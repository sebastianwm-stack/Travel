// Start, Einladung, Navigation, Reisewechsel und Aktualisierung.
import { api, getToken, setToken, forgetToken, rememberTrip, myTrips, cachedState, ApiError } from './api.js';
import { S, refresh, onChange, trip, me } from './state.js';
import { esc, ICON, toast, sheetOpen, closeSheet, openSheet, ago, fmtShort } from './ui.js';
import { actions } from './components.js';
import { viewToday, viewIdeas, viewInfos, mountView } from './views.js';
import { viewPlan, mountPlan } from './plan.js';
import { themeFor, skylineSVG } from './themes.js';
import { autoFill } from './images.js';
import './sheets.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');

const ROUTES = {
  heute: { label: 'Heute', icon: ICON.today, view: viewToday },
  plan: { label: 'Plan', icon: ICON.map, view: viewPlan, mount: mountPlan },
  ideen: { label: 'Ideen', icon: ICON.heart, view: viewIdeas },
  infos: { label: 'Infos', icon: ICON.bag, view: viewInfos },
};
const ALIAS = { karte: 'plan', reise: 'infos' };
const route = () => { const r = location.hash.replace(/^#\/?/, '').split('/')[0] || 'heute'; return ALIAS[r] || r; };

// ---------- Rendern ----------
let lastRoute = null;
function render({ soft = false } = {}) {
  if (!S.data) return;
  let r = route();
  if (!ROUTES[r]) r = 'heute';
  const keepScroll = soft || r === lastRoute;
  const y = window.scrollY;
  const active = document.activeElement;
  const searchFocus = active?.matches?.('[data-search]') ? active.selectionStart : null;
  app.innerHTML = (S.offlineSince ? `<div class="offline">Offline · Stand ${ago(S.offlineSince)}</div>` : '') + ROUTES[r].view() + installHint(r);
  document.body.dataset.route = r;
  mountView(app, r);
  ROUTES[r].mount?.(app);
  nav.innerHTML = Object.entries(ROUTES).map(([k, v]) => `<a href="#/${k}" class="${k === r ? 'on' : ''}" ${k === r ? 'aria-current="page"' : ''}>${v.icon}<span>${v.label}</span></a>`).join('');
  nav.hidden = false;
  if (searchFocus !== null) { const s = app.querySelector('[data-search]'); s?.focus(); s?.setSelectionRange(searchFocus, searchFocus); }
  if (keepScroll && r !== 'plan') window.scrollTo(0, y); else window.scrollTo(0, 0);
  lastRoute = r;
}

function installHint(r) {
  if (r !== 'heute') return '';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  let dismissed = false;
  try { dismissed = localStorage.getItem('rb.hint') === '1'; } catch { /* egal */ }
  if (standalone || dismissed) return '';
  return `<div class="hintbar"><p>${ios ? 'In Safari auf Teilen tippen und Zum Home-Bildschirm wählen.' : 'Im Browser-Menü Zum Startbildschirm hinzufügen wählen.'} Dann liegt die App neben deinen anderen Apps und kann Benachrichtigungen schicken.</p><button class="icon" data-act="hideHint" aria-label="Ausblenden">${ICON.close}</button></div>`;
}

window.addEventListener('hashchange', () => { closeSheet(); render(); });
window.addEventListener('rb:render', () => render({ soft: true }));
onChange(() => render({ soft: true }));

// Klicks zentral verteilen
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-stop]')) { e.stopPropagation(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.tagName !== 'INPUT') e.preventDefault();
  fn(el, e);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('input[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el, e);
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('article[data-act]');
  if (el && e.target === el) { e.preventDefault(); actions[el.dataset.act]?.(el, e); }
});

// ---------- Reisen wechseln, neue Reise, Einladen ----------
function switchTo(token) {
  setToken(token);
  S.data = null;
  history.replaceState(null, '', `/?k=${token}#/heute`);
  closeSheet();
  boot();
}

