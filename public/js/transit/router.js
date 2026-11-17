// Kleiner ÖPNV-Router für ein Streckennetz aus scripts/build-transit.mjs.
// Läuft im Browser und im Worker. Rechnet: zu Fuß zur Station, warten (halbe Taktzeit),
// fahren, umsteigen, zu Fuß zum Ziel. Ist Laufen schneller oder kaum langsamer, wird gelaufen.

const WALK_MIN_PER_KM = 12.5;  // ca. 4,8 km/h und Umwege durchs Straßenraster
const ACCESS_KM = 1.1;         // so weit läuft man höchstens zu einer Station
const ENTRY_SEC = 120;         // Treppen, Drehkreuz, Bahnsteig
const EXIT_SEC = 60;
const SAME_STATION_XFER = 120;

const rad = (x) => (x * Math.PI) / 180;
export function km(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const walkSec = (k) => k * WALK_MIN_PER_KM * 60;

// kleiner Binär-Heap für Dijkstra
class Heap {
  constructor() { this.k = []; this.v = []; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v; const top = v[0], lastK = k.pop(), lastV = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lastK) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lastK; v[i] = lastV;
    }
    return top;
  }
  get size() { return this.k.length; }
}

export function makeRouter(net) {
  const st = net.stations.map(([name, la, ln]) => ({ name, lat: la / 1e5, lng: ln / 1e5 }));
  const routes = net.routes.map(([name, color, text, wait]) => ({ name, color, text, wait }));
  const box = st.reduce((b, s) => ({ s: Math.min(b.s, s.lat), n: Math.max(b.n, s.lat), w: Math.min(b.w, s.lng), e: Math.max(b.e, s.lng) }), { s: 90, n: -90, w: 180, e: -180 });

  // Knoten = Station × Linie
  const nodeOf = new Map(); const nodeSt = []; const nodeR = [];
  const node = (s, r) => { const k = s * 64 + r; let n = nodeOf.get(k); if (n === undefined) { n = nodeSt.length; nodeOf.set(k, n); nodeSt.push(s); nodeR.push(r); } return n; };
  const ride = []; // je Knoten: [nachbar, sek, ...]
  const add = (a, b, sec) => { (ride[a] ||= []).push(b, sec); };
  for (let i = 0; i < net.edges.length; i += 4) {
    const [a, b, r, sec] = net.edges.slice(i, i + 4);
    const na = node(a, r), nb = node(b, r);
    add(na, nb, sec); add(nb, na, sec);
  }
  const atStation = []; nodeSt.forEach((s, n) => (atStation[s] ||= []).push(n));
  const xfer = []; // je Station: [andere Station, sek, ...]
  for (let i = 0; i < net.xfers.length; i += 3) {
    const [a, b, sec] = net.xfers.slice(i, i + 3);
    if (a !== b) { (xfer[a] ||= []).push(b, sec); (xfer[b] ||= []).push(a, sec); }
  }

  // nächste Stationen; schnelle Näherung statt Haversine, Ergebnis je Punkt zwischengespeichert
  const kx = 111.32 * Math.cos(rad(st[0]?.lat || 40)), ky = 110.57;
  const nearCache = new Map();
  const near = (p) => {
    const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    let out = nearCache.get(key);
    if (out) return out;
    out = [];
    const lim2 = ACCESS_KM * ACCESS_KM;
    for (let i = 0; i < st.length; i++) {
      const dx = (st[i].lng - p.lng) * kx, dy = (st[i].lat - p.lat) * ky, d2 = dx * dx + dy * dy;
      if (d2 <= lim2 && atStation[i]) out.push([i, Math.sqrt(d2)]);
    }
    out = out.sort((x, y) => x[1] - y[1]).slice(0, 10);
    if (nearCache.size > 4000) nearCache.clear();
    nearCache.set(key, out);
    return out;
  };
  const covers = (p) => p && Number.isFinite(p.lat) && p.lat > box.s - 0.02 && p.lat < box.n + 0.02 && p.lng > box.w - 0.02 && p.lng < box.e + 0.02 && near(p).length > 0;

  // Dijkstra vom Startpunkt aus, einmal pro Startpunkt und Wochentag-Art zwischengespeichert
  const cache = new Map();
  function from(p, svc) {
    const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)},${svc}`;
    if (cache.has(key)) return cache.get(key);
    const wait = (r) => routes[r].wait[svc];
    const N = nodeSt.length;
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const h = new Heap();
    for (const [s, k] of near(p)) {
      for (const n of atStation[s]) {
        const w = wait(nodeR[n]); if (w < 0) continue;
        const c = walkSec(k) + ENTRY_SEC + w;
        if (c < dist[n]) { dist[n] = c; h.push(c, n); }
      }
    }
    while (h.size) {
      const n = h.pop(); const d = dist[n];
      const e = ride[n] || [];
      for (let i = 0; i < e.length; i += 2) { const m = e[i], c = d + e[i + 1]; if (c < dist[m]) { dist[m] = c; prev[m] = n; h.push(c, m); } }
      const s = nodeSt[n];
      // umsteigen in derselben Station
      for (const m of atStation[s]) {
        if (m === n) continue; const w = wait(nodeR[m]); if (w < 0) continue;
        const c = d + SAME_STATION_XFER + w; if (c < dist[m]) { dist[m] = c; prev[m] = n; h.push(c, m); }
      }
      // umsteigen zu verbundenen Stationen (Stationskomplexe)
      const x = xfer[s] || [];
      for (let i = 0; i < x.length; i += 2) {
        for (const m of atStation[x[i]] || []) {
          const w = wait(nodeR[m]); if (w < 0) continue;
          const c = d + x[i + 1] + w; if (c < dist[m]) { dist[m] = c; prev[m] = n; h.push(c, m); }
        }
      }
    }
    const res = { dist, prev };
    if (cache.size > 400) cache.clear();
    cache.set(key, res);
    return res;
  }

  // Wochentag des Datums → 0 werktags, 1 samstags, 2 sonntags
  const svcOf = (date) => { if (!date) return 0; const d = new Date(date + 'T12:00:00Z').getUTCDay(); return d === 6 ? 1 : d === 0 ? 2 : 0; };

  // Fahrt von a nach b: { min, mode: 'walk'|'transit', lines: [{name,color,text}], walkMin, from, to }
  function trip(a, b, { date } = {}) {
    if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return null;
    const direct = km(a, b);
    const walk = { min: Math.max(1, Math.round(walkSec(direct) / 60)), mode: 'walk', lines: [], walkMin: Math.round(walkSec(direct) / 60) };
    if (direct < 0.6 || !covers(a) || !covers(b)) return covers(a) && covers(b) ? walk : (direct < 1.5 ? walk : null);
    const { dist, prev } = from(a, svcOf(date));
    let best = Infinity, bestNode = -1;
    for (const [s, k] of near(b)) {
      for (const n of atStation[s]) { const c = dist[n] + walkSec(k) + EXIT_SEC; if (c < best) { best = c; bestNode = n; } }
    }
    if (bestNode < 0 || !Number.isFinite(best)) return direct < 2.5 ? walk : null;
    // Laufen, wenn es nicht deutlich länger dauert
    if (walk.min * 60 <= best + 240) return walk;
    const lines = []; const path = [];
    for (let n = bestNode; n >= 0; n = prev[n]) path.push(n);
    path.reverse();
    for (const n of path) { const r = routes[nodeR[n]]; if (lines[lines.length - 1]?.name !== r.name) lines.push({ name: r.name, color: r.color, text: r.text }); }
    return { min: Math.round(best / 60), mode: 'transit', lines, from: st[nodeSt[path[0]]].name, to: st[nodeSt[bestNode]].name };
  }

  return { covers, trip, name: net.name };
}
