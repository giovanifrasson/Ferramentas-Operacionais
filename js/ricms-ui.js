/* ricms-ui.js - tela do RICMS-SC (dispara/consulta o workflow do GitHub Actions) */
(function () {
  'use strict';
  const { $, esc } = window.UI;

  // espelho de $Script:Docs em ricms-sc/RICMS-SC-para-Markdown.ps1
  const DOCS = [
    ['Regulamento RICMS/SC', 'RICMS_SC_Regulamento.md'],
    ['Anexo 1 - Produtos / Tratamento Específico', 'RICMS_SC_Anexo_01.md'],
    ['Anexo 1A - Bens / Substituição Tributária', 'RICMS_SC_Anexo_01A.md'],
    ['Anexo 2 - Benefícios Fiscais', 'RICMS_SC_Anexo_02.md'],
    ['Anexo 3 - Substituição Tributária', 'RICMS_SC_Anexo_03.md'],
    ['Anexo 4 - Simples Nacional', 'RICMS_SC_Anexo_04.md'],
    ['Anexo 5 - Obrigações Acessórias', 'RICMS_SC_Anexo_05.md'],
    ['Anexo 6 - Regimes Especiais', 'RICMS_SC_Anexo_06.md'],
    ['Anexo 7 - Processamentos de Dados', 'RICMS_SC_Anexo_07.md'],
    ['Anexo 8 - Equipamentos de Uso Fiscal', 'RICMS_SC_Anexo_08.md'],
    ['Anexo 9 - Emissor de Cupom Fiscal', 'RICMS_SC_Anexo_09.md'],
    ['Anexo 10 - Códigos Fiscais', 'RICMS_SC_Anexo_10.md'],
    ['Anexo 11 - Obrigações em Meio Eletrônico', 'RICMS_SC_Anexo_11.md'],
    ['Anexo 12 - Incidência Monofásica / Combustíveis', 'RICMS_SC_Anexo_12.md'],
    ['Tabela 5.2A - Código de Benefício Fiscal (cBenef)', 'RICMS_SC_cBenef.md']
  ];

  const RESULT = {
    success: ['ok', 'Concluída'],
    failure: ['err', 'Falhou'],
    cancelled: ['mute', 'Cancelada'],
    skipped: ['mute', 'Ignorada']
  };

  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  async function loadRuns() {
    const box = $('ricms-runs');
    box.textContent = 'Carregando…';
    const url = 'https://api.github.com/repos/' + CONFIG.repo + '/actions/workflows/' + CONFIG.workflow + '/runs?per_page=8';
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
      if (resp.status === 404) { box.textContent = 'Workflow ainda não encontrado em ' + CONFIG.repo + ' (repositório privado ou ainda não publicado).'; return; }
      if (!resp.ok) throw new Error('GitHub respondeu ' + resp.status);
      const data = await resp.json();
      if (!data.workflow_runs.length) { box.textContent = 'Nenhuma execução ainda.'; return; }
      const rows = data.workflow_runs.map(r => {
        const [cls, label] = r.status !== 'completed' ? ['warn', r.status === 'queued' ? 'Na fila' : 'Em execução'] : (RESULT[r.conclusion] || ['mute', r.conclusion || '-']);
        return '<tr><td>' + esc(fmtDate(r.created_at)) + '</td><td><span class="pill ' + cls + '">' + esc(label) + '</span></td><td>' + esc(r.actor ? r.actor.login : '') +
          '</td><td><a href="' + esc(r.html_url) + '" target="_blank" rel="noopener">Ver execução</a></td></tr>';
      }).join('');
      box.innerHTML = '<table class="runs"><thead><tr><th>Início</th><th>Situação</th><th>Por</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
    } catch (e) {
      box.textContent = 'Não foi possível consultar o GitHub: ' + e.message;
    }
  }

  window.Tools.ricms = {
    init() {
      $('ricms-run').href = 'https://github.com/' + CONFIG.repo + '/actions/workflows/' + CONFIG.workflow;
      $('ricms-docs').innerHTML = DOCS.map(([nome, arq]) => '<li>' + esc(nome) + '<br><code>' + esc(arq) + '</code></li>').join('');
      $('ricms-refresh').addEventListener('click', loadRuns);
      loadRuns();
    }
  };
})();
