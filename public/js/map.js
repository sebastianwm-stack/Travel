// Leaflet (lokal unter vendor/) mit den Standard-Kacheln von OpenStreetMap (ohne Schlüssel, mit Namensnennung).
import { CATS } from './themes.js';

let leafletReady = null;
export function loadLeaflet() {
  if (!leafletReady) {
    leafletReady = new Promise((res, rej) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = '/vendor/leaflet/leaflet.js';
      s.onload = () => res(window.L);
      s.onerror = () => { leafletReady = null; rej(new Error('Die Karte konnte nicht geladen werden.')); };
      document.head.appendChild(s);
    });
  }
  return leafletReady;
}

export function baseMap(L, el) {
  const map = L.map(el, { zoomControl: false, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    // OpenStreetMap verlangt einen Referer (nur die Adresse der App, ohne Pfad)
    referrerPolicy: 'strict-origin-when-cross-origin',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  return map;
}

export function pin(L, p, label = '', { active = false, faint = false } = {}) {
  const c = CATS[p.cat] || CATS.Sehen;
  return L.divIcon({
    className: `pin${active ? ' active' : ''}${faint ? ' faint' : ''}`,
    html: `<span style="background:${c.bg};color:${c.fg}">${label}</span>`,
    iconSize: [30, 30], iconAnchor: [15, 15],
  });
}

export const hasCoords = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng);