function openTrips() {
  const list = myTrips();
  const cur = getToken();
  const isAdmin = me()?.role === 'admin';
  const sheet = openSheet(`<div class="sh-head"><h2>Deine Reisen</h2><button class="icon" data-close aria-label="Schließen">${ICON.close}</button></div>
    <div class="members">${list.map((t) => `<button class="mem trip-pick ${t.token === cur ? 'on' : ''}" data-token="${esc(t.token)}"><span><b>${esc(t.name || 'Reise')}</b><small>${esc(t.dest || '')}${t.token === cur ? ' · gerade offen' : ''}</small></span></button>`).join('')}</div>
    ${isAdmin ? `<details class="edit"><summary>${ICON.plus} Neue Reise anlegen</summary>
      <form class="form" data-newtrip>
        <label>Name<input name="name" required maxlength="120" placeholder="z. B. Lissabon mit Freunden"></label>
        <label>Wohin?<input name="dest" maxlength="120" placeholder="Lissabon"></label>
        <div class="two"><label>Von<input type="date" name="start"></label><label>Bis<input type="date" name="end"></label></div>
        <button class="btn primary">Anlegen</button>
        <p class="hint">Die neue Reise ist von dieser getrennt. Wer mitkommt, bekommt dort einen eigenen Einladungslink.</p>
      </form></details>` : ''}`);
  sheet.querySelectorAll('.trip-pick').forEach((b) => b.addEventListener('click', () => switchTo(b.dataset.token)));
  sheet.querySelector('[data-newtrip]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api('/trips', { method: 'POST', body: { trip: { name: f.name, dest: f.dest, start: f.start || null, end: f.end || null } } });
      switchTo(r.links[0].token);
      toast('Neue Reise angelegt. Lade unter Infos die anderen ein.', 4000);
    } catch (err) { toast(err.message); }
  });
}

function openInvite() {
  const draw = (code, multi) => {
    const url = code ? `${location.origin}/?join=${code}` : '';
    const sheet = openSheet(`<div class="sh-head"><h2>Einladen</h2><button class="icon" data-close aria-label="Schließen">${ICON.close}</button></div>
      ${!code ? `<p class="hint">Wer den Link öffnet, tippt den eigenen Namen an oder gibt ihn ein und ist dabei. Andere Reisen sieht niemand.</p>
        <button class="btn primary big" data-mk="0">${ICON.link}Link für eine Person</button>
        <p class="hint">Gilt einmal und 14 Tage lang. Für jede Person einen eigenen Link erstellen.</p>
        <button class="btn big" data-mk="1">${ICON.link}Link für die ganze Gruppe</button>
        <p class="hint">Gilt beliebig oft, 14 Tage lang. Praktisch für eine Gruppen-Chat-Nachricht.</p>`
      : `<p class="hint">${multi ? 'Gilt 14 Tage für alle, die ihn bekommen.' : 'Gilt für eine Person und 14 Tage lang.'}</p>
        <input class="linkbox" readonly value="${esc(url)}">
        <div class="row-btns">${navigator.share ? `<button class="btn primary" data-share>${ICON.send}Teilen</button>` : ''}<button class="btn" data-copy>${ICON.link}Kopieren</button><button class="btn ghost" data-again>Noch einen</button></div>`}`);
    sheet.querySelectorAll('[data-mk]').forEach((b) => b.addEventListener('click', async () => {
      try { const r = await api('/invites', { method: 'POST', body: { multi: b.dataset.mk === '1' } }); draw(r.code, r.multi); } catch (e) { toast(e.message); }
    }));
    sheet.querySelector('[data-copy]')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); toast('Link kopiert'); } catch { sheet.querySelector('.linkbox').select(); } });
    sheet.querySelector('[data-share]')?.addEventListener('click', () => navigator.share({ text: `Komm mit nach ${trip().dest || trip().name}! Hier planen wir zusammen: ${url}` }).catch(() => {}));
    sheet.querySelector('[data-again]')?.addEventListener('click', () => draw(null));
  };
  draw(null);
}

