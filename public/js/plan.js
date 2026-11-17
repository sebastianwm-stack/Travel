// Plan: der Tag als Route auf der Karte, darunter die Stopps als wischbare Karten.
// Wer lieber liest, schaltet auf Liste um.
import { esc, ICON, fmtLong, toast, openSheet, weekday, dayNum, monthName } from './ui.js';
import { S, trip, stopsOf, pool, defaultDay, heartsOf, commentsOf } from './state.js';
import { dayChips, stopCard, sticker, avatars, empty, register, routeUrl, areaOf, photo } from './components.js';
import { thread, mountThread, openPlace, keepOpen } from './sheets.js';
import { loadLeaflet, baseMap, pin, hasCoords } from './map.js';

export const planUi = { day: null, mode: 'karte' };
let map = null;

function miniCard(p, i) {
  const hs = heartsOf(p.id);
  const nc = commentsOf(`place:${p.id}`).length;
  return `<article class="mini ${p.booked ? 'booked' : ''} ${p.image ? 'has-ph' : ''}" data-act="openPlace" data-id="${p.id}" data-i="${i}" tabindex="0">
    ${p.image ? `<div class="mini-ph">${photo(p)}</div>` : ''}
    <div class="mini-top"><span class="num">${i + 1}</span><span class="time">${esc(p.time || 'offen')}</span>${sticker(p.cat, 'sm')}${p.booked ? '<span class="okmini">gebucht</span>' : ''}</div>
    <h3>${esc(p.title)}</h3>
    <p class="ar">${esc(areaOf(p))}</p>
    <div class="ft">${avatars(hs)}${nc ? `<span class="cnt">${ICON.chat}${nc}</span>` : ''}<a class="go" href="${routeUrl(p)}" target="_blank" rel="noopener" data-stop>Route →</a></div>
  </article>`;
}

export function viewPlan() {
  const t = trip();
  if (!planUi.day || !t.days.includes(planUi.day)) planUi.day = defaultDay();
  const d = planUi.day;
  if (!d) return `<div class="top"><h1>Plan</h1></div><div class="page">${empty('Noch keine Reisedaten', 'Die Reiseleitung trägt Start und Ende unter Infos ein.')}</div>`;
  const stops = stopsOf(d);
  const notes = commentsOf(`day:${d}`).length;
  const head = `<div class="plan-head">
      <div class="plan-title"><h1><small>${dayNum(d)}. ${monthName(d)}</small>${weekday(d)}</h1>
        <div class="seg" role="group" aria-label="Ansicht"><button class="${planUi.mode === 'karte' ? 'on' : ''}" data-act="planMode" data-m="karte">Karte</button><button class="${planUi.mode === 'liste' ? 'on' : ''}" data-act="planMode" data-m="liste">Liste</button></div></div>
      ${dayChips(d)}
    </div>`;
  const tools = `<div class="plan-tools">
      <button class="btn sm" data-act="suggest" data-day="${d}">${ICON.spark}Vorschlag</button>
      <button class="btn sm" data-act="pickFromPool" data-day="${d}">${ICON.heart}Aus den Ideen</button>
      <button class="btn sm" data-act="dayNotes" data-day="${d}">${ICON.chat}Notizen${notes ? ` (${notes})` : ''}</button>
    </div>`;

  if (planUi.mode === 'liste') {
    return `<div class="plan-list">${head}<div class="page">${tools}
      ${stops.length ? `<div class="list">${stops.map((p) => stopCard(p)).join('')}</div>` : empty('Der Tag ist noch frei', 'Holt euch Orte aus den Ideen oder lasst einen Vorschlag machen.')}
    </div></div>`;
  }
  return `<div class="planmap">
    ${head}
    <div id="map" role="application" aria-label="Karte des Tages"></div>
    <div class="carousel-wrap">
      ${tools}
      <div class="carousel" data-carousel>
        ${stops.map(miniCard).join('')}
        <article class="mini add">
          <b>${stops.length ? 'Noch was?' : 'Der Tag ist noch frei'}</b>
          <p class="ar">${stops.length ? 'Weitere Orte für diesen Tag' : 'Holt euch Orte aus den Ideen oder lasst einen Vorschlag machen.'}</p>
          <div class="row-btns"><button class="btn sm primary" data-act="addIdea" data-day="${d}">${ICON.plus}Neuer Ort</button></div>
        </article>
      </div>
    </div>
  </div>`;
}

