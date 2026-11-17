// Rahmen der Reise: Wann ist man am Anreisetag im Hotel, wann muss man am Abreisetag los?
// Läuft im Browser und im Worker (Planung), damit beide dieselben freien Abschnitte sehen.
//
// Flug-Einträge (items, kind 'flight') haben in data: dir ('hin' | 'rueck'), date (Abflugdatum),
// dep / arr (Ortszeit HH:MM), from / to (Flughafen-Kürzel), no (Flugnummer), arrDate (falls anderer Tag).
// Unterkunft (kind 'stay'): checkin / checkout (HH:MM).

// Fahrt Flughafen ↔ Innenstadt in Minuten (Taxi oder Bahn, mit etwas Luft)
const AIRPORT_MIN = { JFK: 70, EWR: 60, LGA: 45 };
const DEFAULT_TRANSFER = 60;
const ARRIVAL_MIN = 75;        // Einreise, Gepäck
const BEFORE_FLIGHT_MIN = 180; // so früh vor Abflug am Flughafen (international)
const LUGGAGE_MIN = 30;        // zurück ins Hotel, Gepäck holen

export const SLOTS = ['frueh', 'vormittag', 'mittag', 'nachmittag', 'abend'];
// grobe Zeitfenster der Abschnitte in Stunden
export const SLOT_HOURS = { frueh: [8, 10.5], vormittag: [10.5, 12], mittag: [12, 14.5], nachmittag: [14.5, 17.5], abend: [17.5, 22.5] };

export const toH = (t) => { const [h, m] = String(t).split(':').map(Number); return h + (m || 0) / 60; };
export const fmtH = (h) => { const q = Math.round(h * 4) / 4; const hh = ((Math.floor(q) % 24) + 24) % 24; return `${String(hh).padStart(2, '0')}:${String(Math.round((q - Math.floor(q)) * 60)).padStart(2, '0')}`; };
const isTime = (t) => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t);
const data = (i) => (typeof i.data === 'string' ? (() => { try { return JSON.parse(i.data); } catch { return {}; } })() : i.data || {});

export const transferMin = (code) => AIRPORT_MIN[String(code || '').toUpperCase()] || DEFAULT_TRANSFER;

// Hin- und Rückflug finden: ausdrücklich markiert, sonst nach Datum (Start- bzw. Endtag)
export function flightsOf(trip, items = []) {
  const fl = items.filter((i) => i.kind === 'flight').map((i) => ({ ...i, d: data(i) }));
  const hin = fl.find((f) => f.d.dir === 'hin') || fl.find((f) => f.d.date && f.d.date <= trip.start) || null;
  const rueck = fl.find((f) => f.d.dir === 'rueck') || fl.find((f) => f.d.date && f.d.date >= trip.end && f !== hin) || null;
  return { hin, rueck };
}

// { arrive: {date, land, airport, hotelAt, transfer} | null, leave: {date, dep, airport, leaveAt, checkout, transfer} | null }
export function frameOf(trip, items = []) {
  if (!trip?.start || !trip?.end) return { arrive: null, leave: null };
  const { hin, rueck } = flightsOf(trip, items);
  const stay = items.find((i) => i.kind === 'stay');
  const sd = stay ? data(stay) : {};
  let arrive = null, leave = null;
  if (hin && isTime(hin.d.arr)) {
    const transfer = transferMin(hin.d.to);
    const at = toH(hin.d.arr) + (ARRIVAL_MIN + transfer) / 60;
    arrive = { date: hin.d.arrDate || trip.start, land: hin.d.arr, dep: isTime(hin.d.dep) ? hin.d.dep : null, from: (hin.d.from || '').toUpperCase(), airport: (hin.d.to || '').toUpperCase(), transfer, hotelAt: fmtH(Math.ceil(at * 4) / 4), checkin: isTime(sd.checkin) ? sd.checkin : '15:00' };
  }
  if (rueck && isTime(rueck.d.dep)) {
    const transfer = transferMin(rueck.d.from);
    const at = toH(rueck.d.dep) - (BEFORE_FLIGHT_MIN + transfer) / 60;
    leave = { date: rueck.d.date || trip.end, dep: rueck.d.dep, airport: (rueck.d.from || '').toUpperCase(), transfer, leaveAt: fmtH(Math.floor(at * 4) / 4), checkout: isTime(sd.checkout) ? sd.checkout : '11:00' };
  }
  return { arrive, leave };
}

// Freie Abschnitte eines Tages. Ohne Flugzeiten: Anreisetag nur abends, Abreisetag nur bis Mittag.
export function daySlots(day, { start, end, frame } = {}) {
  const arr = frame?.arrive, lv = frame?.leave;
  const free = (from, to) => SLOTS.filter((s) => { const [a, b] = SLOT_HOURS[s]; return Math.min(b, to) - Math.max(a, from) >= 1.25; });
  if (day === start && day === end && arr && lv) return free(toH(arr.hotelAt), toH(lv.leaveAt) - LUGGAGE_MIN / 60);
  if (day === start) return arr ? free(toH(arr.hotelAt), 24) : ['abend'];
  if (day === end) return lv ? free(0, toH(lv.leaveAt) - LUGGAGE_MIN / 60) : ['frueh', 'vormittag'];
  return SLOTS;
}
// Frühester Start des Anreisetags (Stunden), für die Zeitplanung
export const dayStartOf = (frame, start) => (frame?.arrive ? { [start]: toH(frame.arrive.hotelAt) + 0.25 } : { [start]: 18 });
