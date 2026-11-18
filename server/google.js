// Google Places (New): Foto, Bewertung, Öffnungszeiten und Website zu jedem Ort, dazu die Suche beim Hinzufügen.
// Der Schlüssel kommt aus dem Cloudflare-Secret GOOGLE_PLACES_KEY oder wird von der Reiseleitung in der App
// eingetragen (trips.gkey). Er verlässt den Server nie.
//
// Gespeichert wird je Ort die Google-Place-ID (darf dauerhaft gespeichert werden) und ein kleiner Auszug
// (ginfo). Fotos holt der Server bei Bedarf und lässt sie eine Woche im Cloudflare-Cache.
const API = 'https://places.googleapis.com/v1';
const DETAIL = 'id,displayName,location,rating,userRatingCount,regularOpeningHours.weekdayDescriptions,websiteUri,googleMapsUri,photos';
const SEARCH = 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType';

export const googleKey = (env, trip) => env.GOOGLE_PLACES_KEY || trip?.gkey || null;
export const validKeyFormat = (k) => typeof k === 'string' && /^AIza[0-9A-Za-z_-]{30,40}$/.test(k.trim());

async function call(key, path, { body, fields, method = body ? 'POST' : 'GET' } = {}) {
  const r = await fetch(`${API}/${path}`, {
    method,
    headers: { 'x-goog-api-key': key, 'x-goog-fieldmask': fields, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j?.error?.message || `Google ${r.status}`); e.status = r.status; throw e; }
  return j;
}

const rad = (x) => (x * Math.PI) / 180;
const km = (a, b) => 12742 * Math.asin(Math.sqrt(Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function similar(a, b) {
  const x = new Set(norm(a).split(' ').filter((w) => w.length > 1)), y = new Set(norm(b).split(' ').filter((w) => w.length > 1));
  if (!x.size || !y.size) return 0;
  let n = 0; x.forEach((w) => { if (y.has(w)) n++; });
  return n / Math.min(x.size, y.size);
}

const CAT = [
  [/^(restaurant|.*_restaurant|meal_takeaway|food_court|pizza|sandwich_shop|deli|diner)$/, 'Essen'],
  [/^(cafe|coffee_shop|bakery|cafeteria|tea_house|dessert_shop|ice_cream_shop|donut_shop|bagel_shop)$/, 'Café'],
  [/^(bar|night_club|pub|wine_bar|cocktail_bar)$/, 'Nachts'],
  [/^(museum|art_gallery|performing_arts_theater|movie_theater|concert_hall|opera_house)$/, 'Kultur'],
  [/^(park|garden|botanical_garden|national_park|zoo|aquarium)$/, 'Natur'],
  [/(store|shopping_mall|market)$/, 'Shopping'],
];
const catOf = (types = [], primary = '') => {
  for (const t of [primary, ...types].filter(Boolean)) { const hit = CAT.find(([re]) => re.test(t)); if (hit) return hit[1]; }
  return 'Sehen';
};

// Suche beim Hinzufügen, wie in Google Maps
export async function searchGoogle(key, q, near) {
  const j = await call(key, 'places:searchText', {
    fields: SEARCH,
    body: { textQuery: q, languageCode: 'de', maxResultCount: 8, ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 30000 } } } : {}) },
  });
  return (j.places || []).map((g) => {
    const parts = (g.formattedAddress || '').split(',').map((s) => s.trim());
    return { title: g.displayName?.text || parts[0] || '', area: parts.length > 2 ? parts[parts.length - 3] : '', address: g.formattedAddress || '', lat: g.location?.latitude, lng: g.location?.longitude, cat: catOf(g.types, g.primaryType), gplace: g.id };
  }).filter((r) => r.title && Number.isFinite(r.lat));
}

// kleiner Auszug, der beim Ort gespeichert wird
export function ginfoOf(g) {
  const ph = g.photos?.[0];
  const by = ph?.authorAttributions?.[0];
  return {
    rating: g.rating ?? null, n: g.userRatingCount ?? null,
    hours: g.regularOpeningHours?.weekdayDescriptions || null,
    web: g.websiteUri || null, maps: g.googleMapsUri || null,
    photo: ph?.name || null, by: by?.displayName || null, byUrl: by?.uri || null,
    at: Date.now(),
  };
}

