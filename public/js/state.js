// Zustand der App: letzter Stand vom Server plus abgeleitete Hilfen.
import { api, cacheState } from './api.js';
import { todayIn, daysBetween } from './ui.js';

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

export async function refresh() {
  const d = await api('/trip');
  S.offlineSince = null;
  setData(d);
  return d;
}

// Nach einer Änderung neu laden, Fehler zeigt der Aufrufer
export async function mutate(path, opts) {
  const r = await api(path, opts);
  await refresh().catch(() => {});
  return r;
}

// ---------- Ableitungen ----------
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
