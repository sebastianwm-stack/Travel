// Zustand der App: letzter Stand vom Server plus abgeleitete Hilfen.
import { api, cacheState } from './api.js';
import { todayIn, daysBetween } from './ui.js';
import { frameOf } from './frame.js';

export const S = {
  data: null,        // Antwort von /api/trip
  offlineSince: null,
  listeners: new Set(),
};

export function setData(d, { cache = true } = {}) {
  S.data = d;
  if (cache) cacheState(d);
  S.listeners.forEach((fn) => fn());
}
export const onChange = (fn) => S.listeners.add(fn);

let lastJSON = '';
export async function refresh() {
  const d = await api('/trip');
  S.offlineSince = null;
  // nur neu zeichnen, wenn sich wirklich etwas geändert hat
  const j = JSON.stringify(d);
  if (j !== lastJSON || !S.data) { lastJSON = j; setData(d); }
  return d;
}
let refreshTimer;
export function refreshSoon(ms = 400) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch(() => {}), ms);
}

// Nach einer Änderung neu laden, Fehler zeigt der Aufrufer
// Änderung an den Server schicken. Mit `local` wird sie sofort angezeigt (optimistisch) und im
// Hintergrund gespeichert; ohne `local` wartet der Aufruf, bis der neue Stand geladen ist.
export async function mutate(path, opts, local) {
  if (local && S.data) {
    local(S.data);
    S.listeners.forEach((fn) => fn());
    try { const r = await api(path, opts); refreshSoon(); return r; }
    catch (e) { refreshSoon(0); throw e; }
  }
  const r = await api(path, opts);
  await refresh().catch(() => {});
  return r;
}

// Bausteine für sofortige Änderungen
export const localPlace = (id, fields) => (d) => { const p = d.places.find((x) => x.id === id); if (p) Object.assign(p, fields); };
export const localHeart = (id) => (d) => {
  const me = d.me.id;
  const i = d.hearts.findIndex(([p, m]) => p === id && m === me);
  if (i >= 0) d.hearts.splice(i, 1); else d.hearts.push([id, me]);
};

// ---------- Suche in den eigenen Orten ----------
// unempfindlich für Groß/klein, Akzente, Apostrophe und Wortreihenfolge
export const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’‘`´]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9äöüß]+/g, ' ').trim();
export function matchPlaces(q, places = S.data.places) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const p of places) {
    const title = norm(p.title), rest = norm(`${p.area} ${p.note} ${p.cat}`);
    const glued = title.replace(/ /g, '');
    if (!words.every((w) => title.includes(w) || rest.includes(w) || glued.includes(w))) continue;
    const score = (title.startsWith(words[0]) ? 3 : 0) + words.filter((w) => title.includes(w) || glued.includes(w)).length * 2 + (p.day ? 0 : 0.5);
    out.push([score, p]);
  }
  return out.sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title, 'de')).map(([, p]) => p);
}

// ---------- Ableitungen ----------
// Anreise und Abreise aus den Flugdaten (Landung, Hotel, Check-out, ab zum Flughafen)
export const frame = () => frameOf(S.data.trip, S.data.items);

// Wetter je Reisetag: einmal laden, nach drei Stunden neu
const wx = { trip: null, at: 0, days: {}, loading: false };
export function weatherOf(day) {
  const t = S.data.trip;
  if ((wx.trip !== t.id || Date.now() - wx.at > 3 * 3600e3) && !wx.loading) {
    wx.loading = true;
    api('/weather')
      .then((r) => { Object.assign(wx, { trip: t.id, at: Date.now(), days: r.days || {} }); window.dispatchEvent(new Event('rb:render')); })
      .catch(() => { Object.assign(wx, { trip: t.id, at: Date.now() }); })
      .finally(() => { wx.loading = false; });
  }
  return wx.trip === t.id ? wx.days[day] || null : null;
}

export const me = () => S.data.me;
export const trip = () => S.data.trip;
export const member = (id) => S.data.members.find((m) => m.id === id);
export const place = (id) => S.data.places.find((p) => p.id === id);

export function heartsOf(placeId) {
  return S.data.hearts.filter(([p]) => p === placeId).map(([, m]) => member(m)).filter(Boolean);
}
export const iHeart = (placeId) => S.data.hearts.some(([p, m]) => p === placeId && m === S.data.me.id);
export const commentsOf = (target) => S.data.comments.filter((c) => c.target === target);

// Abschnitte des Tages (statt fester Uhrzeiten)
export const SLOTS = ['frueh', 'vormittag', 'mittag', 'nachmittag', 'abend'];
export const SLOT_LABEL = { frueh: 'Frühstück', vormittag: 'Vormittag', mittag: 'Mittag', nachmittag: 'Nachmittag', abend: 'Abend' };
export function slotOf(p) {
  if (SLOTS.includes(p.slot)) return p.slot;
  if (!p.time) return null;
  const [h, m] = p.time.split(':').map(Number);
  const x = h + m / 60;
  return x < 10.5 ? 'frueh' : x < 12 ? 'vormittag' : x < 14.5 ? 'mittag' : x < 17.5 ? 'nachmittag' : 'abend';
}
export const whenLabel = (p) => p.time || SLOT_LABEL[slotOf(p)] || 'Zeit offen';
const slotIdx = (p) => { const s = slotOf(p); return s ? SLOTS.indexOf(s) : 9; };
const byTime = (a, b) => slotIdx(a) - slotIdx(b) || (a.time || '99:99').localeCompare(b.time || '99:99') || a.ord - b.ord;
export const stopsOf = (day) => S.data.places.filter((p) => p.day === day).sort(byTime);
export const pool = () => S.data.places.filter((p) => !p.day);

// Phase der Reise aus Sicht von heute (Ortszeit am Ziel)
export function phase() {
  const t = trip();
  const today = todayIn(t.tz);
  if (!t.start || !t.end) return { kind: 'open', today };
  if (today < t.start) return { kind: 'before', today, days: daysBetween(today, t.start) };
  if (today > t.end) return { kind: 'after', today };
  return { kind: 'during', today, index: daysBetween(t.start, today) };
}

export function defaultDay() {
  const p = phase();
  const days = trip().days;
  if (p.kind === 'during') return p.today;
  return days[0] || null;
}
