// Ideen swipen: rechts = will ich (Herz), links = eher nicht. Wenn alle ein Herz vergeben haben: Match.
import { esc, ICON, avatar, toast } from './ui.js';
import { S, me, member, pool, heartsOf, iHeart, mutate, localHeart, commentsOf } from './state.js';
import { CATS } from './themes.js';
import { register, areaOf, photo, mapsUrl, blurbHTML } from './components.js';
import { openPlace } from './sheets.js';

const nopeKey = () => `rb.nope.${S.data.me.id}`;
function nopes() { try { return new Set(JSON.parse(localStorage.getItem(nopeKey()) || '[]')); } catch { return new Set(); } }
function saveNopes(set) { try { localStorage.setItem(nopeKey(), JSON.stringify([...set])); } catch { /* egal */ } }

// Noch nicht bewertete Ideen: ohne Tag, ohne mein Herz, nicht weggewischt
// Auf der Karte ohne Links (z. B. "Weitere Filiale: https://…"), die stehen vollständig im Ort-Fenster
// Neben der Kurzinfo nur Notizen von Leuten aus der Gruppe ("Anni: …"), keine Stichworte wie "Thai"
const showNote = (p) => { const n = cardNote(p.note); return Boolean(n) && (!p.blurb || /^[A-ZÄÖÜ][\wäöüß]+: /.test(n)); };
const cardNote = (n) => String(n || '').split('\n').filter((l) => !/^Weitere Filiale/.test(l)).join(' ').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();

export function deck() {
  const no = nopes();
  return pool().filter((p) => !iHeart(p.id) && !no.has(p.id))
    .sort((a, b) => heartsOf(b.id).length - heartsOf(a.id).length || a.title.localeCompare(b.title, 'de'));
}

let history = [];

function cardHTML(p, depth) {
  const c = CATS[p.cat] || CATS.Sehen;
  const hs = heartsOf(p.id);
  const by = member(p.createdBy);
  return `<article class="swcard" data-id="${p.id}" style="--bg:${c.bg};--fg:${c.fg};--d:${depth}" ${depth === 0 ? 'tabindex="0"' : 'aria-hidden="true"'}>
    <div class="sw-top with-ph">
      ${photo(p, 'sw-ph')}
      <span class="st big" style="background:var(--fg);color:var(--bg)">${esc(p.cat)}</span>
    </div>
    <div class="sw-title"><h2>${esc(p.title)}</h2>${areaOf(p) ? `<p>${esc(areaOf(p))}</p>` : ''}
      <a class="gm" href="${mapsUrl(p)}" target="_blank" rel="noopener" data-stop>In Google Maps ansehen →</a></div>
    <div class="sw-body">
      ${blurbHTML(p)}
      ${showNote(p) ? `<p class="note">${esc(cardNote(p.note))}</p>` : ''}
      ${commentsOf(`place:${p.id}`).slice(-2).map((c) => `<p class="sw-cmt"><b>${esc(member(c.by)?.name || '')}:</b> ${esc(c.body || 'hat ein Foto geteilt')}</p>`).join('')}
      ${!p.note && !commentsOf(`place:${p.id}`).length ? '<p class="hint">Noch keine Notiz. Über die Sprechblase unten kannst du eine schreiben.</p>' : ''}
      ${hs.length ? `<p class="who">${hs.map((m) => avatar(m)).join('')} ${hs.map((m) => esc(m.name)).join(', ')} ${hs.length === 1 ? 'will' : 'wollen'} hin</p>`
        : by && p.source !== 'import' ? `<p class="who">${avatar(by)} von ${esc(by.name)}</p>` : ''}
    </div>
    <span class="stamp yes">Will ich</span><span class="stamp no">Eher nicht</span>
  </article>`;
}

