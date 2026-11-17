// Kurzes Mitmach-Tutorial beim ersten Öffnen: wischen, Tag antippen, Vorschlag annehmen.
// Die Swipe-Karte ist echt: ein Wisch nach rechts vergibt ein Herz.
import { esc, ICON, avatar, weekday, dayNum } from './ui.js';
import { S, me, trip, mutate, heartsOf } from './state.js';
import { photo, resolveImages, areaOf, actions } from './components.js';
import { themeFor, skylineSVG, CATS } from './themes.js';
import { deck } from './swipe.js';
import { storyRing } from './story.js';

const KEY = 'rb.tour';
let step = 0;
let el = null;

export function maybeTour() {
  try { if (localStorage.getItem(KEY)) return; } catch { return; }
  start();
}
export function start() {
  el = document.getElementById('tour');
  step = 0;
  el.hidden = false;
  document.body.classList.add('locked');
  draw();
}
function finish(goSwipe) {
  try { localStorage.setItem(KEY, '1'); localStorage.setItem('rb.intro', '1'); } catch { /* egal */ }
  el.hidden = true;
  el.innerHTML = '';
  document.body.classList.remove('locked');
  window.dispatchEvent(new Event('rb:sheet-closed'));
  if (goSwipe) actions.goSwipe?.();
}
const next = () => { step++; draw(); };

function draw() {
  const t = trip();
  const th = themeFor(t);
  const others = S.data.members.filter((m) => m.id !== me().id);
  const dots = [0, 1, 2, 3, 4].map((i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('');
  let body = '';
  if (step === 0) {
    body = `<div class="tour-hero" style="--hero:${th.hero};--hero-ink:${th.ink};--orb:${th.orb}"><div class="orb"></div>${skylineSVG(th)}</div>
      <div class="tour-txt"><h2>Hallo ${esc(me().name)}!</h2>
      <p>Hier plant ihr ${esc(t.name)}${others.length ? ` zusammen: du, ${others.map((m) => esc(m.name)).join(', ')}` : ''}. Vier Dinge, dann geht es los.</p>
      <p class="avs big">${S.data.members.map((m) => avatar(m)).join('')}</p></div>
      <button class="btn primary big" data-next>Zeig mal</button>`;
  } else if (step === 1) {
    const p = deck()[0] || S.data.places.find((x) => !x.day);
    const c = p ? CATS[p.cat] || CATS.Sehen : CATS.Sehen;
    body = `<div class="tour-txt"><small>1 von 4</small><h2>Ideen swipen</h2><p>Wisch die Karte nach rechts, wenn du hinwillst, nach links, wenn nicht. Probier es aus.</p></div>
      ${p ? `<div class="tour-swipe"><article class="swcard demo" data-id="${p.id}" style="--bg:${c.bg};--fg:${c.fg};--d:0">
        <div class="sw-top with-ph">${photo(p, 'sw-ph')}</div>
        <div class="sw-title"><h2>${esc(p.title)}</h2>${areaOf(p) ? `<p>${esc(areaOf(p))}</p>` : ''}</div>
        <span class="stamp yes">Will ich</span><span class="stamp no">Eher nicht</span></article></div>
        <div class="tour-arrows"><span>← eher nicht</span><span>will ich →</span></div>` : '<button class="btn primary big" data-next>Weiter</button>'}`;
  } else if (step === 2) {
    body = `<div class="tour-txt"><small>2 von 4</small><h2>Tage als Stories</h2><p>Auf Heute steht jeder Tag als Kreis. Antippen und durch die Stopps blättern. Tipp einen an.</p></div>
      <div class="rings tour-rings">${t.days.slice(0, 4).map((d) => storyRing(d).replace('data-act="story"', 'data-tour-ring').replace('data-act="gotoDay"', 'data-tour-ring')).join('')}</div>`;
  } else if (step === 3) {
    const ideas = S.data.places.filter((x) => !x.day);
    const pick = (cat) => ideas.find((x) => x.cat === cat && x.image) || ideas.find((x) => x.cat === cat);
    const rows = [['Frühstück', pick('Café')], ['Vormittag', pick('Sehen')]].filter(([, p]) => p);
    const lunch = pick('Essen');
    body = `<div class="tour-txt"><small>3 von 4</small><h2>Plan ohne Stress</h2><p>Jeder Tag hat fünf lockere Abschnitte. Für freie Abschnitte schlägt die App etwas aus euren Ideen vor. Du tippst nur: passt oder andere.</p></div>
      <div class="tour-plan">
        ${rows.map(([l, p]) => `<div class="tour-slot"><b>${l}</b><div class="row-card"><div class="rc-ph">${photo(p)}</div><div class="rc-main"><b>${esc(p.title)}</b><span class="ar">${esc(areaOf(p))}</span></div></div></div>`).join('')}
        ${lunch ? `<div class="tour-slot"><b>Mittag</b><div class="sugcard"><div class="sc-ph">${photo(lunch)}</div><div class="sc-main"><small>Vorschlag</small><b>${esc(lunch.title)}</b>
          <div class="sc-btns"><button class="btn sm primary" data-next>${ICON.check}Passt</button><button class="btn sm" data-next>Andere</button></div></div></div></div>` : '<button class="btn primary big" data-next>Weiter</button>'}
      </div>`;
  } else {
    body = `<div class="tour-txt"><small>4 von 4</small><h2>Und sonst?</h2>
      <p>Im Plan hat jeder Tag Notizen, jeder Ort Kommentare und Fotos. Und unten am Bildschirm hilft der Reiseberater, wenn du nicht weiterweißt.</p></div>
      <button class="btn primary big" data-go>Los, Ideen swipen</button><button class="btn ghost wide" data-done>Erst mal umschauen</button>`;
  }
  el.innerHTML = `<div class="tour-in"><div class="tour-top"><span class="tour-dots">${dots}</span><button class="link" data-done>Überspringen</button></div>${body}</div>`;
  resolveImages(el);
  el.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', next));
  el.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', () => finish(false)));
  el.querySelector('[data-go]')?.addEventListener('click', () => finish(true));
  el.querySelectorAll('[data-tour-ring]').forEach((b) => b.addEventListener('click', () => { b.classList.add('pop'); setTimeout(next, 350); }));
  const card = el.querySelector('.swcard.demo');
  if (card) dragDemo(card);
}

function dragDemo(card) {
  let sx = 0, dx = 0, on = false;
  card.addEventListener('pointerdown', (e) => { on = true; sx = e.clientX; card.setPointerCapture(e.pointerId); card.style.transition = 'none'; });
  card.addEventListener('pointermove', (e) => {
    if (!on) return;
    dx = e.clientX - sx;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    card.classList.toggle('show-yes', dx > 40);
    card.classList.toggle('show-no', dx < -40);
  });
  const end = async () => {
    if (!on) return;
    on = false;
    if (Math.abs(dx) < 100) { card.style.transition = 'transform .2s ease-out'; card.style.transform = ''; card.classList.remove('show-yes', 'show-no'); return; }
    const yes = dx > 0;
    card.style.transition = 'transform .3s ease-in, opacity .3s';
    card.style.transform = `translateX(${yes ? 500 : -500}px) rotate(${yes ? 22 : -22}deg)`;
    card.style.opacity = '0';
    if (yes && !heartsOf(card.dataset.id).some((m) => m.id === me().id)) mutate(`/places/${card.dataset.id}/heart`, { method: 'POST' }).catch(() => {});
    setTimeout(next, 320);
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}
