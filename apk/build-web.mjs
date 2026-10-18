// Construit la version autonome (hors-ligne) du jeu pour l'APK Android.
// Sortie : android/app/src/main/assets/www/  (index.html + game.js + polices)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../dnd3d');
const out = path.resolve(here, 'android/app/src/main/assets/www');
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

// 1. un seul script, Three.js inclus
await esbuild.build({
  entryPoints: [path.join(src, 'js/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['chrome90'],
  nodePaths: [path.join(here, 'node_modules')],
  outfile: path.join(out, 'game.js'),
  logLevel: 'warning',
});

// 2. polices Google embarquées
const FONT_URL = 'https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700;900&family=Cinzel:wght@500;700;900&family=EB+Garamond:ital,wght@0,400;0,600;1,400&display=swap';
let css = await (await fetch(FONT_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' } })).text();
// ne garder que les jeux de caractères latins (suffisants pour le français)
css = css.split('/*').filter((b) => !b.trim() || /^\s*latin \*\//.test(b)).map((b, i) => (i ? '/*' + b : b)).join('');
const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
let n = 0;
for (const u of urls) {
  const name = `f${n++}.woff2`;
  fs.writeFileSync(path.join(out, 'fonts', name), Buffer.from(await (await fetch(u)).arrayBuffer()));
  css = css.split(u).join(`fonts/${name}`);
}
fs.writeFileSync(path.join(out, 'fonts.css'), css);

// 3. page HTML adaptée (pas d'importmap ni de CDN)
let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, '');
html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link href="fonts.css" rel="stylesheet">');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
html = html.replace('<script type="module" src="js/main.js"></script>', '<script src="game.js"></script>');
html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">');
if (html.includes('cdn.jsdelivr') || html.includes('importmap')) throw new Error('dépendance CDN restante');
fs.writeFileSync(path.join(out, 'index.html'), html);

const kb = (f) => Math.round(fs.statSync(path.join(out, f)).size / 1024);
console.log(`game.js ${kb('game.js')} Ko, ${urls.length} polices, index.html ${kb('index.html')} Ko`);
