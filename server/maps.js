// Abgleich mit einer geteilten Google-Maps-Liste ("Gespeichert" → Liste teilen).
//
// Google bietet dafür keine offizielle Schnittstelle. Wir lesen die Liste über dieselbe Adresse,
// die Google Maps selbst im Browser lädt. Das kann jederzeit brechen; die Fehlermeldung sagt das
// dann ehrlich, und Orte lassen sich weiterhin einzeln per Link hinzufügen.
import { rid, str } from './util.js';
import { km } from './plan.js';
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
    // Ortsfotos, nicht die Profilbilder der Personen, die den Ort gespeichert haben (/a-/)
    const photo = findString(e[1], (s) => /^https:\/\/lh\d\.googleusercontent\.com\//.test(s) && !s.includes('/a-/')) || '';
    // Google-Kennung des Ortes (für einen direkten Link) und wer ihn in die Liste gelegt hat
    let cid = null;
    try { const low = BigInt(e[1][6][1]); cid = (low < 0n ? low + 2n ** 64n : low).toString(); } catch { /* ohne */ }
    const by = Array.isArray(e[12]) && typeof e[12][0] === 'string' ? e[12][0] : '';
    return { title: e[2], lat, lng, ref: cid ? `cid:${cid}` : ref, address, note, photo, cid, by };
  });
  return { title, places };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Gelesene Liste in die Reise übernehmen. Bestehende Orte werden ergänzt; was schon einmal da war
// (auch gelöschte oder zusammengeführte Orte), kommt nicht wieder. Wer einen Ort gespeichert hat, bekommt ein Herz.
export async function importList(env, trip, parsed, fallbackMember = null) {
  const { results: existing } = await env.DB.prepare('SELECT id, title, lat, lng, approx, source_ref, deleted FROM places WHERE trip_id = ?').bind(trip.id).all();
  const { results: members } = await env.DB.prepare('SELECT id, name, role FROM members WHERE trip_id = ?').bind(trip.id).all();
  const admin = members.find((m) => m.role === 'admin');
  // "Charlotte W" gehört zu "Charly": erste drei Buchstaben des Vornamens vergleichen
  const memberFor = (by) => {
    const k = norm(by).slice(0, 3);
    return (k && members.find((m) => norm(m.name).slice(0, 3) === k)) || null;
  };
  const byRef = new Map(existing.filter((p) => p.source_ref).map((p) => [p.source_ref, p]));
  const live = existing.filter((p) => !p.deleted);
  const now = Date.now();
  let added = 0, updated = 0;
  const stmts = [];
  let ord = now;
  for (const g of parsed.places) {
    const who = memberFor(g.by) || (fallbackMember && members.find((m) => m.id === fallbackMember)) || admin;
    const url = g.cid ? `https://maps.google.com/?cid=${g.cid}` : '';
    let hit = byRef.get(g.ref);
    if (!hit) {
      const nt = norm(g.title);
      hit = live.find((p) => {
        const np = norm(p.title);
        const near = Number.isFinite(p.lat) ? km(p, g) < 1.5 : true;
        return near && (np === nt || (nt.length > 5 && np.length > 5 && (np.startsWith(nt) || nt.startsWith(np))));
      });
    }
    if (hit) {
      if (hit.deleted) continue; // bewusst gelöscht oder zusammengeführt
      if (!hit.source_ref || hit.approx) {
        stmts.push(env.DB.prepare("UPDATE places SET lat = ?, lng = ?, approx = 0, url = CASE WHEN url = '' THEN ? ELSE url END, source_ref = COALESCE(source_ref, ?), updated_at = ? WHERE id = ?").bind(g.lat, g.lng, url, g.ref, now, hit.id));
        updated++;
      }
      if (who) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO hearts (place_id, member_id) VALUES (?, ?)').bind(hit.id, who.id));
      continue;
    }
    const id = rid();
    const parts = g.address.split(',').map((x) => x.trim());
    const area = /Brooklyn/.test(g.address) ? 'Brooklyn' : /Queens/.test(g.address) ? 'Queens' : /New York, NY/.test(g.address) ? 'Manhattan' : parts.length > 2 ? parts[parts.length - 3] : '';
    stmts.push(env.DB.prepare(
      `INSERT INTO places (id, trip_id, title, area, cat, note, lat, lng, approx, url, image, image_credit, source, source_ref, ord, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'maps', ?, ?, ?, ?, ?)`
    ).bind(id, trip.id, str(g.title, 200), str(area, 120), guessCat(g.title + ' ' + g.note), str(g.note, 1000), g.lat, g.lng, url, g.photo, g.photo ? JSON.stringify({ t: 'Google Maps' }) : '', g.ref, ord++, who?.id || null, now, now));
    if (who) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO hearts (place_id, member_id) VALUES (?, ?)').bind(id, who.id));
    added++;
  }
  stmts.push(env.DB.prepare('UPDATE trips SET maps_synced_at = ? WHERE id = ?').bind(now, trip.id));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { added, updated, total: parsed.places.length, title: parsed.title };
}

// Abruf direkt vom Server (von Cloudflare aus blockt Google das derzeit, siehe .github/workflows/maps-sync.yml)
export async function syncTrip(env, trip, memberId, fetcher = fetch) {
  if (!trip.maps_url) throw new Error('Für diese Reise ist keine Google-Maps-Liste hinterlegt.');
  const resolved = await resolveUrl(trip.maps_url, fetcher);
  const id = listIdFromUrl(resolved);
  if (!id) throw new Error('Der Link sieht nicht nach einer geteilten Google-Maps-Liste aus.');
  let parsed;
  try { parsed = parseList(await fetchList(id, fetcher)); }
  catch (e) { throw new Error(`Die Liste ließ sich nicht lesen: ${e.message}. Einzelne Orte gehen weiter per Link.`); }
  if (!parsed.places.length) throw new Error('In der Liste wurden keine Orte gefunden. Ist sie in Google Maps per Link geteilt?');
  return importList(env, trip, parsed, memberId);
}
