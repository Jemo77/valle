// Arma la versión de una sola página (para publicar como artefacto): CSS + HTML + JS en un único archivo,
// usando api-artifact.js en lugar de api-rest.js y agregando la pestaña de administración.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'web');
const read = (p) => readFileSync(path.join(web, p), 'utf8');

const html = read('index.html');
const shell = html.split('<!--shell:start-->')[1].split('<!--shell:end-->')[0].trim();
const fonts = html.match(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)">/)[1];

let scripts = [...html.matchAll(/<script src="\/assets\/([^"]+)"><\/script>/g)].map((m) => m[1]);
scripts = scripts.map((s) => (s === 'api-rest.js' ? 'api-artifact.js' : s));
const at = scripts.indexOf('app.js');
scripts.splice(at, 0, 'admin.js', 'mod-admin-tab.js');

const css = read('assets/valle.css');
const js = scripts.map((s) => `/* ${s} */\n${read('assets/' + s)}`).join('\n');
if (/<\/script/i.test(js)) throw new Error('El JavaScript contiene </script>: no se puede incrustar.');

const out = `<title>Valle Interior</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${fonts}">
<style>
${css}
</style>
${shell}
<script>
(function(){
${js}
})();
</script>
`;
mkdirSync(path.join(root, 'dist'), { recursive: true });
const file = path.join(root, 'dist', 'valle-artifact.html');
writeFileSync(file, out);
console.log(`dist/valle-artifact.html · ${(out.length / 1024).toFixed(0)} KB · ${scripts.length} scripts`);
