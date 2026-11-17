// Plan: zwei Ansichten eines Tages.
//  Ablauf: fünf lockere Abschnitte (Frühstück bis Abend); freie Abschnitte zeigen einen Vorschlag aus den Ideen.
//  Karte: der Tag als Route, darunter die Stopps als wischbare Karten.
import { esc, ICON, fmtLong, toast, openSheet, weekday, dayNum, monthName } from './ui.js';
import { S, trip, stopsOf, pool, defaultDay, heartsOf, commentsOf, place, mutate, SLOTS, SLOT_LABEL, slotOf, whenLabel, localPlace } from './state.js';
import { api } from './api.js';
import { dayChips, stopCard, sticker, avatars, empty, register, routeUrl, areaOf, photo } from './components.js';
import { thread, mountThread, openPlace, keepOpen } from './sheets.js';
import { loadMapLib, baseMap, addPin, addRoute, addHome, hasCoords } from './map.js';
import { routerFor } from './transit/index.js';

export const planUi = { day: null, mode: 'ablauf', draft: null, stamp: '', loading: false, alt: {}, skip: new Set() };
let map = null;

function miniCard(p, i) {
  const hs = heartsOf(p.id);
  const nc = commentsOf(`place:${p.id}`).length;
  return `<article class="mini has-ph ${p.booked ? 'booked' : ''}" data-act="openPlace" data-id="${p.id}" data-i="${i}" tabindex="0">
    <div class="mini-ph">${photo(p)}</div>
    <div class="mini-top"><span class="num">${i + 1}</span><span class="time">${esc(whenLabel(p))}</span>${sticker(p.cat, 'sm')}${p.booked ? '<span class="okmini">gebucht</span>' : ''}</div>
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
        <div class="seg" role="group" aria-label="Ansicht"><button class="${planUi.mode === 'ablauf' ? 'on' : ''}" data-act="planMode" data-m="ablauf">Ablauf</button><button class="${planUi.mode === 'karte' ? 'on' : ''}" data-act="planMode" data-m="karte">Karte</button></div></div>
      ${dayChips(d)}
    </div>`;
  const tools = `<div class="plan-tools">
      <button class="btn sm" data-act="suggest">${ICON.spark}Reise vorplanen</button>
      <button class="btn sm" data-act="pickFromPool" data-day="${d}">${ICON.heart}Aus den Ideen</button>
      <button class="btn sm" data-act="dayNotes" data-day="${d}">${ICON.chat}Notizen${notes ? ` (${notes})` : ''}</button>
    </div>`;

  if (planUi.mode === 'ablauf') return `<div class="plan-list">${head}<div class="page">${tools}${ablauf(d)}</div></div>`;
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

// ---------- Ablauf ----------
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const SLOT_IC = {
  frueh: I('<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2M11 3v2"/>'),
  vormittag: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>'),
  mittag: I('<path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 3c-2 1-3 4-3 7h3v11"/>'),
  nachmittag: I('<path d="M3 17h18M6 17a6 6 0 0 1 12 0M12 5v3M5 9l2 1.5M19 9l-2 1.5"/>'),
  abend: I('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
};
function daySlotsOf(d) {
  const t = trip();
  const base = d === t.start ? ['abend'] : d === t.end ? ['frueh', 'vormittag'] : SLOTS;
  const used = new Set(stopsOf(d).map(slotOf).filter(Boolean));
  return SLOTS.filter((s) => base.includes(s) || used.has(s));
}
const HOME_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/></svg>';
const stampOf = () => S.data.places.map((p) => `${p.id}${p.day || ''}${p.slot || ''}${p.time || ''}`).join() + S.data.hearts.length + JSON.stringify(trip().hotel);

function ensureDraft() {
  const st = stampOf();
  if (planUi.stamp === st || planUi.loading) return;
  planUi.loading = true;
  api('/plan/draft', { method: 'POST', body: {} })
    .then((r) => { planUi.draft = r.draft; planUi.stamp = st; planUi.alt = {}; })
    .catch(() => {})
    .finally(() => { planUi.loading = false; window.dispatchEvent(new Event('rb:render')); });
}
// Aktueller Vorschlag für einen Abschnitt (mit "Andere" durchblättern)
function suggestionFor(d, slot) {
  const key = `${d}:${slot}`;
  if (planUi.skip.has(key)) return null;
  const e = planUi.draft?.[d]?.[slot];
  if (!e) return null;
  const list = [e.pick, ...e.alts].map(place).filter((p) => p && !p.day);
  if (!list.length) return null;
  return { p: list[(planUi.alt[key] || 0) % list.length], n: list.length };
}

// ---------- Wege zwischen den Stopps (U-Bahn-Fahrplan, sonst nichts) ----------
let router = { trip: null, r: null, loading: false };
function ensureRouter() {
  const t = trip();
  if (router.trip === t.id || router.loading) return;
  router.loading = true;
  routerFor([t.hotel, ...S.data.places]).then((r) => { router = { trip: t.id, r, loading: false }; if (r) window.dispatchEvent(new Event('rb:render')); })
    .catch(() => { router = { trip: t.id, r: null, loading: false }; });
}
const WALK_IC = I('<circle cx="13" cy="4" r="2"/><path d="m9 21 2-6 3 3v3M10 12l1-4 3 2 3 1M11 8l-3 2-1 4"/>');
const TRAIN_IC = I('<rect x="5" y="3" width="14" height="14" rx="4"/><path d="M5 11h14M8 21l2-4M16 21l-2-4"/><circle cx="9" cy="14" r=".6"/><circle cx="15" cy="14" r=".6"/>');
// Weg zwischen zwei Stopps: empfohlene Art zuerst, bei Wegen bis 35 Min. zu Fuß auch die andere Möglichkeit
function leg(a, b, d, sug = false) {
  if (!router.r || !a || !b || !hasCoords(a) || !hasCoords(b)) return '';
  const r = router.r.trip(a, b, { date: d });
  if (!r) return '';
  const url = (mode) => `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=${mode}`;
  const walkOpt = r.walk ? `<a class="leg-o" href="${url('walking')}" target="_blank" rel="noopener" data-stop aria-label="${r.walk.min} Minuten zu Fuß">${WALK_IC}<span>${r.walk.min} Min. zu Fuß</span></a>` : '';
  const t = r.transit;
  const trainOpt = t ? `<a class="leg-o" href="${url('transit')}" target="_blank" rel="noopener" data-stop aria-label="${t.min} Minuten mit Linie ${t.lines.map((l) => l.name).join(', ')} ab ${esc(t.from)}">${TRAIN_IC}<span>${t.min} Min. ${t.lines.map((l) => `<i class="ln" style="background:${l.color};color:${l.text}">${esc(l.name)}</i>`).join('')}${r.mode === 'transit' ? `<small>ab ${esc(t.from)}</small>` : ''}</span></a>` : '';
  // die andere Möglichkeit nur, wenn sie eine echte Wahl ist (Bahn kaum langsamer, Laufweg nicht zu lang)
  const showOther = r.mode === 'walk' ? t && r.walk.min >= 10 && t.min <= r.walk.min + 5 : r.walk && r.walk.min <= 35;
  const first = r.mode === 'walk' ? walkOpt : trainOpt;
  const other = showOther ? (r.mode === 'walk' ? trainOpt : walkOpt) : '';
  return `<div class="leg ${sug ? 'to-sug' : ''} ${r.min >= 45 ? 'long' : ''}">${first}${other ? `<span class="leg-alt"><em>oder</em>${other}</span>` : ''}</div>`;
}

function rowCard(p) {
  const hs = heartsOf(p.id);
  return `<article class="row-card ${p.booked ? 'booked' : ''}" data-act="openPlace" data-id="${p.id}" tabindex="0">
    <div class="rc-ph">${photo(p)}</div>
    <div class="rc-main"><b>${esc(p.title)}</b><span class="ar">${esc([p.time, areaOf(p)].filter(Boolean).join(' · '))}</span>
      <span class="rc-ft">${sticker(p.cat, 'sm')}${p.booked ? '<span class="okmini">gebucht</span>' : ''}${avatars(hs, 'xs')}</span></div>
  </article>`;
}

function ablauf(d) {
  ensureDraft();
  ensureRouter();
  const t = trip();
  const stops = stopsOf(d);
  // Route des Tages: Unterkunft → Stopps und Vorschläge → Unterkunft
  let last = t.hotel && d !== t.start ? t.hotel : null;
  const step = (p, sug) => { const h = leg(last, p, d, sug); if (hasCoords(p)) last = p; return h; };
  const loose = stops.filter((p) => !slotOf(p));
  let anySug = false;
  const sections = daySlotsOf(d).map((slot) => {
    const here = stops.filter((p) => slotOf(p) === slot);
    let body = here.map((p) => step(p) + rowCard(p)).join('');
    if (!here.length) {
      const sg = suggestionFor(d, slot);
      if (sg) {
        anySug = true;
        const hs = heartsOf(sg.p.id);
        body = step(sg.p, true) + `<div class="sugcard">
          <div class="sc-ph" data-act="openPlace" data-id="${sg.p.id}">${photo(sg.p)}</div>
          <div class="sc-main"><small>Vorschlag</small><b data-act="openPlace" data-id="${sg.p.id}">${esc(sg.p.title)}</b>
            <span class="ar">${esc([areaOf(sg.p), hs.length ? `${hs.map((m) => m.name).join(', ')} ${hs.length === 1 ? 'will' : 'wollen'} hin` : ''].filter(Boolean).join(' · '))}</span>
            <div class="sc-btns"><button class="btn sm primary" data-act="sugTake" data-day="${d}" data-slot="${slot}" data-id="${sg.p.id}">${ICON.check}Passt</button>
              ${sg.n > 1 ? `<button class="btn sm" data-act="sugNext" data-day="${d}" data-slot="${slot}">${ICON.refresh}Andere</button>` : ''}
              <button class="icon" data-act="sugSkip" data-day="${d}" data-slot="${slot}" aria-label="Frei lassen">${ICON.close}</button></div></div>
        </div>`;
      } else {
        body = `<p class="slot-free">${planUi.loading && !planUi.draft ? 'Suche Vorschläge …' : 'Frei. Zeit zum Treibenlassen.'}</p>`;
      }
    }
    return `<section class="slot ${here.length ? 'filled' : ''}"><div class="slot-h"><span class="slot-ic" aria-hidden="true">${SLOT_IC[slot]}</span><h3>${SLOT_LABEL[slot]}</h3>
      <button class="slot-add" data-act="addIdea" data-day="${d}" data-slot="${slot}" aria-label="Ort für ${SLOT_LABEL[slot]} hinzufügen">${ICON.plus}</button></div>${body}</section>`;
  }).join('');
  const back = t.hotel ? leg(last, t.hotel, d) : '';
  const hint = d === t.start ? '<p class="hint">Anreisetag: Ankunft am späten Nachmittag, nach der Einreise bleibt der Abend.</p>'
    : d === t.end ? '<p class="hint">Abreisetag: Der Vormittag ist noch frei, abends geht der Flug.</p>' : '';
  const home = t.hotel ? `<div class="home-row">${HOME_IC}<span>${esc(t.hotel.name)}</span></div>` : '';
  return `${hint}
    ${anySug ? `<button class="btn primary wide" data-act="sugTakeAll" data-day="${d}">${ICON.check}Alle Vorschläge für ${weekday(d)} übernehmen</button>` : ''}
    <div class="slots">${home && d !== t.start ? home.replace('home-row', 'home-row start') : ''}${sections}${home ? back + home.replace('home-row', 'home-row end') : ''}</div>
    ${loose.length ? `<section class="slot"><div class="slot-h"><span class="slot-ic" aria-hidden="true">${I('<circle cx="12" cy="12" r="3"/>')}</span><h3>Irgendwann</h3></div>${loose.map(rowCard).join('')}</section>` : ''}`;
}

export async function mountPlan(root) {
  if (planUi.mode !== 'karte') return;
  const el = root.querySelector('#map');
  if (!el) return;
  let ml;
  try { ml = await loadMapLib(); } catch (e) { el.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
  if (!el.isConnected) return;
  if (map) { map.remove(); map = null; }
  map = baseMap(ml, el);
  const d = planUi.day;
  const all = stopsOf(d);
  const stops = all.filter(hasCoords);
  const markers = new Map();
  // Ideen ohne Tag blass im Hintergrund, damit man sieht, was in der Nähe liegt
  for (const p of pool().filter(hasCoords)) addPin(ml, map, p, '', { faint: true, onClick: () => openPlace(p.id) });
  stops.forEach((p) => {
    const i = all.indexOf(p);
    markers.set(i, { m: addPin(ml, map, p, String(i + 1), { onClick: () => scrollToCard(i) }), p });
  });
  const hotel = trip().hotel;
  if (hotel) addHome(ml, map, hotel);
  // Route: morgens von der Unterkunft los, abends dorthin zurück
  const path = hotel && stops.length ? [hotel, ...stops, hotel] : stops;
  if (path.length > 1) addRoute(map, path);
  const fitTo = stops.length ? (hotel ? [...stops, hotel] : stops) : hotel ? [hotel, ...pool().filter(hasCoords)] : pool().filter(hasCoords);
  const bottomPad = root.querySelector('.carousel-wrap')?.offsetHeight || 200;
  if (fitTo.length) {
    const b = new ml.LngLatBounds();
    fitTo.forEach((p) => b.extend([p.lng, p.lat]));
    map.fitBounds(b, { padding: { top: 170, bottom: bottomPad + 30, left: 50, right: 50 }, maxZoom: 12.8, duration: 0 });
  }

  // Karte folgt der Karte im Karussell
  const car = root.querySelector('[data-carousel]');
  let active = -1;
  const setActive = (i) => {
    if (i === active) return;
    markers.get(active)?.m.getElement().classList.remove('active');
    active = i;
    const cur = markers.get(i);
    if (cur) {
      cur.m.getElement().classList.add('active');
      // nur verschieben, wenn der Ort nicht ohnehin gut sichtbar ist; Zoom bleibt
      const pt = map.project([cur.p.lng, cur.p.lat]);
      const h = el.clientHeight, w = el.clientWidth, bottom = h - bottomPad - 20;
      if (!(pt.x > 40 && pt.x < w - 40 && pt.y > 170 && pt.y < bottom)) {
        map.easeTo({ center: [cur.p.lng, cur.p.lat], offset: [0, (170 - bottomPad) / 2], duration: 450 });
      }
    }
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

window.addEventListener('rb:goto-day', (e) => { planUi.day = e.detail; window.dispatchEvent(new Event('rb:render')); });

register({
  sugTake: async (el) => {
    const mv = { id: el.dataset.id, day: el.dataset.day, slot: el.dataset.slot };
    mutate('/plan/apply', { method: 'POST', body: { moves: [mv] } }, localPlace(mv.id, { day: mv.day, slot: mv.slot, time: '' })).catch((e) => toast(e.message));
  },
  sugNext: (el) => { const k = `${el.dataset.day}:${el.dataset.slot}`; planUi.alt[k] = (planUi.alt[k] || 0) + 1; window.dispatchEvent(new Event('rb:render')); },
  sugSkip: (el) => { planUi.skip.add(`${el.dataset.day}:${el.dataset.slot}`); window.dispatchEvent(new Event('rb:render')); },
  sugTakeAll: async (el) => {
    const d = el.dataset.day;
    const moves = daySlotsOf(d).map((slot) => ({ slot, sg: suggestionFor(d, slot) })).filter((x) => x.sg && !stopsOf(d).some((p) => slotOf(p) === x.slot))
      .map((x) => ({ id: x.sg.p.id, day: d, slot: x.slot }));
    if (!moves.length) return;
    mutate('/plan/apply', { method: 'POST', body: { moves } }, (data) => moves.forEach((m) => localPlace(m.id, { day: m.day, slot: m.slot, time: '' })(data))).catch((e) => toast(e.message));
    toast(`${moves.length} Orte für ${weekday(d)} eingeplant`);
  },
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
