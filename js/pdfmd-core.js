/*
 * pdfmd-core.js - porte de PDF-para-Markdown.ps1 (sem interface).
 * Extracao: pdf.js (substitui o iTextSharp). A logica de agrupamento em linhas, deteccao do
 * corpo do texto e formatacao Markdown segue o original passo a passo.
 */
(function (global) {
  'use strict';

  const { roundHalfEven, sortObject } = global.PsNet;

  // ---------------------------------------------------------------- extracao de "chunks"

  const FONT_CI = (name, sub) => name.toLowerCase().includes(sub.toLowerCase());

  function classifyFont(fname) {
    return {
      bold: FONT_CI(fname, 'Bold') || FONT_CI(fname, 'Black') || FONT_CI(fname, 'Heavy') || FONT_CI(fname, 'Semibold'),
      italic: FONT_CI(fname, 'Italic') || FONT_CI(fname, 'Oblique'),
      mono: FONT_CI(fname, 'Mono') || FONT_CI(fname, 'Courier') || FONT_CI(fname, 'Fixed') || FONT_CI(fname, 'Console')
    };
  }

  /** Nome PostScript da fonte (equivale a DocumentFont.PostscriptFontName do iTextSharp). */
  function realFontName(page, loadedName) {
    try {
      if (page.commonObjs.has(loadedName)) {
        const f = page.commonObjs.get(loadedName);
        if (f && typeof f.name === 'string') return f.name;
      }
    } catch (e) { /* fonte ainda nao resolvida */ }
    return '';
  }

  /**
   * Devolve os chunks de uma pagina: {text, fontSize, bold, italic, mono, x, y}
   * x/y = inicio da linha de base em coordenadas do PDF (origem no canto inferior esquerdo).
   * fontSize = tamanho da fonte no espaco do usuario (o original chama de "altura").
   */
  async function extractPageChunks(page) {
    const content = await page.getTextContent({ disableCombineTextItems: true });
    // o pdf.js so expoe o nome real das fontes (commonObjs) depois de processar a lista de operadores
    try { await page.getOperatorList(); } catch (e) { /* segue sem os nomes: ficam sem negrito/italico/mono */ }
    const cache = new Map();
    const chunks = [];
    for (const item of content.items) {
      const text = item.str;
      if (text === undefined || text === null || text === '') continue;
      let info = cache.get(item.fontName);
      if (!info) {
        const name = realFontName(page, item.fontName);
        const style = (content.styles && content.styles[item.fontName]) || {};
        info = { ...classifyFont(name), name, family: style.fontFamily };
        cache.set(item.fontName, info);
      }
      const t = item.transform;
      // o original mede |ascendente - descendente| do iTextSharp, que nos PDFs testados e exatamente o
      // tamanho da fonte no espaco do usuario (conferido chunk a chunk); aqui usa-se o mesmo valor direto.
      let height = Math.hypot(t[2], t[3]);
      if (!(height >= 0.5)) height = 10;
      chunks.push({ text, fontSize: height, bold: info.bold, italic: info.italic, mono: info.mono, x: t[4], y: t[5] });
    }
    return chunks;
  }

  // ---------------------------------------------------------------- linhas

  function newLineObj(chunks) {
    const sorted = sortObject(chunks, c => c.x, false);
    const text = sorted.map(c => c.text).join('');
    const sizes = sorted.filter(c => c.fontSize > 0.5).map(c => c.fontSize);
    const avgSize = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 10.0;
    const avgY = chunks.reduce((a, c) => a + c.y, 0) / chunks.length;
    return {
      text: text.trim(),
      avgFontSize: avgSize,
      avgY,
      isBold: sorted.some(c => c.bold),
      isItalic: sorted.some(c => c.italic),
      isMono: sorted.some(c => c.mono)
    };
  }

  function groupChunksIntoLines(chunks, tol) {
    if (tol === undefined) tol = 2.0;
    const result = [];
    if (chunks.length === 0) return result;
    const sorted = sortObject(chunks, c => c.y, true);
    let cur = [];
    let curY = NaN;
    for (const c of sorted) {
      const cy = c.y;
      const join = Number.isNaN(curY) || Math.abs(cy - curY) <= tol;
      if (join) {
        cur.push(c);
        curY = Number.isNaN(curY) ? cy : (curY + cy) * 0.5;
      } else {
        if (cur.length > 0) result.push(newLineObj(cur));
        cur = [c];
        curY = cy;
      }
    }
    if (cur.length > 0) result.push(newLineObj(cur));
    return result;
  }

  function getBodySize(lines) {
    const counts = new Map();
    for (const ln of lines) {
      const k = roundHalfEven(ln.avgFontSize);
      if (k < 4) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    if (counts.size === 0) return 10.0;
    // empate: o original depende da ordem de uma Hashtable (arbitraria); aqui vence o primeiro tamanho visto
    return sortObject([...counts.keys()], k => counts.get(k), true)[0];
  }

  // ---------------------------------------------------------------- Markdown

  const RX_BULLET = /^[•◦▪▸▷→· \-*]\s+(.+)$/;
  const RX_NUMBERED = /^(\d{1,3})[.:)]\s+(.+)$/;

  function formatMarkdownLine(text, size, bold, italic, mono, body) {
    const t = text.trim();
    if (!t) return null;
    const ratio = body > 0 ? size / body : 1.0;
    if (ratio >= 1.8) return '# ' + t;
    if (ratio >= 1.4) return '## ' + t;
    if (ratio >= 1.15) return '### ' + t;
    let m = RX_BULLET.exec(t);
    if (m) return '- ' + m[1].trim();
    m = RX_NUMBERED.exec(t);
    if (m) return m[1] + '. ' + m[2].trim();
    if (mono) return '    ' + t;
    if (bold && italic && t.length <= 120) return '***' + t + '***';
    if (bold && t.length <= 120) return '**' + t + '**';
    if (italic && t.length <= 120) return '*' + t + '*';
    return t;
  }

  /** Converte as paginas ja extraidas (array de arrays de chunks) em Markdown. */
  function chunksToMarkdown(pages, opts) {
    const pageSep = !!(opts && opts.pageSep);
    const out = [];
    const line = s => out.push(s);
    pages.forEach((entry, idx) => {
      const pn = idx + 1;
      if (pageSep && pn > 1) { line(''); line('---'); line(''); }
      if (entry.error) {
        line('<!-- pagina ' + pn + ': erro na extracao: ' + entry.error + ' -->');
        line('');
        return;
      }
      const chunks = entry.chunks;
      if (chunks.length === 0) {
        line('<!-- pagina ' + pn + ': sem texto extraivel (possivelmente escaneado) -->');
        line('');
        return;
      }
      const lines = groupChunksIntoLines(chunks);
      const bodySize = getBodySize(lines);
      let prevY = NaN;
      for (const ln of lines) {
        if (ln.text.trim() === '') continue;
        if (!Number.isNaN(prevY)) {
          const gap = prevY - ln.avgY;
          const lh = Math.max(1.0, ln.avgFontSize);
          if (gap > lh * 1.8) line('');
        }
        prevY = ln.avgY;
        const md = formatMarkdownLine(ln.text, ln.avgFontSize, ln.isBold, ln.isItalic, ln.isMono, bodySize);
        if (md) line(md);
      }
    });
    return out.length ? out.join('\n') + '\n' : '';
  }

  /** Fluxo completo: ArrayBuffer do PDF -> texto Markdown. */
  async function convertPdfToMarkdown(arrayBuffer, opts) {
    const onProg = (opts && opts.onProgress) || (() => {});
    const pdfjs = global.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = global.CONFIG.libs.pdfjsWorker;
    onProg(0, 'Abrindo PDF...');
    // copia: o pdf.js transfere (e invalida) o buffer entregue ao worker
    const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
    try {
      const total = doc.numPages;
      if (total === 0) throw new Error('PDF sem paginas.');
      const pages = [];
      for (let pn = 1; pn <= total; pn++) {
        onProg(Math.trunc((pn - 1) / total * 100), 'Pagina ' + pn + ' de ' + total + '...');
        try {
          const page = await doc.getPage(pn);
          pages.push({ chunks: await extractPageChunks(page) });
          page.cleanup();
        } catch (e) {
          pages.push({ error: e.message });
        }
        if (pn % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }
      onProg(100, 'Concluido.');
      return chunksToMarkdown(pages, opts);
    } finally {
      try { await doc.destroy(); } catch (e) { /* ignora */ }
    }
  }

  global.PdfMd = { extractPageChunks, groupChunksIntoLines, getBodySize, formatMarkdownLine, chunksToMarkdown, convertPdfToMarkdown };
})(window);
