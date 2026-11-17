// Abendbriefing: um briefing_hour (Ortszeit am Reiseziel) geht eine Push-Nachricht für den nächsten Tag raus.
// Am Abend vor dem Abflug richtet sich die Uhrzeit nach der Heimat-Zeitzone.
import { addDays, localParts } from './util.js';
import { pushToTrip } from './push.js';
import { frameOf } from '../public/js/frame.js';
import { weatherFor, weatherLoc, weatherSentence } from './weather.js';

// frame: Anreise/Abreise (frame.js), wx: Wetter je Tag (weather.js)
export function briefingFor(trip, places, tomorrow, { frame = null, wx = {} } = {}) {
  const msg = planFor(trip, places, tomorrow);
  const extra = [];
  const arr = frame?.arrive, lv = frame?.leave;
  if (tomorrow === trip.start && arr) extra.push(`${arr.dep ? `Abflug ${arr.dep}${arr.from ? ` in ${arr.from}` : ''}, ` : ''}Landung ${arr.land}${arr.airport ? ` in ${arr.airport}` : ''}, im Hotel ca. ${arr.hotelAt}.`);
  if (tomorrow === trip.end && lv) extra.push(`Check-out bis ${lv.checkout}, ab zum Flughafen um ${lv.leaveAt}.`);
  const w = weatherSentence(wx?.[tomorrow]);
  if (w) extra.push(w);
  return { title: msg.title, body: [...extra, msg.body].join(' ') };
}

function planFor(trip, places, tomorrow) {
  const ps = places.filter((p) => p.day === tomorrow && !p.deleted)
    .sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.ord - b.ord);
  const isFirst = tomorrow === trip.start;
  const isLast = tomorrow === trip.end;
  const title = isFirst ? `Morgen geht es nach ${trip.dest || trip.name}` : isLast ? 'Morgen ist schon der letzte Tag' : 'Morgen auf dem Plan';
  if (!ps.length) return { title, body: 'Für morgen steht noch nichts fest. In den Ideen liegt genug, oder ihr fragt den Reiseberater.' };
  const first = ps[0];
  const LABEL = { frueh: 'Frühstück', vormittag: 'Vormittags', mittag: 'Mittags', nachmittag: 'Nachmittags', abend: 'Abends' };
  const parts = ps.slice(0, 5).map((p) => `${p.time ? p.time + ' ' : p.slot ? LABEL[p.slot] + ': ' : ''}${p.title}`);
  const more = ps.length > 5 ? ` und ${ps.length - 5} mehr` : '';
  const booked = ps.filter((p) => p.booked).map((p) => p.title);
  let body = parts.join(' · ') + more + '.';
  if (booked.length) body += ` Gebucht: ${booked.join(', ')}.`;
  if (first.time) body = `Start ${first.time}. ` + body;
  return { title, body };
}

// Vom Cron jede Stunde aufgerufen
export async function runBriefings(env, now = Date.now()) {
  const { results: trips } = await env.DB.prepare('SELECT * FROM trips WHERE start IS NOT NULL AND end IS NOT NULL').all();
  let sent = 0;
  for (const trip of trips) {
    const there = localParts(trip.tz, now);
    const home = localParts(trip.home_tz, now);
    // Abend vor dem Abflug: zu Hause; während der Reise: am Ziel
    let local = null;
    if (addDays(home.date, 1) === trip.start) local = home;
    else if (there.date >= trip.start && there.date < trip.end) local = there;
    if (!local || local.hour !== trip.briefing_hour || trip.last_briefing === local.date) continue;
    const { results: places } = await env.DB.prepare('SELECT * FROM places WHERE trip_id = ? AND deleted = 0').bind(trip.id).all();
    const { results: items } = await env.DB.prepare('SELECT * FROM items WHERE trip_id = ?').bind(trip.id).all();
    const wx = await weatherFor(env, trip, weatherLoc(trip, places)).catch(() => ({}));
    const msg = briefingFor(trip, places, addDays(local.date, 1), { frame: frameOf(trip, items), wx });
    const r = await pushToTrip(env, trip.id, { ...msg, tag: 'briefing', url: './#/heute' });
    await env.DB.prepare('UPDATE trips SET last_briefing = ? WHERE id = ?').bind(local.date, trip.id).run();
    sent += r.sent;
  }
  return { sent };
}
