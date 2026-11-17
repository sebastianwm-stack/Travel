// Tagesvorschlag: verteilt Ideen ohne Tag so auf die Reisetage, dass nahe Orte am selben Tag liegen.
// Rein rechnerisch (Entfernungen, Herzen), so klappt es auch ohne KI.
//
// Ausreißer (weit weg von allen anderen Ideen, z. B. Dyker Heights draußen in Brooklyn) bestimmen nicht die
// Tagesgebiete. Sie kommen als "Abstecher" ans Ende eines passenden Tages, frühestens am späten Nachmittag.
// Feste Termine eines Tages (mit Uhrzeit) bleiben frei; vorgeschlagene Stopps werden drumherum gelegt.

const R = 6371;
export function km(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const DURATION = { Essen: 1.25, Café: 0.75, Sehen: 1.25, Shopping: 2, Kultur: 2.5, Natur: 1.5, Nachts: 2, Weihnachten: 1 };
const OUTLIER_KM = 2.5;     // so weit weg vom nächsten anderen Ort gilt als Ausreißer
const LATEST_END = 23;      // später endet kein vorgeschlagener Stopp
const ABSTECHER_FROM = 17.5;
const LUNCH = 11.5;

const hasPos = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng);
const dur = (p) => p.hours || DURATION[p.cat] || 1.25;
// Wegezeit in Stunden: kurze Wege zu Fuß, längere mit der Bahn
const travel = (a, b) => (a && b && hasPos(a) && hasPos(b) ? 0.2 + Math.min(1.25, km(a, b) * 0.08) : 0.25);
const toH = (t) => { const [h, m] = String(t).split(':').map(Number); return h + m / 60; };

export function findOutliers(candidates, others = []) {
  const all = [...candidates, ...others.filter(hasPos)];
  return new Set(candidates.filter((p) => {
    const nn = Math.min(Infinity, ...all.filter((q) => q.id !== p.id).map((q) => km(p, q)));
    return all.length > 2 && nn > OUTLIER_KM;
  }).map((p) => p.id));
}

