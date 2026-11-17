// Wiederverwendbare Bausteine: Kopf mit Skyline, Ortskarten, Tageschips, Sticker.
import { esc, ICON, avatar, fmtChip } from './ui.js';
import { CATS } from './themes.js';
import { S, heartsOf, iHeart, commentsOf, trip, member } from './state.js';
import { themeFor, skylineSVG } from './themes.js';
import { fileUrl } from './api.js';

export const actions = {};
export const register = (obj) => Object.assign(actions, obj);

export function sticker(cat, extra = '') {
  const c = CATS[cat] || CATS.Sehen;
  return `<span class="st ${extra}" style="background:${c.bg};color:${c.fg}">${esc(cat)}</span>`;
}

export function avatars(list, cls = '') {
  return list.length ? `<span class="avs ${cls}">${list.map((m) => avatar(m)).join('')}</span>` : '';
}

export function hero({ pill, title, sub, badge }) {
  const th = themeFor(trip());
  const members = S.data.members;
  return `<header class="hero" style="--hero:${th.hero};--hero-ink:${th.ink};--orb:${th.orb}">
    <div class="orb" aria-hidden="true"></div>
    ${skylineSVG(th)}
    <div class="hero-in">
      <div class="hero-row"><button class="pill" data-act="trips" aria-label="Reise wechseln">${esc(pill)}<span aria-hidden="true">▾</span></button>${avatars(members, 'on-hero')}</div>
      <h1>${title}</h1>
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
      ${badge ? `<span class="badge">${esc(badge)}</span>` : ''}
    </div>
  </header>`;
}

export function dayChips(selected, { withPool = false, counts = true } = {}) {
  const days = trip().days;
  const c = (d) => S.data.places.filter((p) => p.day === d).length;
  return `<div class="chips days" role="tablist">
    ${days.map((d) => `<button class="chip ${d === selected ? 'on' : ''}" role="tab" aria-selected="${d === selected}" data-act="pickDay" data-day="${d}">${fmtChip(d)}${counts ? `<small>${c(d)}</small>` : ''}</button>`).join('')}
    ${withPool ? `<button class="chip ${selected === 'pool' ? 'on' : ''}" data-act="pickDay" data-day="pool">Ohne Tag<small>${S.data.places.filter((p) => !p.day).length}</small></button>` : ''}
  </div>`;
}

export const areaOf = (p) => (p.area && p.area.trim().toLowerCase() !== p.title.trim().toLowerCase() ? p.area : '');

// Bild eines Ortes: https-Link direkt, eigenes Foto (file:<id>) wird nachgeladen
export function photo(p, cls = '') {
  if (!p.image) return '';
  const alt = esc(p.title);
  if (p.image.startsWith('file:')) return `<img class="ph ${cls}" data-file-img="${esc(p.image.slice(5))}" alt="${alt}">`;
  return `<img class="ph ${cls}" src="${esc(p.image)}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}
export function resolveImages(root) {
  root.querySelectorAll('img[data-file-img]').forEach(async (img) => {
    try { img.src = await fileUrl(img.dataset.fileImg); } catch { img.remove(); }
  });
  root.querySelectorAll('img.ph').forEach((img) => img.addEventListener('error', () => img.classList.add('broken'), { once: true }));
}

export function routeUrl(p) {
  if (Number.isFinite(p.lat) && !p.approx) return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${p.title} ${p.area || ''} ${trip().dest || ''}`.trim())}`;
}

export function stopCard(p, { walkAfter = '' } = {}) {
  const hs = heartsOf(p.id);
  const nc = commentsOf(`place:${p.id}`).length;
  return `<article class="card ${p.booked ? 'booked' : ''} ${p.image ? 'has-ph' : ''}" data-act="openPlace" data-id="${p.id}" tabindex="0">
    ${p.booked ? '<span class="ok">gebucht ✓</span>' : ''}
    ${p.image ? `<div class="card-ph">${photo(p)}</div>` : ''}
    <div class="card-top"><span class="time">${esc(p.time || 'offen')}</span>${sticker(p.cat)}</div>
    <h3 class="ti">${esc(p.title)}</h3>
    ${areaOf(p) ? `<p class="ar">${esc(areaOf(p))}</p>` : ''}
    ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
    <div class="ft">${avatars(hs)}${nc ? `<span class="cnt">${ICON.chat}${nc}</span>` : ''}
      <a class="go" href="${routeUrl(p)}" target="_blank" rel="noopener" data-stop>Route →</a></div>
  </article>${walkAfter}`;
}

export function ideaCard(p) {
  const hs = heartsOf(p.id);
  const mine = iHeart(p.id);
  const nc = commentsOf(`place:${p.id}`).length;
  const by = member(p.createdBy);
  return `<article class="idea" data-act="openPlace" data-id="${p.id}" tabindex="0">
    ${p.image ? `<div class="idea-ph">${photo(p)}</div>` : ''}
    <div class="idea-main">
      <div class="card-top">${sticker(p.cat)}${p.day ? `<span class="daytag">${fmtChip(p.day)}${p.time ? ' · ' + esc(p.time) : ''}</span>` : ''}</div>
      <h3 class="ti sm">${esc(p.title)}</h3>
      <p class="ar">${esc(p.area || '')}${by && p.source !== 'import' ? ` · von ${esc(by.name)}` : ''}</p>
      <div class="ft">${avatars(hs)}${nc ? `<span class="cnt">${ICON.chat}${nc}</span>` : ''}</div>
    </div>
    <button class="heart ${mine ? 'on' : ''}" data-act="toggleHeart" data-id="${p.id}" aria-pressed="${mine}" aria-label="${mine ? 'Herz entfernen' : 'Herz geben'}">${mine ? ICON.heartFill : ICON.heart}<span>${hs.length || ''}</span></button>
  </article>`;
}

export function empty(title, text, btn = '') {
  return `<div class="empty"><b>${esc(title)}</b><p>${esc(text)}</p>${btn}</div>`;
}
