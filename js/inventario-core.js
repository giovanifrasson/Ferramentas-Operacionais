/*
 * inventario-core.js - porte de DLL-Ajuste-Inventario.ps1 (sem interface).
 * Leitura: SheetJS (XLSX). Gravacao: ExcelJS. Aritmetica: decimal.js (o original usa [decimal]).
 * As funcoes mantem os nomes/etapas do .ps1 para facilitar a comparacao.
 */
(function (global) {
  'use strict';

  const D = global.Decimal.clone({ precision: 28, rounding: 4 /* ROUND_HALF_UP = longe do zero */ });
  const { sortObject } = global.PsNet;

  const ALIASES_QTD = ['qtd', 'qtde', 'quantidade', 'quant', 'estoque', 'saldo', 'qte'];
  const ALIASES_UNIT = ['vlr unit', 'vl unit', 'vlr unitario', 'vl unitario', 'valor unitario', 'preco unitario', 'preco un', 'valor un', 'custo unitario', 'preco medio'];
  const ALIASES_TOTAL = ['vlr total', 'vl total', 'valor total', 'total', 'total item', 'valor estoque', 'total estoque', 'custo total'];

  // ---------------------------------------------------------------- texto / numero

  function convertToNormalizedText(value) {
    if (value === null || value === undefined) return '';
    let s = String(value).trim().toLowerCase();
    s = s.normalize('NFD').replace(/\p{Mn}/gu, '');
    s = s.replace(/[^a-z0-9]+/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  }

  /** [decimal]<double>: o .NET arredonda para 15 digitos significativos. */
  function doubleToDecimal(d) {
    if (!isFinite(d) || Math.abs(d) >= 7.9228162514264337593543950335e28) return null;
    return new D(d.toPrecision(15));
  }

  /** Decimal.TryParse(s, NumberStyles.Any, InvariantCulture) para o que sobra apos o pre-tratamento. */
  function tryParseDecimal(s) {
    s = s.replace(/^[ \t\n\v\f\r ]+|[ \t\n\v\f\r ]+$/g, '');
    let neg = false;
    let m = /^\(([^()]*)\)$/.exec(s);
    if (m) { neg = true; s = m[1].replace(/^[ \t]+|[ \t]+$/g, ''); if (/^[+-]|[+-]$/.test(s)) return null; }
    m = /^([+-]?)(\d+\.?\d*|\.\d+)(?:[eE]([+-]?\d+))?([+-]?)$/.exec(s);
    if (!m) return null;
    if (m[1] && m[4]) return null;
    if (m[1] === '-' || m[4] === '-') neg = !neg;
    let num = m[2] + (m[3] !== undefined ? 'e' + m[3] : '');
    let v;
    try { v = new D(num); } catch (e) { return null; }
    if (v.abs().gte('7.9228162514264337593543950335e28')) return null;
    return neg ? v.neg() : v;
  }

  function convertToDecimalValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return doubleToDecimal(value);
    let s = String(value).trim().replace(/R\$/g, '').replace(/ /g, '');
    if (s === '' || s.startsWith('=')) return null;
    if (s.includes(',') && s.includes('.')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(/,/g, '.');
      else s = s.replace(/,/g, '');
    } else if (s.includes(',')) {
      s = s.replace(/\./g, '').replace(/,/g, '.');
    }
    return tryParseDecimal(s);
  }

  function convertToBRLAmount(text) {
    const v = convertToDecimalValue(text);
    if (v === null || v.lte(0)) throw new Error('Informe um valor total maior que zero.');
    return v.toDecimalPlaces(2, 4);
  }

  function formatBRL(v) {
    const n = (v && v.toNumber) ? v.toNumber() : Number(v);
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // ---------------------------------------------------------------- planilha (SheetJS)

  /** Envolve uma worksheet do SheetJS com acesso 1-based e o equivalente do UsedRange. */
  function makeSheet(name, ws) {
    const ref = ws['!ref'] ? global.XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
    const used = { row: ref.s.r + 1, col: ref.s.c + 1, rows: ref.e.r - ref.s.r + 1, cols: ref.e.c - ref.s.c + 1 };
    const merges = (ws['!merges'] || []).map(m => ({ r0: m.s.r + 1, c0: m.s.c + 1, r1: m.e.r + 1, c1: m.e.c + 1 }));
    const enc = global.XLSX.utils.encode_cell;
    function get(r, c) {
      const cell = ws[enc({ r: r - 1, c: c - 1 })];
      if (!cell || cell.t === 'z' || cell.t === 'e') return null;
      if (cell.v === undefined) return null;
      return cell.v;
    }
    function mergeArea(r, c) {
      for (const m of merges) if (r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1) return { col: m.c0, cols: m.c1 - m.c0 + 1 };
      return { col: c, cols: 1 };
    }
    return { name, used, get, mergeArea };
  }

  function buildBlock(sh, r0, r1, c0, c1) {
    const rows = r1 - r0 + 1, cols = c1 - c0 + 1;
    const block = new Array(rows + 1);
    for (let ri = 1; ri <= rows; ri++) {
      const row = new Array(cols + 1);
      for (let ci = 1; ci <= cols; ci++) row[ci] = sh.get(r0 + ri - 1, c0 + ci - 1);
      block[ri] = row;
    }
    return block;
  }

  // ---------------------------------------------------------------- deteccao de colunas

  function resolveDataColumns(sh, headerRow, anchorCol, maxColLimit) {
    const windowStart = anchorCol;
    const windowEnd = Math.min(maxColLimit, anchorCol + 12);
    if (windowEnd < windowStart) return null;
    const lastRow = sh.used.row + sh.used.rows - 1;
    const sampleLastRow = Math.min(lastRow, headerRow + 400);
    if (sampleLastRow <= headerRow) return null;
    const rows = sampleLastRow - headerRow;
    const cols = windowEnd - windowStart + 1;
    if (rows < 2 || cols < 2) return null;
    const block = buildBlock(sh, headerRow + 1, sampleLastRow, windowStart, windowEnd);

    const sampleRowIdx = [];
    for (let ri = 1; ri <= rows; ri++) {
      let anyVal = false;
      for (let ci = 1; ci <= cols; ci++) {
        if (convertToDecimalValue(block[ri][ci]) !== null) { anyVal = true; break; }
      }
      if (anyVal) sampleRowIdx.push(ri);
      if (sampleRowIdx.length >= 15) break;
    }
    if (sampleRowIdx.length === 0) return null;
    const hitCounts = {};
    for (let ci = 1; ci <= cols; ci++) {
      let hits = 0;
      for (const ri of sampleRowIdx) if (convertToDecimalValue(block[ri][ci]) !== null) hits++;
      hitCounts[ci] = hits;
    }
    const threshold = Math.max(1, Math.ceil(sampleRowIdx.length * 0.5));
    const candidateCols = Object.keys(hitCounts).map(Number).filter(k => hitCounts[k] >= threshold).sort((a, b) => a - b);
    if (candidateCols.length < 3) return null;
    const qtyCi = candidateCols[0], unitCi = candidateCols[1], totalCi = candidateCols[2];
    let ok = 0, checked = 0;
    for (const ri of sampleRowIdx) {
      const q = convertToDecimalValue(block[ri][qtyCi]);
      const u = convertToDecimalValue(block[ri][unitCi]);
      const t = convertToDecimalValue(block[ri][totalCi]);
      if (q !== null && u !== null && t !== null && q.gt(0)) {
        checked++;
        const expected = q.times(u);
        if (Math.abs(expected.minus(t).toNumber()) <= Math.max(0.05, expected.toNumber() * 0.02)) ok++;
      }
    }
    if (checked > 0 && (ok / checked) >= 0.6) {
      return { qtd: windowStart + qtyCi - 1, unit: windowStart + unitCi - 1, total: windowStart + totalCi - 1 };
    }
    return null;
  }

  function getInventoryTable(sheets) {
    let best = null;
    for (const sh of sheets) {
      const firstRow = Math.max(1, sh.used.row);
      const firstCol = Math.max(1, sh.used.col);
      const lastRow = Math.min(firstRow + sh.used.rows - 1, firstRow + 150);
      const lastCol = Math.min(firstCol + sh.used.cols - 1, firstCol + 80);
      const rows = lastRow - firstRow + 1;
      const cols = lastCol - firstCol + 1;
      if (rows < 2 || cols < 2) continue;
      for (let ri = 1; ri <= rows; ri++) {
        const hits = {};
        for (let ci = 1; ci <= cols; ci++) {
          const absRow = firstRow + ri - 1, absCol = firstCol + ci - 1;
          const v = convertToNormalizedText(sh.get(absRow, absCol));
          if (!v) continue;
          if (ALIASES_QTD.includes(v) && hits.qtd === undefined) hits.qtd = absCol;
          if (ALIASES_UNIT.includes(v) && hits.unit === undefined) hits.unit = absCol;
          if (ALIASES_TOTAL.includes(v) && hits.total === undefined) hits.total = absCol;
        }
        let score = Object.keys(hits).length;
        if (hits.qtd !== undefined) score += 2;
        if (hits.unit !== undefined) score += 3;
        if (hits.total !== undefined) score += 3;
        if (best === null || score > best.score) best = { score, sheet: sh, row: firstRow + ri - 1, hits };
      }
    }
    if (best === null || best.score < 8 || best.hits.qtd === undefined || best.hits.unit === undefined || best.hits.total === undefined) {
      throw new Error('Nao consegui localizar as colunas QTD., Vlr Unit. e Vlr.Total no relatorio.');
    }
    best.headerCols = { qtd: best.hits.qtd, unit: best.hits.unit, total: best.hits.total };
    const used = best.sheet.used;
    const maxColLimit = Math.min(used.col + used.cols - 1, best.hits.total + 10);
    const resolved = resolveDataColumns(best.sheet, best.row, best.hits.qtd, maxColLimit);
    if (resolved) {
      best.hits.qtd = resolved.qtd;
      best.hits.unit = resolved.unit;
      best.hits.total = resolved.total;
    }
    return best;
  }

  function getDescriptiveFields(sh, headerRow, excludeHeaderCols, maxCol) {
    const fields = [];
    if (maxCol < 1) return fields;
    for (let c = 1; c <= maxCol; c++) {
      const raw = sh.get(headerRow, c);
      if (typeof raw !== 'string' || raw.trim() === '') continue;
      if (excludeHeaderCols.includes(c)) continue;
      const ma = sh.mergeArea(headerRow, c);
      const mStart = ma.col;
      const mEnd = mStart + ma.cols - 1;
      fields.push({ label: raw.trim(), headerCol: c, winStart: Math.max(1, mStart - 2), winEnd: Math.min(maxCol, mEnd + 2), dataCol: null });
    }
    return fields;
  }

  function resolveDescriptiveColumns(fields, block, sampleRowIdx, claimed) {
    const sorted = sortObject(fields, f => f.headerCol, false);
    for (const f of sorted) {
      const votes = new Map(); // ordem de insercao = ordem em que o original cria as chaves
      for (const ri of sampleRowIdx) {
        for (let c = f.winStart; c <= f.winEnd; c++) {
          if (claimed.has(c)) continue;
          const v = block[ri][c];
          const isBlank = v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
          if (!isBlank) {
            votes.set(c, (votes.get(c) || 0) + 1);
            break;
          }
        }
      }
      if (votes.size > 0) {
        // em empate de votos o original escolhe arbitrariamente (Hashtable + Sort-Object); aqui vence a primeira coluna votada
        const ranked = sortObject([...votes.keys()], k => votes.get(k), true);
        f.dataCol = ranked[0];
        claimed.add(f.dataCol);
      }
    }
    return sorted.filter(f => f.dataCol !== null);
  }

  // ---------------------------------------------------------------- calculo do ajuste

  const tick = () => new Promise(r => setTimeout(r, 0));

  /**
   * Equivale a Update-InventoryValues, ate o ponto em que o original regrava a planilha.
   * Devolve o "plano": matriz de saida e metadados (nada e gravado aqui).
   */
  async function computeAdjustment(sheets, competencia, target, onProgress) {
    const report = async (pct, msg) => { if (onProgress) { onProgress(pct, msg); await tick(); } };
    await report(10, 'Identificando colunas do relatorio...');
    const det = getInventoryTable(sheets);
    const sh = det.sheet;
    const qtdCi = det.hits.qtd, unitCi = det.hits.unit, totalCi = det.hits.total;

    await report(15, 'Lendo itens do inventario...');
    const lastRow = sh.used.row + sh.used.rows - 1;
    const maxCol = Math.max(Math.min(sh.used.col + sh.used.cols - 1, 40), totalCi + 1);
    if (lastRow <= det.row) throw new Error('Nao encontrei linhas de itens com QTD. e Vlr Unit. validos.');
    const rows = lastRow - det.row;
    const block = buildBlock(sh, det.row + 1, lastRow, 1, maxCol);

    const items = [];
    let blank = 0;
    let current = new D(0);
    for (let ri = 1; ri <= rows; ri++) {
      const parts = [];
      for (let ci = 1; ci <= maxCol; ci++) {
        const cv = block[ri][ci];
        if (typeof cv === 'string' && cv.trim() !== '') parts.push(convertToNormalizedText(cv));
      }
      if (/total geral/i.test(parts.join(' '))) break;
      const qty = convertToDecimalValue(block[ri][qtdCi]);
      const unit = convertToDecimalValue(block[ri][unitCi]);
      let itemTotal = convertToDecimalValue(block[ri][totalCi]);
      if (qty === null && unit === null && itemTotal === null) {
        blank++;
        if (blank >= 12) break;
        continue;
      }
      blank = 0;
      if (qty === null || qty.lte(0) || unit === null || unit.lte(0)) continue;
      if (itemTotal === null) itemTotal = qty.times(unit);
      current = current.plus(itemTotal);
      items.push({ rowIdx: ri, qty, unit, total: itemTotal });
    }
    if (items.length === 0) throw new Error('Nao encontrei linhas de itens com QTD. e Vlr Unit. validos.');
    if (current.lte(0)) throw new Error('O valor atual do inventario e zero ou invalido.');
    const factor = target.div(current);

    await report(30, 'Ajustando valores unitarios...');
    const totalItems = items.length;
    const step = Math.max(1, Math.trunc(totalItems / 50));
    let after = new D(0);
    let n = 0;
    for (const item of items) {
      let newUnit = item.unit.times(factor).toDecimalPlaces(6, 4);
      if (newUnit.lt(0)) newUnit = new D(0);
      const newTotal = item.qty.times(newUnit).toDecimalPlaces(2, 4);
      block[item.rowIdx][unitCi] = newUnit.toNumber();
      block[item.rowIdx][totalCi] = newTotal.toNumber();
      item.unit = newUnit;
      item.total = newTotal;
      after = after.plus(newTotal);
      n++;
      if (n % step === 0) {
        const pct = 30 + Math.trunc(35 * (n / totalItems));
        await report(Math.min(65, pct), `Ajustando itens... (${n} de ${totalItems})`);
      }
    }

    await report(68, 'Ajuste fino do valor final...');
    for (let i = 0; i < 15; i++) {
      const residual = target.minus(after);
      if (residual.abs().toNumber() < 0.005) break;
      // Sort-Object Qty -Descending | Select-Object -First 1  (empate: vence o primeiro item)
      const candidate = sortObject(items, it => it.qty.toNumber(), true)[0];
      if (!candidate || candidate.qty.lte(0)) break;
      const delta = residual.div(candidate.qty).toDecimalPlaces(8, 4);
      if (delta.isZero()) break;
      const nu = candidate.unit.plus(delta);
      if (nu.lt(0)) break;
      const nt = candidate.qty.times(nu).toDecimalPlaces(2, 4);
      block[candidate.rowIdx][unitCi] = nu.toNumber();
      block[candidate.rowIdx][totalCi] = nt.toNumber();
      after = after.minus(candidate.total).plus(nt);
      candidate.unit = nu;
      candidate.total = nt;
    }

    await report(72, 'Identificando colunas descritivas...');
    const excludeHeaderCols = [det.headerCols.qtd, det.headerCols.unit, det.headerCols.total];
    let descFields = getDescriptiveFields(sh, det.row, excludeHeaderCols, maxCol);
    const claimed = new Set([qtdCi, unitCi, totalCi]);
    const sampleRowIdx = items.slice(0, 8).map(it => it.rowIdx);
    descFields = resolveDescriptiveColumns(descFields, block, sampleRowIdx, claimed);

    let ordered = descFields.map(f => ({ label: f.label, headerCol: f.headerCol, dataCol: f.dataCol, role: 'desc' }));
    ordered.push({ label: 'QTD.', headerCol: det.headerCols.qtd, dataCol: qtdCi, role: 'qtd' });
    ordered.push({ label: 'Vlr Unit.', headerCol: det.headerCols.unit, dataCol: unitCi, role: 'unit' });
    ordered.push({ label: 'Vlr.Total', headerCol: det.headerCols.total, dataCol: totalCi, role: 'total' });
    ordered = sortObject(ordered, f => f.headerCol, false);
    const fieldCount = ordered.length;
    let qtyFieldIdx = -1, unitFieldIdx = -1, totalFieldIdx = -1;
    ordered.forEach((f, fi) => {
      if (f.role === 'qtd') qtyFieldIdx = fi;
      else if (f.role === 'unit') unitFieldIdx = fi;
      else if (f.role === 'total') totalFieldIdx = fi;
    });

    await report(78, 'Montando planilha limpa...');
    const hasComp = competencia.trim() !== '';
    const headerRowOut = hasComp ? 2 : 1;
    const firstDataRowOut = headerRowOut + 1;
    const totalRowOut = firstDataRowOut + items.length;
    const out = [];
    for (let r = 0; r < totalRowOut; r++) out.push(new Array(fieldCount).fill(null));
    if (hasComp) { out[0][0] = 'Competencia'; out[0][1] = competencia; }
    for (let fi = 0; fi < fieldCount; fi++) out[headerRowOut - 1][fi] = ordered[fi].label;
    let rowCursor = firstDataRowOut;
    for (const item of items) {
      for (let fi = 0; fi < fieldCount; fi++) {
        let val = block[item.rowIdx][ordered[fi].dataCol];
        if (typeof val === 'string') {
          val = val.trim();
          // No original o Excel converte em numero o texto que parece numero ao gravar a coluna de quantidade
          // (colunas descritivas sao gravadas como Texto); aqui a conversao usa a mesma regra de leitura da ferramenta.
          if (ordered[fi].role === 'qtd') {
            const asNum = convertToDecimalValue(val);
            if (asNum !== null) val = asNum.toNumber();
          }
        }
        out[rowCursor - 1][fi] = val === undefined ? null : val;
      }
      rowCursor++;
    }
    const totalRi = totalRowOut - 1;
    out[totalRi][0] = 'Total Geral';
    if (qtyFieldIdx >= 0) out[totalRi][qtyFieldIdx] = items.reduce((a, it) => a.plus(it.qty), new D(0)).toNumber();
    if (totalFieldIdx >= 0) out[totalRi][totalFieldIdx] = after.toNumber();

    // colunas descritivas cujo primeiro valor e texto ganham formato "Texto" no original
    const textCols = [];
    for (let fi = 0; fi < fieldCount; fi++) {
      if (ordered[fi].role === 'desc') {
        const sample = block[items[0].rowIdx][ordered[fi].dataCol];
        if (typeof sample === 'string') textCols.push(fi);
      }
    }

    return {
      sheetName: sh.name,
      items: items.length,
      current, target, final: after, difference: target.minus(after),
      out, fieldCount, hasComp, headerRowOut, firstDataRowOut, totalRowOut,
      qtyFieldIdx, unitFieldIdx, totalFieldIdx, textCols,
      header: { row: det.row, cols: det.headerCols, dataCols: { qtd: qtdCi, unit: unitCi, total: totalCi } },
      fields: ordered
    };
  }

  // ---------------------------------------------------------------- gravacao (ExcelJS)

  function displayLength(v, fmt) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') {
      const frac = fmt === '#,##0.0000' ? 4 : fmt === '#,##0.00' ? 2 : fmt === '#,##0' ? 0 : null;
      if (frac === null) return String(v).length;
      return v.toLocaleString('pt-BR', { minimumFractionDigits: frac, maximumFractionDigits: frac }).length;
    }
    return String(v).length;
  }

  /**
   * Regrava a planilha alvo (equivale a UnMerge + Clear + Value2 + formatacao + AutoFit)
   * e preserva as demais abas do arquivo. Devolve ArrayBuffer .xlsx.
   */
  async function writeWorkbook(sourceBuffer, sourceIsXlsx, sheetJsWorkbook, plan, onProgress) {
    const report = async (pct, msg) => { if (onProgress) { onProgress(pct, msg); await tick(); } };
    await report(85, 'Regravando planilha sem mesclagens...');
    const wb = new global.ExcelJS.Workbook();
    let loaded = false;
    if (sourceIsXlsx) {
      try { await wb.xlsx.load(sourceBuffer); loaded = true; } catch (e) { loaded = false; }
    }
    if (!loaded) {
      const converted = global.XLSX.write(sheetJsWorkbook, { bookType: 'xlsx', type: 'array' });
      const wb2 = new global.ExcelJS.Workbook();
      await wb2.xlsx.load(converted);
      return finishWrite(wb2, plan, report);
    }
    return finishWrite(wb, plan, report);
  }

  async function finishWrite(wb, plan, report) {
    const old = wb.getWorksheet(plan.sheetName);
    if (!old) throw new Error('Aba "' + plan.sheetName + '" nao encontrada ao gravar.');
    const orderNo = old.orderNo, state = old.state;
    wb.removeWorksheet(old.id);
    const ws = wb.addWorksheet(plan.sheetName);
    ws.orderNo = orderNo;
    ws.state = state;

    const FMT_TEXT = '@';
    const fmtByCol = new Array(plan.fieldCount).fill(null);
    if (plan.hasComp) { /* B1 = texto */ }
    plan.textCols.forEach(fi => { fmtByCol[fi] = FMT_TEXT; });
    if (plan.qtyFieldIdx >= 0) fmtByCol[plan.qtyFieldIdx] = '#,##0';
    if (plan.unitFieldIdx >= 0) fmtByCol[plan.unitFieldIdx] = '#,##0.0000';
    if (plan.totalFieldIdx >= 0) fmtByCol[plan.totalFieldIdx] = '#,##0.00';

    for (let r = 0; r < plan.totalRowOut; r++) {
      const row = ws.getRow(r + 1);
      for (let c = 0; c < plan.fieldCount; c++) {
        const v = plan.out[r][c];
        const cell = row.getCell(c + 1);
        if (v !== null && v !== undefined) cell.value = v;
        if (fmtByCol[c]) cell.numFmt = fmtByCol[c];
      }
      row.commit && row.commit();
    }
    if (plan.hasComp) {
      const b1 = ws.getCell(1, 2);
      if (!fmtByCol[1] || fmtByCol[1] === FMT_TEXT) b1.numFmt = FMT_TEXT;
    }

    const grey = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E6E6' } };
    for (let c = 1; c <= plan.fieldCount; c++) {
      const h = ws.getCell(plan.headerRowOut, c);
      h.font = { bold: true };
      h.fill = grey;
      ws.getCell(plan.totalRowOut, c).font = { bold: true };
    }
    if (plan.hasComp) { ws.getCell(1, 1).font = { bold: true }; ws.getCell(1, 2).font = { bold: true }; }

    for (let c = 0; c < plan.fieldCount; c++) {
      let w = 0;
      for (let r = 0; r < plan.totalRowOut; r++) w = Math.max(w, displayLength(plan.out[r][c], fmtByCol[c]) + (r === plan.headerRowOut - 1 || r === plan.totalRowOut - 1 ? 1 : 0));
      ws.getColumn(c + 1).width = Math.max(8.43, w + 2);
    }

    await report(96, 'Salvando arquivo...');
    const buf = await wb.xlsx.writeBuffer();
    await report(100, 'Concluido.');
    return buf;
  }

  /** Fluxo completo: arquivo (ArrayBuffer) -> {buffer(.xlsx), resumo}. */
  async function adjustInventory(arrayBuffer, fileName, competencia, targetText, onProgress) {
    const report = async (pct, msg) => { if (onProgress) { onProgress(pct, msg); await tick(); } };
    const target = convertToBRLAmount(targetText);
    await report(5, 'Lendo o arquivo...');
    const xlsxLike = /\.(xlsx|xlsm|xltx|xltm)$/i.test(fileName);
    const wbJs = global.XLSX.read(arrayBuffer, { type: 'array', cellDates: false, cellNF: false, cellStyles: false });
    const sheets = wbJs.SheetNames.map(nm => makeSheet(nm, wbJs.Sheets[nm]));
    const plan = await computeAdjustment(sheets, competencia, target, onProgress);
    const buffer = await writeWorkbook(arrayBuffer, xlsxLike, wbJs, plan, onProgress);
    return { buffer, plan };
  }

  function suggestFileName(fileName, competencia) {
    const dot = fileName.lastIndexOf('.');
    const name = dot > 0 ? fileName.slice(0, dot) : fileName;
    let safe = competencia.trim().replace(/[\\/:*?"<>|]/g, '-');
    if (safe === '') safe = 'ajustado';
    return name + ' - AJUSTADO ' + safe + '.xlsx';
  }

  global.Inventario = {
    convertToNormalizedText, convertToDecimalValue, convertToBRLAmount, formatBRL,
    makeSheet, getInventoryTable, computeAdjustment, adjustInventory, suggestFileName, D
  };
})(window);
