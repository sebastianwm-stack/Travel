// Ortssuche beim Tippen über Photon (komoot, OpenStreetMap-Daten, ohne Schlüssel).
// Liefert Name, Gegend, genaue Lage und eine passende Kategorie.
const CAT_BY = [
  [(k, v) => k === 'amenity' && /^(restaurant|fast_food|food_court|biergarten)$/.test(v), 'Essen'],
  [(k, v) => (k === 'amenity' && /^(cafe|ice_cream)$/.test(v)) || (k === 'shop' && /^(bakery|pastry|coffee|confectionery)$/.test(v)), 'Café'],
  [(k, v) => k === 'amenity' && /^(bar|pub|nightclub)$/.test(v), 'Nachts'],
  [(k, v) => (k === 'amenity' && /^(theatre|cinema|arts_centre)$/.test(v)) || (k === 'tourism' && /^(museum|gallery)$/.test(v)), 'Kultur'],
  [(k, v) => k === 'leisure' && /^(park|garden|nature_reserve)$/.test(v), 'Natur'],
  [(k) => k === 'shop', 'Shopping'],
];
function catOf(props) {
  if (/bagel|bakery|caf[eé]|coffee|donut|patisserie|bread/i.test(props.name || '')) return 'Café';
  const hit = CAT_BY.find(([f]) => f(props.osm_key, props.osm_value));
  return hit ? hit[1] : 'Sehen';
}

export async function searchPlaces(q, near) {
  const params = new URLSearchParams({ q, limit: '8', lang: 'en' });
  if (near) { params.set('lat', near.lat.toFixed(4)); params.set('lon', near.lng.toFixed(4)); }
  const res = await fetch(`https://photon.komoot.io/api/?${params}`);
  if (!res.ok) throw new Error('Die Suche ist gerade nicht erreichbar.');
  const data = await res.json();
  const seen = new Set();
  return (data.features || []).map((f) => {
    const p = f.properties;
    const street = [p.street, p.housenumber].filter(Boolean).join(' ');
    return {
      title: p.name || street,
      area: p.district || p.locality || p.suburb || p.city || '',
      address: [street, p.district || p.locality, p.city].filter(Boolean).join(', '),
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], cat: catOf(p),
    };
  }).filter((r) => {
    const key = `${r.title}|${r.address}`;
    if (!r.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
