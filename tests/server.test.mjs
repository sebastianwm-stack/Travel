// Tests für den Server-Teil: Web-Push-Verschlüsselung, Maps-Auslesen, Tagesvorschlag, Schnittstelle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { encryptPayload } from '../server/push.js';
import { parseList, listIdFromUrl } from '../server/maps.js';
import { suggestPlan } from '../server/plan.js';
import { parsePlaceUrl, createTrip } from '../server/api.js';
import { briefingFor } from '../server/briefing.js';
import { guessCat } from '../server/cats.js';
import worker from '../server/worker.js';
import { b64uEncode } from '../server/util.js';

// --- D1-Nachbau im Arbeitsspeicher ---
function memoryD1() {
  const db = new DatabaseSync(':memory:');
  const st = (sql, params = []) => ({
    sql,
    bind: (...p) => st(sql, p),
    first: async () => { const r = db.prepare(sql).get(...params); return r ? { ...r } : null; },
    all: async () => ({ results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }),
    run: async () => db.prepare(sql).run(...params),
  });
  return { prepare: (sql) => st(sql), batch: async (list) => { const out = []; for (const s of list) out.push(/^\s*select/i.test(s.sql || '') ? await s.all() : await s.run()); return out; } };
}

test('Web Push: Nachricht lässt sich mit dem Empfängerschlüssel wieder entschlüsseln (RFC 8291)', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const body = await encryptPayload({ p256dh: b64uEncode(uaPub), auth: b64uEncode(auth) }, 'Morgen: 09:00 Bagels');

  // Empfängerseite nachbauen
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPub = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const hmac = async (k, d) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), d));
  const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
  const te = (s) => new TextEncoder().encode(s);
  const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hmac(await hmac(auth, shared), cat(te('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(te('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
  assert.equal(plain[plain.length - 1], 2);
  assert.equal(new TextDecoder().decode(plain.slice(0, -1)), 'Morgen: 09:00 Bagels');
});

test('Maps: Listen-ID aus verschiedenen Linkformen', () => {
  assert.equal(listIdFromUrl('https://www.google.com/maps/@53.59,9.97,14z/data=!4m2!11m1!2srNY-AfUQ28LAF0akAz3W0m-ipRE4BA?entry=ttu'), 'rNY-AfUQ28LAF0akAz3W0m-ipRE4BA');
  assert.equal(listIdFromUrl('https://www.google.com/maps/placelists/list/AbCdEfGhIjKlMnOpQrSt'), 'AbCdEfGhIjKlMnOpQrSt');
  assert.equal(listIdFromUrl('https://example.com'), null);
});

test('Maps: Orte aus einer Antwort im Google-Format lesen', () => {
  const entry = (name, lat, lng, note) => [null, [null, null, 'X', null, `${name}, 1 Main St, New York`, [null, null, lat, lng], ['0x89c2:0x' + name.length]], name, note];
  const data = [[null, null, null, null, 'nyc', null, null, null, [entry('Apollo Bagels', 40.7268, -73.9876, 'lecker'), entry('High Line', 40.748, -74.0048, '')]]];
  const r = parseList(data);
  assert.equal(r.places.length, 2);
  assert.deepEqual([r.places[0].title, r.places[0].lat, r.places[0].lng, r.places[0].note], ['Apollo Bagels', 40.7268, -73.9876, 'lecker']);
});

test('Ortslink aus Google Maps', () => {
  const p = parsePlaceUrl('https://www.google.com/maps/place/Joe%27s+Pizza/@40.73,-74.00,17z/data=!3d40.7305503!4d-73.9995');
  assert.equal(p.title, "Joe's Pizza");
  assert.equal(p.lat, 40.7305503);
  assert.equal(parsePlaceUrl('https://example.com/x'), null);
});

test('Kategorien raten', () => {
  assert.equal(guessCat('Prince Street Pizza'), 'Essen');
  assert.equal(guessCat("Leon's Bagels"), 'Café');
  assert.equal(guessCat('MoMA'), 'Kultur');
});

test('Tagesvorschlag: nahe Orte am selben Tag, Kapazität eingehalten', () => {
  const down = [[40.71, -74.01], [40.712, -74.008], [40.709, -74.012]];
  const up = [[40.78, -73.96], [40.782, -73.962], [40.779, -73.958]];
  const places = [...down, ...up].map(([lat, lng], i) => ({ id: 'p' + i, lat, lng, cat: 'Sehen', day: null, ord: i }));
  const moves = suggestPlan(places, ['2026-12-18', '2026-12-19'], { perDay: 3 });
  assert.equal(moves.length, 6);
  const dayOf = Object.fromEntries(moves.map((m) => [m.id, m.day]));
  assert.equal(new Set(['p0', 'p1', 'p2'].map((id) => dayOf[id])).size, 1);
  assert.equal(new Set(['p3', 'p4', 'p5'].map((id) => dayOf[id])).size, 1);
  assert.notEqual(dayOf.p0, dayOf.p3);
});

test('Briefing nennt Uhrzeit und Gebuchtes', () => {
  const trip = { start: '2026-12-17', end: '2026-12-21', dest: 'New York', name: 'NY' };
  const m = briefingFor(trip, [
    { day: '2026-12-19', time: '22:00', title: 'Radio City', booked: 1, ord: 2 },
    { day: '2026-12-19', time: '09:00', title: 'Apollo Bagels', booked: 0, ord: 1 },
  ], '2026-12-19');
  assert.match(m.body, /^Start 09:00/);
  assert.match(m.body, /Gebucht: Radio City/);
});

test('Schnittstelle: Einrichten, Zugriff nur mit Link, Herzen und Kommentare', async () => {
  const env = { DB: memoryD1(), FILES: new Map() };
  const call = (path, { method = 'GET', body, token } = {}) => worker.fetch(new Request(`http://x/api${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
  }), env);

  let r = await call('/status');
  assert.equal((await r.json()).setup, false);
  r = await call('/setup', { method: 'POST', body: { trip: { name: 'Test', dest: 'New York', start: '2026-12-17', end: '2026-12-19' }, members: [{ key: 'S', name: 'Seb', role: 'admin' }, { key: 'M', name: 'Mama' }], places: [{ title: 'High Line', cat: 'Natur', lat: 40.748, lng: -74.0048, hearts: ['M'] }] } });
  const { links } = await r.json();
  assert.equal(links.length, 2);
  // zweites Einrichten verboten
  assert.equal((await call('/setup', { method: 'POST', body: { trip: { name: 'X' } } })).status, 403);
  // ohne Link kein Zugriff
  assert.equal((await call('/trip')).status, 401);
  assert.equal((await call('/trip', { token: 'x'.repeat(32) })).status, 401);

  const mama = links[1].token;
  const state = await (await call('/trip', { token: mama })).json();
  assert.equal(state.me.name, 'Mama');
  assert.equal(state.places.length, 1);
  assert.equal(state.hearts.length, 1);
  const pid = state.places[0].id;
  await call(`/places/${pid}/heart`, { method: 'POST', token: mama });
  await call('/comments', { method: 'POST', token: mama, body: { target: `place:${pid}`, body: 'Schön!' } });
  await call(`/places/${pid}`, { method: 'PATCH', token: mama, body: { day: '2026-12-18', time: '10:00' } });
  const s2 = await (await call('/trip', { token: links[0].token })).json();
  assert.equal(s2.hearts.length, 0);
  assert.equal(s2.comments[0].body, 'Schön!');
  assert.equal(s2.places[0].day, '2026-12-18');
  // Mitglied einladen nur als Reiseleitung
  assert.equal((await call('/members', { method: 'POST', token: mama, body: { name: 'Lena' } })).status, 403);
  const inv = await (await call('/members', { method: 'POST', token: links[0].token, body: { name: 'Lena' } })).json();
  assert.ok(inv.token.length >= 20);
});

test('Einladungen: einmal gültig, offene Plätze, getrennte Reisen', async () => {
  const env = { DB: memoryD1(), FILES: new Map() };
  const call = async (path, { method = 'GET', body, token } = {}) => {
    const r = await worker.fetch(new Request(`http://x/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: await r.json() };
  };
  const setup = await call('/setup', { method: 'POST', body: { trip: { name: 'NY' }, members: [{ key: 'S', name: 'Seb', role: 'admin' }, { key: 'M', name: 'Mama' }] } });
  const admin = setup.data.links[0].token;
  const inv = await call('/invites', { method: 'POST', token: admin, body: {} });
  const info = await call(`/invite/${inv.data.code}`);
  assert.equal(info.data.trip.name, 'NY');
  assert.deepEqual(info.data.seats.map((x) => x.name), ['Mama']);
  // Mama übernimmt ihren Platz
  const joined = await call('/join', { method: 'POST', body: { code: inv.data.code, seat: info.data.seats[0].id } });
  const me = await call('/trip', { token: joined.data.token });
  assert.equal(me.data.me.name, 'Mama');
  // Einmal-Link ist verbraucht
  assert.equal((await call('/join', { method: 'POST', body: { code: inv.data.code, name: 'Fremd' } })).status, 404);
  // Gruppen-Link: mehrere neue Personen
  const multi = await call('/invites', { method: 'POST', token: admin, body: { multi: true } });
  const a = await call('/join', { method: 'POST', body: { code: multi.data.code, name: 'Lena' } });
  const b = await call('/join', { method: 'POST', body: { code: multi.data.code, name: 'Tom' } });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  // Nur Reiseleitung lädt ein
  assert.equal((await call('/invites', { method: 'POST', token: a.data.token, body: {} })).status, 403);
  // Zweite Reise ist von der ersten getrennt
  const second = await call('/trips', { method: 'POST', token: admin, body: { trip: { name: 'Freunde' } } });
  const s2 = await call('/trip', { token: second.data.links[0].token });
  assert.equal(s2.data.trip.name, 'Freunde');
  assert.equal(s2.data.members.length, 1);
  const lena = await call('/trip', { token: a.data.token });
  assert.equal(lena.data.trip.name, 'NY');
});

test('Bildsuche: Suchbegriffe und Auswahl', async () => {
  const { searchTerms, fromWikipedia, similarity } = await import('../public/js/images.js');
  assert.equal(searchTerms('Brooklyn Bridge zu Fuß').full, 'Brooklyn Bridge');
  assert.deepEqual(searchTerms('One World Trade Center und 9/11 Memorial').parts, ['One World Trade Center', '9', '11 Memorial'].filter((x) => x.length > 2));
  assert.equal(searchTerms('Bootstour zur Freiheitsstatue').full, 'Statue of Liberty');
  assert.ok(similarity('High Line', 'High Line') === 1);
  // Gefälschte Wikipedia-Antwort: Logo wird übersprungen, passender Artikel genommen
  const fake = async () => ({ ok: true, status: 200, json: async () => ({ query: { pages: {
    1: { pageid: 1, index: 1, title: 'MoMA PS1', thumbnail: { source: 'https://x/logo.svg/960px-logo.svg.png' } },
    2: { pageid: 2, index: 2, title: 'Museum of Modern Art', thumbnail: { source: 'https://x/moma.jpg' }, coordinates: [{ lat: 40.7614, lon: -73.9776 }] },
    3: { pageid: 3, index: 3, title: 'High Line', thumbnail: { source: 'https://x/hl.jpg' } },
  } } }) });
  const r = await fromWikipedia({ title: 'High Line', lat: 40.748, lng: -74.0048 }, 'New York', fake);
  assert.equal(r.url, 'https://x/hl.jpg');
  // Zu allgemein: kein Bild statt irgendeines Hotels
  assert.equal(await fromWikipedia({ title: 'Ankommen, Hotel, erster Abendspaziergang' }, 'New York', fake), null);
});

test('Schema lässt sich mehrfach ausführen (neue Isolates)', async () => {
  const { SCHEMA } = await import('../server/schema.js');
  const db = new DatabaseSync(':memory:');
  const stmts = SCHEMA.split(';').map((s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim()).filter(Boolean);
  for (let round = 0; round < 2; round++) for (const s of stmts) db.exec(s);
  assert.ok(stmts.every((s) => /IF NOT EXISTS/.test(s)), 'jedes CREATE braucht IF NOT EXISTS');
});

test('Tagesvorschlag: Ausreißer werden zum Abstecher am späten Nachmittag', () => {
  const manhattan = [[40.71, -74.01], [40.712, -74.008], [40.709, -74.012], [40.75, -73.99], [40.752, -73.988], [40.749, -73.991]];
  const places = manhattan.map(([lat, lng], i) => ({ id: 'm' + i, lat, lng, cat: 'Sehen', day: null, ord: i }));
  places.push({ id: 'dyker', lat: 40.6215, lng: -74.013, cat: 'Weihnachten', day: null, hearts: 5 });
  const moves = suggestPlan(places, ['2026-12-18', '2026-12-19'], { perDay: 4 });
  const dyker = moves.find((m) => m.id === 'dyker');
  assert.ok(dyker, 'Ausreißer wird trotzdem eingeplant');
  assert.equal(dyker.note, 'Abstecher, etwas weiter weg');
  assert.ok(dyker.time >= '17:30');
  // Die Manhattan-Gruppen bleiben getrennt nach Gegend
  const dayOf = Object.fromEntries(moves.map((m) => [m.id, m.day]));
  assert.equal(new Set(['m0', 'm1', 'm2'].map((id) => dayOf[id])).size, 1);
});

test('Tagesvorschlag: feste Termine bleiben frei', () => {
  const fixed = { id: 'show', lat: 40.76, lng: -73.98, cat: 'Kultur', day: '2026-12-19', time: '11:00', hours: 2 };
  const places = [fixed, ...[0, 1, 2, 3].map((i) => ({ id: 'p' + i, lat: 40.76 + i * 0.001, lng: -73.98, cat: 'Sehen', day: null }))];
  const moves = suggestPlan(places, ['2026-12-19'], { perDay: 6 });
  const h = (t) => { const [a, b] = t.split(':').map(Number); return a + b / 60; };
  for (const m of moves) {
    const s = h(m.time);
    assert.ok(s + 1.25 <= 10.5 || s >= 13, `${m.time} kollidiert mit dem Termin um 11:00`);
  }
});

test('Tagesgerüst: Vorschläge passen zum Abschnitt, belegte Abschnitte bleiben frei', async () => {
  const { draftPlan } = await import('../server/plan.js');
  const at = (i) => ({ lat: 40.72 + i * 0.001, lng: -73.99 });
  const places = [
    { id: 'cafe', cat: 'Café', title: 'Bagels', ...at(0), hearts: 2 },
    { id: 'pizza', cat: 'Essen', title: 'Pizza', ...at(1), hearts: 1 },
    { id: 'park', cat: 'Natur', title: 'Park', ...at(2), hearts: 3 },
    { id: 'shop', cat: 'Shopping', title: 'Laden', ...at(3) },
    { id: 'lights', cat: 'Weihnachten', title: 'Christmas lights', ...at(4) },
    { id: 'fixed', cat: 'Kultur', title: 'Show', ...at(5), day: '2026-12-19', time: '20:00' },
  ];
  const d = draftPlan(places, ['2026-12-18', '2026-12-19', '2026-12-20'], { start: '2026-12-18', end: '2026-12-20' });
  assert.deepEqual(Object.keys(d['2026-12-18']).filter((s) => s !== 'abend'), [], 'Anreisetag nur abends');
  const mid = d['2026-12-19'];
  assert.equal(mid.abend, undefined, 'Abend ist durch die Show belegt');
  if (mid.frueh) assert.equal(mid.frueh.pick, 'cafe');
  if (mid.mittag) assert.equal(mid.mittag.pick, 'pizza');
  const picks = Object.values(d).flatMap((x) => Object.values(x).map((e) => e.pick));
  assert.equal(new Set(picks).size, picks.length, 'kein Ort doppelt vorgeschlagen');
});

test('Tagesgerüst: Abreisetag bleibt nah an der Unterkunft, Abschnitte folgen der Route', async () => {
  const { draftPlan, km } = await import('../server/plan.js');
  const home = { lat: 40.711, lng: -74.010 };
  const P = (id, cat, lat, lng, hearts = 0) => ({ id, title: id, cat, lat, lng, hearts });
  const places = [
    P('cafe-nah', 'Café', 40.713, -74.008), P('cafe-weit', 'Café', 40.760, -73.980, 2),
    P('sehen-a', 'Sehen', 40.720, -74.000), P('essen-a', 'Essen', 40.721, -73.999), P('sehen-b', 'Sehen', 40.722, -73.998),
    P('essen-weit', 'Essen', 40.735, -73.990),
  ];
  const days = ['2026-12-18', '2026-12-19'];
  const d = draftPlan(places, days, { start: '2026-12-18', end: '2026-12-19', home });
  const leave = d['2026-12-19'];
  assert.equal(leave.frueh?.pick, 'cafe-nah', 'Frühstück am Abreisetag in Hotelnähe, trotz mehr Herzen weiter weg');
  for (const e of Object.values(leave)) {
    const p = places.find((x) => x.id === e.pick);
    assert.ok(km(home, p) < 2.5, `${p.id} zu weit weg für den Abreisetag`);
  }
});

test('U-Bahn-Router: plausible Fahrzeiten aus dem MTA-Fahrplan', async () => {
  const { routerFor, ttOf } = await import('../public/js/transit/index.js');
  const hotel = { lat: 40.7114, lng: -74.0102 }; // Lower Manhattan
  const r = await routerFor([hotel]);
  assert.ok(r, 'New York hat ein Netz');
  const ts = r.trip(hotel, { lat: 40.758, lng: -73.9855 }, { date: '2026-12-18' }); // Times Square
  assert.equal(ts.mode, 'transit');
  assert.ok(ts.min >= 15 && ts.min <= 35, `Times Square ${ts.min} Min.`);
  assert.ok(ts.lines.length >= 1 && ts.lines[0].color.startsWith('#'));
  const near = r.trip(hotel, { lat: 40.7128, lng: -74.0060 }, { date: '2026-12-18' }); // ein paar Blocks
  assert.equal(near.mode, 'walk');
  const dyker = r.trip(hotel, { lat: 40.6168, lng: -74.0183 }, { date: '2026-12-20' });
  assert.ok(dyker.min >= 40 && dyker.min <= 75, `Dyker Heights ${dyker.min} Min.`);
  // Wochenende: B und W fahren nicht
  const sun = r.trip(hotel, { lat: 40.758, lng: -73.9855 }, { date: '2026-12-20' });
  assert.ok(!sun.lines.some((l) => l.name === 'B' || l.name === 'W'));
  // außerhalb des Netzes kein Router
  assert.equal(await routerFor([{ lat: 52.52, lng: 13.40 }]), null);
  assert.equal(ttOf(null), null);
});
