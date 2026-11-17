// Baut aus dem GTFS-Fahrplan der New Yorker U-Bahn (MTA) ein kompaktes Streckennetz für den Router.
// Aufruf: node scripts/build-transit.mjs <ordner-mit-gtfs-txt-dateien>
// Quelle: https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip (MTA, öffentlich)
// Ergebnis: public/js/transit/nyc.js
//
// Pro Linie und Haltestellenpaar die mittlere Fahrzeit tagsüber (9 bis 21 Uhr),
// pro Linie die halbe mittlere Taktzeit als Wartezeit (werktags, samstags, sonntags),
// dazu die Umstiege aus transfers.txt.
import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const DIR = process.argv[2];
if (!DIR) { console.error('Ordner mit den GTFS-Dateien angeben'); process.exit(1); }

function parseLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function table(name) {
  const lines = readFileSync(join(DIR, name), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const head = parseLine(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(parseLine(l).map((v, i) => [head[i], v])));
}
const secs = (t) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// Stationen (Elternhaltestellen)
const stops = table('stops.txt');
const parent = new Map();
const stations = [];
const stIndex = new Map();
for (const s of stops) {
  if (s.location_type === '1') { stIndex.set(s.stop_id, stations.length); stations.push(s); }
}
for (const s of stops) parent.set(s.stop_id, s.parent_station || s.stop_id);
const stOf = (stopId) => stIndex.get(parent.get(stopId));

// Linien
const routes = table('routes.txt');
const rIndex = new Map(routes.map((r, i) => [r.route_id, i]));

// Fahrten
const trips = new Map(table('trips.txt').map((t) => [t.trip_id, t]));
const SERVICE = { Weekday: 0, Saturday: 1, Sunday: 2 };

// stop_times zeilenweise (groß)
const ride = new Map();        // "a|b|r" → [sek]
const starts = new Map();      // "r|svc|dir" → Anzahl Abfahrten 10–20 Uhr
let curTrip = null, prev = null;
const rl = createInterface({ input: createReadStream(join(DIR, 'stop_times.txt')) });
let head = null;
for await (const line of rl) {
  if (!head) { head = parseLine(line.replace(/^﻿/, '')); continue; }
  const v = parseLine(line);
  const row = Object.fromEntries(head.map((h, i) => [h, v[i]]));
  const t = trips.get(row.trip_id);
  if (!t) continue;
  const svc = SERVICE[t.service_id];
  const r = rIndex.get(t.route_id);
  if (row.trip_id !== curTrip) {
    curTrip = row.trip_id; prev = null;
    const dep = secs(row.departure_time);
    if (svc !== undefined && dep >= 10 * 3600 && dep < 20 * 3600) {
      const k = `${r}|${svc}|${t.direction_id}`;
      starts.set(k, (starts.get(k) || 0) + 1);
    }
  }
  const st = stOf(row.stop_id);
  const arr = secs(row.arrival_time), dep = secs(row.departure_time);
  if (prev && st !== undefined && prev.st !== undefined && prev.st !== st && prev.dep >= 9 * 3600 && prev.dep < 21 * 3600) {
    const [a, b] = prev.st < st ? [prev.st, st] : [st, prev.st]; // ungerichtet
    const k = `${a}|${b}|${r}`;
    if (!ride.has(k)) ride.set(k, []);
    ride.get(k).push(Math.max(30, arr - prev.dep));
  }
  prev = { st, dep };
}

// Wartezeit: halbe Taktzeit, gedeckelt
const WINDOW = 10 * 3600;
const waits = routes.map((_, r) => [0, 1, 2].map((svc) => {
  const n = Math.max(starts.get(`${r}|${svc}|0`) || 0, starts.get(`${r}|${svc}|1`) || 0);
  return n ? Math.min(600, Math.round(WINDOW / n / 2)) : -1; // -1: fährt an dem Tag tagsüber nicht
}));

const edges = [];
for (const [k, list] of ride) {
  const [a, b, r] = k.split('|').map(Number);
  edges.push(a, b, r, Math.round(median(list)));
}

const xfers = [];
for (const t of table('transfers.txt')) {
  const a = stOf(t.from_stop_id), b = stOf(t.to_stop_id);
  if (a === undefined || b === undefined) continue;
  xfers.push(a, b, Number(t.min_transfer_time || 120));
}

const usedRoutes = new Set(edges.filter((_, i) => i % 4 === 2));
const net = {
  name: 'New York Subway',
  source: 'MTA GTFS',
  feed: (() => { try { return table('feed_info.txt')[0]?.feed_version || ''; } catch { return ''; } })(),
  stations: stations.map((s) => [s.stop_name, Math.round(Number(s.stop_lat) * 1e5), Math.round(Number(s.stop_lon) * 1e5)]),
  routes: routes.map((r, i) => [r.route_short_name || r.route_id, '#' + (r.route_color || '808183'), '#' + (r.route_text_color || 'FFFFFF'), usedRoutes.has(i) ? waits[i] : [-1, -1, -1]]),
  edges,
  xfers,
};
mkdirSync(new URL('../public/js/transit/', import.meta.url), { recursive: true });
const out = new URL('../public/js/transit/nyc.js', import.meta.url);
writeFileSync(out, `// Erzeugt mit scripts/build-transit.mjs aus dem MTA-Fahrplan (GTFS). Nicht von Hand ändern.\nexport default ${JSON.stringify(net)};\n`);
console.log(`${stations.length} Stationen, ${routes.length} Linien, ${edges.length / 4} Strecken, ${xfers.length / 3} Umstiege → ${out.pathname}`);
