// Welches Streckennetz passt zur Reise? Wird nur geladen, wenn die Orte in seinem Gebiet liegen.
import { makeRouter } from './router.js';

const NETWORKS = [
  { id: 'nyc', box: { s: 40.49, n: 40.92, w: -74.27, e: -73.68 }, load: () => import('./nyc.js') },
];
const loaded = {};
const inBox = (p, b) => p && Number.isFinite(p.lat) && p.lat > b.s && p.lat < b.n && p.lng > b.w && p.lng < b.e;

export function networkFor(points) {
  return NETWORKS.find((n) => points.filter(Boolean).some((p) => inBox(p, n.box))) || null;
}
export function routerFor(points) {
  const net = networkFor(points);
  if (!net) return Promise.resolve(null);
  return (loaded[net.id] ||= net.load().then((m) => makeRouter(m.default)));
}
// Für die Planung: (a, b, datum) → Minuten oder null
export const ttOf = (router) => (router ? (a, b, date) => router.trip(a, b, { date })?.min ?? null : null);