// Den passenden Google-Ort zu einem unserer Orte finden
export async function matchPlace(key, p, dest = '') {
  if (p.gplace) return call(key, `places/${p.gplace}?languageCode=de`, { fields: DETAIL });
  const hasPos = Number.isFinite(p.lat) && Number.isFinite(p.lng) && !p.approx;
  const j = await call(key, 'places:searchText', {
    fields: DETAIL.split(',').map((f) => `places.${f}`).join(','),
    body: { textQuery: [p.title, p.area, dest].filter(Boolean).join(', '), languageCode: 'de', maxResultCount: 3, ...(hasPos ? { locationBias: { circle: { center: { latitude: p.lat, longitude: p.lng }, radius: 500 } } } : {}) },
  });
  const list = (j.places || []).filter((g) => g.location);
  // nah dran und ähnlicher Name, sonst lieber nichts als ein falsches Foto
  const ok = list.find((g) => {
    const d = hasPos ? km(p, { lat: g.location.latitude, lng: g.location.longitude }) : null;
    const s = similar(p.title, g.displayName?.text);
    return d === null ? s >= 0.6 : (d < 0.25 && s >= 0.3) || (d < 0.8 && s >= 0.6);
  });
  return ok || null;
}

// Orte ohne Google-Daten nachholen, ein paar pro Aufruf
export async function fillPlaces(env, trip, { limit = 10, ids = null } = {}) {
  const key = googleKey(env, trip);
  if (!key) return { done: 0, left: 0, error: 'kein Schlüssel' };
  const where = ids ? `id IN (${ids.map(() => '?').join(',')})` : 'gtried = 0';
  const { results } = await env.DB.prepare(`SELECT * FROM places WHERE trip_id = ? AND deleted = 0 AND ${where} LIMIT ?`).bind(trip.id, ...(ids || []), limit).all();
  let done = 0, error = null;
  for (let i = 0; i < results.length; i += 4) {
    await Promise.all(results.slice(i, i + 4).map(async (p) => {
      try {
        const g = await matchPlace(key, p, trip.dest);
        await env.DB.prepare('UPDATE places SET gplace = ?, ginfo = ?, gtried = 1 WHERE id = ?').bind(g?.id || null, g ? JSON.stringify(ginfoOf(g)) : null, p.id).run();
        done++;
      } catch (e) {
        error = e.message;
        // Schlüssel falsch oder Kontingent erschöpft: nicht als erledigt markieren, später nochmal
        if (![400, 401, 403, 429].includes(e.status)) await env.DB.prepare('UPDATE places SET gtried = 1 WHERE id = ?').bind(p.id).run();
      }
    }));
    if (error && /API key|PERMISSION|quota|exhausted/i.test(error)) break;
  }
  const left = (await env.DB.prepare('SELECT COUNT(*) AS n FROM places WHERE trip_id = ? AND deleted = 0 AND gtried = 0').bind(trip.id).first()).n;
  return { done, left, error };
}

// Foto ausliefern (öffentlich über die zufällige Orts-ID, damit <img> es laden kann)
export async function photoResponse(env, ctx, row) {
  const key = googleKey(env, { gkey: row.gkey });
  let info = null;
  try { info = JSON.parse(row.ginfo || 'null'); } catch { /* egal */ }
  if (!key || !info?.photo) return new Response('', { status: 404 });
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const ck = new Request(`https://reisebande.pages.dev/__gphoto/${row.id}/${encodeURIComponent(info.photo.slice(-24))}`);
  const hit = cache && (await cache.match(ck));
  if (hit) return hit;
  let r = await fetch(`${API}/${info.photo}/media?maxWidthPx=900&key=${encodeURIComponent(key)}`);
  if (!r.ok && row.gplace && [400, 404].includes(r.status)) {
    // Fotonamen laufen ab: frisch holen und nochmal
    try {
      const g = await call(key, `places/${row.gplace}?languageCode=de`, { fields: DETAIL });
      const fresh = ginfoOf(g);
      await env.DB.prepare('UPDATE places SET ginfo = ? WHERE id = ?').bind(JSON.stringify(fresh), row.id).run();
      if (fresh.photo) r = await fetch(`${API}/${fresh.photo}/media?maxWidthPx=900&key=${encodeURIComponent(key)}`);
    } catch { /* bleibt beim Fehler */ }
  }
  if (!r.ok) return new Response('', { status: 404, headers: { 'cache-control': 'public, max-age=3600' } });
  const out = new Response(r.body, { headers: { 'content-type': r.headers.get('content-type') || 'image/jpeg', 'cache-control': 'public, max-age=604800' } });
  if (cache) ctx?.waitUntil?.(cache.put(ck, out.clone()));
  return out;
}

// Schlüssel vor dem Speichern prüfen (ein günstiger Abruf)
export async function testKey(key) {
  await call(key, 'places:searchText', { fields: 'places.id', body: { textQuery: 'Times Square New York', maxResultCount: 1 } });
  return true;
}
