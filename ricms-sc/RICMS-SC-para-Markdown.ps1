#requires -Version 5.1
<#
.SYNOPSIS
    Baixa o RICMS/SC (regulamento, anexos e tabela cBenef) e converte para Markdown.
.DESCRIPTION
    Sem parametros abre a interface (Windows Forms), como a ferramenta original.
    Com -Headless roda sem interface em qualquer sistema com PowerShell 7 (pwsh), por exemplo no
    GitHub Actions; a tabela cBenef (PDF) usa o pdftotext do poppler (poppler-utils).
.PARAMETER Headless
    Executa sem interface: baixa, converte e grava os .md; nao faz commit/push (isso fica com o workflow).
.PARAMETER Destino
    Pasta de saida dos .md. Padrao: a pasta fixa usada pela interface.
.PARAMETER PdfToText
    Caminho do pdftotext. No modo -Headless o padrao e o pdftotext encontrado no PATH.
.PARAMETER Only
    Nomes dos arquivos de saida (ex.: RICMS_SC_Anexo_01.md) a converter; omitido = todos.
#>
[CmdletBinding()]
param(
    [switch]$Headless,
    [string]$Destino,
    [string]$PdfToText,
    [string[]]$Only
)
if (-not $Headless) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
}

$Script:LogPath = Join-Path $PSScriptRoot 'erro.log'
$Script:BaseUrl = 'https://legislacao.sef.sc.gov.br/HTML/REGULAMENTOS/ICMS/'
$Script:RepoDir = 'C:\Users\giova\OneDrive\Ferramentas Frasson\Legislação Markdown\Base_Dados'
$Script:OutDir  = "$Script:RepoDir\SKILL\ICMS_SC\Legislacao"
$Script:GitExe  = 'C:\Program Files\Git\cmd\git.exe'
$Script:PdfToTextExe = 'C:\Program Files\Git\mingw64\bin\pdftotext.exe'
$Script:Enc     = [System.Text.Encoding]::GetEncoding(1252)

if ($Destino)   { $Script:OutDir = $Destino }
if ($PdfToText) { $Script:PdfToTextExe = $PdfToText }
elseif ($Headless) {
    $cmdPdf = Get-Command pdftotext -ErrorAction SilentlyContinue
    if ($cmdPdf) { $Script:PdfToTextExe = $cmdPdf.Source }
}

# Documentos do RICMS-SC com URL e nome de arquivo de saida
$Script:Docs = @(
    [pscustomobject]@{ Nome='Regulamento RICMS/SC';                             Url="${Script:BaseUrl}RICMS_01_00.htm";   Arquivo='RICMS_SC_Regulamento.md'  }
    [pscustomobject]@{ Nome='Anexo 1  - Produtos / Tratamento Específico';      Url="${Script:BaseUrl}RICMS_01_01.htm";   Arquivo='RICMS_SC_Anexo_01.md'     }
    [pscustomobject]@{ Nome='Anexo 1A - Bens / Substituição Tributária';        Url="${Script:BaseUrl}RICMS_01_01_A.htm"; Arquivo='RICMS_SC_Anexo_01A.md'    }
    [pscustomobject]@{ Nome='Anexo 2  - Benefícios Fiscais';                    Url="${Script:BaseUrl}RICMS_01_02.htm";   Arquivo='RICMS_SC_Anexo_02.md'     }
    [pscustomobject]@{ Nome='Anexo 3  - Substituição Tributária';               Url="${Script:BaseUrl}RICMS_01_03.htm";   Arquivo='RICMS_SC_Anexo_03.md'     }
    [pscustomobject]@{ Nome='Anexo 4  - Simples Nacional';                      Url="${Script:BaseUrl}RICMS_01_04.htm";   Arquivo='RICMS_SC_Anexo_04.md'     }
    [pscustomobject]@{ Nome='Anexo 5  - Obrigações Acessórias';                 Url="${Script:BaseUrl}RICMS_01_05.htm";   Arquivo='RICMS_SC_Anexo_05.md'     }
    [pscustomobject]@{ Nome='Anexo 6  - Regimes Especiais';                     Url="${Script:BaseUrl}RICMS_01_06.htm";   Arquivo='RICMS_SC_Anexo_06.md'     }
    [pscustomobject]@{ Nome='Anexo 7  - Processamentos de Dados';               Url="${Script:BaseUrl}RICMS_01_07.htm";   Arquivo='RICMS_SC_Anexo_07.md'     }
    [pscustomobject]@{ Nome='Anexo 8  - Equipamentos de Uso Fiscal';            Url="${Script:BaseUrl}RICMS_01_08.htm";   Arquivo='RICMS_SC_Anexo_08.md'     }
    [pscustomobject]@{ Nome='Anexo 9  - Emissor de Cupom Fiscal';               Url="${Script:BaseUrl}RICMS_01_09.htm";   Arquivo='RICMS_SC_Anexo_09.md'     }
    [pscustomobject]@{ Nome='Anexo 10 - Códigos Fiscais';                       Url="${Script:BaseUrl}RICMS_01_10.htm";   Arquivo='RICMS_SC_Anexo_10.md'     }
    [pscustomobject]@{ Nome='Anexo 11 - Obrigações em Meio Eletrônico';         Url="${Script:BaseUrl}RICMS_01_11.htm";   Arquivo='RICMS_SC_Anexo_11.md'     }
    [pscustomobject]@{ Nome='Anexo 12 - Incidência Monofásica / Combustíveis';  Url="${Script:BaseUrl}RICMS_01_12.htm";   Arquivo='RICMS_SC_Anexo_12.md'     }
    [pscustomobject]@{ Nome='Tabela 5.2A - Código de Benefício Fiscal (cBenef)'; Url='https://www.sef.sc.gov.br/api-portal/Documento/ver/1188'; Arquivo='RICMS_SC_cBenef.md'; Tipo='pdf-cbenef' }
)

