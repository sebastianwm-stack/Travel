// Abgleich mit einer geteilten Google-Maps-Liste ("Gespeichert" → Liste teilen).
//
// Google bietet dafür keine offizielle Schnittstelle. Wir lesen die Liste über dieselbe Adresse,
// die Google Maps selbst im Browser lädt. Das kann jederzeit brechen; die Fehlermeldung sagt das
// dann ehrlich, und Orte lassen sich weiterhin einzeln per Link hinzufügen.
import { rid, str } from './util.js';
import { guessCat } from './cats.js';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export function listIdFromUrl(url) {
  const s = decodeURIComponent(String(url || ''));
  const m = s.match(/placelists\/list\/([A-Za-z0-9_-]{16,})/) || s.match(/!11m1!2s([A-Za-z0-9_-]{16,})/) || s.match(/!2s([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}

// Kurzlinks (maps.app.goo.gl) auflösen
export async function resolveUrl(url, fetcher = fetch) {
  let current = url;
  for (let i = 0; i < 4; i++) {
    const u = new URL(current);
    if (!/(^|\.)goo\.gl$/.test(u.hostname) && !/^g\.co$/.test(u.hostname)) return current;
    const res = await fetcher(current, { redirect: 'manual', headers: { 'user-agent': UA } });
    const loc = res.headers.get('location');
    if (!loc) return current;
    current = new URL(loc, current).toString();
  }
  return current;
}

export async function fetchList(id, fetcher = fetch) {
  const pb = `!1m4!1s${id}!2e1!3m1!1e1!2e2!3e2!4i500!16b1`;
  const url = `https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=de&gl=de&pb=${encodeURIComponent(pb)}`;
  const res = await fetcher(url, { headers: { 'user-agent': UA, accept: '*/*' } });
  if (res.status === 429 || res.status === 403) throw new Error('Google lässt den Abruf von Cloudflare aus gerade nicht zu');
  if (!res.ok) throw new Error(`Google antwortet mit ${res.status}`);
  const text = await res.text();
  return JSON.parse(text.replace(/^\)\]\}'\s*/, ''));
}

// --- Auslesen, bewusst tolerant gegenüber kleinen Formatänderungen ---

const isLat = (v) => typeof v === 'number' && v >= -90 && v <= 90;
const isLng = (v) => typeof v === 'number' && v >= -180 && v <= 180;

function findCoords(node, depth = 0) {
  if (!Array.isArray(node) || depth > 6) return null;
  for (let i = 0; i + 1 < node.length; i++) {
    const a = node[i], b = node[i + 1];
    if (isLat(a) && isLng(b) && !Number.isInteger(a) && !Number.isInteger(b)) return [a, b];
  }
  for (const c of node) {
    const r = findCoords(c, depth + 1);
    if (r) return r;
  }
  return null;
}
function findString(node, test, depth = 0) {
  if (depth > 6) return null;
  if (typeof node === 'string') return test(node) ? node : null;
  if (!Array.isArray(node)) return null;
  for (const c of node) {
    const r = findString(c, test, depth + 1);
    if (r) return r;
  }
  return null;
}

function looksLikeEntry(e) {
  return Array.isArray(e) && typeof e[2] === 'string' && e[2].length > 0 && Array.isArray(e[1]) && findCoords(e[1]);
}

function findEntries(node, depth = 0) {
  if (!Array.isArray(node) || depth > 5) return null;
  if (node.length && node.filter(looksLikeEntry).length >= Math.max(1, node.length * 0.6)) return node;
  for (const c of node) {
    const r = findEntries(c, depth + 1);
    if (r) return r;
  }
  return null;
}

export function parseList(data) {
  const entries = findEntries(data) || [];
  const title = typeof data?.[0]?.[4] === 'string' ? data[0][4] : '';
  const places = entries.filter(looksLikeEntry).map((e) => {
    const [lat, lng] = findCoords(e[1]);
    const ref = findString(e[1], (s) => /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(s)) || `${e[2]}@${lat.toFixed(4)},${lng.toFixed(4)}`;
    const address = findString(e[1], (s) => s.includes(',') && s.length > 6 && s !== e[2]) || '';
    const note = typeof e[3] === 'string' ? e[3] : '';
    const photo = findString(e, (s) => /^https:\/\/lh\d\.googleusercontent\.com\//.test(s)) || '';
    return { title: e[2], lat, lng, ref, address, note, photo };
  });
  return { title, places };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Liste holen und in die Reise übernehmen. Bestehende Orte werden ergänzt, nichts wird gelöscht.
export async function syncTrip(env, trip, memberId, fetcher = fetch) {
  if (!trip.maps_url) throw new Error('Für diese Reise ist keine Google-Maps-Liste hinterlegt.');
  const resolved = await resolveUrl(trip.maps_url, fetcher);
  const id = listIdFromUrl(resolved);
  if (!id) throw new Error('Der Link sieht nicht nach einer geteilten Google-Maps-Liste aus.');
  let parsed;
  try {
    parsed = parseList(await fetchList(id, fetcher));
  } catch (e) {
    throw new Error(`Die Liste ließ sich nicht lesen: ${e.message}. Einzelne Orte gehen weiter per Link.`);
  }
  if (!parsed.places.length) throw new Error('In der Liste wurden keine Orte gefunden. Ist sie in Google Maps per Link geteilt?');

  const { results: existing } = await env.DB.prepare('SELECT id, title, source_ref, approx FROM places WHERE trip_id = ? AND deleted = 0').bind(trip.id).all();
  const byRef = new Map(existing.filter((p) => p.source_ref).map((p) => [p.source_ref, p]));
  const byTitle = new Map(existing.map((p) => [norm(p.title), p]));
  const now = Date.now();
  let added = 0, updated = 0;
  const stmts = [];
  let ord = now;
  for (const g of parsed.places) {
    const hit = byRef.get(g.ref) || byTitle.get(norm(g.title));
    if (hit) {
      stmts.push(env.DB.prepare("UPDATE places SET lat = ?, lng = ?, approx = 0, source_ref = COALESCE(source_ref, ?), image = CASE WHEN image = '' AND ? != '' THEN ? ELSE image END, updated_at = ? WHERE id = ?").bind(g.lat, g.lng, g.ref, g.photo, g.photo, now, hit.id));
      updated++;
    } else {
      stmts.push(env.DB.prepare(
        `INSERT INTO places (id, trip_id, title, area, cat, note, lat, lng, approx, image, image_credit, source, source_ref, ord, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'maps', ?, ?, ?, ?, ?)`
      ).bind(rid(), trip.id, str(g.title, 200), str(g.address.split(',').slice(0, 2).join(','), 120), guessCat(g.title + ' ' + g.note), str(g.note, 1000), g.lat, g.lng, g.photo, g.photo ? JSON.stringify({ t: 'Google Maps' }) : '', g.ref, ord++, memberId, now, now));
      added++;
    }
  }
  stmts.push(env.DB.prepare('UPDATE trips SET maps_synced_at = ? WHERE id = ?').bind(now, trip.id));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { added, updated, total: parsed.places.length, title: parsed.title };
}
