// Gemeinsame Hilfen für den Server-Teil.
import { SCHEMA, MIGRATIONS } from './schema.js';

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const fail = (status, error) => json({ error }, status);

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ALPHA = 'abcdefghijkmnopqrstuvwxyz23456789';
export function rid(len = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => ALPHA[b % ALPHA.length]).join('');
}
export const newToken = () => rid(32);

export function b64uDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function b64uEncode(bytes) {
  let s = '';
  new Uint8Array(bytes).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Text säubern und kürzen
export function str(v, max = 500) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}
export const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const isTime = (v) => typeof v === 'string' && (v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v));
export const num = (v) => (v === null || v === '' || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

// Datum/Uhrzeit in einer Zeitzone
export function localParts(tz, now = Date.now()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysOf(trip) {
  if (!isDate(trip.start) || !isDate(trip.end)) return [];
  const out = [];
  for (let d = trip.start; d <= trip.end && out.length < 60; d = addDays(d, 1)) out.push(d);
  return out;
}

// Schema einmal pro Isolate (und Datenbank) sicherstellen
const schemaReady = new WeakMap();
export function ensureSchema(db) {
  if (!schemaReady.has(db)) {
    schemaReady.set(db, (async () => {
      const stmts = SCHEMA.split(';')
        .map((s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim())
        .filter(Boolean);
      await db.batch(stmts.map((s) => db.prepare(s)));
      await db.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)').run();
      const row = await db.prepare("SELECT v FROM meta WHERE k = 'version'").first();
      let version = row ? Number(row.v) : 0;
      for (let i = version; i < MIGRATIONS.length; i++) {
        for (const s of MIGRATIONS[i]) await db.prepare(s).run();
        version = i + 1;
      }
      await db.prepare("INSERT INTO meta (k, v) VALUES ('version', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(version)).run();
    })().catch((e) => { schemaReady.delete(db); throw e; }));
  }
  return schemaReady.get(db);
}