# ── Logging ───────────────────────────────────────────────────────────────────

function Write-CrashLog([string]$ctx, [object]$err) {
    try {
        $line = "[{0}] {1}: {2}`r`n{3}`r`n---`r`n" -f `
            (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $ctx,
            $err.Exception.Message, $err.Exception.ToString()
        Add-Content -LiteralPath $Script:LogPath -Value $line -Encoding UTF8
    } catch {}
}

if (-not $Headless) {
    [System.Windows.Forms.Application]::SetUnhandledExceptionMode(
        [System.Windows.Forms.UnhandledExceptionMode]::CatchException)
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $Script:ThreadExHandler = {
        param($s, $e)
        Write-CrashLog 'Thread' ([pscustomobject]@{ Exception = $e.Exception })
        [System.Windows.Forms.MessageBox]::Show(
            "Erro:`n$($e.Exception.Message)`n`nLog: $Script:LogPath",
            'RICMS-SC para Markdown', 'OK', 'Error') | Out-Null
    }
    [System.Windows.Forms.Application]::add_ThreadException($Script:ThreadExHandler)
}

# ── Conversão HTML → Markdown ─────────────────────────────────────────────────

function ConvertTo-CleanText([string]$Html) {
    $t = $Html
    $t = $t -replace '(?i)<br\s*/?>', ' '
    $t = $t -replace '<[^>]+>', ''
    $t = $t -replace '&nbsp;', ' '
    $t = $t -replace '&lt;',   '<'
    $t = $t -replace '&gt;',   '>'
    $t = $t -replace '&amp;',  '&'
    $t = $t -replace '&ldquo;|&#8220;', '"'
    $t = $t -replace '&rdquo;|&#8221;', '"'
    $t = $t -replace '&lsquo;|&#8216;', "'"
    $t = $t -replace '&rsquo;|&#8217;', "'"
    $t = [regex]::Replace($t, '&#(\d+);', { [char][int]$args[0].Groups[1].Value })
    return ($t.Trim() -replace '\s+', ' ')
}

function Convert-TableToMarkdown([string]$TableHtml) {
    $sb = New-Object System.Text.StringBuilder
    $rows = [regex]::Matches($TableHtml, '(?si)<tr[^>]*>(.*?)</tr>')
    $headerDone = $false
    foreach ($row in $rows) {
        $cells = [regex]::Matches($row.Groups[1].Value, '(?si)<t[dh][^>]*>(.*?)</t[dh]>')
        if ($cells.Count -eq 0) { continue }
        $cellTexts = @($cells | ForEach-Object { ConvertTo-CleanText $_.Groups[1].Value })
        $line = '| ' + ($cellTexts -join ' | ') + ' |'
        [void]$sb.AppendLine($line)
        if (-not $headerDone) {
            [void]$sb.AppendLine('|' + ('---|' * $cellTexts.Count))
            $headerDone = $true
        }
    }
    return $sb.ToString()
}

