# Ferramentas Operacionais

Site estático (HTML, CSS e JS puro, tema claro, menu lateral) com três ferramentas portadas dos scripts PowerShell de `ferramentas/`:

| Ferramenta | Como funciona |
|---|---|
| **Ajuste de Inventário** | Lê com SheetJS, calcula em decimal (decimal.js) e grava com ExcelJS. Tudo no navegador. |
| **PDF para Markdown** | Extrai texto com pdf.js e monta o Markdown. Tudo no navegador. |
| **RICMS-SC** | GitHub Actions roda `ricms-sc/RICMS-SC-para-Markdown.ps1` (`-Headless`) com `pwsh` + poppler e publica os `.md` em `Base_Dados`. |

As bibliotecas vêm do cdnjs (sem build, sem `npm`). Para ver localmente: `python -m http.server` nesta pasta e abrir `http://localhost:8000`.

## Publicar
1. Repositório `giovanifrasson/Ferramentas-Operacionais` → *Settings › Pages › Deploy from a branch › `main` / root*.
2. Secret `BASE_DADOS_TOKEN` (*Settings › Secrets and variables › Actions*): token fine-grained com **Contents: Read and write** apenas em `giovanifrasson/Base_Dados`. Sem o secret o workflow roda e deixa os `.md` só como artefato.
3. *Actions › RICMS-SC para Markdown › Run workflow* (a tela RICMS-SC do site mostra o histórico).

O repositório e o workflow são configurados em `js/config.js`.

## Estrutura
```
index.html  css/styles.css
js/app.js            navegação, carregamento sob demanda, utilidades
js/inventario-*.js   núcleo (porte do .ps1) e tela
js/pdfmd-*.js        núcleo (porte do .ps1) e tela;  js/zip.js  gerador de .zip
js/ricms-ui.js       tela do RICMS-SC;  js/psnet.js  diferenças PS 5.1 × JS
ricms-sc/            RICMS-SC-para-Markdown.ps1 (original + -Headless)
.github/workflows/ricms-sc.yml
```
A comparação com os originais está em `../Comparacao-Ferramentas/RELATORIO-COMPARACAO.md`.
