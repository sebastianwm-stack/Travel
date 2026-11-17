// Reiseberater über Cloudflare Workers AI (kostenloses Tageskontingent, kein API-Schlüssel nötig).
// Das Modell bekommt den Plan, die Ideen mit Herzen und Notizen und beantwortet Fragen der Gruppe.
import { daysOf, localParts } from './util.js';

export const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const dayLabel = (d) => { const x = new Date(d + 'T12:00:00Z'); return `${WD[x.getUTCDay()]} ${x.getUTCDate()}.${x.getUTCMonth() + 1}.`; };

export function tripContext(trip, members, places, hearts) {
  const name = new Map(members.map((m) => [m.id, m.name]));
  const hb = new Map();
  for (const h of hearts) hb.set(h.place_id, [...(hb.get(h.place_id) || []), name.get(h.member_id)].filter(Boolean));
  const line = (p) => `- ${p.time ? p.time + ' ' : ''}${p.title} [${p.cat}${p.area ? ', ' + p.area : ''}]${p.booked ? ' (gebucht)' : ''}${hb.get(p.id)?.length ? ' ♥ ' + hb.get(p.id).join(', ') : ''}${p.note ? ': ' + p.note.slice(0, 140) : ''}`;
  const out = [`Reise: ${trip.name} nach ${trip.dest}, ${trip.start} bis ${trip.end}. Mitreisende: ${members.map((m) => m.name).join(', ')}.`];
  for (const d of daysOf(trip)) {
    const ps = places.filter((p) => p.day === d).sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.ord - b.ord);
    out.push(`\n${dayLabel(d)}${ps.length ? '' : ' (noch nichts geplant)'}`);
    ps.forEach((p) => out.push(line(p)));
  }
  const pool = places.filter((p) => !p.day);
  if (pool.length) {
    out.push('\nIdeen ohne festen Tag:');
    pool.forEach((p) => out.push(line(p)));
  }
  return out.join('\n');
}

export async function ask(env, { trip, members, places, hearts, me, question, history = [] }) {
  if (!env.AI) return { answer: 'Der Reiseberater antwortet erst in der veröffentlichten App (Cloudflare Workers AI). Im lokalen Test gibt es ihn nicht.' };
  const now = localParts(trip.tz);
  const system = `Du bist der Reiseberater einer kleinen Reisegruppe aus Familie oder Freunden. Antworte auf Deutsch, kurz und konkret, so wie eine gut informierte Freundin schreiben würde. Keine Floskeln, keine Gedankenstriche, keine Emojis.
Nutze vor allem die Orte aus dem Plan und den Ideen unten und nenne sie beim Namen. Eigene Vorschläge sind erlaubt, kennzeichne sie dann als "neu".
Erfinde keine Öffnungszeiten, Preise oder Buchungen. Wenn du etwas nicht weißt, sag es.
Heute ist am Reiseziel der ${now.date}, etwa ${now.hour} Uhr. Es fragt: ${me.name}.

${tripContext(trip, members, places, hearts)}`;
  const messages = [{ role: 'system', content: system }, ...history.slice(-6), { role: 'user', content: question }];
  const res = await env.AI.run(MODEL, { messages, max_tokens: 700, temperature: 0.5 });
  return { answer: String(res?.response || '').trim() || 'Darauf habe ich gerade keine Antwort.' };
}