function Convert-HtmlToMarkdown([string]$Html) {
    $h = $Html

    # Remove head e scripts
    $h = [regex]::Replace($h, '(?si)<head[^>]*>.*?</head>', '')
    $h = [regex]::Replace($h, '(?si)<script[^>]*>.*?</script>', '')
    $h = [regex]::Replace($h, '(?si)<style[^>]*>.*?</style>', '')

    # Remove linha de data de atualizacao
    # SEFAZ-SC usa atributos SEM aspas: class=versao (nao class="versao")
    # Padrao: class=(?:"NOME"|NOME)\b para suportar ambos os formatos
    $h = [regex]::Replace($h, '(?si)<p\s[^>]*class=(?:"versao"|versao)\b[^>]*>.*?</p>', '')

    # Remove <o:p> (artefatos do Word)
    $h = [regex]::Replace($h, '(?si)<o:p[^>]*>.*?</o:p>', '')

    # Remove links de navegacao (ancora), preservando texto
    $h = $h -replace '(?i)<a\s[^>]*name=[^>]*/>', ''
    $h = [regex]::Replace($h, '(?si)<a\s[^>]*name=[^>]*>(.*?)</a>', '$1')
    $h = [regex]::Replace($h, '(?si)<a\s[^>]*href=[^>]*>(.*?)</a>', '$1')

    # Converte tabelas para Markdown antes de processar paragrafos
    $h = [regex]::Replace($h, '(?si)<table[^>]*>(.*?)</table>', {
        param($m)
        "`n" + (Convert-TableToMarkdown $m.Value) + "`n"
    })

    # Converte paragrafos de acordo com classe CSS
    # SEFAZ-SC usa aspas opcionais; \b apos o nome garante fim de palavra (nao consome ">")
    # documento / documento01 / documento010 → # (titulo principal H1)
    # Variantes: documento (Anexo 4, 7), documento01 (maioria), documento010 (Anexo 9)
    $h = [regex]::Replace($h, '(?si)<p\s[^>]*class=(?:"documento\w*"|documento\w*)\b[^>]*>(.*?)</p>', {
        param($m)
        $t = ConvertTo-CleanText $m.Groups[1].Value
        if ($t) { "`n# $t`n" } else { '' }
    })
    # titulo03 / titulocentralizado → ## (nivel TITULO, acima de CAPITULO)
    $h = [regex]::Replace($h, '(?si)<p\s[^>]*class=(?:"titulo03"|titulo03|"titulocentralizado"|titulocentralizado)\b[^>]*>(.*?)</p>', {
        param($m)
        $t = ConvertTo-CleanText $m.Groups[1].Value
        if ($t) { "`n## $t`n" } else { '' }
    })
    # capitulo04 / capitulo → ## (capítulo)
    $h = [regex]::Replace($h, '(?si)<p\s[^>]*class=(?:"capitulo04"|capitulo04|"capitulo"|capitulo)\b[^>]*>(.*?)</p>', {
        param($m)
        $t = ConvertTo-CleanText $m.Groups[1].Value
        if ($t) { "`n## $t`n" } else { '' }
    })
    # secao05 / secao → ### (seção)
    $h = [regex]::Replace($h, '(?si)<p\s[^>]*class=(?:"secao05"|secao05|"secao"|secao)\b[^>]*>(.*?)</p>', {
        param($m)
        $t = ConvertTo-CleanText $m.Groups[1].Value
        if ($t) { "`n### $t`n" } else { '' }
    })
    # subsecao06 / subsecao → #### (subseção)
    $h = [regex]::Replace($h, '(?si)<p\s[^>]*class=(?:"subsecao06"|subsecao06|"subsecao"|subsecao)\b[^>]*>(.*?)</p>', {
        param($m)
        $t = ConvertTo-CleanText $m.Groups[1].Value
        if ($t) { "`n#### $t`n" } else { '' }
    })
    # notattulo / notattulo0 → nota em negrito
    $h = [regex]::Replace($h, '(?si)<p\s[^>]*class=(?:"notattulo\w*"|notattulo\w*)\b[^>]*>(.*?)</p>', {
        param($m)
        $t = ConvertTo-CleanText $m.Groups[1].Value
        if ($t) { "`n> **$t**" } else { '' }
    })
    # notatexto → blockquote
    $h = [regex]::Replace($h, '(?si)<p\s[^>]*class=(?:"notatexto"|notatexto)\b[^>]*>(.*?)</p>', {
        param($m)
        $t = ConvertTo-CleanText $m.Groups[1].Value
        if ($t) { "> $t" } else { '' }
    })
    # paragrafos restantes (redaoatual, redaoatualtabela, etc.)
    $h = [regex]::Replace($h, '(?si)<p[^>]*>(.*?)</p>', {
        param($m)
        $t = ConvertTo-CleanText $m.Groups[1].Value
        if ($t) { "`n$t" } else { '' }
    })

    # Bold e italic residuais
    $h = [regex]::Replace($h, '(?si)<(?:b|strong)[^>]*>(.*?)</(?:b|strong)>', '**$1**')
    $h = [regex]::Replace($h, '(?si)<(?:i|em)[^>]*>(.*?)</(?:i|em)>', '*$1*')

    # Remove todas as tags HTML restantes
    $h = $h -replace '<[^>]+>', ''

    # Decodifica entidades HTML remanescentes
    $h = $h -replace '&nbsp;', ' '
    $h = $h -replace '&quot;', '"'
    $h = $h -replace '&lt;',   '<'
    $h = $h -replace '&gt;',   '>'
    $h = $h -replace '&amp;',  '&'
    $h = [regex]::Replace($h, '&#(\d+);', { [char][int]$args[0].Groups[1].Value })

    # Normaliza espacos e quebras de linha
    $h = $h -replace '\r\n|\r', "`n"
    $h = $h -replace '[ \t]+',  ' '
    $h = $h -replace '\n ',     "`n"
    # Remove linhas que contem apenas ** (negrito orfao de tag vazia)
    $h = $h -replace '(?m)^\*\*\s*$', ''
    $h = [regex]::Replace($h, '\n{3,}', "`n`n")

    # Converte headings que contem APENAS referencias em parenteses de volta para texto simples
    # Ex: "### (Convênio ICMS 100/97...)" → "(Convênio ICMS 100/97...)"
    # Tambem cobre referencias sem fechamento de parentese (texto truncado do HTML original)
    # Isso evita que citacoes legais aparecam como titulos de secao no documento
    $h = [regex]::Replace($h, '(?m)^#+\s+(\(.+)\s*$', '$1')

    # Merge headings consecutivos do mesmo nivel (titulo dividido em dois paragrafos no HTML)
    # Ex: "# ANEXO 12\n\n# DA INCIDÊNCIA..." → "# ANEXO 12 DA INCIDÊNCIA..."
    # Condicoes para NAO mesclar:
    #   - Primeiro heading comeca com "(" (referencia pura)
    #   - Primeiro heading termina com ")" (heading completo que ja tem referencia no fim)
    #   - Primeiro heading termina com REVOGADA (titulo completo, ex: "Subsecao IV-A - REVOGADA")
    #   - Segundo heading comeca com palavra estrutural (Secao, Subsecao, Capitulo, Titulo, Art.)
    foreach ($lvl in @('####', '###', '##', '#')) {
        $esc = [regex]::Escape($lvl)
        $h = [regex]::Replace($h, "(?m)^($esc [^(\n][^\n]*[^)\n])\n\n$esc ([^\n]+)", {
            param($m)
            $first  = $m.Groups[1].Value
            $second = $m.Groups[2].Value
            if ($first  -match '(?i)\bREVOGADA\.?\s*$') { return $m.Value }
            if ($second -match '^(?i)(Se[cç][aã]o|Subse[cç][aã]o|Cap[ií]tulo|T[ií]tulo|Art\.)\s') { return $m.Value }
            return "$first $second"
        })
    }

    # Merge tabelas Markdown consecutivas com mesmo numero de colunas (ate 8 passadas)
    # Tabelas separadas apenas por linha em branco e mesma estrutura de colunas sao consolidadas
    $mergePat = [scriptblock]{
        param($m)
        $c1 = ([regex]::Matches($m.Groups[1].Value, '\|') | Measure-Object).Count - 1
        $c2 = ([regex]::Matches($m.Groups[2].Value, '\|') | Measure-Object).Count - 1
        $cs = ([regex]::Matches($m.Groups[3].Value, '\|') | Measure-Object).Count - 1
        if ($c1 -gt 0 -and $c1 -eq $c2 -and $c1 -eq $cs) {
            return "$($m.Groups[1].Value)`n$($m.Groups[2].Value)"
        }
        return $m.Value
    }
    $prevLen = -1
    for ($pass = 0; $pass -lt 8 -and $h.Length -ne $prevLen; $pass++) {
        $prevLen = $h.Length
        $h = [regex]::Replace($h, '(?m)(\|[^\n]+)\n\n(\|[^\n]+)\n(\|[-| :]+\|[^\n]*)', $mergePat)
    }
    $h = [regex]::Replace($h, '\n{3,}', "`n`n")

    # Normaliza hierarquia de headings para evitar saltos de nivel
    # Usa substituicao de passagem unica (regex com scriptblock) para evitar promocao em cascata
    # Caso 1: sem H1 → decrementa todos os niveis em 1 (## vira #, ### vira ##, etc.)
    if ($h -notmatch '(?m)^# [^#]') {
        $h = [regex]::Replace($h, '(?m)^(#+) ', {
            param($m)
            $newLvl = [Math]::Max(1, $m.Groups[1].Value.Length - 1)
            ('#' * $newLvl) + ' '
        })
    }
    # Caso 2: tem H1 mas sem H2 → decrementa apenas niveis H3+ em 1 (### vira ##, #### vira ###)
    elseif ($h -notmatch '(?m)^## [^#]') {
        $h = [regex]::Replace($h, '(?m)^(###+) ', {
            param($m)
            $newLvl = [Math]::Max(2, $m.Groups[1].Value.Length - 1)
            ('#' * $newLvl) + ' '
        })
    }

    return $h.Trim()
}

