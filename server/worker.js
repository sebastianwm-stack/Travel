// Cloudflare Worker "reisebande": beantwortet /api/* (api.js) und liefert die App aus (static-files.js).
// Jede Stunde prüft der Cron, ob irgendwo das Abendbriefing fällig ist (briefing.js).
import { ensureSchema, fail } from './util.js';
import { handleApi } from './api.js';
import { runBriefings } from './briefing.js';

const SECURITY = {
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'content-security-policy': "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://en.wikipedia.org https://commons.wikimedia.org https://tiles.openfreemap.org https://photon.komoot.io; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'none'",
};

let staticFiles = null;
async function serveStatic(request, url) {
  // erst beim ersten Seitenaufruf laden, damit Tests und der lokale Server ohne die eingebundenen Dateien auskommen
  if (!staticFiles) staticFiles = (await import('./static-files.js')).STATIC;
  let path = url.pathname === '/' ? '/index.html' : url.pathname;
  let hit = staticFiles[path];
  if (!hit && !/\.[a-z0-9]+$/i.test(path)) hit = staticFiles['/index.html'];
  if (!hit) return new Response('Nicht gefunden', { status: 404, headers: SECURITY });
  const [body, type] = hit;
  // Vendor-Dateien ändern sich selten, alles andere immer frisch prüfen (Home-Bildschirm-App)
  const cache = path.startsWith('/vendor/') || path.startsWith('/fonts/') ? 'public, max-age=604800' : 'no-cache';
  return new Response(request.method === 'HEAD' ? null : body, { headers: { 'content-type': type, 'cache-control': cache, ...SECURITY } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return serveStatic(request, url);
    if (!env.DB) return fail(503, 'Die Datenbank ist nicht angebunden (D1-Bindung "DB" fehlt).');
    try {
      await ensureSchema(env.DB);
      return await handleApi(request, env, url, ctx);
    } catch (e) {
      console.error(e);
      return fail(500, 'Da ist auf dem Server etwas schiefgelaufen.');
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(ensureSchema(env.DB).then(() => runBriefings(env)));
  },
};