Object.assign(actions, {
  hideHint: () => { try { localStorage.setItem('rb.hint', '1'); } catch { /* egal */ } render({ soft: true }); },
  trips: openTrips,
  invite: openInvite,
});

// ---------- Startbildschirme ----------
function screen(html) {
  nav.hidden = true;
  app.innerHTML = `<div class="gate">${html}</div>`;
}

function noAccessScreen(msg = '') {
  const known = myTrips();
  screen(`<div class="gate-card"><h1>Reisebande</h1>
    <p>${esc(msg || 'Hier planen Familie und Freunde gemeinsam ihre Reise. Zum Mitmachen brauchst du einen Einladungslink von der Reiseleitung.')}</p>
    <form data-paste class="form"><label>Einladungslink einfügen<input name="link" inputmode="url" placeholder="https://…" autofocus></label><button class="btn primary big">Weiter</button></form>
    ${known.length ? `<p class="hint">Oder zu einer deiner Reisen:</p>${known.map((t) => `<button class="btn wide" data-token="${esc(t.token)}">${esc(t.name || 'Reise')}</button>`).join('')}` : ''}</div>`);
  app.querySelector('[data-paste]').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = e.target.link.value.trim();
    const join = v.match(/[?&]join=([a-z0-9]{8,40})/i);
    const k = v.match(/[?&]k=([a-z0-9]{20,})/i);
    if (join) { history.replaceState(null, '', `/?join=${join[1]}`); boot(); }
    else if (k) switchTo(k[1]);
    else toast('Das sieht nicht nach einem Einladungslink aus.');
  });
  app.querySelectorAll('[data-token]').forEach((b) => b.addEventListener('click', () => switchTo(b.dataset.token)));
}

async function joinScreen(code) {
  let info;
  try { info = await api(`/invite/${code}`, { token: '' }); }
  catch (e) { return noAccessScreen(e.message); }
  const t = info.trip;
  const already = myTrips().find((x) => x.id === t.id);
  if (already) { toast('Du bist schon dabei'); return switchTo(already.token); }
  const th = themeFor(t);
  nav.hidden = true;
  app.innerHTML = `<header class="hero join" style="--hero:${th.hero};--hero-ink:${th.ink};--orb:${th.orb}"><div class="orb" aria-hidden="true"></div>${skylineSVG(th)}
    <div class="hero-in"><span class="pill">Einladung${info.by ? ` von ${esc(info.by)}` : ''}</span>
      <h1>${esc(t.name)}</h1>${t.start ? `<p class="sub">${fmtShort(t.start)} bis ${fmtShort(t.end)}</p>` : ''}</div></header>
    <div class="page join-body">
      ${info.seats.length ? `<h2>Wer bist du?</h2><div class="seats">${info.seats.map((s) => `<button class="seat" data-seat="${s.id}" style="--c:${s.color}"><i></i>${esc(s.name)}</button>`).join('')}</div>
        <p class="hint">Oder du bist neu dabei:</p>` : '<h2>Wie heißt du?</h2>'}
      <form class="form" data-join><label>Dein Name<input name="name" maxlength="40" placeholder="Vorname" ${info.seats.length ? '' : 'autofocus'}></label><button class="btn primary big">Mitmachen</button></form>
    </div>`;
  const done = (r) => { setToken(r.token); history.replaceState(null, '', `/?k=${r.token}#/heute`); boot(); };
  app.querySelectorAll('[data-seat]').forEach((b) => b.addEventListener('click', async () => {
    try { done(await api('/join', { method: 'POST', token: '', body: { code, seat: b.dataset.seat } })); } catch (e) { toast(e.message); }
  }));
  app.querySelector('[data-join]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) { toast('Wie heißt du?'); return; }
    try { done(await api('/join', { method: 'POST', token: '', body: { code, name } })); } catch (err) { toast(err.message); }
  });
}

