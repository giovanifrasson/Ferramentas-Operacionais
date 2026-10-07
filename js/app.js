/* app.js - navegacao lateral, carregamento sob demanda e utilidades compartilhadas */
(function () {
  'use strict';

  const VIEWS = {
    inventario: { title: 'Ajuste de Inventário', scripts: () => [CONFIG.libs.xlsx, CONFIG.libs.exceljs, CONFIG.libs.decimal, 'js/psnet.js', 'js/inventario-core.js', 'js/inventario-ui.js'] },
    pdf: { title: 'PDF para Markdown', scripts: () => [CONFIG.libs.pdfjs, 'js/psnet.js', 'js/zip.js', 'js/pdfmd-core.js', 'js/pdfmd-ui.js'] },
    ricms: { title: 'RICMS-SC', scripts: () => ['js/ricms-ui.js'] },
    nfe: { title: 'NFe: baixar XML por chave', scripts: () => ['js/nfe-ui.js'] }
  };

  const loaded = new Map();
  function loadScript(src) {
    if (loaded.has(src)) return loaded.get(src);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Falha ao carregar ' + src));
      document.head.appendChild(s);
    });
    loaded.set(src, p);
    return p;
  }

  // utilidades usadas pelas ferramentas
  window.UI = {
    $: id => document.getElementById(id),
    async loadSequential(list) { for (const src of list) await loadScript(src); },
    setStatus(el, text, kind) {
      el.textContent = text;
      el.className = 'status' + (kind ? ' ' + kind : '');
    },
    setProgress(prefix, pct, msg) {
      const wrap = document.getElementById(prefix + '-progress');
      if (wrap) wrap.hidden = false;
      document.getElementById(prefix + '-bar').style.width = pct + '%';
      document.getElementById(prefix + '-pct').textContent = pct + '%';
      if (msg) {
        const st = document.getElementById(prefix + '-status');
        st.textContent = msg;
        st.className = 'status';
      }
    },
    download(blob, name) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    },
    bindDrop(dropEl, inputEl, onFiles) {
      dropEl.addEventListener('click', () => inputEl.click());
      dropEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputEl.click(); } });
      ['dragenter', 'dragover'].forEach(ev => dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.remove('over'); }));
      dropEl.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
      inputEl.addEventListener('change', () => { if (inputEl.files.length) onFiles([...inputEl.files]); inputEl.value = ''; });
    },
    fmtSize(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; },
    esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  };

  const initialized = new Set();
  async function show(name) {
    if (!VIEWS[name]) name = 'inventario';
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
    document.querySelectorAll('.nav a').forEach(a => {
      if (a.dataset.view === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = VIEWS[name].title + ' · Ferramentas Operacionais';
    document.getElementById('topTitle').textContent = VIEWS[name].title;
    document.body.classList.remove('nav-open');
    if (!initialized.has(name)) {
      initialized.add(name);
      try {
        await window.UI.loadSequential(VIEWS[name].scripts());
        if (window.Tools && window.Tools[name]) window.Tools[name].init();
      } catch (err) {
        initialized.delete(name);
        const view = document.getElementById('view-' + name);
        const box = document.createElement('div');
        box.className = 'status err';
        box.textContent = err.message + ' Verifique a conexão com a internet e recarregue a página.';
        view.prepend(box);
      }
    }
  }

  function route() { show((location.hash || '#inventario').slice(1)); }
  window.addEventListener('hashchange', route);
  document.getElementById('menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  document.getElementById('scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  window.Tools = {};
  route();
})();
