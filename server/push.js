// Web Push (VAPID, RFC 8292) mit Verschlüsselung der Nachricht auf dem Server (RFC 8291, aes128gcm).
// Anders als bei Maré schreibt hier der Server selbst das Abendbriefing, deshalb verschlüsselt er auch.
import { b64uDecode, b64uEncode } from './util.js';

const PUSH_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com'];

export function validEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}

export const pushReady = (env) => Boolean(env.VAPID_PUBLIC && env.VAPID_PRIVATE_JWK);

let signingKey = null;
async function vapidKey(env) {
  if (!signingKey) {
    const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
    signingKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  return signingKey;
}

export async function vapidJWT(env, audience, now = Date.now()) {
  const enc = (o) => b64uEncode(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'https://reisebande.pages.dev' })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(env), new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64uEncode(sig)}`;
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const te = (s) => new TextEncoder().encode(s);

// Verschlüsselt `text` für ein Abo { p256dh, auth } (beides base64url). Gibt den fertigen Body zurück.
export async function encryptPayload(sub, text, { salt, keyPair } = {}) {
  const uaPublic = b64uDecode(sub.p256dh);
  const authSecret = b64uDecode(sub.auth);
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  keyPair = keyPair || (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, keyPair.privateKey, 256));

  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, cat(te('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(te('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = cat(te(text), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return cat(header, cipher);
}

export async function sendPush(env, sub, message) {
  const body = await encryptPayload(sub, JSON.stringify(message));
  const jwt = await vapidJWT(env, new URL(sub.endpoint).origin);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '43200',
      urgency: 'normal',
    },
    body,
  });
  if (res.status >= 300) console.error('push', res.status, await res.text().catch(() => ''));
  return res.status;
}

// Wie sendPush, gibt aber Apples bzw. Googles Antwort mit zurück (für den Test-Knopf)
export async function sendPushVerbose(env, sub, message) {
  try {
    const body = await encryptPayload(sub, JSON.stringify(message));
    const jwt = await vapidJWT(env, new URL(sub.endpoint).origin);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`, 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '43200', urgency: 'normal' },
      body,
    });
    return { status: res.status, detail: res.status >= 300 ? (await res.text().catch(() => '')).slice(0, 200) : '' };
  } catch (e) {
    return { status: 0, detail: String(e?.message || e).slice(0, 200) };
  }
}

// An alle Abos einer Reise senden; tote Abos werden entfernt
export async function pushToTrip(env, tripId, message, { exceptMember } = {}) {
  if (!pushReady(env)) return { sent: 0 };
  const { results } = await env.DB.prepare(
    'SELECT s.* FROM push_subs s JOIN members m ON m.id = s.member_id WHERE m.trip_id = ?'
  ).bind(tripId).all();
  let sent = 0;
  for (const s of results) {
    if (exceptMember && s.member_id === exceptMember) continue;
    try {
      const status = await sendPush(env, s, message);
      if (status === 404 || status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(s.endpoint).run();
      else if (status < 300) sent++;
    } catch { /* nächstes Abo */ }
  }
  return { sent };
}