function Get-DownloadAndConvert([string]$Url, [string]$Nome, [scriptblock]$OnStatus, [string]$Tipo = 'html') {
    & $OnStatus "Baixando: $Nome..."
    if ($Tipo -eq 'pdf-cbenef') {
        $tmpPdf = Join-Path ([System.IO.Path]::GetTempPath()) 'cbenef_sef_sc.pdf'
        $wcp = New-Object System.Net.WebClient
        $wcp.Headers['User-Agent'] = 'RICMS-SC-para-Markdown/1.0'
        $wcp.DownloadFile($Url, $tmpPdf)
        & $OnStatus "Convertendo: $Nome..."
        try   { return Convert-CbenefPdfToMarkdown $tmpPdf $Url }
        finally { if (Test-Path $tmpPdf) { Remove-Item -LiteralPath $tmpPdf -Force } }
    }
    $wc = New-Object System.Net.WebClient
    $wc.Encoding = $Script:Enc
    $wc.Headers['User-Agent'] = 'RICMS-SC-para-Markdown/1.0'
    $html = $wc.DownloadString($Url)

    & $OnStatus "Convertendo: $Nome..."
    $md = Convert-HtmlToMarkdown $html

    $header = "> Fonte: $Url`n> Baixado em: $(Get-Date -Format 'dd/MM/yyyy HH:mm')`n`n---`n`n"
    if (-not $md -or $md.Trim().Length -lt 20) {
        $md = "> **Documento sem conteúdo disponível.**`n>`n> O documento '$Nome' existe no portal da SEFAZ-SC mas não possui texto publicado no momento do download."
    }
    return $header + $md
}

# ── Conversão PDF cBenef (Tabela 5.2A) → Markdown ────────────────────────────
# Usa pdftotext (instalado junto com o Git for Windows) em modo -table e
# reconstroi as linhas da tabela a partir da posicao das colunas.