export async function mountPlan(root) {
  if (planUi.mode !== 'karte') { return; }
  const el = root.querySelector('#map');
  if (!el) return;
  let L;
  try { L = await loadLeaflet(); } catch (e) { el.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
  if (!el.isConnected) return;
  if (map) { map.remove(); map = null; }
  map = baseMap(L, el);
  const d = planUi.day;
  const stops = stopsOf(d).filter(hasCoords);
  const all = stopsOf(d);
  const markers = new Map();
  // Ideen ohne Tag blass im Hintergrund, damit man sieht, was in der Nähe liegt
  for (const p of pool().filter(hasCoords)) {
    const m = L.marker([p.lat, p.lng], { icon: pin(L, p, '', { faint: true }), title: p.title, keyboard: false }).addTo(map);
    m.on('click', () => openPlace(p.id));
  }
  stops.forEach((p) => {
    const i = all.indexOf(p);
    const m = L.marker([p.lat, p.lng], { icon: pin(L, p, String(i + 1)), title: p.title, zIndexOffset: 1000 }).addTo(map);
    m.on('click', () => scrollToCard(i));
    markers.set(i, { m, p });
  });
  if (stops.length > 1) L.polyline(stops.map((p) => [p.lat, p.lng]), { color: '#161616', weight: 4, opacity: 0.8, dashArray: '1 9', lineCap: 'round' }).addTo(map);
  const fitTo = stops.length ? stops : pool().filter(hasCoords);
  const bottomPad = root.querySelector('.carousel-wrap')?.offsetHeight || 200;
  if (fitTo.length) map.fitBounds(L.latLngBounds(fitTo.map((p) => [p.lat, p.lng])), { paddingTopLeft: [30, 150], paddingBottomRight: [30, bottomPad + 20], maxZoom: 15 });
  else map.setView([48.5, 10], 4);

  // Karte folgt der Karte im Karussell
  const car = root.querySelector('[data-carousel]');
  let active = -1;
  const setActive = (i) => {
    if (i === active) return;
    const prev = markers.get(active);
    if (prev) prev.m.setIcon(pin(L, prev.p, String(active + 1)));
    active = i;
    const cur = markers.get(i);
    if (cur) { cur.m.setIcon(pin(L, cur.p, String(i + 1), { active: true })); map.panTo([cur.p.lat, cur.p.lng], { animate: true }); }
    car.querySelectorAll('.mini').forEach((c) => c.classList.toggle('on', Number(c.dataset.i) === i));
  };
  let raf;
  car.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const mid = car.scrollLeft + car.clientWidth / 2;
      let best = -1, bestD = Infinity;
      car.querySelectorAll('.mini[data-i]').forEach((c) => {
        const dd = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
        if (dd < bestD) { bestD = dd; best = Number(c.dataset.i); }
      });
      if (best >= 0) setActive(best);
    });
  }, { passive: true });
  function scrollToCard(i) {
    const c = car.querySelector(`.mini[data-i="${i}"]`);
    if (c) car.scrollTo({ left: c.offsetLeft - (car.clientWidth - c.offsetWidth) / 2, behavior: 'smooth' });
    setActive(i);
  }
}

register({
  planMode: (el) => { planUi.mode = el.dataset.m; window.dispatchEvent(new Event('rb:render')); },
  pickDay: (el) => { planUi.day = el.dataset.day; if (location.hash !== '#/plan') location.hash = '#/plan'; else window.dispatchEvent(new Event('rb:render')); },
  gotoDay: (el) => { planUi.day = el.dataset.day; location.hash = '#/plan'; },
  dayNotes: (el) => {
    const d = el.dataset.day;
    keepOpen(() => {
      const sheet = openSheet(`<div class="sh-head"><h2>Notizen zu ${esc(fmtLong(d))}</h2><button class="icon" data-close aria-label="Schließen">${ICON.close}</button></div>
        ${thread(`day:${d}`, { placeholder: 'Treffpunkt, Tickets, Ideen …' })}`, { tall: true });
      mountThread(sheet);
    });
  },
});
