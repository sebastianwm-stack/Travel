// Verbindung zum Server. Pro Reise gibt es einen persönlichen Schlüssel; ein Gerät kann in mehreren Reisen sein.
const TRIPS = 'rb.trips';     // [{ token, id, name, dest }]
const CURRENT = 'rb.current';

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat oder voll */ } };

// Alte Einzel-Speicherung übernehmen
(() => {
  try {
    const old = localStorage.getItem('rb.token');
    if (old && !read(TRIPS, []).length) { write(TRIPS, [{ token: old }]); write(CURRENT, old); }
    localStorage.removeItem('rb.token');
  } catch { /* egal */ }
})();

export const myTrips = () => read(TRIPS, []);
export const getToken = () => read(CURRENT, '') || '';

export function setToken(token) {
  if (!token) return;
  const list = myTrips();
  if (!list.some((t) => t.token === token)) list.push({ token });
  write(TRIPS, list);
  write(CURRENT, token);
}
export function forgetToken(token) {
  write(TRIPS, myTrips().filter((t) => t.token !== token));
  if (getToken() === token) write(CURRENT, myTrips()[0]?.token || '');
  try { localStorage.removeItem(cacheKey(token)); } catch { /* egal */ }
}
export function rememberTrip(token, trip) {
  const list = myTrips();
  // derselbe Reise-Eintrag mit anderem Schlüssel (z. B. neuer Link) wird ersetzt
  const next = list.filter((t) => t.token === token || t.id !== trip.id);
  const e = next.find((t) => t.token === token);
  if (e) Object.assign(e, { id: trip.id, name: trip.name, dest: trip.dest });
  write(TRIPS, next);
}

export class ApiError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

export async function api(path, { method = 'GET', body, headers = {}, raw = false, token = getToken() } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers: h, body: payload });
  } catch {
    throw new ApiError('Keine Verbindung. Bist du offline?', 0);
  }
  if (raw) {
    if (!res.ok) throw new ApiError('Konnte nicht geladen werden.', res.status);
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Fehler ${res.status}`, res.status);
  return data;
}

const cacheKey = (token) => `rb.cache.${(token || '').slice(0, 10)}`;
export function cacheState(s) { write(cacheKey(getToken()), { at: Date.now(), s }); }
export function cachedState() { return read(cacheKey(getToken()), null); }

// Dateien als Blob-URL laden (Bilder brauchen den Schlüssel im Header)
const blobUrls = new Map();
export async function fileUrl(id) {
  if (blobUrls.has(id)) return blobUrls.get(id);
  const res = await api(`/files/${id}`, { raw: true });
  const url = URL.createObjectURL(await res.blob());
  blobUrls.set(id, url);
  return url;
}
