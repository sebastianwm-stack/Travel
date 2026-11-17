// Stories: ein Tag als Folge von Vollbild-Seiten, eine pro Stopp. Tippen rechts/links blättert.
import { esc, ICON, weekday, dayNum, monthName, avatar } from './ui.js';
import { S, trip, stopsOf, heartsOf, commentsOf, whenLabel } from './state.js';
import { CATS, themeFor, skylineSVG } from './themes.js';
import { routeUrl, areaOf, photo, resolveImages } from './components.js';
import { openPlace } from './sheets.js';

let state = null;

export function openStory(day) {
  const stops = stopsOf(day);
  state = { day, stops, i: 0 };
  markSeen(day);
  const el = document.getElementById('story');
  el.hidden = false;
  document.body.classList.add('locked');
  draw();
  el.focus();
}

function close() {
  const el = document.getElementById('story');
  el.hidden = true;
  el.innerHTML = '';
  document.body.classList.remove('locked');
  state = null;
}

function draw() {
  const el = document.getElementById('story');
  const { day, stops, i } = state;
  const t = trip();
  const n = stops.length + 1; // Titelseite + Stopps
  const bars = Array.from({ length: n }, (_, k) => `<i class="${k < i ? 'done' : k === i ? 'now' : ''}"></i>`).join('');
  let slide;
  let fg = '#fff';
  if (i === 0) {
    const th = themeFor(t);
    fg = th.ink;
    const idx = t.days.indexOf(day);
    slide = `<div class="slide cover" style="--bg:${th.hero};--fg:${th.ink};--orb:${th.orb}">
      ${stops.length ? `<div class="collage n${Math.min(4, stops.length)}">${stops.slice(0, 4).map((p) => photo(p)).join('')}</div>` : `<div class="orb" aria-hidden="true"></div>${skylineSVG(th)}`}
      <div class="slide-in">
        <p class="kick">Tag ${idx + 1} von ${t.days.length}</p>
        <h2>${weekday(day)},<br>${dayNum(day)}. ${monthName(day)}</h2>
        <p class="lead">${stops.length ? `${stops.length} ${stops.length === 1 ? 'Stopp' : 'Stopps'}: ${stops.slice(0, 4).map((p) => esc(p.title.replace(/\s*\(.*\)/, ''))).join(', ')}${stops.length > 4 ? ' …' : ''}` : 'Noch nichts geplant.'}</p>
        ${stops.length ? '<p class="tap">Tippen zum Weiterblättern</p>' : `<button class="btn" data-plan-day="${day}" data-noflip>Tag planen</button>`}
      </div></div>`;
  } else {
    const p = stops[i - 1];
    const c = CATS[p.cat] || CATS.Sehen;
    fg = c.fg;
    const hs = heartsOf(p.id);
    const nc = commentsOf(`place:${p.id}`).length;
    slide = `<div class="slide stop with-ph" style="--bg:${c.bg};--fg:${c.fg}">
      <div class="slide-ph">${photo(p)}</div>
      <div class="slide-in">
        <p class="kick">${esc(whenLabel(p))}${p.booked ? ' · gebucht' : ''}</p>
        <span class="st big" style="background:var(--fg);color:var(--bg)">${esc(p.cat)}</span>
        <h2>${esc(p.title)}</h2>
        ${areaOf(p) ? `<p class="lead">${esc(areaOf(p))}</p>` : ''}
        ${p.note ? `<p class="quote">${esc(p.note)}</p>` : ''}
        ${hs.length ? `<p class="who">${hs.map((m) => avatar(m)).join('')}<span>${hs.map((m) => esc(m.name)).join(', ')} ${hs.length === 1 ? 'will' : 'wollen'} hin</span></p>` : ''}
      </div>
      <div class="slide-act">
        <a class="btn" href="${routeUrl(p)}" target="_blank" rel="noopener" data-noflip>${ICON.route}Route</a>
        <button class="btn" data-detail="${p.id}" data-noflip>${ICON.chat}${nc ? `${nc} Kommentare` : 'Details'}</button>
      </div></div>`;
  }
  el.style.setProperty('--sfg', fg);
  el.innerHTML = `<div class="story-bars">${bars}</div>
    <button class="story-x" data-noflip aria-label="Schließen">${ICON.close}</button>
    ${slide}
    <button class="flip prev" aria-label="Zurück"></button><button class="flip next" aria-label="Weiter"></button>`;
  resolveImages(el);
  el.querySelector('[data-plan-day]')?.addEventListener('click', (e) => { const d = e.currentTarget.dataset.planDay; close(); location.hash = '#/plan'; window.dispatchEvent(new CustomEvent('rb:goto-day', { detail: d })); });
  el.querySelector('.story-x').addEventListener('click', close);
  el.querySelector('.flip.prev').addEventListener('click', () => go(-1));
  el.querySelector('.flip.next').addEventListener('click', () => go(1));
  el.querySelector('[data-detail]')?.addEventListener('click', (e) => { const id = e.currentTarget.dataset.detail; close(); openPlace(id); });
}

function go(dir) {
  if (!state) return;
  const n = state.stops.length + 1;
  const next = state.i + dir;
  if (next < 0) return;
  if (next >= n) { close(); return; }
  state.i = next;
  draw();
}

document.addEventListener('keydown', (e) => {
  if (!state) return;
  if (e.key === 'Escape') close();
  if (e.key === 'ArrowRight') go(1);
  if (e.key === 'ArrowLeft') go(-1);
});

// Nach unten wischen schließt
let startY = null;
document.addEventListener('touchstart', (e) => { if (state) startY = e.touches[0].clientY; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!state || startY === null) return;
  if (e.changedTouches[0].clientY - startY > 90) close();
  startY = null;
}, { passive: true });

// Gesehen-Status je Tag: ändert sich der Tag (andere Stopps), ist er wieder neu
const seenKey = (day) => `rb.seen.${day}`;
const dayHash = (day) => stopsOf(day).map((p) => p.id + (p.time || '')).join(',');
const isSeen = (day) => { try { return localStorage.getItem(seenKey(day)) === dayHash(day); } catch { return false; } };
export const markSeen = (day) => { try { localStorage.setItem(seenKey(day), dayHash(day)); } catch { /* egal */ } };

export function storyRing(day) {
  const stops = stopsOf(day);
  const label = `${weekday(day).slice(0, 2)} ${dayNum(day)}.`;
  if (!stops.length) {
    return `<button class="ring ring-free" data-act="gotoDay" data-day="${day}" aria-label="${weekday(day)} planen">
      <span class="ring-c"><span class="ring-in"><b>+</b></span></span><small>${label}</small></button>`;
  }
  const cols = stops.map((p) => (CATS[p.cat] || CATS.Sehen).bg);
  const seg = 360 / cols.length;
  const ring = `conic-gradient(${cols.map((c, k) => `${c} ${k * seg}deg ${(k + 1) * seg}deg`).join(', ')})`;
  const cover = stops.find((p) => p.image) || stops[0];
  return `<button class="ring ${isSeen(day) ? 'seen' : ''}" data-act="story" data-day="${day}" aria-label="${weekday(day)}, ${stops.length} Stopps ansehen">
    <span class="ring-c" style="--ring:${ring}"><span class="ring-in">${photo(cover)}</span><i class="ring-n">${stops.length}</i></span><small>${label}</small></button>`;
}
