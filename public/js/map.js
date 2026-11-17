// Karte mit MapLibre (lokal unter vendor/) und Vektorkacheln von OpenFreeMap, ohne Schlüssel.
// Der Stil steht in mapstyle.js. Pins sind HTML-Sticker, die Route eine gepunktete Linie.
import { CATS } from './themes.js';
import { MAP_STYLE } from './mapstyle.js';

let ready = null;
export function loadMapLib() {
  if (!ready) {
    ready = new Promise((res, rej) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = '/vendor/maplibre/maplibre-gl.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = '/vendor/maplibre/maplibre-gl-csp.js';
      s.onload = () => { window.maplibregl.setWorkerUrl('/vendor/maplibre/maplibre-gl-csp-worker.js'); res(window.maplibregl); };
      s.onerror = () => { ready = null; rej(new Error('Die Karte konnte nicht geladen werden.')); };
      document.head.appendChild(s);
    });
  }
  return ready;
}

export function baseMap(ml, el, { center = [10, 48.5], zoom = 3 } = {}) {
  const map = new ml.Map({
    container: el, style: MAP_STYLE, center, zoom, pitch: 0, maxPitch: 0,
    attributionControl: { compact: true, customAttribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>' },
    dragRotate: false, pitchWithRotate: false, touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  return map;
}

export function addPin(ml, map, p, label = '', { faint = false, onClick } = {}) {
  const c = CATS[p.cat] || CATS.Sehen;
  const el = document.createElement('button');
  el.className = `pin${faint ? ' faint' : ''}`;
  el.type = 'button';
  el.setAttribute('aria-label', p.title);
  el.innerHTML = faint ? `<span style="background:${c.bg}"></span>` : `<span class="drop" style="--c:${c.bg};--t:${c.fg}"><b>${label}</b></span>`;
  if (onClick) el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return new ml.Marker({ element: el, anchor: faint ? 'center' : 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map);
}

export function addRoute(map, points) {
  const add = () => {
    if (map.getSource('route')) return;
    map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) } } });
    map.addLayer({ id: 'route-halo', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': 8 } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#E8553A', 'line-width': 4 } });
  };
  if (map.isStyleLoaded()) add(); else map.once('load', add);
}

// Die Unterkunft: eigener Pin mit Haus, immer sichtbar
export function addHome(ml, map, hotel) {
  const el = document.createElement('div');
  el.className = 'home-pin';
  el.setAttribute('aria-label', hotel.name);
  el.innerHTML = `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/></svg></span><b>${hotel.name.replace(/</g, '')}</b>`;
  return new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([hotel.lng, hotel.lat]).addTo(map);
}

export const hasCoords = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng);
