(function (V) {
  'use strict';
  var el = V.el;

  V.registerModule({
    id: 'dibujar', kanji: '描', label: 'Dibujar', order: 30,
    render: function (root, ctx) {
      var holder = el('div');
      root.append(
        el('p', { class: 'eyebrow', text: 'Lienzo personal' }),
        el('h2', { class: 'mt', text: 'Un lienzo libre' }),
        el('p', { class: 'sub', text: 'Tu dibujo se guarda solo en este navegador. Para dibujar con otras personas, pasá a las salas.' }),
        holder,
        el('p', { class: 'hint' }, 'Mouse, dedo o lápiz. ', el('button', { type: 'button', class: 'lnk', text: 'Ir al lienzo compartido →', onclick: function () { ctx.go('salas', { arg: 'dibujo' }); } })));
      var tool = V.createCanvasTool({ container: holder, storageKey: 'draw' });
      return function () { tool.destroy(); };
    },
  });
})(window.Valle = window.Valle || {});
