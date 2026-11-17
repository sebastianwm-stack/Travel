// Die Schnittstelle der App. Jede Person hat einen eigenen Einladungslink mit geheimem Schlüssel;
// die App schickt ihn als "Authorization: Bearer …" mit. Gespeichert ist nur sein Hash.
import { json, fail, sha256, rid, newToken, str, isDate, isTime, num, daysOf, addDays, localParts } from './util.js';
import { validCat, guessCat } from './cats.js';
import { suggestPlan } from './plan.js';
import { syncTrip, resolveUrl } from './maps.js';
import { ask } from './ai.js';
import { briefingFor } from './briefing.js';
import { validEndpoint, pushReady, pushToTrip, sendPush } from './push.js';

const COLORS = ['#C8F25A', '#FF8AD1', '#FF5B3A', '#2F4BFF', '#7A4DFF', '#0E6B47', '#FFB627', '#16B5C9'];
const MAX_FILE = 20 * 1024 * 1024;
const ITEM_KINDS = ['flight', 'stay', 'transport'];

async function body(request) {
  return request.json().catch(() => ({}));
}

async function auth(request, env) {
  const h = request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (token.length < 20) return null;
  const me = await env.DB.prepare('SELECT * FROM members WHERE token_hash = ?').bind(await sha256(token)).first();
  if (!me) return null;
  const trip = await env.DB.prepare('SELECT * FROM trips WHERE id = ?').bind(me.trip_id).first();
  if (!trip) return null;
  if (!me.last_seen || Date.now() - me.last_seen > 5 * 60e3) {
    await env.DB.prepare('UPDATE members SET last_seen = ? WHERE id = ?').bind(Date.now(), me.id).run();
  }
  return { me, trip };
}

const publicMember = (m) => ({ id: m.id, name: m.name, color: m.color, role: m.role, claimed: !!m.claimed, lastSeen: m.last_seen });

async function loadState(env, trip) {
  const q = (sql) => env.DB.prepare(sql).bind(trip.id).all().then((r) => r.results);
  const [members, places, hearts, comments, items, files] = await Promise.all([
    q('SELECT * FROM members WHERE trip_id = ? ORDER BY created_at'),
    q('SELECT * FROM places WHERE trip_id = ? AND deleted = 0'),
    q('SELECT h.* FROM hearts h JOIN places p ON p.id = h.place_id WHERE p.trip_id = ?'),
    q('SELECT * FROM comments WHERE trip_id = ? ORDER BY created_at'),
    q('SELECT * FROM items WHERE trip_id = ? ORDER BY ord'),
    q('SELECT * FROM files WHERE trip_id = ?'),
  ]);
  return { members, places, hearts, comments, items, files };
}

function tripOut(trip) {
  const { id, name, dest, theme, start, end, tz, home_tz, maps_url, maps_synced_at, briefing_hour } = trip;
  return { id, name, dest, theme, start, end, tz, homeTz: home_tz, mapsUrl: maps_url, mapsSyncedAt: maps_synced_at, briefingHour: briefing_hour, days: daysOf(trip) };
}

function placeOut(p) {
  return {
    id: p.id, title: p.title, area: p.area, cat: p.cat, note: p.note, lat: p.lat, lng: p.lng, approx: !!p.approx,
    url: p.url, image: p.image, imageCredit: safeJSON(p.image_credit || 'null', null), imageTried: !!p.image_tried, source: p.source, day: p.day, time: p.time, ord: p.ord, booked: !!p.booked, hours: p.hours,
    createdBy: p.created_by, createdAt: p.created_at, updatedAt: p.updated_at,
  };
}
function itemOut(i) {
  return { id: i.id, kind: i.kind, title: i.title, note: i.note, data: safeJSON(i.data, {}), ord: i.ord };
}
const safeJSON = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// ---------- Anlegen einer Reise aus einer Importdatei ----------

