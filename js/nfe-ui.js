/* nfe-ui.js - botao que inicia a ferramenta local NFe-Baixar-XML-por-Chave (atalho frasson-nfe://) */
(function () {
  'use strict';
  const { $ } = window.UI;

  window.Tools.nfe = {
    init() {
      $('nfe-start').addEventListener('click', () => {
        window.UI.setStatus($('nfe-status'),
          'Comando enviado ao Windows. Se a janela da ferramenta não abrir em alguns segundos, cadastre o atalho (veja "Primeira vez neste computador") ou abra pelo Executar.cmd.');
      });
    }
  };
})();
