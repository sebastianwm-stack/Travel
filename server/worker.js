// Cloudflare Worker "reisebande": liefert die App aus public/ aus und beantwortet /api/* (api.js).
// Jede Stunde prüft der Cron, ob irgendwo das Abendbriefing fällig ist (briefing.js).
import { ensureSchema, fail } from './util.js';
import { handleApi } from './api.js';
import { runBriefings } from './briefing.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.DB) return fail(503, 'Die Datenbank ist nicht angebunden (D1-Bindung "DB" fehlt).');
    try {
      await ensureSchema(env.DB);
      return await handleApi(request, env, url);
    } catch (e) {
      console.error(e);
      return fail(500, 'Da ist auf dem Server etwas schiefgelaufen.');
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(ensureSchema(env.DB).then(() => runBriefings(env)));
  },
};
