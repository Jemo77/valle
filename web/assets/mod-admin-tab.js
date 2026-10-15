/* Pestaña de administración dentro de la versión de una sola página (solo para quien puede editar). */
(function (V) {
  'use strict';
  V.registerModule({
    id: 'admin', kanji: '管', label: 'Admin', order: 70,
    visible: function (ctx) { return !!ctx.canAdmin; },
    render: function (root, ctx) {
      var holder = V.el('div');
      root.append(
        V.el('p', { class: 'eyebrow', text: 'Solo para quien edita esta página' }),
        V.el('p', { class: 'sub', text: 'Subí series, capítulos y páginas; agregá o sacá proyectos; editá el texto del sitio.' }),
        holder);
      var inst = V.mountAdmin(holder, ctx.api);
      return function () { inst.destroy(); };
    },
  });
})(window.Valle = window.Valle || {});