function Convert-CbenefPdfToMarkdown([string]$PdfPath, [string]$Url) {
    $pdftotext = $Script:PdfToTextExe
    if (-not (Test-Path $pdftotext)) { throw "pdftotext nao encontrado em $pdftotext (instale o Git for Windows)." }

    $txtPath = [System.IO.Path]::ChangeExtension($PdfPath, '.txt')
    & $pdftotext -enc UTF-8 -table $PdfPath $txtPath 2>&1 | Out-Null
    if (-not (Test-Path $txtPath)) {
        # poppler nao tem -table (so o xpdf do Git for Windows tem): -layout mantem as colunas alinhadas
        & $pdftotext -enc UTF-8 -layout $PdfPath $txtPath 2>&1 | Out-Null
    }
    if (-not (Test-Path $txtPath)) { throw 'Falha ao extrair texto do PDF (pdftotext).' }
    $txt = [System.IO.File]::ReadAllText($txtPath, [System.Text.Encoding]::UTF8)
    Remove-Item $txtPath -Force -ErrorAction SilentlyContinue

    $cc = [char]0x00E7; $ca = [char]0x00E3; $ce = [char]0x00E9; $cAg = [char]0x00E1
    $ci = [char]0x00ED; $co = [char]0x00F3; $cx = [char]0x00EA; $dash = [char]0x2014
    $tCred = "Cr${ce}dito Presumido"
    $tRed  = "Redu${cc}${ca}o de Base de C${cAg}lculo"
    $tIsen = "Isen${cc}${ca}o"
    $tSusp = "Suspens${ca}o da exigibilidade"
    $tNInc = "N${ca}o incid${cx}ncia"

    $cstNames = '00','02','10','15','20','30','40','41','50','51','53','60','61','70','90'
    $dscRx    = [regex]'^((Isen\w+|Diferimento|Cr\wdito Presumido|Redu\w+ de Base de C\wlculo|Suspens\wo da [Ee]xigibilidade|N\wo[- ]incid\w+)\.|[\w -]{4,60}\.\s?ICMS\b|Opera\w+ ou presta|Benef\w+ fiscal cujo)'
    $preRx    = [regex]'^[\w -]{4,60}\.\s?(ICMS\.)?\s*'
    $dateRx   = [regex]'\d\d/\d\d/\d{4}'

    # 1) fatia cada linha da tabela por coluna, usando o cabecalho de cada pagina
    $linhas = New-Object System.Collections.ArrayList
    foreach ($pg in ($txt -split "`f")) {
        $ls = $pg -split "`r?`n"
        $hi = -1
        for ($i = 0; $i -lt $ls.Count; $i++) { if ($ls[$i].StartsWith('Benef')) { $hi = $i; break } }
        if ($hi -lt 0) { continue }
        $h = $ls[$hi]
        $dpos = $h.IndexOf('Descri')
        $spos = $h.IndexOf('Simples')
        $lpos = $h.IndexOf('Legisla')
        $kpos = [regex]::Match($h, 'C.digo\s+do\s+benef').Index
        $vpos = [regex]::Match($h, 'Vig.ncia\s+In').Index
        $fpos = [regex]::Match($h, 'Vig.ncia\s+Fim').Index
        $cpos = @{}
        foreach ($c in $cstNames) { $cpos[$c] = [regex]::Match($h, "CST\s+$c").Index }
        if ($dpos -lt 0 -or $spos -lt 0 -or $lpos -lt 0 -or $kpos -le 0 -or $vpos -le 0 -or $fpos -le 0) { continue }
        for ($i = $hi + 1; $i -lt $ls.Count; $i++) {
            $l = $ls[$i]
            if ([string]::IsNullOrWhiteSpace($l)) { continue }
            if ($l -match '^\d\d/\d\d/\d{4} \d\d:') { continue }
            if ($l -match '^\s*Nacional\s*$') { continue }
            $l = $l.PadRight($fpos + 20)
            $csts = @()
            foreach ($c in $cstNames) {
                if ($l.Substring($cpos[$c] - 2, 7).Trim()) { $csts += $c }
            }
            [void]$linhas.Add([pscustomobject]@{
                Desc    = ($l.Substring($dpos, $spos - $dpos).Trim() -replace '\s+', ' ')
                Simples = $l.Substring($spos, $cpos['00'] - 2 - $spos).Trim()
                Csts    = $csts
                Leg     = $l.Substring($lpos, $kpos - $lpos).Trim()
                Code    = $l.Substring($kpos, $vpos - $kpos).Trim()
                Vi      = $l.Substring($vpos, $fpos - $vpos).Trim()
                Vf      = $l.Substring($fpos).Trim()
            })
        }
    }
    if ($linhas.Count -eq 0) { throw 'Nenhuma linha reconhecida no PDF do cBenef (layout mudou?).' }

    # 2) agrupa linhas em registros: um registro comeca onde a descricao comeca com o tipo do beneficio
    $idx = @(0..($linhas.Count - 1) | Where-Object { $dscRx.IsMatch($linhas[$_].Desc) })
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("> Fonte: $Url (Tabela 5.2A - cBenef, SEF/SC)")
    [void]$sb.AppendLine("> Baixado em: $(Get-Date -Format 'dd/MM/yyyy HH:mm')")
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('---')
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine("# Tabela 5.2A $dash C${co}digo de Benef${ci}cio Fiscal (cBenef) $dash SEF/SC")
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine("Campo ``cBenef`` da NF-e/NFC-e. Cada linha traz o c${co}digo, o tipo do benef${ci}cio, a descri${cc}${ca}o, a aplica${cc}${ca}o ao Simples Nacional, os CSTs em que o c${co}digo pode ser informado, a legisla${cc}${ca}o de origem e a vig${cx}ncia.")
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine("| C${co}digo cBenef | Tipo | Descri${cc}${ca}o | Simples Nacional | CSTs | Legisla${cc}${ca}o | Vig${cx}ncia in${ci}cio | Vig${cx}ncia fim |")
    [void]$sb.AppendLine('|---|---|---|---|---|---|---|---|')

    $nReg = 0
    for ($k = 0; $k -lt $idx.Count; $k++) {
        $ini = $idx[$k]
        $fim = if ($k + 1 -lt $idx.Count) { $idx[$k + 1] - 1 } else { $linhas.Count - 1 }
        $seg = @($linhas[$ini..$fim])

        $desc  = (($seg | ForEach-Object { $_.Desc } | Where-Object { $_ }) -join ' ') -replace '\s+', ' '
        $codes = @($seg | ForEach-Object { [regex]::Match($_.Code, 'SC\d{6}').Value } | Where-Object { $_ })
        $leg   = (($seg | ForEach-Object { $_.Leg } | Where-Object { $_ }) -join ' ') -replace '\s+', ' '
        $simp  = (($seg | ForEach-Object { $_.Simples } | Where-Object { $_ }) -join ' ').Trim()
        $csts  = @($seg | ForEach-Object { $_.Csts } | Sort-Object -Unique)
        $vi    = ($seg | ForEach-Object { $dateRx.Match($_.Vi).Value } | Where-Object { $_ } | Select-Object -First 1)
        $vf    = ($seg | ForEach-Object { $dateRx.Match($_.Vf).Value } | Where-Object { $_ } | Select-Object -First 1)

        # tipo do beneficio (normalizado) e descricao sem o prefixo "Tipo. ICMS."
        $tipo = '-'
        $m = [regex]::Match($desc, '^([\w -]{4,60})\.\s?(ICMS\b|)')
        if ($m.Success -and $desc -notmatch '^(Opera\w+ ou presta|Benef\w+ fiscal cujo)') {
            $t = $m.Groups[1].Value.Trim()
            if     ($t -match '^(?i:isen|inse)')    { $tipo = $tIsen }
            elseif ($t -match '^(?i:cr.dito)')      { $tipo = $tCred }
            elseif ($t -match '^(?i:redu)')         { $tipo = $tRed }
            elseif ($t -match '^(?i:suspens)')      { $tipo = $tSusp }
            elseif ($t -match '^(?i:n.o[- ]incid)') { $tipo = $tNInc }
            else                                    { $tipo = $t }
            $desc = $preRx.Replace($desc, '', 1)
        }

        $codeTxt = if ($codes.Count) { $codes -join ', ' } else { '(sem preenchimento do cBenef)' }
        $simTxt  = if ($simp -match '^S') { 'Sim' } elseif ($simp -match '^N') { "N${ca}o" } else { '-' }
        $cstTxt  = if ($csts.Count) { $csts -join ', ' } else { '-' }
        if (-not $leg) { $leg = '-' }
        if (-not $vi)  { $vi  = '-' }
        if (-not $vf)  { $vf  = '-' }
        $desc = $desc.Replace('|', '\|'); $leg = $leg.Replace('|', '\|')

        [void]$sb.AppendLine("| $codeTxt | $tipo | $desc | $simTxt | $cstTxt | $leg | $vi | $vf |")
        $nReg++
    }
    if ($nReg -lt 100) { throw "Conversao do cBenef suspeita: apenas $nReg registros reconhecidos." }
    return $sb.ToString()
}

