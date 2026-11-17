// Tagesvorschlag: verteilt Ideen ohne Tag so auf die Reisetage, dass nahe Orte am selben Tag liegen.
// Rein rechnerisch (Entfernungen, Herzen), so klappt es auch ohne KI.

const R = 6371;
export function km(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const DURATION = { Essen: 1.25, Café: 0.75, Sehen: 1.25, Shopping: 2, Kultur: 2.5, Natur: 1.5, Nachts: 2, Weihnachten: 1 };

// places: [{id, lat, lng, cat, hearts, day, hours}], days: ['YYYY-MM-DD', ...]
export function suggestPlan(places, days, { perDay = 6, lightDays = [], dayStart = {} } = {}) {
  const planned = new Map(days.map((d) => [d, places.filter((p) => p.day === d)]));
  const cap = new Map(days.map((d) => [d, Math.max(0, (lightDays.includes(d) ? 2 : perDay) - planned.get(d).length)]));
  const open = days.filter((d) => cap.get(d) > 0);
  if (!open.length) return [];
  const total = open.reduce((n, d) => n + cap.get(d), 0);
  const pool = places
    .filter((p) => !p.day && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .sort((a, b) => (b.hearts || 0) - (a.hearts || 0))
    .slice(0, total);
  if (!pool.length) return [];

  // Startzentren: bereits geplante Orte eines Tages, sonst weit auseinanderliegende Ideen
  const centers = [];
  for (const d of open) {
    const pl = planned.get(d).filter((p) => Number.isFinite(p.lat));
    if (pl.length) centers.push(mean(pl));
  }
  while (centers.length < open.length) {
    let best = null, bestD = -1;
    for (const p of pool) {
      const dist = centers.length ? Math.min(...centers.map((c) => km(c, p))) : (p.hearts || 0);
      if (dist > bestD) { bestD = dist; best = p; }
    }
    centers.push({ lat: best.lat, lng: best.lng });
  }

  let assign = new Map();
  for (let iter = 0; iter < 12; iter++) {
    assign = new Map(open.map((d) => [d, []]));
    // Paare (Ort, Tag) nach Entfernung sortieren und unter Beachtung der Kapazität zuteilen
    const pairs = [];
    pool.forEach((p) => open.forEach((d, i) => pairs.push([km(centers[i], p), p, d])));
    pairs.sort((a, b) => a[0] - b[0]);
    const done = new Set();
    for (const [, p, d] of pairs) {
      if (done.has(p.id) || assign.get(d).length >= cap.get(d)) continue;
      assign.get(d).push(p);
      done.add(p.id);
    }
    open.forEach((d, i) => {
      const all = [...assign.get(d), ...planned.get(d).filter((p) => Number.isFinite(p.lat))];
      if (all.length) centers[i] = mean(all);
    });
  }

  const out = [];
  for (const d of open) {
    const stops = route(assign.get(d), planned.get(d));
    let t = dayStart[d] ?? 9.5;
    const taken = planned.get(d).map((p) => p.time).filter(Boolean);
    stops.forEach((p, i) => {
      while (taken.includes(fmt(t))) t += 0.5;
      out.push({ id: p.id, day: d, time: fmt(t), ord: i + 1 + planned.get(d).length });
      t += (p.hours || DURATION[p.cat] || 1.25) + 0.25;
    });
  }
  return out;
}

function mean(ps) {
  return { lat: ps.reduce((n, p) => n + p.lat, 0) / ps.length, lng: ps.reduce((n, p) => n + p.lng, 0) / ps.length };
}
function fmt(h) {
  const hh = Math.min(23, Math.floor(h)), mm = Math.round((h - Math.floor(h)) * 60 / 15) * 15;
  return `${String(hh + (mm === 60 ? 1 : 0)).padStart(2, '0')}:${String(mm === 60 ? 0 : mm).padStart(2, '0')}`;
}
// Reihenfolge nach dem jeweils nächsten Ort. Start: ein schon geplanter Ort des Tages, sonst der westlichste.
function route(stops, fixed) {
  if (stops.length < 2) return stops;
  const rest = [...stops];
  const startFrom = fixed.find((p) => Number.isFinite(p.lat));
  let cur = startFrom || rest.reduce((a, b) => (b.lng < a.lng ? b : a));
  const out = [];
  if (!startFrom) { out.push(cur); rest.splice(rest.indexOf(cur), 1); }
  while (rest.length) {
    let bi = 0;
    rest.forEach((p, i) => { if (km(cur, p) < km(cur, rest[bi])) bi = i; });
    cur = rest.splice(bi, 1)[0];
    out.push(cur);
  }
  return out;
}
