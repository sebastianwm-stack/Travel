// Kleine Hilfen für die Oberfläche: Escaping, Icons, Datumsformate, Toast, Bottom-Sheet.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Links in Notizen klickbar machen (nach dem Escaping)
export const linkify = (s) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.length > 40 ? u.slice(0, 38) + '…' : u}</a>`);

const P = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const ICON = {
  today: P('<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>'),
  plan: P('<path d="M5 6h14M5 12h14M5 18h9"/>'),
  heart: P('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  heartFill: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round" d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  map: P('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  bag: P('<rect x="4" y="6" width="16" height="14" rx="3"/><path d="M9 6V4h6v2"/>'),
  chat: P('<path d="M4 5h16v11H9l-5 4z"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  close: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5c.7 5 3.5 8 9 9.5-5.5 1.5-8.3 4.5-9 9.5-.7-5-3.5-8-9-9.5 5.5-1.5 8.3-4.5 9-9.5z"/></svg>',
  route: P('<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>'),
  clip: P('<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>'),
  send: P('<path d="M4 12 20 4l-6 16-3-7z"/>'),
  check: P('<path d="m5 12 5 5 9-10"/>'),
  trash: P('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  edit: P('<path d="M4 20h4L20 8l-4-4L4 16z"/>'),
  bell: P('<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>'),
  link: P('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  refresh: P('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  plane: P('<path d="M3 13l18-7-5 14-4-5-5 3 1-5z"/>'),
  bed: P('<path d="M3 18V7M3 13h18v5M21 13a3 3 0 0 0-3-3h-7v3"/><circle cx="7" cy="10.5" r="1.5"/>'),
  car: P('<path d="M5 16h14M6 16l1.5-5h9L18 16M6 16v3M18 16v3"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/>'),
  doc: P('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>'),
  up: P('<path d="m6 15 6-6 6 6"/>'),
  down: P('<path d="m6 9 6 6 6-6"/>'),
  back: P('<path d="m15 6-6 6 6 6"/>'),
};

// ---------- Datum ----------
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WDL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MON = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
const dt = (iso) => new Date(iso + 'T12:00:00Z');
export const fmtChip = (iso) => { const d = dt(iso); return `${WD[d.getUTCDay()]} ${d.getUTCDate()}.`; };
export const fmtLong = (iso) => { const d = dt(iso); return `${WDL[d.getUTCDay()]}, ${d.getUTCDate()}. ${MON[d.getUTCMonth()]}`; };
export const fmtShort = (iso) => { const d = dt(iso); return `${WD[d.getUTCDay()]} ${d.getUTCDate()}. ${MON[d.getUTCMonth()]}`; };
export const weekday = (iso) => WDL[dt(iso).getUTCDay()];
export const dayNum = (iso) => dt(iso).getUTCDate();
export const monthName = (iso) => MON[dt(iso).getUTCMonth()];
export function todayIn(tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
export const daysBetween = (a, b) => Math.round((dt(b) - dt(a)) / 864e5);
export function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  return d === 1 ? 'gestern' : `vor ${d} Tagen`;
}

// ---------- Avatare ----------
export function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.22 ? '#161616' : '#FFFFFF';
}
export const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();
export function avatar(m, cls = '') {
  if (!m) return '';
  return `<i class="av ${cls}" style="background:${m.color};color:${textOn(m.color)}" title="${esc(m.name)}">${esc(initial(m.name))}</i>`;
}

// ---------- Toast ----------
let toastTimer;
export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------- Bottom-Sheet ----------
let sheetClose = null;
export function openSheet(html, { onMount, onClose, tall = false } = {}) {
  closeSheet();
  const root = document.getElementById('sheet');
  root.innerHTML = `<div class="scrim" data-close></div><section class="sheet ${tall ? 'tall' : ''}" role="dialog" aria-modal="true"><div class="grab" aria-hidden="true"></div>${html}</section>`;
  root.hidden = false;
  document.body.classList.add('locked');
  const sheet = root.querySelector('.sheet');
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheet));
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey);
  sheetClose = () => { document.removeEventListener('keydown', onKey); onClose?.(); };
  requestAnimationFrame(() => sheet.classList.add('in'));
  onMount?.(sheet);
  const first = sheet.querySelector('[autofocus]');
  if (first && matchMedia('(hover: hover)').matches) first.focus();
  return sheet;
}
export function closeSheet() {
  const root = document.getElementById('sheet');
  if (!root || root.hidden) return;
  root.hidden = true;
  root.innerHTML = '';
  document.body.classList.remove('locked');
  const f = sheetClose; sheetClose = null; f?.();
}
export const sheetOpen = () => !document.getElementById('sheet').hidden;