# ── Execucao sem interface (-Headless): GitHub Actions / pwsh ─────────────────

if ($Headless) {
    $docsRun = @($Script:Docs)
    if ($Only) { $docsRun = @($docsRun | Where-Object { $Only -contains $_.Arquivo }) }
    if ($docsRun.Count -eq 0) { Write-Host 'Nenhum documento selecionado.'; exit 2 }

    if (-not (Test-Path -LiteralPath $Script:OutDir)) { [void](New-Item -ItemType Directory -Path $Script:OutDir -Force) }
    $okCount = 0
    $errList = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $docsRun.Count; $i++) {
        $doc = $docsRun[$i]
        Write-Host ("[{0}/{1}] {2}" -f ($i + 1), $docsRun.Count, $doc.Nome)
        try {
            $tipoDoc = if ($doc.PSObject.Properties['Tipo']) { $doc.Tipo } else { 'html' }
            $md = Get-DownloadAndConvert -Url $doc.Url -Nome $doc.Nome -Tipo $tipoDoc -OnStatus { param($msg) Write-Host "    $msg" }
            [System.IO.File]::WriteAllText((Join-Path $Script:OutDir $doc.Arquivo), $md, [System.Text.Encoding]::UTF8)
            $okCount++
        } catch {
            Write-CrashLog "Conv:$($doc.Nome)" $_
            [void]$errList.Add("$($doc.Nome): $($_.Exception.Message)")
            Write-Host "    ERRO: $($_.Exception.Message)"
        }
    }
    Write-Host ("Concluido: {0} arquivo(s) gravado(s) em {1}; {2} erro(s)." -f $okCount, $Script:OutDir, $errList.Count)
    foreach ($e in $errList) { Write-Host "  - $e" }
    exit $(if ($errList.Count -gt 0) { 1 } else { 0 })
}

# ── Interface ─────────────────────────────────────────────────────────────────

$form = New-Object System.Windows.Forms.Form
$form.Text            = 'RICMS-SC para Markdown'
$form.StartPosition   = 'CenterScreen'
$form.Size            = New-Object System.Drawing.Size(680, 560)
$form.MinimumSize     = $form.Size
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox     = $false
$form.Font            = New-Object System.Drawing.Font('Segoe UI', 10)
$form.Icon            = [System.Drawing.SystemIcons]::Application

