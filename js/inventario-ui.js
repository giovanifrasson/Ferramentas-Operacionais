/* inventario-ui.js - tela do Ajuste de Inventario */
(function () {
  'use strict';
  const { $, esc } = window.UI;
  const Inv = window.Inventario;

  let file = null;       // File escolhido
  let lastResult = null; // {blob, name}

  function setFile(f) {
    file = f;
    $('inv-picked').textContent = f ? f.name + '  (' + window.UI.fmtSize(f.size) + ')' : 'Nenhum arquivo selecionado';
    window.UI.setStatus($('inv-status'), f ? 'Arquivo selecionado. Informe o valor desejado e gere a planilha.' : 'Selecione o arquivo de inventario.');
  }

  function updateTargetHint() {
    const el = $('inv-target-hint');
    const t = $('inv-target').value.trim();
    if (!t) { el.textContent = 'Informe o valor que o inventário deve somar.'; return; }
    try {
      el.textContent = 'Interpretado como ' + Inv.formatBRL(Inv.convertToBRLAmount(t));
    } catch (e) {
      el.textContent = e.message;
    }
  }

  function fmtCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return v.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
    return String(v);
  }

  function renderResult(plan, name) {
    const kp = [
      ['Itens ajustados', plan.items.toLocaleString('pt-BR')],
      ['Valor anterior', Inv.formatBRL(plan.current)],
      ['Valor alvo', Inv.formatBRL(plan.target)],
      ['Valor final', Inv.formatBRL(plan.final)],
      ['Diferença', Inv.formatBRL(plan.difference)]
    ];
    $('inv-kpis').innerHTML = kp.map(([k, v]) => '<div class="kpi"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>').join('');
    $('inv-filename').textContent = name;
    const maxRows = 40;
    const rows = plan.out;
    let html = '';
    const head = plan.headerRowOut - 1;
    const numCols = new Set([plan.qtyFieldIdx, plan.unitFieldIdx, plan.totalFieldIdx]);
    const shown = rows.slice(0, Math.min(rows.length - 1, head + 1 + maxRows));
    shown.forEach((r, i) => {
      const tag = i === head ? 'th' : 'td';
      html += '<tr>' + r.map((v, c) => '<' + tag + (numCols.has(c) && i > head ? ' class="num"' : '') + '>' + esc(fmtCell(v)) + '</' + tag + '>').join('') + '</tr>';
    });
    const last = rows[rows.length - 1];
    html += '<tr class="tot">' + last.map((v, c) => '<td' + (numCols.has(c) ? ' class="num"' : '') + '>' + esc(fmtCell(v)) + '</td>').join('') + '</tr>';
    $('inv-preview').innerHTML = html;
    $('inv-preview-note').textContent = 'Aba "' + plan.sheetName + '". Mostrando as primeiras ' + Math.min(maxRows, plan.items) + ' de ' + plan.items + ' linhas de itens.';
    $('inv-result').hidden = false;
  }

  async function run() {
    const btn = $('inv-run');
    try {
      if (!file) throw new Error('Selecione um arquivo Excel valido.');
      Inv.convertToBRLAmount($('inv-target').value); // valida antes de ler o arquivo
      btn.disabled = true;
      $('inv-result').hidden = true;
      window.UI.setProgress('inv', 0, 'Processando no navegador. Nao feche a pagina...');
      const buf = await file.arrayBuffer();
      const comp = $('inv-comp').value.trim();
      const { buffer, plan } = await Inv.adjustInventory(buf, file.name, comp, $('inv-target').value, (p, m) => window.UI.setProgress('inv', p, m));
      const name = Inv.suggestFileName(file.name, comp);
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      lastResult = { blob, name };
      window.UI.download(blob, name);
      renderResult(plan, name);
      window.UI.setStatus($('inv-status'),
        'Concluido. Itens ajustados: ' + plan.items + '. Valor final: ' + Inv.formatBRL(plan.final) + '. Diferenca: ' + Inv.formatBRL(plan.difference) + '.', 'ok');
    } catch (err) {
      console.error(err);
      window.UI.setStatus($('inv-status'), 'Erro: ' + err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  window.Tools.inventario = {
    init() {
      $('inv-comp').value = (() => { const d = new Date(); return String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); })();
      window.UI.bindDrop($('inv-drop'), $('inv-file'), files => setFile(files[0]));
      $('inv-target').addEventListener('input', updateTargetHint);
      $('inv-run').addEventListener('click', run);
      $('inv-download').addEventListener('click', () => { if (lastResult) window.UI.download(lastResult.blob, lastResult.name); });
      $('inv-target').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    },
    // usado nos testes de comparacao
    _run: (buf, name, comp, target) => Inv.adjustInventory(buf, name, comp, target)
  };
})();
