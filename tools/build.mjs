// Builds dist/X-Ray Body Mirror.html: one file with the code and the anatomy inside,
// so it opens with a double click (it still needs internet for three.js and MediaPipe).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root));
const out = await build({ entryPoints: [fileURLToPath(new URL('src/main.js', root))], bundle: true, format: 'esm',
  external: ['three'], minify: true, write: false, logLevel: 'error' });
const js = out.outputFiles[0].text.replaceAll('</script', '<\\/script');
const html = read('index.html').toString().replace('<script type="module" src="src/main.js"></script>', () =>
  `<script id="bodymeta" type="application/json">${read('assets/body.json')}</script>\n` +
  `<script id="bodydata" type="application/octet-stream">${read('assets/body.bin.gz').toString('base64')}</script>\n` +
  `<script type="module">${js}</script>`);
fs.mkdirSync(new URL('dist/', root), { recursive: true });
fs.writeFileSync(new URL('dist/X-Ray Body Mirror.html', root), html);
console.log(`dist/X-Ray Body Mirror.html  ${(html.length / 1e6).toFixed(1)} MB`);