// places: [{id, lat, lng, cat, hearts, day, time, hours}], days: ['YYYY-MM-DD', ...]
export function suggestPlan(places, days, { perDay = 6, lightDays = [], dayStart = {}, home = null } = {}) {
  const planned = new Map(days.map((d) => [d, places.filter((p) => p.day === d)]));
  const cap = new Map(days.map((d) => [d, Math.max(0, (lightDays.includes(d) ? 2 : perDay) - planned.get(d).length)]));
  const open = days.filter((d) => cap.get(d) > 0);
  if (!open.length) return [];
  const total = open.reduce((n, d) => n + cap.get(d), 0);

  const candidates = places.filter((p) => !p.day && hasPos(p)).sort((a, b) => (b.hearts || 0) - (a.hearts || 0));
  const outliers = findOutliers(candidates, places.filter((p) => p.day));
  const pool = candidates.filter((p) => !outliers.has(p.id)).slice(0, total);

  const out = [];
  const dayEnd = new Map();   // Ende des letzten vorgeschlagenen Stopps je Tag
  const dayCenter = new Map();

  if (pool.length) {
    // Startzentren: bereits geplante Orte eines Tages, sonst weit auseinanderliegende Ideen (ohne Ausreißer)
    const centers = [];
    for (const d of open) {
      const pl = planned.get(d).filter(hasPos);
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
        const all = [...assign.get(d), ...planned.get(d).filter(hasPos)];
        if (all.length) centers[i] = mean(all);
      });
    }

    open.forEach((d, i) => {
      dayCenter.set(d, centers[i]);
      const blocked = fixedBlocks(planned.get(d));
      let t = dayStart[d] ?? 9.5;
      let prev = home && hasPos(home) ? home : null; // jeder Tag beginnt an der Unterkunft
      let ord = planned.get(d).length;
      // Cafés morgens zuerst, Restaurants frühestens mittags (sonst der nächste andere Ort vorgezogen)
      const queue = route(assign.get(d), planned.get(d), home).sort((a, b) => (b.cat === 'Café') - (a.cat === 'Café'));
      while (queue.length) {
        let k = 0;
        if (queue[0].cat === 'Essen' && t < LUNCH) { const alt = queue.findIndex((q) => q.cat !== 'Essen'); if (alt > 0) k = alt; }
        const p = queue.splice(k, 1)[0];
        t += prev ? travel(prev, p) : 0;
        const slot = fit(t, dur(p), blocked);
        if (slot === null) continue; // passt nicht mehr in den Tag, bleibt in den Ideen
        out.push({ id: p.id, day: d, time: fmt(slot), ord: ++ord });
        t = slot + dur(p);
        prev = p;
      }
      dayEnd.set(d, { t, prev, ord });
    });
  }

  // Abstecher: je Tag höchstens einer, nicht an Anreise- oder Abreisetag, beliebteste zuerst
  const used = new Set();
  for (const p of candidates.filter((x) => outliers.has(x.id))) {
    const options = days.filter((d) => !lightDays.includes(d) && !used.has(d))
      .map((d) => ({ d, c: dayCenter.get(d) || mean(planned.get(d).filter(hasPos)) || p }))
      .sort((a, b) => km(a.c, p) - km(b.c, p));
    for (const { d } of options) {
      const end = dayEnd.get(d) || { t: dayStart[d] ?? 9.5, prev: null, ord: planned.get(d).length };
      const start = Math.max(ABSTECHER_FROM, end.t + travel(end.prev, p));
      const slot = fit(start, dur(p), fixedBlocks(planned.get(d)), travel(end.prev, p));
      if (slot === null) continue;
      out.push({ id: p.id, day: d, time: fmt(slot), ord: end.ord + 1, note: 'Abstecher, etwas weiter weg' });
      used.add(d);
      break;
    }
  }
  return out;
}

// Feste Termine als belegte Zeitfenster (mit Puffer für den Weg dorthin)
function fixedBlocks(list) {
  return list.filter((p) => p.time).map((p) => [toH(p.time) - 0.5, toH(p.time) + dur(p)]);
}
// Frühester Beginn ab t, der weder mit festen Terminen kollidiert noch zu spät endet
function fit(t, d, blocked, gap = 0) {
  let s = t;
  for (let guard = 0; guard < 20; guard++) {
    const hit = blocked.find(([a, b]) => s < b && s + d > a);
    if (!hit) break;
    s = hit[1] + Math.max(gap, 0.25);
  }
  return s + d > LATEST_END ? null : s;
}

