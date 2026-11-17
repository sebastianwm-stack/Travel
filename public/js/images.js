// Bilder für Orte, damit man beim Swipen sieht, worum es geht.
// Reihenfolge: Foto aus der Google-Maps-Liste (kommt beim Abgleich) → Wikipedia-Artikel → Foto auf Wikimedia Commons,
// das genau dort aufgenommen wurde. Ohne API-Schlüssel. Treffer zählen nur, wenn Name oder Lage passen.
// Die Suche läuft im Browser: Wikimedia drosselt gemeinsam genutzte Server-Adressen, jedes Handy hat seine eigene.

const R = 6371;
function km(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['the', 'and', 'und', 'new', 'york', 'nyc', 'city', 'of', 'at', 'zu', 'fuss', 'der', 'die', 'das', 'im', 'am', 'a', 'wer', 'moechte', 'shopping']);
const words = (s) => norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w));

export function similarity(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach((w) => { if (B.has(w)) hit++; });
  return hit / Math.min(A.size, B.size);
}

export class RateLimited extends Error {}
async function getJSON(url, fetcher) {
  let res;
  try { res = await fetcher(url, { headers: { accept: 'application/json' } }); }
  catch { throw new RateLimited('Keine Verbindung'); } // offline: später nochmal versuchen
  if (res.status === 429) throw new RateLimited('Zu viele Anfragen');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Deutsche Beschreibungen in englische Suchbegriffe übersetzen, Füllwörter weglassen
const DE_EN = [
  [/freiheitsstatue/gi, 'Statue of Liberty'], [/weihnachtsbeleuchtung|lichtershow/gi, 'Christmas lights'],
  [/eisbahn/gi, 'rink'], [/aussichtsplattform/gi, 'observation deck'], [/weihnachtsmarkt/gi, 'Christmas market'],
  [/(?<!\p{L})(zu fuß|zu fuss|wer möchte|bootstour zur|bootstour|führung|winterbummel|nachbarschaft|alternative|shopping|erster|abendspaziergang|ankommen)(?!\p{L})/giu, ' '],
];
export function searchTerms(title) {
  let t = String(title).replace(/\(.*?\)/g, ' ');
  for (const [re, en] of DE_EN) t = t.replace(re, en);
  t = t.replace(/[:]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = t.split(/\s+(?:und|&|and)\s+|,|\//i).map((x) => x.trim()).filter((x) => x.length > 2);
  return { full: t, parts };
}

// Wikipedia: passender Artikel mit Titelbild (keine Logos)
// Allein zu allgemein, um ein passendes Bild zu finden ("Hotel" ergäbe irgendein Hotel)
const GENERIC = new Set(['hotel', 'park', 'museum', 'market', 'bar', 'restaurant', 'cafe', 'shop', 'store', 'bridge', 'street', 'tour', 'pizza', 'burger', 'bagels', 'tacos', 'ramen']);
const tooGeneric = (t) => { const w = words(t); return !w.length || (w.length === 1 && GENERIC.has(w[0])); };

export async function fromWikipedia(place, dest, fetcher = fetch) {
  const { full } = searchTerms(place.title);
  if (!full || tooGeneric(full)) return null;
  const parts = searchTerms(place.title).parts.filter((x) => !tooGeneric(x));
  const queries = [...new Set([`${full} ${dest || ''}`.trim(), full, ...parts.slice(0, 2)])].slice(0, 3);
  for (const q of queries) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=5&prop=pageimages|coordinates&piprop=thumbnail&pithumbsize=900&colimit=5`;
    const data = await getJSON(url, fetcher);
    const pages = Object.values(data?.query?.pages || {})
      .filter((p) => p.thumbnail?.source && !/\.svg/i.test(p.thumbnail.source))
      .sort((a, b) => a.index - b.index);
    let best = null, bestScore = 0;
    for (const p of pages) {
      const sim = Math.max(similarity(full, p.title), ...parts.map((x) => similarity(x, p.title)));
      const c = p.coordinates?.[0];
      const dist = c && Number.isFinite(place.lat) ? km(place, { lat: c.lat, lng: c.lon }) : null;
      if (dist !== null && dist > 25) continue; // anderer Ort gleichen Namens
      let score = 0;
      if (sim >= 0.99) score = 3;
      else if (sim >= 0.5 && (dist === null || dist < 5)) score = 2;
      else if (sim >= 0.34 && dist !== null && dist < 1.5) score = 1.5;
      if (score > bestScore) { best = p; bestScore = score; }
    }
    if (best) return { url: best.thumbnail.source, credit: `Wikipedia: ${best.title}`, link: `https://en.wikipedia.org/?curid=${best.pageid}` };
  }
  return null;
}

// Commons: Fotos im Umkreis von 100 m, deren Dateiname zum Ort passt
export async function fromCommons(place, fetcher = fetch) {
  if (!Number.isFinite(place.lat) || place.approx) return null;
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggscoord=${place.lat}|${place.lng}&ggsradius=100&ggsnamespace=6&ggslimit=20&prop=imageinfo&iiprop=url&iiurlwidth=900`;
  const data = await getJSON(url, fetcher);
  const files = Object.values(data?.query?.pages || {}).filter((f) => f.imageinfo?.[0]?.thumburl && /\.(jpe?g|png|webp)$/i.test(f.title));
  const name = searchTerms(place.title).full;
  if (tooGeneric(name)) return null;
  const scored = files.map((f) => ({ f, s: similarity(name, f.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '')) })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  const f = scored[0].f;
  return { url: f.imageinfo[0].thumburl, credit: 'Wikimedia Commons', link: f.imageinfo[0].descriptionurl || 'https://commons.wikimedia.org' };
}

export async function findImage(place, dest, fetcher = fetch) {
  const w = await fromWikipedia(place, dest, fetcher).catch((e) => { if (e instanceof RateLimited) throw e; return null; });
  if (w) return w;
  return fromCommons(place, fetcher).catch((e) => { if (e instanceof RateLimited) throw e; return null; });
}

// Im Hintergrund für Orte ohne Bild suchen. Jeder Ort wird nur einmal automatisch versucht (für alle Geräte).
let running = false;
export async function autoFill(places, dest, save, { pause = 400 } = {}) {
  if (running) return;
  running = true;
  try {
    for (const p of places.filter((x) => !x.image && !x.imageTried)) {
      let img;
      try { img = await findImage(p, dest); } catch { break; } // gedrosselt: beim nächsten Öffnen weiter
      await save(p.id, img);
      await new Promise((r) => setTimeout(r, pause));
    }
  } finally { running = false; }
}