# Label documentos
$lbl1 = New-Object System.Windows.Forms.Label
$lbl1.Text     = 'Documentos RICMS/SC para baixar:'
$lbl1.Location = New-Object System.Drawing.Point(20, 18)
$lbl1.AutoSize = $true
$form.Controls.Add($lbl1)

# CheckedListBox com todos os documentos
$clb = New-Object System.Windows.Forms.CheckedListBox
$clb.Location            = New-Object System.Drawing.Point(20, 42)
$clb.Size                = New-Object System.Drawing.Size(440, 310)
$clb.CheckOnClick        = $true
$clb.HorizontalScrollbar = $false
$clb.IntegralHeight      = $false
foreach ($doc in $Script:Docs) {
    [void]$clb.Items.Add($doc.Nome, $true)
}
$form.Controls.Add($clb)

# Botoes Selecionar Todos / Limpar Seleção
$btnAll = New-Object System.Windows.Forms.Button
$btnAll.Text     = 'Selecionar Todos'
$btnAll.Location = New-Object System.Drawing.Point(474, 42)
$btnAll.Size     = New-Object System.Drawing.Size(170, 32)
$btnAll.Cursor   = [System.Windows.Forms.Cursors]::Hand
$btnAll.Add_Click({
    for ($i = 0; $i -lt $clb.Items.Count; $i++) { $clb.SetItemChecked($i, $true) }
})
$form.Controls.Add($btnAll)

$btnNone = New-Object System.Windows.Forms.Button
$btnNone.Text     = 'Limpar Seleção'
$btnNone.Location = New-Object System.Drawing.Point(474, 82)
$btnNone.Size     = New-Object System.Drawing.Size(170, 32)
$btnNone.Cursor   = [System.Windows.Forms.Cursors]::Hand
$btnNone.Add_Click({
    for ($i = 0; $i -lt $clb.Items.Count; $i++) { $clb.SetItemChecked($i, $false) }
})
$form.Controls.Add($btnNone)

# Separador
$sep = New-Object System.Windows.Forms.Label
$sep.BorderStyle = 'Fixed3D'
$sep.Location    = New-Object System.Drawing.Point(20, 366)
$sep.Size        = New-Object System.Drawing.Size(624, 2)
$form.Controls.Add($sep)

# Pasta de destino fixa
$lbl2 = New-Object System.Windows.Forms.Label
$lbl2.Text      = "Destino: GitHub › giovanifrasson/Base_Dados › SKILL/ICMS_SC/Legislacao"
$lbl2.Location  = New-Object System.Drawing.Point(20, 380)
$lbl2.AutoSize  = $true
$lbl2.ForeColor = [System.Drawing.Color]::FromArgb(0, 110, 0)
$form.Controls.Add($lbl2)

# Botoes Converter e Fechar
$btnConv = New-Object System.Windows.Forms.Button
$btnConv.Text     = 'Baixar e Converter'
$btnConv.Font     = New-Object System.Drawing.Font('Segoe UI Semibold', 11)
$btnConv.Location = New-Object System.Drawing.Point(20, 406)
$btnConv.Size     = New-Object System.Drawing.Size(200, 46)
$btnConv.Cursor   = [System.Windows.Forms.Cursors]::Hand
$form.Controls.Add($btnConv)

$btnFech = New-Object System.Windows.Forms.Button
$btnFech.Text     = 'Fechar'
$btnFech.Font     = New-Object System.Drawing.Font('Segoe UI', 11)
$btnFech.Location = New-Object System.Drawing.Point(524, 406)
$btnFech.Size     = New-Object System.Drawing.Size(120, 46)
$btnFech.Cursor   = [System.Windows.Forms.Cursors]::Hand
$btnFech.Add_Click({ $form.Close() })
$form.Controls.Add($btnFech)

# ProgressBar e status
$lblSt = New-Object System.Windows.Forms.Label
$lblSt.Text     = 'Selecione os documentos e clique em Baixar e Converter.'
$lblSt.Location = New-Object System.Drawing.Point(20, 464)
$lblSt.Size     = New-Object System.Drawing.Size(624, 22)
$form.Controls.Add($lblSt)

$lblPct = New-Object System.Windows.Forms.Label
$lblPct.Text      = '0%'
$lblPct.Location  = New-Object System.Drawing.Point(605, 490)
$lblPct.AutoSize  = $true
$lblPct.Font      = New-Object System.Drawing.Font('Segoe UI Semibold', 10)
$form.Controls.Add($lblPct)

$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(20, 490)
$bar.Size     = New-Object System.Drawing.Size(580, 22)
$bar.Minimum  = 0
$bar.Maximum  = 100
$bar.Style    = 'Continuous'
$form.Controls.Add($bar)

# ── Handler do botao Converter ────────────────────────────────────────────────

$Script:AllCtrls = @($btnConv, $btnFech, $btnAll, $btnNone, $clb)

