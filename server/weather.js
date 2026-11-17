// Wetter je Reisetag von Open-Meteo (frei, ohne Schlüssel).
// Bis 16 Tage im Voraus: Vorhersage. Davor: was in den letzten fünf Jahren an diesen Tagen üblich war.
// Ergebnis liegt im KV-Speicher (Vorhersage 3 Stunden, übliche Werte 30 Tage).
import { daysOf, localParts, addDays } from './util.js';

const FORECAST_DAYS = 16;
const YEARS = 5;

async function cached(env, key, ttl, fn) {
  try {
    const raw = await env.FILES.get(key, 'text');
    const txt = typeof raw === 'string' ? raw : raw ? new TextDecoder().decode(raw) : null;
    if (txt) return JSON.parse(txt);
  } catch { /* neu holen */ }
  const val = await fn();
  if (val) await env.FILES.put(key, JSON.stringify(val), { expirationTtl: ttl }).catch(() => {});
  return val;
}
async function getJSON(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'reisebande (trip planner)' }, cf: { cacheTtl: 1800 } });
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  return r.json();
}
const shiftYear = (date, k) => `${Number(date.slice(0, 4)) - k}${date.slice(4)}`.replace(/-02-29$/, '-02-28');

// { 'YYYY-MM-DD': { kind: 'forecast', code, tmax, tmin, rain (%), snow (cm) } | { kind: 'typical', tmax, tmin, rain (Anteil Jahre mit Regen), snow } }
export async function weatherFor(env, trip, loc) {
  const days = daysOf(trip);
  if (!days.length || !loc || !Number.isFinite(loc.lat)) return {};
  const lat = loc.lat.toFixed(2), lng = loc.lng.toFixed(2);
  const tz = trip.tz || 'UTC';
  const today = localParts(tz).date;
  const last = addDays(today, FORECAST_DAYS - 1);
  const inForecast = days.filter((d) => d >= today && d <= last);
  const out = {};

  if (inForecast.length) {
    const f = await cached(env, `wx:f:${lat},${lng}:${inForecast[0]}:${inForecast.at(-1)}:${today}`, 3 * 3600, async () => {
      const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&timezone=${encodeURIComponent(tz)}&start_date=${inForecast[0]}&end_date=${inForecast.at(-1)}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,snowfall_sum`);
      return j.daily;
    }).catch(() => null);
    f?.time?.forEach((d, i) => {
      out[d] = { kind: 'forecast', code: f.weather_code[i], tmax: Math.round(f.temperature_2m_max[i]), tmin: Math.round(f.temperature_2m_min[i]), rain: f.precipitation_probability_max[i] ?? null, snow: f.snowfall_sum[i] ?? 0 };
    });
  }

  const rest = days.filter((d) => !out[d] && d >= today);
  if (rest.length) {
    const year = Number(today.slice(0, 4));
    const y0 = 1; // nur abgeschlossene Jahre: das Vorjahr und davor
    const t = await cached(env, `wx:t:${lat},${lng}:${rest[0].slice(5)}:${rest.at(-1).slice(5)}`, 30 * 86400, async () => {
      const runs = await Promise.all(Array.from({ length: YEARS }, (_, k) => {
        const off = Number(rest[0].slice(0, 4)) - (year - y0 - k);
        return getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&timezone=${encodeURIComponent(tz)}&start_date=${shiftYear(rest[0], off)}&end_date=${shiftYear(rest.at(-1), off)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum`)
          .then((j) => j.daily).catch(() => null);
      }));
      const ok = runs.filter((r) => r?.time?.length);
      if (!ok.length) return null;
      const avg = (arr) => { const v = arr.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      return rest.map((_, i) => ({
        tmax: Math.round(avg(ok.map((r) => r.temperature_2m_max[i]))),
        tmin: Math.round(avg(ok.map((r) => r.temperature_2m_min[i]))),
        rain: Math.round((ok.filter((r) => r.precipitation_sum[i] >= 1).length / ok.length) * 100),
        snow: Math.round((ok.filter((r) => r.snowfall_sum[i] >= 1).length / ok.length) * 100),
      }));
    }).catch(() => null);
    t?.forEach((x, i) => { if (rest[i]) out[rest[i]] = { kind: 'typical', ...x }; });
  }
  return out;
}

// Ort fürs Wetter: die Unterkunft, sonst die Mitte der Ideen
export function weatherLoc(trip, places = []) {
  let h = null;
  try { h = JSON.parse(trip.hotel || 'null'); } catch { /* egal */ }
  if (h && Number.isFinite(h.lat)) return h;
  const ps = places.filter((p) => Number.isFinite(p.lat));
  return ps.length ? { lat: ps.reduce((n, p) => n + p.lat, 0) / ps.length, lng: ps.reduce((n, p) => n + p.lng, 0) / ps.length } : null;
}

// Kurzer Satz fürs Abendbriefing
export function weatherSentence(w) {
  if (!w) return '';
  if (w.kind === 'forecast') {
    const wet = w.snow >= 1 ? `, ${Math.round(w.snow)} cm Schnee` : w.rain >= 50 ? `, Regen wahrscheinlich (${w.rain} %)` : w.rain >= 30 ? ', vielleicht Regen' : ', eher trocken';
    return `${w.tmin} bis ${w.tmax} Grad${wet}.`;
  }
  return `Üblich sind ${w.tmin} bis ${w.tmax} Grad.`;
}

// Für die Planung: an welchen Tagen ist Regen oder Schnee angesagt?
export function wetDays(wx) {
  const out = {};
  for (const [d, w] of Object.entries(wx || {})) {
    if (w.kind === 'forecast' && ((w.rain ?? 0) >= 60 || (w.snow ?? 0) >= 1 || (w.code >= 61 && w.code <= 99))) out[d] = true;
  }
  return out;
}
