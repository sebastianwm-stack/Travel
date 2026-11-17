// Wetter-Anzeige: kleines Symbol im Sticker-Stil und ein kurzer Satz.
import { esc, fmtShort } from './ui.js';
import { weatherOf } from './state.js';

const sv = (inner) => `<svg viewBox="0 0 32 32" aria-hidden="true">${inner}</svg>`;
const SUN = '<circle cx="16" cy="16" r="6.5" fill="#FFC93C" stroke="#161616" stroke-width="2"/><path d="M16 3v3.5M16 25.5V29M3 16h3.5M25.5 16H29M6.8 6.8l2.5 2.5M22.7 22.7l2.5 2.5M6.8 25.2l2.5-2.5M22.7 9.3l2.5-2.5" stroke="#161616" stroke-width="2" stroke-linecap="round"/>';
const CLOUD = (y = 0) => `<path d="M9 ${24 + y}h14a5 5 0 0 0 .6-10 7 7 0 0 0-13.4-1.6A5.5 5.5 0 0 0 9 ${24 + y}z" fill="#fff" stroke="#161616" stroke-width="2" stroke-linejoin="round"/>`;
const ICONS = {
  sun: sv(SUN),
  partly: sv('<circle cx="12" cy="12" r="5.5" fill="#FFC93C" stroke="#161616" stroke-width="2"/><path d="M12 2.5v2M3 12h2M5.6 5.6l1.4 1.4M18.4 5.6 17 7" stroke="#161616" stroke-width="2" stroke-linecap="round"/>' + CLOUD(2)),
  cloud: sv(CLOUD(-1)),
  fog: sv(CLOUD(-4) + '<path d="M6 25h20M9 29h14" stroke="#161616" stroke-width="2" stroke-linecap="round"/>'),
  rain: sv(CLOUD(-4) + '<path d="M11 24l-1.5 4M16.5 24 15 28M22 24l-1.5 4" stroke="#2F4BFF" stroke-width="2.4" stroke-linecap="round"/>'),
  snow: sv(CLOUD(-4) + '<circle cx="10.5" cy="26" r="1.6" fill="#7EB6FF" stroke="#161616" stroke-width="1"/><circle cx="16" cy="28" r="1.6" fill="#7EB6FF" stroke="#161616" stroke-width="1"/><circle cx="21.5" cy="26" r="1.6" fill="#7EB6FF" stroke="#161616" stroke-width="1"/>'),
  storm: sv(CLOUD(-4) + '<path d="M17 22l-4 6h4l-2 4" fill="none" stroke="#FF5B3A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
};
// WMO-Wettercodes → Symbol und Wort
function kindOf(code) {
  if (code === 0) return ['sun', 'klar'];
  if (code <= 2) return ['partly', 'heiter'];
  if (code === 3) return ['cloud', 'bewölkt'];
  if (code <= 48) return ['fog', 'neblig'];
  if (code <= 57) return ['rain', 'Niesel'];
  if (code <= 67) return ['rain', 'Regen'];
  if (code <= 77) return ['snow', 'Schnee'];
  if (code <= 82) return ['rain', 'Schauer'];
  if (code <= 86) return ['snow', 'Schneeschauer'];
  return ['storm', 'Gewitter'];
}
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// { icon, text, typical } oder null
export function weatherInfo(day) {
  const w = weatherOf(day);
  if (!w) return null;
  if (w.kind === 'forecast') {
    const [k, word] = kindOf(w.code);
    const extra = w.snow >= 1 ? `${Math.round(w.snow)} cm Schnee` : w.rain >= 30 ? `Regen ${w.rain} %` : '';
    return { icon: ICONS[k], short: `${w.tmin}° / ${w.tmax}°`, text: [`${w.tmin}° bis ${w.tmax}°`, w.snow >= 1 ? '' : word, extra].filter(Boolean).join(' · '), wet: w.rain >= 60 || w.snow >= 1 || (w.code >= 61 && w.code <= 99) };
  }
  const k = w.snow >= 40 ? 'snow' : w.rain >= 50 ? 'rain' : 'partly';
  const often = w.snow >= 40 ? 'oft Schnee' : w.snow >= 20 ? 'manchmal Schnee' : w.rain >= 60 ? 'oft Regen' : w.rain >= 40 ? 'manchmal Regen' : 'meist trocken';
  return { icon: ICONS[k], short: `${w.tmin}° / ${w.tmax}°`, text: `Üblich: ${w.tmin}° bis ${w.tmax}°, ${often}`, typical: true, from: addDays(day, -15) };
}
// Zeile für Kopf oder Karte
export function weatherLine(day, cls = '') {
  const i = weatherInfo(day);
  if (!i) return '';
  return `<p class="wx ${i.typical ? 'typ' : ''} ${cls}">${i.icon}<span>${esc(i.text)}${i.typical ? `<small>Vorhersage ab ${esc(fmtShort(i.from))}</small>` : ''}</span></p>`;
}
export const weatherIcon = (day) => weatherInfo(day)?.icon || '';
