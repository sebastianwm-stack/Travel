// Reiseberater über Cloudflare Workers AI (kostenloses Tageskontingent, kein API-Schlüssel nötig).
// Das Modell bekommt den Plan, die Ideen mit Herzen und Notizen und beantwortet Fragen der Gruppe.
import { daysOf, localParts } from './util.js';

// Schnelle Modelle zuerst; fällt eins aus, kommt das nächste dran
export const MODELS = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/meta/llama-3.1-8b-instruct-fast'];

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const dayLabel = (d) => { const x = new Date(d + 'T12:00:00Z'); return `${WD[x.getUTCDay()]} ${x.getUTCDate()}.${x.getUTCMonth() + 1}.`; };

export function tripContext(trip, members, places, hearts) {
  const name = new Map(members.map((m) => [m.id, m.name]));
  const hb = new Map();
  for (const h of hearts) hb.set(h.place_id, [...(hb.get(h.place_id) || []), name.get(h.member_id)].filter(Boolean));
  const line = (p) => `- ${p.time ? p.time + ' ' : p.slot ? '(' + p.slot + ') ' : ''}${p.title} [${p.cat}${p.area ? ', ' + p.area : ''}]${p.booked ? ' (gebucht)' : ''}${hb.get(p.id)?.length ? ' ♥ ' + hb.get(p.id).join(', ') : ''}${p.note ? ': ' + p.note.slice(0, 70) : ''}`;
  let hotel = null;
  try { hotel = JSON.parse(trip.hotel || 'null'); } catch { /* egal */ }
  const out = [`Reise: ${trip.name} nach ${trip.dest}, ${trip.start} bis ${trip.end}. Mitreisende: ${members.map((m) => m.name).join(', ')}.${hotel ? ` Unterkunft: ${hotel.name}.` : ''}`];
  for (const d of daysOf(trip)) {
    const ps = places.filter((p) => p.day === d).sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.ord - b.ord);
    out.push(`\n${dayLabel(d)}${ps.length ? '' : ' (noch nichts geplant)'}`);
    ps.forEach((p) => out.push(line(p)));
  }
  // Nur die beliebtesten Ideen mitschicken, sonst wird die Anfrage lang und langsam
  const pool = places.filter((p) => !p.day).sort((a, b) => (hb.get(b.id)?.length || 0) - (hb.get(a.id)?.length || 0));
  if (pool.length) {
    out.push('\nIdeen ohne festen Tag (die beliebtesten):');
    pool.slice(0, 60).forEach((p) => out.push(line(p)));
    if (pool.length > 60) out.push(`… und ${pool.length - 60} weitere Ideen.`);
  }
  return out.join('\n');
}

function buildMessages({ trip, members, places, hearts, me, question, history = [] }) {
  const now = localParts(trip.tz);
  const system = `Du bist der Reiseberater einer kleinen Reisegruppe aus Familie oder Freunden. Antworte auf Deutsch, kurz und konkret, so wie eine gut informierte Freundin schreiben würde. Höchstens fünf Sätze oder eine kurze Liste. Keine Floskeln, keine Gedankenstriche, keine Emojis.
Nutze vor allem die Orte aus dem Plan und den Ideen unten und nenne sie beim Namen. Eigene Vorschläge sind erlaubt, kennzeichne sie dann als "neu".
Erfinde keine Öffnungszeiten, Preise oder Buchungen. Wenn du etwas nicht weißt, sag es.
Heute ist am Reiseziel der ${now.date}, etwa ${now.hour} Uhr. Es fragt: ${me.name}.

${tripContext(trip, members, places, hearts)}`;
  return [{ role: 'system', content: system }, ...history.slice(-6), { role: 'user', content: question }];
}

const NO_AI = 'Der Reiseberater antwortet erst in der veröffentlichten App (Cloudflare Workers AI). Im lokalen Test gibt es ihn nicht.';

export async function ask(env, input) {
  if (!env.AI) return { answer: NO_AI };
  const messages = buildMessages(input);
  let lastErr;
  for (const model of MODELS) {
    try {
      const res = await env.AI.run(model, { messages, max_tokens: 500, temperature: 0.5 });
      return { answer: String(res?.response || '').trim() || 'Darauf habe ich gerade keine Antwort.' };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Antwort als Stream (Server-Sent Events von Workers AI), damit der Text sofort erscheint
export async function askStream(env, input) {
  if (!env.AI) return new Response(`data: ${JSON.stringify({ response: NO_AI })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  const messages = buildMessages(input);
  let lastErr;
  for (const model of MODELS) {
    try {
      const stream = await env.AI.run(model, { messages, max_tokens: 500, temperature: 0.5, stream: true });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' } });
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
