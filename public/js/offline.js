// "Für unterwegs speichern": lädt Karte (Gebiet aller Orte, bis Zoomstufe 14) und alle Fotos in den Speicher
// des Geräts, damit in der U-Bahn ohne Netz trotzdem alles da ist. Der Reisestand selbst liegt ohnehin im
// localStorage, die App-Dateien hält der Service Worker.
import { S, trip } from './state.js';

const TILES = 'tiles-v1';
const PHOTOS = 'photos-v1';
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
const RANGES = ['0-255', '256-511', '8192-8447'];
const KEY = (id) => `rb.offline.${id}`;

const tx = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
const ty = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };

export const offlineSupported = () => 'caches' in window && 'serviceWorker' in navigator;
export function offlineInfo() {
  try { return JSON.parse(localStorage.getItem(KEY(trip().id)) || 'null'); } catch { return null; }
}

// Kacheln für das Gebiet aller Orte (plus Rand), Zoom 5 bis maxzoom
export function tileList(points, template, maxz = 14) {
  const ps = points.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!ps.length) return [];
  const s = Math.min(...ps.map((p) => p.lat)) - 0.01, n = Math.max(...ps.map((p) => p.lat)) + 0.01;
  const w = Math.min(...ps.map((p) => p.lng)) - 0.01, e = Math.max(...ps.map((p) => p.lng)) + 0.01;
  const out = [];
  for (let z = 5; z <= maxz; z++) {
    for (let x = tx(w, z); x <= tx(e, z); x++) for (let y = ty(n, z); y <= ty(s, z); y++) out.push(template.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  }
  return out;
}

export function photoList(places) {
  const out = [];
  for (const p of places) {
    if (p.g?.photo) out.push({ url: `/api/gphoto/${p.id}?v=${p.g.v || ''}`, cors: true });
    else if (/^https:\/\//.test(p.image || '')) out.push({ url: p.image, cors: false });
  }
  return out;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } }));
}

// onProgress({ done, total, phase }) während des Ladens; gibt die Zusammenfassung zurück
export async function saveOffline(onProgress = () => {}) {
  const t = trip();
  navigator.storage?.persist?.().catch(() => {}); // bitte nicht automatisch wegräumen
  const tiles = await caches.open(TILES);
  const photos = await caches.open(PHOTOS);
  const tj = await fetch(TILEJSON).then((r) => { tiles.put(TILEJSON, r.clone()); return r.json(); });
  const tpl = tj.tiles?.[0];
  if (!tpl) throw new Error('Die Karte ist gerade nicht erreichbar.');
  const mapUrls = [
    ...tileList([t.hotel, ...S.data.places], tpl, Math.min(14, tj.maxzoom || 14)),
    ...FONTS.flatMap((f) => RANGES.map((r) => GLYPHS.replace('{fontstack}', f).replace('{range}', r))),
  ];
  const ph = photoList(S.data.places);
  const total = mapUrls.length + ph.length;
  let done = 0, failed = 0, bytes = 0;
  const tick = (phase) => onProgress({ done, total, phase });
  tick('map');
  await pool(mapUrls, 6, async (u) => {
    try {
      if (!(await tiles.match(u))) {
        const r = await fetch(u);
        if (!r.ok) throw new Error(r.status);
        bytes += Number(r.headers.get('content-length')) || 0;
        await tiles.put(u, r);
      }
    } catch { failed++; }
    done++; tick('map');
  });
  await pool(ph, 6, async ({ url, cors }) => {
    try {
      const req = new Request(url, cors ? {} : { mode: 'no-cors' });
      if (!(await photos.match(req, { ignoreVary: true }))) {
        const r = await fetch(req);
        if (r.status === 404) { done++; tick('photos'); return; } // zu diesem Ort gibt es kein Foto
        if (!r.ok && r.type !== 'opaque') throw new Error(r.status);
        await photos.put(req, r);
      }
    } catch { failed++; }
    done++; tick('photos');
  });
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const info = { at: Date.now(), tiles: mapUrls.length, photos: ph.length, failed, usage: est?.usage || bytes };
  try { localStorage.setItem(KEY(t.id), JSON.stringify(info)); } catch { /* egal */ }
  return info;
}
