// Kurzinfos zu Orten: ein bis zwei Sätze, wofür der Ort gut ist, was man bestellt, ein Tipp oder ein ehrlicher Haken.
// Einmal am Tag (Cron) für Orte ohne Kurzinfo; ohne neue Orte passiert nichts. Jeder Ort bekommt genau eine.
// Grundlage: Name, Lage, Kategorie, Notizen der Gruppe und, wenn ein Google-Schlüssel da ist, Googles
// Kurzbeschreibung und einige Bewertungen (nur für die Anfrage, nicht gespeichert).
import { googleKey, googleNotes } from './google.js';

const MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-4-scout-17b-16e-instruct'];
const CHUNK = 6;
const MAX_TRIES = 4;
export const VERDICTS = ['top', 'ok', 'meh'];

const SYSTEM = `Du schreibst Kurzinfos zu Orten für die Reise-App einer Familie, so wie eine Freundin, die die Stadt gut kennt, es in einer Nachricht schreiben würde.
Für jeden Ort genau ein Eintrag: ein bis zwei ganze Sätze auf Deutsch, zusammen höchstens 170 Zeichen.
Was rein soll: wofür der Ort bekannt ist, was man dort isst, trinkt oder sieht, und ein praktischer Tipp oder ein ehrlicher Haken (lange Schlange, teuer, sehr touristisch, nur bar, früh hingehen).
Was nicht rein soll: den Namen des Orts wiederholen, Stichwortlisten, Kategorie oder Stadtname aufzählen, Werbeton, Floskeln wie "ein Muss" oder "Highlight", Gedankenstriche, Emojis.
Nutze die Notizen der Gruppe und Google-Infos, wenn vorhanden. Die Notizen sind persönliche Eindrücke: übernimm nur, was anderen hilft, nicht in Ich-Form und nicht, was jemand noch nicht probiert hat. Erfinde nichts: Kennst du einen Ort nicht sicher, schreib vorsichtig, was man dort nach Art und Lage erwarten kann, ohne erfundene Gerichte oder Preise.
verdict: "top" = klare Empfehlung, "ok" = nett, wenn es in den Tag passt, "meh" = eher nicht (Grund steht im Text).

Beispiele:
Joe's Pizza | Gegend: Greenwich Village | Art: Essen
{"i":1,"text":"Das klassische New Yorker Stück Käsepizza, dünn und groß, auf die Hand. Drinnen ist kaum Platz, also mitnehmen und im Gehen essen.","verdict":"top"}
Times Square | Art: Sehen
{"i":2,"text":"Abends einmal durchlaufen und staunen reicht völlig. Essen oder einkaufen lohnt hier nicht, alles teuer und voll.","verdict":"meh"}

Antworte nur mit JSON in dieser Form: {"items":[{"i":1,"text":"...","verdict":"top"}]}`;


