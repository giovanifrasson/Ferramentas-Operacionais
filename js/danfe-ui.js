/* danfe-ui.js - botao que inicia a ferramenta local DANFE-por-Chave (atalho frasson-danfe://) */
(function () {
  'use strict';
  const { $ } = window.UI;

  window.Tools.danfe = {
    init() {
      $('danfe-start').addEventListener('click', () => {
        window.UI.setStatus($('danfe-status'),
          'Comando enviado ao Windows. Se a janela da ferramenta não abrir em alguns segundos, cadastre o atalho (veja "Primeira vez neste computador") ou abra pelo Executar.cmd.');
      });
    }
  };
})();
