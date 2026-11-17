// Benachrichtigungen (Abendbriefing, Nachrichten an alle) über Web Push.
import { api } from './api.js';

const FLAG = 'rb.push';
const b64ToBytes = (s) => {
  const b = atob((s + '==='.slice((s.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  try { return localStorage.getItem(FLAG) === 'on' && Notification.permission === 'granted' ? 'on' : 'off'; } catch { return 'off'; }
}

export async function enablePush() {
  const status = await api('/status');
  if (!status.push || !status.vapid) throw new Error('Benachrichtigungen sind auf dem Server noch nicht eingerichtet.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Ohne Erlaubnis keine Benachrichtigungen. Das lässt sich in den Einstellungen ändern.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(status.vapid) });
  await api('/push/subscribe', { method: 'POST', body: { endpoint: sub.endpoint, p256dh: toB64u(sub.getKey('p256dh')), auth: toB64u(sub.getKey('auth')) } });
  try { localStorage.setItem(FLAG, 'on'); } catch { /* egal */ }
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    }
  } finally {
    try { localStorage.removeItem(FLAG); } catch { /* egal */ }
  }
}

export const testPush = () => api('/push/test', { method: 'POST' });