// Text säubern: Hausregeln (keine Gedankenstriche, gerade Anführungszeichen), Länge
export function cleanBlurb(t, title = '') {
  let s = String(t || '').replace(/\s+/g, ' ').trim()
    .replace(/\s*[–—]\s*/g, ', ').replace(/[„“”]/g, '"').replace(/[‚‘’]/g, "'")
    .replace(/^["']|["']$/g, '');
  // Floskeln raus, die trotz Anweisung durchrutschen
  s = s.replace(/,?\s*(ein|das) (absolute[sn]? |echte[sn]? )?(Muss|Highlight)( für [^.,]+)?/gi, '').replace(/\s+([.,])/g, '$1').replace(/,\./g, '.');
  if (title && s.toLowerCase().startsWith(title.toLowerCase())) s = s.slice(title.length).replace(/^[\s,:.]+/, '');
  if (s) s = s[0].toUpperCase() + s.slice(1);
  if (s && !/[.!?…]$/.test(s)) s += '.';
  if (s.length > 230) s = s.slice(0, 227).replace(/\s+\S*$/, '') + ' …';
  return s;
}

function parse(res) {
  let r = res?.response ?? res;
  if (typeof r === 'string') {
    const m = r.match(/\{[\s\S]*\}/);
    try { r = JSON.parse(m ? m[0] : r); } catch { return []; }
  }
  return Array.isArray(r?.items) ? r.items : [];
}

async function askModel(env, user) {
  let lastErr;
  for (const model of MODELS) {
    try {
      const res = await env.AI.run(model, {
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
        max_tokens: 1200, temperature: 0.4,
      });
      const items = parse(res);
      if (items.length) return items;
      lastErr = new Error('leere Antwort');
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Schreibt Kurzinfos für bis zu `limit` Orte ohne Kurzinfo (optional nur einer Reise)
export async function writeBlurbs(env, { limit = 60, tripId = null, debug = null } = {}) {
  if (!env.AI) return { written: 0, left: 0, error: 'Keine KI-Anbindung' };
  const { results: rows } = await env.DB.prepare(
    `SELECT p.*, t.dest AS t_dest, t.gkey AS t_gkey FROM places p JOIN trips t ON t.id = p.trip_id
     WHERE p.deleted = 0 AND p.blurb IS NULL AND p.blurb_tries < ? ${tripId ? 'AND p.trip_id = ?' : ''} ORDER BY p.created_at LIMIT ?`
  ).bind(MAX_TRIES, ...(tripId ? [tripId] : []), limit).all();
  let written = 0, error = null;
  for (let c = 0; c < rows.length; c += CHUNK) {
    const chunk = rows.slice(c, c + CHUNK);
    const lines = await Promise.all(chunk.map(async (p, k) => {
      let g = null;
      try { g = JSON.parse(p.ginfo || 'null'); } catch { /* egal */ }
      const key = googleKey(env, { gkey: p.t_gkey });
      const extra = key && p.gplace ? await googleNotes(key, p.gplace).catch(() => '') : '';
      return [`${k + 1}. ${p.title}`, p.area && `Gegend: ${p.area}`, `Art: ${p.cat}`, p.t_dest && `Stadt: ${p.t_dest}`,
        p.note && `Notiz der Gruppe: ${p.note.slice(0, 200)}`, g?.rating && `Google: ${g.rating} Sterne (${g.n || '?'} Bewertungen)`, extra].filter(Boolean).join(' | ');
    }));
    try {
      const items = await askModel(env, lines.join('\n'));
      if (debug) debug.push({ prompt: lines, items });
      const stmts = [];
      chunk.forEach((p, k) => {
        const it = items.find((x) => Number(x.i) === k + 1);
        const text = cleanBlurb(it?.text, p.title);
        if (text.length >= 30 && text.split(' ').length >= 7 && /[.!?…]$/.test(text)) {
          stmts.push(env.DB.prepare('UPDATE places SET blurb = ?, blurb_v = ? WHERE id = ?').bind(text, VERDICTS.includes(it.verdict) ? it.verdict : 'ok', p.id));
          written++;
        } else stmts.push(env.DB.prepare('UPDATE places SET blurb_tries = blurb_tries + 1 WHERE id = ?').bind(p.id));
      });
      if (stmts.length) await env.DB.batch(stmts);
    } catch (e) {
      error = String(e?.message || e);
      await env.DB.batch(chunk.map((p) => env.DB.prepare('UPDATE places SET blurb_tries = blurb_tries + 1 WHERE id = ?').bind(p.id)));
    }
  }
  const left = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM places WHERE deleted = 0 AND blurb IS NULL AND blurb_tries < ? ${tripId ? 'AND trip_id = ?' : ''}`).bind(MAX_TRIES, ...(tripId ? [tripId] : [])).first()).n;
  return { written, left, error };
}

// Vom stündlichen Cron: höchstens einmal pro Tag (UTC), nichts zu tun heißt nichts zu tun
export async function dailyBlurbs(env, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'blurbs_day'").first().catch(() => null);
  if (row?.v === day) return { skipped: true };
  await env.DB.prepare("INSERT INTO meta (k, v) VALUES ('blurbs_day', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(day).run();
  return writeBlurbs(env, { limit: 60 });
}
