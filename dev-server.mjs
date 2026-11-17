// Lokaler Testserver: liefert public/ aus und beantwortet /api/* mit dem echten Worker-Code.
// D1 wird mit node:sqlite nachgebildet (Datei .wrangler/dev.sqlite), KV mit einem Ordner.
// Start: npm run dev  →  http://localhost:8788
// Mit Testdaten: SEED=private/nyc-2026.json npm run dev   (nur wenn die Datenbank noch leer ist)
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import worker from './server/worker.js';
import { createTrip } from './server/api.js';
import { ensureSchema } from './server/util.js';

const PORT = process.env.PORT || 8788;
const ROOT = new URL('./public/', import.meta.url).pathname;
const DATA = new URL('./.wrangler/dev/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain' };

await mkdir(join(DATA, 'files'), { recursive: true });
const sqlite = new DatabaseSync(join(DATA, 'dev.sqlite'));
sqlite.exec('PRAGMA foreign_keys = ON');

// Minimaler Nachbau der D1-Schnittstelle
function statement(sql, params = []) {
  // wie D1 erst beim Ausführen vorbereiten (Tabellen können im selben Batch erst entstehen)
  const s = () => sqlite.prepare(sql);
  const plain = (r) => (r ? { ...r } : null);
  return {
    sql,
    bind: (...p) => statement(sql, p),
    first: async () => plain(s().get(...params)),
    all: async () => ({ results: s().all(...params).map(plain) }),
    run: async () => { const r = s().run(...params); return { meta: { changes: r.changes } }; },
  };
}
export const DB = {
  prepare: (sql) => statement(sql),
  batch: async (stmts) => {
    sqlite.exec('BEGIN');
    try { const out = []; for (const st of stmts) out.push(/^\s*select/i.test(st.sql) ? await st.all() : await st.run()); sqlite.exec('COMMIT'); return out; }
    catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  },
};

const fileKey = (k) => join(DATA, 'files', Buffer.from(k).toString('base64url'));
const FILES = {
  put: async (k, v) => writeFile(fileKey(k), Buffer.from(v instanceof ArrayBuffer ? new Uint8Array(v) : v)),
  get: async (k) => { try { const b = await readFile(fileKey(k)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } catch { return null; } },
  delete: async (k) => rm(fileKey(k), { force: true }),
};

const vapid = JSON.parse(await readFile(new URL('./private/vapid.json', import.meta.url), 'utf8').catch(() => 'null'));
const env = { DB, FILES, VAPID_PUBLIC: vapid?.pub, VAPID_PRIVATE_JWK: vapid?.jwk };

if (process.env.SEED) {
  await ensureSchema(DB);
  const n = await DB.prepare('SELECT COUNT(*) AS n FROM trips').first();
  if (n.n === 0) {
    const data = JSON.parse(await readFile(process.env.SEED, 'utf8'));
    const { links } = await createTrip(env, data);
    await writeFile(join(DATA, 'links.json'), JSON.stringify(links, null, 1));
    console.log('Testreise angelegt. Einladungslinks:');
    for (const l of links) console.log(`  ${l.name.padEnd(10)} http://localhost:${PORT}/?k=${l.token}`);
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const r = await worker.fetch(request, env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  try {
    const data = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Nicht gefunden');
  }
}).listen(PORT, () => console.log(`Reisebande läuft auf http://localhost:${PORT}`));