function setupScreen() {
  screen(`<div class="gate-card"><h1>Neue Reise</h1><p>Noch gibt es hier keine Reise. Leg die erste an, danach lädst du die anderen per Link ein.</p>
    <form data-setup class="form">
      <label>Wie heißt die Reise?<input name="name" required placeholder="z. B. New York" maxlength="120"></label>
      <label>Wohin?<input name="dest" placeholder="New York" maxlength="120"></label>
      <div class="two"><label>Von<input type="date" name="start"></label><label>Bis<input type="date" name="end"></label></div>
      <label>Dein Name<input name="me" required placeholder="Vorname" maxlength="40"></label>
      <button class="btn primary big">Reise anlegen</button>
    </form>
    <p class="hint">Oder eine vorbereitete Reise-Datei laden:</p>
    <label class="btn wide">Datei wählen (.json)<input type="file" accept="application/json,.json" hidden data-file></label></div>`);
  const done = (r) => {
    const admin = r.links.find((l) => l.role === 'admin') || r.links[0];
    switchTo(admin.token);
  };
  app.querySelector('[data-setup]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { done(await api('/setup', { method: 'POST', token: '', body: { trip: { name: f.name, dest: f.dest, start: f.start || null, end: f.end || null }, members: [{ key: 'me', name: f.me, role: 'admin' }] } })); }
    catch (err) { toast(err.message); }
  });
  app.querySelector('[data-file]').addEventListener('change', async (e) => {
    try { done(await api('/setup', { method: 'POST', token: '', body: JSON.parse(await e.target.files[0].text()) })); }
    catch (err) { toast(err.message || 'Die Datei ließ sich nicht lesen.'); }
  });
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const join = params.get('join');
  if (join) return joinScreen(join);
  const k = params.get('k');
  if (k && k !== getToken()) setToken(k);
  if (!getToken()) {
    try {
      const st = await api('/status', { token: '' });
      if (!st.setup) return setupScreen();
    } catch { /* offline */ }
    return noAccessScreen();
  }
  const cached = cachedState();
  if (cached?.s && !S.data) { S.data = cached.s; render(); }
  try {
    const d = await refresh();
    rememberTrip(getToken(), d.trip);
    fillImagesLater();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      forgetToken(getToken());
      S.data = null;
      if (getToken()) return switchTo(getToken());
      return noAccessScreen('Dieser Link gilt nicht mehr. Frag die Reiseleitung nach einem neuen.');
    }
    if (cached?.s) { S.offlineSince = cached.at; render(); }
    else screen(`<div class="gate-card"><h1>Keine Verbindung</h1><p>${esc(e.message)}</p><button class="btn primary" data-reload>Nochmal versuchen</button></div>`);
    app.querySelector('[data-reload]')?.addEventListener('click', () => location.reload());
  }
}

// Bilder für Orte im Hintergrund suchen (im Browser, siehe images.js)
function fillImagesLater() {
  const missing = S.data.places.filter((p) => !p.image && !p.imageTried);
  if (!missing.length) return;
  setTimeout(() => autoFill(S.data.places, trip().dest, async (id, img) => {
    await api(`/places/${id}`, { method: 'PATCH', body: img ? { image: img.url, imageCredit: { t: img.credit, l: img.link } } : { imageTried: true } }).catch(() => {});
  }).then(() => refresh().catch(() => {})), 1500);
}

// Regelmäßig auffrischen, solange die App sichtbar ist
setInterval(() => { if (document.visibilityState === 'visible' && S.data && !sheetOpen() && document.getElementById('story').hidden) refresh().catch(() => {}); }, 30000);
let loadedVersion = null;
async function checkVersion() {
  try {
    const v = (await (await fetch('/version.txt', { cache: 'no-store' })).text()).trim();
    if (loadedVersion && v !== loadedVersion) location.reload();
    loadedVersion = v;
  } catch { /* offline */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  checkVersion();
  if (S.data) refresh().catch(() => {});
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
checkVersion();
boot();
