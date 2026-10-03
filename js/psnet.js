/*
 * psnet.js - diferencas de comportamento entre o Windows PowerShell 5.1 e o JavaScript
 * que afetam os resultados dos .ps1 originais.
 *
 * - [Math]::Round(x) arredonda metade para o par (banker's rounding); Math.round do JS nao.
 * - Sort-Object do PS 5.1 e instavel: em empates a ordem e arbitraria (verificado em testes),
 *   entao nao ha como reproduzi-la. Aqui os empates seguem a ordem original (ordenacao estavel,
 *   que o JS garante), isto e, vence o primeiro item encontrado.
 */
(function (global) {
  'use strict';

  /** [Math]::Round(x) - arredonda metade para o par. */
  function roundHalfEven(x) {
    const f = Math.floor(x);
    const d = x - f;
    if (d < 0.5) return f;
    if (d > 0.5) return f + 1;
    return f % 2 === 0 ? f : f + 1;
  }

  /** Sort-Object <prop> [-Descending] sobre numeros; estavel. Devolve uma copia. */
  function sortObject(items, keyFn, descending) {
    const sign = descending ? -1 : 1;
    return items
      .map((item, i) => ({ item, i, k: keyFn(item) }))
      .sort((a, b) => (a.k < b.k ? -sign : a.k > b.k ? sign : a.i - b.i))
      .map(e => e.item);
  }

  global.PsNet = { roundHalfEven, sortObject };
})(typeof window !== 'undefined' ? window : globalThis);
