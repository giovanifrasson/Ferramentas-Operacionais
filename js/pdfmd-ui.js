/* pdfmd-ui.js - tela do PDF para Markdown */
(function () {
  'use strict';
  const { $, esc } = window.UI;

  let items = [];   // {file, status: '', md: null, outName}
  let results = []; // itens convertidos com sucesso

  function baseName(n) { return n.replace(/\.pdf$/i, ''); }

  function renderList() {
    const ul = $('pdf-list');
    ul.innerHTML = '';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      const st = it.status ? '<span class="st ' + (it.ok === true ? 'ok' : it.ok === false ? 'err' : '') + '">' + esc(it.status) + '</span>' : '';
      li.innerHTML = '<span class="name" title="' + esc(it.file.name) + '">' + esc(it.file.name) + '</span>' +
        '<span class="size">' + window.UI.fmtSize(it.file.size) + '</span>' + st +
        '<button class="btn small" type="button" data-rm="' + i + '" aria-label="Remover ' + esc(it.file.name) + '">Remover</button>';
      ul.appendChild(li);
    });
  }

  function addFiles(files) {
    for (const f of files) {
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') continue;
      if (items.some(it => it.file.name === f.name && it.file.size === f.size)) continue;
      items.push({ file: f, status: '', ok: null, md: null });
    }
    renderList();
    if (items.length) window.UI.setStatus($('pdf-status'), items.length + ' arquivo(s) na lista. Clique em Converter PDFs.');
  }

  function uniqueNames() {
    const used = new Set();
    for (const it of results) {
      let name = baseName(it.file.name) + '.md';
      let n = 2;
      while (used.has(name.toLowerCase())) name = baseName(it.file.name) + ' (' + n++ + ').md';
      used.add(name.toLowerCase());
      it.outName = name;
    }
  }

  function showResults() {
    uniqueNames();
    $('pdf-result').hidden = results.length === 0;
    const sel = $('pdf-preview-sel');
    sel.innerHTML = results.map((r, i) => '<option value="' + i + '">' + esc(r.outName) + '</option>').join('');
    updatePreview();
    $('pdf-save-folder').hidden = typeof window.showDirectoryPicker !== 'function';
    $('pdf-save-zip').textContent = results.length === 1 ? 'Baixar .md' : 'Baixar tudo (.zip)';
  }

  function updatePreview() {
    const r = results[Number($('pdf-preview-sel').value) || 0];
    const pre = $('pdf-preview');
    if (!r) { pre.textContent = ''; return; }
    pre.textContent = r.md.length > 60000 ? r.md.slice(0, 60000) + '\n\n[... pré-visualização cortada; o arquivo salvo está completo ...]' : r.md;
  }

  async function run() {
    const btn = $('pdf-run');
    if (!items.length) { window.UI.setStatus($('pdf-status'), 'Erro: adicione pelo menos um arquivo PDF.', 'err'); return; }
    btn.disabled = true;
    $('pdf-result').hidden = true;
    results = [];
    const n = items.length;
    const errs = [];
    const pageSep = $('pdf-sep').checked;
    try {
      for (let i = 0; i < n; i++) {
        const it = items[i];
        it.status = 'convertendo...'; it.ok = null; it.md = null; renderList();
        const base = Math.trunc(i / n * 100);
        try {
          const buf = await it.file.arrayBuffer();
          it.md = await window.PdfMd.convertPdfToMarkdown(buf, {
            pageSep,
            onProgress: (pct, msg) => window.UI.setProgress('pdf', Math.min(100, base + Math.trunc(pct / n)), '(' + (i + 1) + '/' + n + ') ' + it.file.name + ' - ' + msg)
          });
          it.status = 'ok'; it.ok = true;
          results.push(it);
        } catch (e) {
          console.error(e);
          it.status = 'erro'; it.ok = false;
          errs.push(it.file.name + ': ' + e.message);
        }
        renderList();
      }
      window.UI.setProgress('pdf', 100);
      showResults();
      if (errs.length === 0) window.UI.setStatus($('pdf-status'), 'Concluido! ' + results.length + ' arquivo(s) convertido(s).', 'ok');
      else window.UI.setStatus($('pdf-status'), results.length + ' convertido(s). ' + errs.length + ' erro(s):\n' + errs.join('\n'), 'warn');
    } finally {
      btn.disabled = false;
    }
  }

  async function saveToFolder() {
    try {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      for (const r of results) {
        const fh = await dir.getFileHandle(r.outName, { create: true });
        const w = await fh.createWritable();
        await w.write(new Blob([r.md], { type: 'text/markdown;charset=utf-8' }));
        await w.close();
      }
      window.UI.setStatus($('pdf-status'), 'Salvo(s) ' + results.length + ' arquivo(s) na pasta "' + dir.name + '".', 'ok');
    } catch (e) {
      if (e.name !== 'AbortError') window.UI.setStatus($('pdf-status'), 'Erro ao salvar na pasta: ' + e.message, 'err');
    }
  }

  function saveZip() {
    if (results.length === 1) {
      window.UI.download(new Blob([results[0].md], { type: 'text/markdown;charset=utf-8' }), results[0].outName);
      return;
    }
    const enc = new TextEncoder();
    const blob = window.Zip.createZip(results.map(r => ({ name: r.outName, data: enc.encode(r.md) })));
    window.UI.download(blob, 'PDF-para-Markdown.zip');
  }

  window.Tools.pdf = {
    init() {
      window.UI.bindDrop($('pdf-drop'), $('pdf-file'), addFiles);
      $('pdf-list').addEventListener('click', e => {
        const b = e.target.closest('[data-rm]');
        if (b) { items.splice(Number(b.dataset.rm), 1); renderList(); }
      });
      $('pdf-clear').addEventListener('click', () => { items = []; results = []; renderList(); $('pdf-result').hidden = true; $('pdf-progress').hidden = true; window.UI.setStatus($('pdf-status'), 'Adicione arquivos PDF para converter.'); });
      $('pdf-run').addEventListener('click', run);
      $('pdf-preview-sel').addEventListener('change', updatePreview);
      $('pdf-save-folder').addEventListener('click', saveToFolder);
      $('pdf-save-zip').addEventListener('click', saveZip);
    }
  };
})();