$btnConv.Add_Click({
    try {
        $selecionados = @(0..($clb.Items.Count - 1) | Where-Object { $clb.GetItemChecked($_) } |
            ForEach-Object { $Script:Docs[$_] })

        if ($selecionados.Count -eq 0) { throw 'Selecione pelo menos um documento.' }

        $outDir = $Script:OutDir
        if (-not (Test-Path $outDir)) { [void](New-Item -ItemType Directory -Path $outDir -Force) }

        foreach ($c in $Script:AllCtrls) { $c.Enabled = $false }
        $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
        $lblSt.ForeColor = [System.Drawing.SystemColors]::ControlText
        $bar.Value = 0; $lblPct.Text = '0%'; $form.Refresh()

        $n    = $selecionados.Count
        $ok   = 0
        $errs = New-Object System.Collections.ArrayList

        for ($i = 0; $i -lt $n; $i++) {
            $doc     = $selecionados[$i]
            $pct     = [int](($i / $n) * 100)
            $bar.Value   = $pct
            $lblPct.Text = "$pct%"
            $lblSt.Text  = "($($i+1)/$n) $($doc.Nome)..."
            $form.Refresh()
            [System.Windows.Forms.Application]::DoEvents()

            try {
                $tipoDoc = if ($doc.PSObject.Properties['Tipo']) { $doc.Tipo } else { 'html' }
                $md      = Get-DownloadAndConvert -Url $doc.Url -Nome $doc.Nome -Tipo $tipoDoc -OnStatus {
                    param($msg)
                    $lblSt.Text = "($($i+1)/$n) $msg"
                    $form.Refresh()
                    [System.Windows.Forms.Application]::DoEvents()
                }
                $outFile = Join-Path $outDir $doc.Arquivo
                [System.IO.File]::WriteAllText($outFile, $md, [System.Text.Encoding]::UTF8)
                $ok++
            } catch {
                Write-CrashLog "Conv:$($doc.Nome)" $_
                [void]$errs.Add("$($doc.Nome): $($_.Exception.Message)")
            }
        }

        $bar.Value = 100; $lblPct.Text = '100%'

        # Publicar no GitHub se houver arquivos convertidos com sucesso
        $gitMsg = ''
        if ($ok -gt 0 -and (Test-Path $Script:GitExe) -and (Test-Path "$Script:RepoDir\.git")) {
            try {
                $lblSt.ForeColor = [System.Drawing.SystemColors]::ControlText
                $lblSt.Text = 'Sincronizando com GitHub...'
                $form.Refresh(); [System.Windows.Forms.Application]::DoEvents()
                # Puxar alteracoes remotas antes de enviar (evita conflito se arquivo foi apagado no GitHub)
                & $Script:GitExe -C $Script:RepoDir fetch origin main 2>&1 | Out-Null
                $data = Get-Date -Format 'dd/MM/yyyy HH:mm'
                & $Script:GitExe -C $Script:RepoDir add 'SKILL/ICMS_SC/Legislacao/' 2>&1 | Out-Null
                $gitOut = & $Script:GitExe -C $Script:RepoDir commit -m "Atualiza RICMS-SC: $ok arquivo(s) – $data" 2>&1
                if ($LASTEXITCODE -eq 0) {
                    # Merge automatico: nossa versao sempre prevalece sobre exclusoes remotas
                    & $Script:GitExe -C $Script:RepoDir merge -X ours origin/main --no-edit 2>&1 | Out-Null
                    & $Script:GitExe -C $Script:RepoDir push origin main 2>&1 | Out-Null
                    $gitMsg = "`nPublicado no GitHub (giovanifrasson/Base_Dados)."
                } else {
                    $gitMsg = "`nGitHub: nenhuma alteracao detectada."
                }
            } catch {
                Write-CrashLog 'GitHub' $_
                $gitMsg = "`nAviso: falha ao publicar no GitHub. Arquivos salvos localmente."
            }
        }

        if ($errs.Count -eq 0) {
            $lblSt.ForeColor = [System.Drawing.Color]::DarkGreen
            $lblSt.Text = "Concluido! $ok arquivo(s) salvos.$gitMsg"
            [System.Windows.Forms.MessageBox]::Show(
                "Conversao concluida!`n`n$ok documento(s) baixado(s) e convertido(s).$gitMsg",
                'RICMS-SC para Markdown', 'OK', 'Information') | Out-Null
        } else {
            $errTxt = $errs -join "`n"
            $lblSt.ForeColor = [System.Drawing.Color]::DarkOrange
            $lblSt.Text = "$ok convertido(s). $($errs.Count) erro(s).$gitMsg"
            [System.Windows.Forms.MessageBox]::Show(
                "$ok convertido(s).$gitMsg`n`nErros:`n$errTxt",
                'RICMS-SC para Markdown', 'OK', 'Warning') | Out-Null
        }
    } catch {
        Write-CrashLog 'Converter' $_
        $lblSt.ForeColor = [System.Drawing.Color]::DarkRed
        $lblSt.Text = "Erro: $($_.Exception.Message)"
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message, 'RICMS-SC para Markdown', 'OK', 'Error') | Out-Null
    } finally {
        foreach ($c in $Script:AllCtrls) { $c.Enabled = $true }
        $form.Cursor = [System.Windows.Forms.Cursors]::Default
    }
})

try {
    [void]$form.ShowDialog()
} catch {
    Write-CrashLog 'Start' $_
    [System.Windows.Forms.MessageBox]::Show(
        "Erro ao iniciar:`n$($_.Exception.Message)`n`nLog: $Script:LogPath",
        'RICMS-SC para Markdown', 'OK', 'Error') | Out-Null
} finally {
    $form.Dispose()
}
