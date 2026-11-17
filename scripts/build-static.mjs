// Erzeugt server/static-files.js mit dem Inhalt aller Dateien aus public/ (Text als String, Binäres als Base64).
// So braucht der Deploy keinen separaten Asset-Upload, der in Cloud-Sessions am Proxy scheitert.
// Läuft automatisch bei npm run deploy. Die erzeugte Datei steht nicht im Repo.
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};
const SKIP = new Set(['_headers']);
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (!SKIP.has(name) && TYPES[extname(name)] && !/LICENSE/i.test(name)) files.push(relative(ROOT, p));
  }
})(ROOT);

const BINARY = new Set(['.png', '.woff2']);
const lines = ['// Automatisch erzeugt von scripts/build-static.mjs. Nicht von Hand bearbeiten.',
  "const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));", '', 'export const STATIC = {'];
for (const f of files) {
  const buf = readFileSync(join(ROOT, f));
  const body = BINARY.has(extname(f)) ? `b64(${JSON.stringify(buf.toString('base64'))})` : JSON.stringify(buf.toString('utf8'));
  lines.push(`  ${JSON.stringify('/' + f)}: [${body}, ${JSON.stringify(TYPES[extname(f)])}],`);
}
lines.push('};', '');
writeFileSync(new URL('../server/static-files.js', import.meta.url), lines.join('\n'));
console.log(`${files.length} Dateien eingebunden`);
