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

  const TOKEN_KEY = 'ricms_gh_token';
  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
  const setToken = t => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* sem armazenamento */ } };

  function syncTokenUi() {
    const has = !!getToken();
    $('ricms-token-box').hidden = has;
    $('ricms-forget').hidden = !has;
  }


  // acompanha a execucao: acha a rodada recem-criada e mostra etapas concluidas / total
  async function track(token, since) {
    const st = $('ricms-status');
    const api = path => fetch('https://api.github.com/repos/' + CONFIG.repo + path, { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token } }).then(r => r.json());
    const setBar = (pct, step) => { $('ricms-progress').hidden = false; $('ricms-bar').style.width = pct + '%'; $('ricms-pct').textContent = pct + '%'; $('ricms-step').textContent = step; };
    setBar(2, 'Workflow na fila...');
    window.UI.setStatus(st, 'Workflow iniciado. Acompanhando a execução...');
    let runId = null;
    for (let i = 0; i < 240; i++) {
      await new Promise(r => setTimeout(r, 4000));
      try {
        if (!runId) {
          const d = await api('/actions/workflows/' + CONFIG.workflow + '/runs?event=workflow_dispatch&per_page=5');
          const run = (d.workflow_runs || []).find(r => new Date(r.created_at).getTime() >= since);
          if (!run) continue;
          runId = run.id;
        }
        const run = await api('/actions/runs/' + runId);
        const jobs = (await api('/actions/runs/' + runId + '/jobs')).jobs || [];
        const steps = jobs.flatMap(j => j.steps || []).filter(s => !/^(Set up job|Complete job|Post )/.test(s.name));
        const done = steps.filter(s => s.status === 'completed').length;
        const cur = steps.find(s => s.status === 'in_progress');
        const pct = steps.length ? Math.round(done / steps.length * 100) : 5;
        if (run.status !== 'completed') {
          setBar(Math.min(95, Math.max(pct, 5)), cur ? 'Etapa: ' + cur.name : 'Em execução...');
          continue;
        }
        const ok = run.conclusion === 'success';
        setBar(100, ok ? 'Concluído' : 'Terminou com erro');
        window.UI.setStatus(st, ok ? 'Concluído com sucesso. ' : 'A execução terminou com ' + run.conclusion + '. ');
        st.className = 'status ' + (ok ? 'ok' : 'err');
        st.innerHTML += '<a href="' + esc(run.html_url) + '" target="_blank" rel="noopener">Ver detalhes e arquivos gerados</a>';
        loadRuns();
        return;
      } catch (e) { /* tenta de novo no proximo ciclo */ }
    }
    window.UI.setStatus(st, 'Acompanhamento encerrado por tempo. Veja o histórico abaixo.', 'warn');
    loadRuns();
  }

  async function run() {
    const st = $('ricms-status');
    let token = getToken();
    const typed = $('ricms-token').value.trim();
    if (!token && typed) { token = typed; }
    if (!token) { window.UI.setStatus(st, 'Informe o token do GitHub para executar.', 'err'); return; }
    $('ricms-run').disabled = true;
    const started = Date.now() - 15000;
    window.UI.setStatus(st, 'Disparando o workflow...');
    try {
      const resp = await fetch('https://api.github.com/repos/' + CONFIG.repo + '/actions/workflows/' + CONFIG.workflow + '/dispatches', {
        method: 'POST',
        headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'main', inputs: { publicar: $('ricms-publish').checked ? 'true' : 'false' } })
      });
      if (resp.status === 204) {
        setToken(token); $('ricms-token').value = ''; syncTokenUi();
        window.UI.setStatus(st, 'Workflow iniciado. A execução leva alguns minutos; acompanhe no histórico abaixo.', 'ok');
        track(token, started);
      } else if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
        setToken('');  syncTokenUi();
        window.UI.setStatus(st, 'O GitHub recusou o token (' + resp.status + '). Confira se ele tem acesso ao repositório ' + CONFIG.repo + ' com a permissão Actions: Read and write.', 'err');
      } else {
        const body = await resp.text();
        window.UI.setStatus(st, 'Erro ' + resp.status + ' ao disparar: ' + body.slice(0, 200), 'err');
      }
    } catch (e) {
      window.UI.setStatus(st, 'Não foi possível falar com o GitHub: ' + e.message, 'err');
    } finally {
      $('ricms-run').disabled = false;
    }
  }

  window.Tools.ricms = {
    init() {
      $('ricms-open').href = 'https://github.com/' + CONFIG.repo + '/actions/workflows/' + CONFIG.workflow;
      $('ricms-docs').innerHTML = DOCS.map(([nome, arq]) => '<li>' + esc(nome) + '<br><code>' + esc(arq) + '</code></li>').join('');
      $('ricms-refresh').addEventListener('click', loadRuns);
      $('ricms-run').addEventListener('click', run);
      $('ricms-forget').addEventListener('click', () => { setToken(''); syncTokenUi(); window.UI.setStatus($('ricms-status'), 'Token apagado deste navegador.'); });
      syncTokenUi();
      loadRuns();
    }
  };
})();