export function swipeHTML() {
  const list = deck();
  const total = pool().length;
  if (!list.length) {
    return `<div class="sw-done"><b>Alles bewertet</b><p>Du hast dich durch alle ${total} Ideen gewischt. Neue Ideen tauchen hier automatisch auf.</p>
      <div class="row-btns center"><button class="btn" data-act="ideasMode" data-m="alle">Alle Ideen ansehen</button>${nopes().size ? '<button class="btn ghost" data-act="resetNopes">Weggewischte nochmal zeigen</button>' : ''}</div></div>`;
  }
  return `<div class="sw-wrap">
    <p class="sw-count">${list.length} von ${total} Ideen warten auf dich</p>
    <div class="sw-stack" data-stack>${list.slice(0, 3).map((p, i) => cardHTML(p, i)).reverse().join('')}</div>
    <div class="sw-btns">
      <button class="swb no" data-act="swipeNo" aria-label="Eher nicht">${ICON.close}</button>
      <button class="swb undo" data-act="swipeUndo" aria-label="Rückgängig" ${history.length ? '' : 'disabled'}>${ICON.back}</button>
      <button class="swb info" data-act="swipeInfo" aria-label="Details">${ICON.chat}</button>
      <button class="swb yes" data-act="swipeYes" aria-label="Will ich">${ICON.heartFill}</button>
    </div>
  </div>`;
}

async function decide(id, yes) {
  if (yes) {
    try {
      const p = mutate(`/places/${id}/heart`, { method: 'POST' }, localHeart(id));
      history.push({ id, yes });
      const n = heartsOf(id).length;
      if (n === S.data.members.length && n > 1) match(id);
      await p;
    } catch (e) { toast(e.message); }
  } else {
    const no = nopes(); no.add(id); saveNopes(no);
    history.push({ id, yes });
    window.dispatchEvent(new Event('rb:render'));
  }
}

function match(id) {
  const p = S.data.places.find((x) => x.id === id);
  const el = document.getElementById('match');
  el.innerHTML = `<div class="match-in"><span class="match-st">Match!</span><b>${esc(p.title)}</b><p>Alle ${S.data.members.length} wollen hin.</p>
    <p class="avs big">${S.data.members.map((m) => avatar(m)).join('')}</p></div>`;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 2200);
  el.onclick = () => { el.hidden = true; };
}

function fly(card, yes) {
  card.style.transition = 'transform .32s ease-in, opacity .32s ease-in';
  card.style.transform = `translate(${yes ? 520 : -520}px, -40px) rotate(${yes ? 24 : -24}deg)`;
  card.style.opacity = '0';
  card.classList.add(yes ? 'show-yes' : 'show-no');
  setTimeout(() => decide(card.dataset.id, yes), 160);
}

export function mountSwipe(root) {
  const stack = root.querySelector('[data-stack]');
  if (!stack) return;
  const card = stack.lastElementChild; // oberste Karte
  if (!card) return;
  let sx = 0, sy = 0, dx = 0, dragging = false;
  card.addEventListener('pointerdown', (e) => { if (e.target.closest('a')) return; dragging = true; sx = e.clientX; sy = e.clientY; dx = 0; card.setPointerCapture(e.pointerId); card.style.transition = 'none'; });
  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - sx;
    const dy = (e.clientY - sy) * 0.3;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    card.classList.toggle('show-yes', dx > 40);
    card.classList.toggle('show-no', dx < -40);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(dx) > 100) fly(card, dx > 0);
    else if (Math.abs(dx) < 6) { card.style.transform = ''; openPlace(card.dataset.id); }
    else { card.style.transition = 'transform .2s ease-out'; card.style.transform = ''; card.classList.remove('show-yes', 'show-no'); }
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') fly(card, true);
    if (e.key === 'ArrowLeft') fly(card, false);
  });
}

register({
  swipeYes: () => { const c = document.querySelector('[data-stack] .swcard:last-child'); if (c) fly(c, true); },
  swipeNo: () => { const c = document.querySelector('[data-stack] .swcard:last-child'); if (c) fly(c, false); },
  swipeInfo: () => { const c = document.querySelector('[data-stack] .swcard:last-child'); if (c) openPlace(c.dataset.id); },
  swipeUndo: async () => {
    const last = history.pop();
    if (!last) return;
    if (last.yes) mutate(`/places/${last.id}/heart`, { method: 'POST' }, localHeart(last.id)).catch((e) => toast(e.message));
    else { const no = nopes(); no.delete(last.id); saveNopes(no); window.dispatchEvent(new Event('rb:render')); }
  },
  resetNopes: () => { saveNopes(new Set()); window.dispatchEvent(new Event('rb:render')); },
});