export async function createTrip(env, data, now = Date.now()) {
  const t = data?.trip || {};
  if (!str(t.name)) throw new Error('Die Reise braucht einen Namen.');
  const tripId = rid();
  const stmts = [];
  stmts.push(env.DB.prepare(
    `INSERT INTO trips (id, name, dest, theme, start, end, tz, home_tz, maps_url, briefing_hour, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(tripId, str(t.name, 120), str(t.dest, 120), str(t.theme, 30) || 'stadt', isDate(t.start) ? t.start : null, isDate(t.end) ? t.end : null,
    str(t.tz, 60) || 'Europe/Berlin', str(t.homeTz, 60) || 'Europe/Berlin', str(t.mapsUrl, 500), Number.isInteger(t.briefingHour) ? t.briefingHour : 20, now));

  const members = Array.isArray(data.members) && data.members.length ? data.members : [{ key: 'ich', name: 'Ich', role: 'admin' }];
  const keyToId = new Map();
  const links = [];
  let i = 0;
  for (const m of members.slice(0, 30)) {
    const id = rid();
    const token = newToken();
    keyToId.set(m.key ?? m.name, id);
    const claimed = m.role === 'admin' || m.claimed === true ? 1 : 0;
    stmts.push(env.DB.prepare('INSERT INTO members (id, trip_id, name, color, role, token_hash, claimed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, tripId, str(m.name, 40) || 'Gast', m.color || COLORS[i % COLORS.length], m.role === 'admin' ? 'admin' : 'member', await sha256(token), claimed, now + i));
    links.push({ id, name: str(m.name, 40), role: m.role === 'admin' ? 'admin' : 'member', token });
    i++;
  }
  let ord = 0;
  for (const p of (data.places || []).slice(0, 1000)) {
    const pid = rid();
    stmts.push(env.DB.prepare(
      `INSERT INTO places (id, trip_id, title, area, cat, note, lat, lng, approx, url, source, day, time, ord, booked, hours, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(pid, tripId, str(p.title, 200) || 'Ort', str(p.area, 120), validCat(p.cat), str(p.note, 2000), num(p.lat), num(p.lng), p.approx ? 1 : 0, str(p.url, 500),
      isDate(p.day) ? p.day : null, isTime(p.time) ? p.time : '', ord++, p.booked ? 1 : 0, num(p.hours), keyToId.get(p.by) || null, now, now));
    for (const k of p.hearts || []) if (keyToId.has(k)) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO hearts (place_id, member_id) VALUES (?, ?)').bind(pid, keyToId.get(k)));
  }
  ord = 0;
  for (const it of (data.items || []).slice(0, 1000)) {
    if (!ITEM_KINDS.includes(it.kind)) continue;
    stmts.push(env.DB.prepare('INSERT INTO items (id, trip_id, kind, title, note, data, ord, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(rid(), tripId, it.kind, str(it.title, 300) || 'Eintrag', str(it.note, 2000), JSON.stringify(it.data || {}).slice(0, 4000), ord++, now));
  }
  for (let k = 0; k < stmts.length; k += 50) await env.DB.batch(stmts.slice(k, k + 50));
  return { tripId, links };
}

// ---------- Google-Maps-Link eines einzelnen Ortes auslesen ----------

export function parsePlaceUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/google\.[a-z.]+$|goo\.gl$/.test(u.hostname)) return null;
  const s = decodeURIComponent(u.pathname + u.search + u.hash);
  const out = {};
  const name = s.match(/\/place\/([^/@]+)/);
  if (name) out.title = name[1].replace(/\+/g, ' ').trim();
  const precise = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  const at = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const c = precise || at;
  if (c) { out.lat = Number(c[1]); out.lng = Number(c[2]); }
  const q = u.searchParams.get('q') || u.searchParams.get('query');
  if (q) {
    const ll = q.match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/);
    if (ll) { out.lat = Number(ll[1]); out.lng = Number(ll[2]); } else if (!out.title) out.title = q.replace(/\+/g, ' ');
  }
  return out.title || out.lat ? out : null;
}

// ---------- Router ----------