function mean(ps) {
  if (!ps.length) return null;
  return { lat: ps.reduce((n, p) => n + p.lat, 0) / ps.length, lng: ps.reduce((n, p) => n + p.lng, 0) / ps.length };
}
function fmt(h) {
  const q = Math.round(h * 4) / 4;
  const hh = Math.min(23, Math.floor(q)), mm = Math.round((q - Math.floor(q)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
// Reihenfolge nach dem jeweils nächsten Ort. Start: ein schon geplanter Ort des Tages, sonst die Unterkunft, sonst der westlichste.
function route(stops, fixed, home = null) {
  if (stops.length < 2) return stops;
  const rest = [...stops];
  const startFrom = fixed.find(hasPos) || (home && hasPos(home) ? home : null);
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

// ---------- Tagesgerüst: Frühstück, Vormittag, Mittag, Nachmittag, Abend ----------
// Statt minutengenauer Zeiten bekommt jeder Tag fünf lockere Abschnitte. Für freie Abschnitte schlägt die App
// je einen Ort vor (plus zwei Alternativen), passend zur Gegend des Tages und nach Herzen sortiert.

export const SLOTS = ['frueh', 'vormittag', 'mittag', 'nachmittag', 'abend'];
export function slotOfTime(t) {
  const h = toH(t);
  return h < 10.5 ? 'frueh' : h < 12 ? 'vormittag' : h < 14.5 ? 'mittag' : h < 17.5 ? 'nachmittag' : 'abend';
}
export const slotOf = (p) => (SLOTS.includes(p.slot) ? p.slot : p.time ? slotOfTime(p.time) : null);

const EVENING = /christmas|weihnacht|lichter|lights|rockefeller|rooftop|dach|bar\b|show|broadway|times square/i;
const FIT = {
  frueh: (p) => (p.cat === 'Café' ? 3 : 0),
  vormittag: (p) => (['Sehen', 'Natur', 'Kultur', 'Shopping'].includes(p.cat) ? 2 : p.cat === 'Weihnachten' ? 1 : 0),
  mittag: (p) => (p.cat === 'Essen' ? 3 : p.cat === 'Café' ? 1 : 0),
  nachmittag: (p) => (['Sehen', 'Shopping', 'Kultur', 'Weihnachten', 'Natur'].includes(p.cat) ? 2 : p.cat === 'Café' ? 1 : 0),
  abend: (p) => (p.cat === 'Nachts' ? 3 : 0) + (p.cat === 'Essen' ? 2 : 0) + (EVENING.test(`${p.title} ${p.note || ''}`) ? 2 : 0),
};
export const slotFit = (p, slot) => FIT[slot](p);

// Welche Abschnitte ein Tag hat: Anreise nur abends, Abreise nur bis mittags
export function daySlots(day, { start, end } = {}) {
  if (day === start) return ['abend'];
  if (day === end) return ['frueh', 'vormittag'];
  return SLOTS;
}

export function draftPlan(places, days, { start, end, home = null } = {}) {
  // Gegenden der Tage aus dem Tagesvorschlag (nahe Orte zusammen, Ausreißer als Abstecher)
  const groups = new Map(days.map((d) => [d, new Set()]));
  for (const m of suggestPlan(places, days, { perDay: 5, lightDays: [start, end].filter(Boolean), dayStart: start ? { [start]: 18 } : {}, home })) {
    groups.get(m.day)?.add(m.id);
  }
  const byId = new Map(places.map((p) => [p.id, p]));
  const used = new Set(places.filter((p) => p.day).map((p) => p.id));
  const out = {};
  for (const d of days) {
    const onDay = places.filter((p) => p.day === d);
    const filled = new Set(onDay.map(slotOf).filter(Boolean));
    const group = [...groups.get(d)].map((id) => byId.get(id)).filter(Boolean);
    const center = mean([...onDay, ...group].filter(hasPos)) || mean(places.filter(hasPos));
    out[d] = {};
    for (const slot of daySlots(d, { start, end })) {
      if (filled.has(slot)) continue;
      const score = (p) => {
        const fit = slotFit(p, slot);
        if (!fit) return -Infinity;
        const dist = center && hasPos(p) ? km(center, p) : 3;
        if (!groups.get(d).has(p.id) && dist > 3) return -Infinity; // nur Orte in der Gegend des Tages
        // Frühstück und Abend lieber in der Nähe der Unterkunft
        const nearHome = home && hasPos(home) && hasPos(p) && (slot === 'frueh' || slot === 'abend') ? km(home, p) * 0.35 : 0;
        return fit * 2 + (p.hearts || 0) * 1.5 + (groups.get(d).has(p.id) ? 2 : 0) - dist * 0.6 - nearHome;
      };
      const ranked = places.filter((p) => !p.day && !used.has(p.id))
        .map((p) => [score(p), p]).filter(([s]) => s > -Infinity)
        .sort((a, b) => b[0] - a[0]).map(([, p]) => p.id);
      if (!ranked.length) continue;
      used.add(ranked[0]);
      out[d][slot] = { pick: ranked[0], alts: ranked.slice(1, 3) };
    }
  }
  return out;
}