export async function handleApi(request, env, url) {
  let m0;
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method;

  if (path === '/status' && method === 'GET') {
    const any = await env.DB.prepare('SELECT COUNT(*) AS n FROM trips').first();
    return json({ setup: any.n > 0, push: pushReady(env), vapid: env.VAPID_PUBLIC || null, ai: Boolean(env.AI) });
  }

  // Erste Reise anlegen: nur solange noch keine existiert, oder mit SETUP_KEY
  if (path === '/setup' && method === 'POST') {
    const any = await env.DB.prepare('SELECT COUNT(*) AS n FROM trips').first();
    const key = request.headers.get('x-setup-key') || '';
    if (any.n > 0 && !(env.SETUP_KEY && key === env.SETUP_KEY)) return fail(403, 'Es gibt schon eine Reise. Neue Reisen legt die Reiseleitung in der App an.');
    const data = await body(request);
    try { return json(await createTrip(env, data)); } catch (e) { return fail(400, e.message); }
  }

  // Einladung ansehen und annehmen (ohne Anmeldung, nur mit Code)
  if ((m0 = path.match(/^\/invite\/([a-z0-9]{8,40})$/)) && method === 'GET') {
    const inv = await validInvite(env, m0[1]);
    if (!inv) return fail(404, 'Diese Einladung ist abgelaufen oder schon benutzt. Frag nach einer neuen.');
    const trip = await env.DB.prepare('SELECT * FROM trips WHERE id = ?').bind(inv.trip_id).first();
    const by = inv.created_by ? await env.DB.prepare('SELECT name FROM members WHERE id = ?').bind(inv.created_by).first() : null;
    const { results: seats } = await env.DB.prepare('SELECT id, name, color FROM members WHERE trip_id = ? AND claimed = 0 ORDER BY created_at').bind(trip.id).all();
    return json({ trip: { id: trip.id, name: trip.name, dest: trip.dest, theme: trip.theme, start: trip.start, end: trip.end }, by: by?.name || '', seats });
  }
  if (path === '/join' && method === 'POST') {
    const b = await body(request);
    const inv = await validInvite(env, str(b.code, 40));
    if (!inv) return fail(404, 'Diese Einladung ist abgelaufen oder schon benutzt. Frag nach einer neuen.');
    const token = newToken();
    const now = Date.now();
    let memberId;
    if (b.seat) {
      const seat = await env.DB.prepare('SELECT id FROM members WHERE id = ? AND trip_id = ? AND claimed = 0').bind(str(b.seat, 40), inv.trip_id).first();
      if (!seat) return fail(409, 'Dieser Platz ist schon vergeben.');
      memberId = seat.id;
      await env.DB.prepare('UPDATE members SET token_hash = ?, claimed = 1, last_seen = ? WHERE id = ?').bind(await sha256(token), now, memberId).run();
    } else {
      const name = str(b.name, 40);
      if (!name) return fail(400, 'Wie heißt du?');
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE trip_id = ?').bind(inv.trip_id).first();
      if (count.n >= 30) return fail(400, 'Die Reise ist voll.');
      memberId = rid();
      await env.DB.prepare('INSERT INTO members (id, trip_id, name, color, role, token_hash, claimed, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
        .bind(memberId, inv.trip_id, name, COLORS[count.n % COLORS.length], 'member', await sha256(token), now, now).run();
    }
    if (inv.uses_left !== null) await env.DB.prepare('UPDATE invites SET uses_left = uses_left - 1 WHERE code_hash = ?').bind(inv.code_hash).run();
    return json({ token, tripId: inv.trip_id });
  }

  const ctx = await auth(request, env);
  if (!ctx) return fail(401, 'Dieser Link ist nicht mehr gültig.');
  const { me, trip } = ctx;
  const isAdmin = me.role === 'admin';
  const now = Date.now();
  let m;

  if (path === '/trip' && method === 'GET') {
    const s = await loadState(env, trip);
    return json({
      me: publicMember(me), trip: tripOut(trip),
      members: s.members.map(publicMember),
      places: s.places.map(placeOut),
      hearts: s.hearts.map((h) => [h.place_id, h.member_id]),
      comments: s.comments.map((c) => ({ id: c.id, target: c.target, by: c.member_id, body: c.body, file: c.file_id, at: c.created_at })),
      items: s.items.map(itemOut),
      files: Object.fromEntries(s.files.map((f) => [f.id, { name: f.name, type: f.type, size: f.size, by: f.member_id }])),
    });
  }

  if (path === '/trip' && method === 'PATCH') {
    if (!isAdmin) return fail(403, 'Nur die Reiseleitung kann das ändern.');
    const b = await body(request);
    const f = {};
    if ('name' in b) f.name = str(b.name, 120) || trip.name;
    if ('dest' in b) f.dest = str(b.dest, 120);
    if ('theme' in b) f.theme = str(b.theme, 30) || 'stadt';
    if ('start' in b && isDate(b.start)) f.start = b.start;
    if ('end' in b && isDate(b.end)) f.end = b.end;
    if ('tz' in b) f.tz = str(b.tz, 60) || trip.tz;
    if ('mapsUrl' in b) f.maps_url = str(b.mapsUrl, 500);
    if ('briefingHour' in b && Number.isInteger(b.briefingHour) && b.briefingHour >= 0 && b.briefingHour <= 23) f.briefing_hour = b.briefingHour;
    const keys = Object.keys(f);
    if (keys.length) await env.DB.prepare(`UPDATE trips SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...keys.map((k) => f[k]), trip.id).run();
    return json({ ok: true });
  }

  if (path === '/me' && method === 'PATCH') {
    const b = await body(request);
    const name = str(b.name, 40) || me.name;
    const color = /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : me.color;
    await env.DB.prepare('UPDATE members SET name = ?, color = ? WHERE id = ?').bind(name, color, me.id).run();
    return json({ ok: true });
  }

  // --- Orte ---
  if (path === '/places' && method === 'POST') {
    const b = await body(request);
    let info = {};
    if (b.link) {
      let link = str(b.link, 1000);
      try { link = await resolveUrl(link); } catch { /* Kurzlink nicht auflösbar, weiter mit Original */ }
      info = parsePlaceUrl(link) || {};
      if (!info.title && !b.title) return fail(400, 'Aus dem Link ließ sich kein Ort lesen. Gib den Namen bitte von Hand ein.');
      info.url = link;
    }
    const title = str(b.title || info.title, 200);
    if (!title) return fail(400, 'Der Ort braucht einen Namen.');
    const id = rid();
    await env.DB.prepare(
      `INSERT INTO places (id, trip_id, title, area, cat, note, lat, lng, approx, url, source, day, time, ord, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, trip.id, title, str(b.area, 120), b.cat ? validCat(b.cat) : guessCat(title + ' ' + (b.note || '')), str(b.note, 2000), num(b.lat ?? info.lat), num(b.lng ?? info.lng),
      str(info.url || b.url, 1000), b.link ? 'link' : 'manual', isDate(b.day) ? b.day : null, isTime(b.time) ? b.time : '', now, me.id, now, now).run();
    await env.DB.prepare('INSERT OR IGNORE INTO hearts (place_id, member_id) VALUES (?, ?)').bind(id, me.id).run();
    return json({ id });
  }

  if ((m = path.match(/^\/places\/([a-z0-9]+)$/))) {
    const p = await env.DB.prepare('SELECT * FROM places WHERE id = ? AND trip_id = ? AND deleted = 0').bind(m[1], trip.id).first();
    if (!p) return fail(404, 'Ort nicht gefunden.');
    if (method === 'PATCH') {
      const b = await body(request);
      const f = {};
      if ('title' in b) f.title = str(b.title, 200) || p.title;
      if ('area' in b) f.area = str(b.area, 120);
      if ('cat' in b) f.cat = validCat(b.cat);
      if ('note' in b) f.note = str(b.note, 2000);
      if ('day' in b) f.day = isDate(b.day) ? b.day : null;
      if ('time' in b && isTime(b.time)) f.time = b.time;
      if ('ord' in b && num(b.ord) !== null) f.ord = num(b.ord);
      if ('booked' in b) f.booked = b.booked ? 1 : 0;
      if ('hours' in b) f.hours = num(b.hours);
      if ('url' in b) f.url = str(b.url, 1000);
      if ('image' in b) {
        const img = str(b.image, 1000);
        if (img && !/^https:\/\//.test(img) && !/^file:[a-z0-9]+$/.test(img)) return fail(400, 'Das Bild braucht einen https-Link.');
        const c = b.imageCredit && typeof b.imageCredit === 'object' ? { t: str(b.imageCredit.t, 80), l: /^https:\/\//.test(b.imageCredit.l || '') ? str(b.imageCredit.l, 500) : undefined } : null;
        f.image = img;
        f.image_credit = img.startsWith('file:') ? JSON.stringify({ t: `Foto von ${me.name}` }) : img ? JSON.stringify(c || { t: new URL(img).hostname }) : '';
        f.image_tried = 1;
      }
      if ('imageTried' in b) f.image_tried = b.imageTried ? 1 : 0;
      if ('lat' in b && 'lng' in b) { f.lat = num(b.lat); f.lng = num(b.lng); f.approx = 0; }
      f.updated_at = now;
      const keys = Object.keys(f);
      await env.DB.prepare(`UPDATE places SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...keys.map((k) => f[k]), p.id).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await env.DB.prepare('UPDATE places SET deleted = 1, updated_at = ? WHERE id = ?').bind(now, p.id).run();
      return json({ ok: true });
    }
  }

  if ((m = path.match(/^\/places\/([a-z0-9]+)\/heart$/)) && method === 'POST') {
    const p = await env.DB.prepare('SELECT id FROM places WHERE id = ? AND trip_id = ?').bind(m[1], trip.id).first();
    if (!p) return fail(404, 'Ort nicht gefunden.');
    const has = await env.DB.prepare('SELECT 1 FROM hearts WHERE place_id = ? AND member_id = ?').bind(p.id, me.id).first();
    if (has) await env.DB.prepare('DELETE FROM hearts WHERE place_id = ? AND member_id = ?').bind(p.id, me.id).run();
    else await env.DB.prepare('INSERT INTO hearts (place_id, member_id) VALUES (?, ?)').bind(p.id, me.id).run();
    return json({ hearted: !has });
  }

  // --- Tagesvorschlag ---
  if (path === '/plan/suggest' && method === 'POST') {
    const s = await loadState(env, trip);
    const hc = new Map();
    s.hearts.forEach((h) => hc.set(h.place_id, (hc.get(h.place_id) || 0) + 1));
    const days = daysOf(trip);
    const b = await body(request);
    const onlyDays = Array.isArray(b.days) ? days.filter((d) => b.days.includes(d)) : days;
    const moves = suggestPlan(s.places.map((p) => ({ ...p, hearts: hc.get(p.id) || 0 })), onlyDays, { perDay: Math.min(10, Math.max(2, Number(b.perDay) || 6)), lightDays: [trip.start, trip.end], dayStart: { [trip.start]: 18 } });
    return json({ moves });
  }
  if (path === '/plan/apply' && method === 'POST') {
    const b = await body(request);
    const moves = Array.isArray(b.moves) ? b.moves.slice(0, 200) : [];
    const stmts = moves.filter((x) => isDate(x.day) && isTime(x.time || '')).map((x) =>
      env.DB.prepare('UPDATE places SET day = ?, time = ?, ord = ?, updated_at = ? WHERE id = ? AND trip_id = ?').bind(x.day, x.time || '', num(x.ord) ?? 0, now, x.id, trip.id));
    for (let k = 0; k < stmts.length; k += 50) await env.DB.batch(stmts.slice(k, k + 50));
    return json({ ok: true, applied: stmts.length });
  }

  // --- Kommentare ---
  if (path === '/comments' && method === 'POST') {
    const b = await body(request);
    const target = str(b.target, 80);
    if (!/^(place:[a-z0-9]+|day:\d{4}-\d{2}-\d{2}|trip)$/.test(target)) return fail(400, 'Unbekanntes Ziel.');
    const text = str(b.body, 4000);
    const fileId = b.file && /^[a-z0-9]+$/.test(b.file) ? b.file : null;
    if (!text && !fileId) return fail(400, 'Leerer Kommentar.');
    const id = rid();
    await env.DB.prepare('INSERT INTO comments (id, trip_id, target, member_id, body, file_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, trip.id, target, me.id, text, fileId, now).run();
    return json({ id });
  }
  if ((m = path.match(/^\/comments\/([a-z0-9]+)$/)) && method === 'DELETE') {
    const c = await env.DB.prepare('SELECT * FROM comments WHERE id = ? AND trip_id = ?').bind(m[1], trip.id).first();
    if (!c) return fail(404, 'Kommentar nicht gefunden.');
    if (c.member_id !== me.id && !isAdmin) return fail(403, 'Nur eigene Kommentare lassen sich löschen.');
    await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(c.id).run();
    if (c.file_id) { await env.FILES.delete(`file:${c.file_id}`); await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(c.file_id).run(); }
    return json({ ok: true });
  }

  // --- Dateien (Fotos, PDFs, Tickets) ---
  if (path === '/files' && method === 'POST') {
    const size = Number(request.headers.get('content-length') || 0);
    if (size > MAX_FILE) return fail(413, 'Die Datei ist zu groß (höchstens 20 MB).');
    const buf = await request.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_FILE) return fail(413, 'Die Datei ist leer oder zu groß (höchstens 20 MB).');
    const type = str(request.headers.get('content-type'), 100) || 'application/octet-stream';
    const name = str(decodeURIComponent(request.headers.get('x-name') || 'Datei'), 200);
    const id = rid(16);
    await env.FILES.put(`file:${id}`, buf, { metadata: { type } });
    await env.DB.prepare('INSERT INTO files (id, trip_id, member_id, name, type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, trip.id, me.id, name, type, buf.byteLength, now).run();
    return json({ id, name, type, size: buf.byteLength });
  }
  if ((m = path.match(/^\/files\/([a-z0-9]+)$/)) && method === 'GET') {
    const f = await env.DB.prepare('SELECT * FROM files WHERE id = ? AND trip_id = ?').bind(m[1], trip.id).first();
    if (!f) return fail(404, 'Datei nicht gefunden.');
    const data = await env.FILES.get(`file:${f.id}`, 'arrayBuffer');
    if (!data) return fail(404, 'Datei nicht gefunden.');
    return new Response(data, { headers: { 'content-type': f.type, 'cache-control': 'private, max-age=86400', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}` } });
  }

  // --- Reise-Infos: Flüge, Unterkunft, Anreise ---
  if (path === '/items' && method === 'POST') {
    const b = await body(request);
    if (!ITEM_KINDS.includes(b.kind)) return fail(400, 'Unbekannte Art.');
    const title = str(b.title, 300);
    if (!title) return fail(400, 'Bitte einen Titel angeben.');
    const id = rid();
    await env.DB.prepare('INSERT INTO items (id, trip_id, kind, title, note, data, ord, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, trip.id, b.kind, title, str(b.note, 2000), JSON.stringify(b.data || {}).slice(0, 4000), now, now).run();
    return json({ id });
  }
  if ((m = path.match(/^\/items\/([a-z0-9]+)$/))) {
    const it = await env.DB.prepare('SELECT * FROM items WHERE id = ? AND trip_id = ?').bind(m[1], trip.id).first();
    if (!it) return fail(404, 'Eintrag nicht gefunden.');
    if (method === 'PATCH') {
      const b = await body(request);
      const f = {};
      if ('title' in b) f.title = str(b.title, 300) || it.title;
      if ('note' in b) f.note = str(b.note, 2000);
      if ('data' in b) f.data = JSON.stringify(b.data || {}).slice(0, 4000);
      f.updated_at = now;
      const keys = Object.keys(f);
      await env.DB.prepare(`UPDATE items SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...keys.map((k) => f[k]), it.id).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(it.id).run();
      return json({ ok: true });
    }
  }

  // --- Mitglieder und Einladungen ---
  if (path === '/invites' && method === 'POST') {
    if (!isAdmin) return fail(403, 'Nur die Reiseleitung kann einladen.');
    const b = await body(request);
    const code = rid(12);
    await env.DB.prepare('INSERT INTO invites (code_hash, trip_id, created_by, uses_left, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await sha256(code), trip.id, me.id, b.multi ? null : 1, now + 14 * 864e5, now).run();
    return json({ code, multi: !!b.multi, expiresAt: now + 14 * 864e5 });
  }
  if (path === '/members' && method === 'POST') {
    if (!isAdmin) return fail(403, 'Nur die Reiseleitung kann einladen.');
    const b = await body(request);
    const name = str(b.name, 40);
    if (!name) return fail(400, 'Bitte einen Namen angeben.');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE trip_id = ?').bind(trip.id).first();
    const id = rid();
    const token = newToken();
    await env.DB.prepare('INSERT INTO members (id, trip_id, name, color, role, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, trip.id, name, COLORS[count.n % COLORS.length], b.role === 'admin' ? 'admin' : 'member', await sha256(token), now).run();
    return json({ id, token });
  }
  if ((m = path.match(/^\/members\/([a-z0-9]+)\/link$/)) && method === 'POST') {
    if (!isAdmin && m[1] !== me.id) return fail(403, 'Nur die Reiseleitung kann Links erneuern.');
    const t = await env.DB.prepare('SELECT id FROM members WHERE id = ? AND trip_id = ?').bind(m[1], trip.id).first();
    if (!t) return fail(404, 'Person nicht gefunden.');
    const token = newToken();
    await env.DB.prepare('UPDATE members SET token_hash = ? WHERE id = ?').bind(await sha256(token), t.id).run();
    await env.DB.prepare('DELETE FROM push_subs WHERE member_id = ?').bind(t.id).run();
    return json({ token });
  }
  if ((m = path.match(/^\/members\/([a-z0-9]+)$/)) && method === 'DELETE') {
    if (!isAdmin || m[1] === me.id) return fail(403, 'Das geht nicht.');
    await env.DB.prepare('DELETE FROM members WHERE id = ? AND trip_id = ?').bind(m[1], trip.id).run();
    return json({ ok: true });
  }

  // --- Neue Reise (Reiseleitung), z. B. später mit Freunden ---
  if (path === '/trips' && method === 'POST') {
    if (!isAdmin) return fail(403, 'Nur die Reiseleitung kann Reisen anlegen.');
    const data = await body(request);
    if (!data.members) data.members = [{ key: 'me', name: me.name, role: 'admin', color: me.color }];
    try { return json(await createTrip(env, data)); } catch (e) { return fail(400, e.message); }
  }

  // --- Google-Maps-Liste ---
  if (path === '/maps/sync' && method === 'POST') {
    try { return json(await syncTrip(env, trip, me.id)); } catch (e) { return fail(502, e.message); }
  }

  // --- Reiseberater ---
  if (path === '/ask' && method === 'POST') {
    const b = await body(request);
    const question = str(b.question, 1000);
    if (!question) return fail(400, 'Was möchtest du wissen?');
    const history = (Array.isArray(b.history) ? b.history : []).filter((h) => ['user', 'assistant'].includes(h.role)).map((h) => ({ role: h.role, content: str(h.content, 2000) }));
    const s = await loadState(env, trip);
    try {
      return json(await ask(env, { trip, members: s.members, places: s.places, hearts: s.hearts, me, question, history }));
    } catch (e) {
      return fail(502, 'Der Reiseberater ist gerade nicht erreichbar. Versuch es gleich noch mal.');
    }
  }

  // --- Push / Abendbriefing ---
  if (path === '/push/subscribe' && method === 'POST') {
    if (!pushReady(env)) return fail(503, 'Benachrichtigungen sind auf dem Server noch nicht eingerichtet.');
    const b = await body(request);
    if (!validEndpoint(b.endpoint) || !b.p256dh || !b.auth) return fail(400, 'Ungültige Anmeldung.');
    await env.DB.prepare('INSERT INTO push_subs (endpoint, member_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth')
      .bind(b.endpoint, me.id, str(b.p256dh, 200), str(b.auth, 100), now).run();
    return json({ ok: true });
  }
  if (path === '/push/subscribe' && method === 'DELETE') {
    const b = await body(request);
    await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND member_id = ?').bind(str(b.endpoint, 1000), me.id).run();
    return json({ ok: true });
  }
  if (path === '/push/test' && method === 'POST') {
    if (!pushReady(env)) return fail(503, 'Benachrichtigungen sind auf dem Server noch nicht eingerichtet.');
    const { results } = await env.DB.prepare('SELECT * FROM push_subs WHERE member_id = ?').bind(me.id).all();
    const s = await loadState(env, trip);
    const msg = briefingFor(trip, s.places, nextBriefingDay(trip));
    let ok = 0;
    for (const sub of results) if ((await sendPush(env, sub, { ...msg, tag: 'briefing', url: './#/heute' }).catch(() => 0)) < 300) ok++;
    return json({ ok: ok > 0, sent: ok });
  }
  if (path === '/briefing' && method === 'GET') {
    const s = await loadState(env, trip);
    const day = nextBriefingDay(trip);
    return json({ day, ...briefingFor(trip, s.places, day) });
  }
  if (path === '/announce' && method === 'POST') {
    // kurze Nachricht an alle, z. B. "Treffpunkt 15 Uhr Lobby"
    const b = await body(request);
    const text = str(b.text, 300);
    if (!text) return fail(400, 'Leere Nachricht.');
    await env.DB.prepare('INSERT INTO comments (id, trip_id, target, member_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(rid(), trip.id, 'trip', me.id, text, now).run();
    const r = await pushToTrip(env, trip.id, { title: me.name, body: text, tag: 'announce', url: './#/heute' }, { exceptMember: me.id });
    return json({ ok: true, sent: r.sent });
  }

  return fail(404, 'Nicht gefunden.');
}

async function validInvite(env, code) {
  if (!code || code.length < 8) return null;
  const inv = await env.DB.prepare('SELECT * FROM invites WHERE code_hash = ?').bind(await sha256(code)).first();
  if (!inv || inv.expires_at < Date.now() || (inv.uses_left !== null && inv.uses_left <= 0)) return null;
  return inv;
}

function nextBriefingDay(trip) {
  const today = localParts(trip.tz).date;
  if (trip.start && today < trip.start) return trip.start;
  const d = addDays(today, 1);
  return trip.end && d > trip.end ? trip.end : d;
}
