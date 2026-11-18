// Hauptansichten: Heute, Ideen, Infos. Der Plan liegt in plan.js. Klicks laufen über data-act.
import { esc, ICON, avatar, fmtChip, fmtShort, weekday, dayNum, monthName, ago, toast, openSheet, closeSheet } from './ui.js';
import { S, trip, me, member, place, stopsOf, pool, phase, heartsOf, mutate, commentsOf, frame, matchPlaces } from './state.js';
import { weatherInfo, weatherLine } from './weather.js';
import { hero, stopCard, ideaCard, sticker, avatars, empty, register, photo, resolveImages } from './components.js';
import { showLink } from './sheets.js';
import { storyRing, openStory } from './story.js';
import { deck, swipeHTML, mountSwipe } from './swipe.js';
import { CATS, CAT_NAMES, THEMES } from './themes.js';
import { api } from './api.js';
import { searchPlaces } from './search.js';
import { pushState, enablePush, disablePush, testPush } from './push.js';

export const ui = { cat: 'Alle', onlyOpen: true, q: '', ideasMode: null, limit: 40 };

const askBar = () => `<button class="askbar" data-act="ask">${ICON.spark}<span>Frag den Reiseberater …</span><b>Fragen</b></button>`;
const shortTitle = (s) => s.replace(/\s*\(.*\)/, '');

// ---------- HEUTE ----------
export function viewToday() {
  const t = trip();
  const ph = phase();
  const booked = S.data.places.filter((p) => p.booked).sort((a, b) => (a.day || '').localeCompare(b.day || ''));
  let h;
  let body = '';

  if (ph.kind === 'during') {
    const stops = stopsOf(ph.today);
    const nowHM = new Intl.DateTimeFormat('de-DE', { timeZone: t.tz, hour: '2-digit', minute: '2-digit' }).format(new Date());
    const next = stops.find((p) => p.time && p.time >= nowHM);
    h = hero({
      pill: `${t.dest || t.name} · Tag ${ph.index + 1} von ${t.days.length}`,
      title: `${weekday(ph.today)},<br>${dayNum(ph.today)}. ${monthName(ph.today)}`,
      sub: `${stops.length} ${stops.length === 1 ? 'Stopp' : 'Stopps'} geplant`,
      badge: next ? `Gleich: ${next.time} ${shortTitle(next.title).split(' ').slice(0, 3).join(' ')}` : '',
    });
    body += todayFrame(ph.today);
    body += storiesRow();
    body += announceBlock();
    body += next ? `<section class="block"><div class="block-h"><h2>Als Nächstes</h2></div>${stopCard(next)}</section>` : '';
    body += stops.length ? '' : empty('Heute ist noch frei', 'Holt euch was aus den Ideen oder lasst euch einen Vorschlag machen.', `<button class="btn primary" data-act="suggest" data-day="${ph.today}">${ICON.spark}Vorschlag für heute</button>`);
  } else if (ph.kind === 'after') {
    h = hero({ pill: t.dest || t.name, title: 'Schön<br>war es.', sub: `${S.data.comments.length} Notizen und ${Object.keys(S.data.files).length} Fotos und Dateien` });
    body += storiesRow('Eure Tage zum Nachblättern');
  } else {
    const n = ph.days;
    h = hero({
      pill: `${t.dest || t.name}${t.start ? ` · ${fmtChip(t.start)} bis ${fmtChip(t.end)}` : ''}`,
      title: n === 1 ? 'Morgen<br>geht es los' : n ? `Noch<br>${n} Tage` : esc(t.name),
      sub: `${S.data.members.map((m) => m.name).join(', ')}`,
      badge: booked.length ? `${shortTitle(booked[0].title).split(' ').slice(0, 2).join(' ')} gebucht` : '',
    });
    body += storiesRow();
    body += weatherRow();
    body += swipeTeaser();
    body += favorites();
    body += newsBlock();
  }
  return `${h}<div class="page">${body}</div>${askBar()}`;
}

// Wetter für alle Reisetage (vor der Reise)
function weatherRow() {
  const t = trip();
  const list = t.days.map((d) => [d, weatherInfo(d)]).filter(([, w]) => w);
  if (!list.length) return '';
  const typical = list.every(([, w]) => w.typical);
  return `<section class="block"><div class="block-h"><h2>Wetter</h2><small class="muted">${typical ? `üblich für die Tage, Vorhersage ab ${fmtShort(list[0][1].from)}` : 'Vorhersage'}</small></div>
    <div class="wx-days">${list.map(([d, w]) => `<a class="wx-day" href="#/plan" data-act="gotoDay" data-day="${d}">${w.icon}<b>${fmtChip(d)}</b><span>${w.short}</span></a>`).join('')}</div></section>`;
}
// Während der Reise: Wetter, und am An- bzw. Abreisetag die Zeiten
function todayFrame(day) {
  const t = trip();
  const fr = frame();
  let out = weatherLine(day, 'today');
  if (fr.arrive && day === t.start) out += `<div class="trip-row">${ICON.plane}<span><b>Landung ${esc(fr.arrive.land)}${fr.arrive.airport ? ` in ${esc(fr.arrive.airport)}` : ''}</b><small>Im Hotel ca. ${esc(fr.arrive.hotelAt)}, Check-in ab ${esc(fr.arrive.checkin)}</small></span></div>`;
  if (fr.leave && day === t.end) out += `<div class="trip-row go">${ICON.plane}<span><b>Ab zum Flughafen um ${esc(fr.leave.leaveAt)}</b><small>Check-out bis ${esc(fr.leave.checkout)}, Abflug ${esc(fr.leave.dep)}${fr.leave.airport ? ` in ${esc(fr.leave.airport)}` : ''}</small></span></div>`;
  return out ? `<section class="block today-frame">${out}</section>` : '';
}

function storiesRow(title = 'Eure Tage') {
  const t = trip();
  if (!t.days.length) return '';
  return `<section class="block"><div class="block-h"><h2>${title}</h2><a class="link" href="#/plan">Auf der Karte</a></div>
    <div class="rings">${t.days.map((d, i) => storyRing(d, i)).join('')}</div></section>`;
}

function swipeTeaser() {
  const n = deck().length;
  if (!n) return '';
  const next = deck()[0];
  const c = CATS[next.cat] || CATS.Sehen;
  return `<button class="teaser" data-act="goSwipe" style="--bg:${c.bg};--fg:${c.fg}">
    <span class="teaser-stack" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="teaser-t"><b>${n} Ideen warten auf dein Urteil</b><small>Nach rechts heißt will ich, nach links eher nicht</small></span>
    <span class="teaser-go">Los</span></button>`;
}

function favorites() {
  const n = S.data.members.length;
  const ranked = S.data.places.map((p) => ({ p, h: heartsOf(p.id) })).filter((x) => x.h.length >= 2)
    .sort((a, b) => b.h.length - a.h.length || a.p.title.localeCompare(b.p.title, 'de')).slice(0, 8);
  if (!ranked.length) return '';
  return `<section class="block"><div class="block-h"><h2>Lieblinge der Bande</h2></div>
    <div class="favs">${ranked.map(({ p, h }) => `<button class="fav has-ph" data-act="openPlace" data-id="${p.id}" style="--bg:${(CATS[p.cat] || CATS.Sehen).bg};--fg:${(CATS[p.cat] || CATS.Sehen).fg}">${photo(p, 'fav-ph')}
      ${h.length === n ? '<span class="fav-m">alle</span>' : ''}<b>${esc(shortTitle(p.title))}</b><span class="avs xs">${h.map((m) => avatar(m)).join('')}</span>
      ${p.day ? `<small>${fmtChip(p.day)}</small>` : '<small>noch ohne Tag</small>'}</button>`).join('')}</div></section>`;
}

function newsBlock() {
  const mine = me().id;
  const news = [...S.data.comments].filter((c) => c.by !== mine).sort((a, b) => b.at - a.at).slice(0, 4);
  const fresh = [...S.data.places].filter((p) => p.createdBy && p.createdBy !== mine && p.source !== 'import').sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  const items = [
    ...news.map((c) => ({ at: c.at, html: newsComment(c) })),
    ...fresh.map((p) => ({ at: p.createdAt, html: `<button class="news" data-act="openPlace" data-id="${p.id}">${avatar(member(p.createdBy))}<span><b>${esc(member(p.createdBy)?.name)}</b> hat <b>${esc(p.title)}</b> zu den Ideen gelegt<small>${ago(p.createdAt)}</small></span></button>` })),
  ].sort((a, b) => b.at - a.at).slice(0, 5);
  return `<section class="block"><div class="block-h"><h2>Neu in der Bande</h2></div>
    ${items.map((x) => x.html).join('') || '<p class="hint">Sobald jemand etwas kommentiert oder eine Idee einträgt, steht es hier.</p>'}
    <button class="btn wide ghost" data-act="announce">${ICON.bell}Nachricht an alle</button></section>`;
}
function newsComment(c) {
  const m = member(c.by);
  let where = 'an alle';
  let act = '';
  if (c.target.startsWith('place:')) { const p = place(c.target.slice(6)); where = p ? `zu ${esc(p.title)}` : ''; act = p ? `data-act="openPlace" data-id="${p.id}"` : ''; }
  else if (c.target.startsWith('day:')) { where = `zu ${fmtShort(c.target.slice(4))}`; act = `data-act="gotoDay" data-day="${c.target.slice(4)}"`; }
  const text = c.body || (c.file ? 'hat eine Datei angehängt' : '');
  return `<button class="news" ${act}>${avatar(m)}<span><b>${esc(m?.name || '')}</b> ${where}: ${esc(text.slice(0, 120))}<small>${ago(c.at)}</small></span></button>`;
}

function announceBlock() {
  const recent = commentsOf('trip').filter((c) => Date.now() - c.at < 24 * 3600e3).slice(-3).reverse();
  return `<section class="block tight">
    ${recent.map((c) => `<div class="announce">${avatar(member(c.by))}<p><b>${esc(member(c.by)?.name || '')}:</b> ${esc(c.body)}<small>${ago(c.at)}</small></p></div>`).join('')}
    <button class="btn wide ghost" data-act="announce">${ICON.bell}Nachricht an alle, zum Beispiel ein Treffpunkt</button></section>`;
}

// ---------- IDEEN ----------
export function viewIdeas() {
  if (!ui.ideasMode) ui.ideasMode = deck().length ? 'swipen' : 'alle';
  const seg = `<div class="seg" role="group" aria-label="Ansicht"><button class="${ui.ideasMode === 'swipen' ? 'on' : ''}" data-act="ideasMode" data-m="swipen">Swipen</button><button class="${ui.ideasMode === 'alle' ? 'on' : ''}" data-act="ideasMode" data-m="alle">Alle</button></div>`;
  const top = `<div class="top"><h1>Ideen</h1><div class="top-r">${seg}<button class="icon solid" data-act="addIdea" aria-label="Neue Idee">${ICON.plus}</button></div></div>`;
  if (ui.ideasMode === 'swipen') return `${top}<div class="page">${swipeHTML()}</div>`;

  const t = trip();
  const all = S.data.places;
  const base = ui.onlyOpen ? all.filter((p) => !p.day) : all;
  const q = ui.q.trim().toLowerCase();
  const counts = Object.fromEntries(CAT_NAMES.map((c) => [c, base.filter((p) => p.cat === c).length]));
  const list = ideasList(base);
  const synced = t.mapsSyncedAt ? `zuletzt ${ago(t.mapsSyncedAt)}` : 'noch nie abgeglichen';
  return `${top}
    <div class="page">
      <input class="search" type="search" placeholder="Suchen …" value="${esc(ui.q)}" data-search aria-label="Ideen durchsuchen">
      <div class="chips wrap">
        <button class="chip ${ui.cat === 'Alle' ? 'on' : ''}" data-act="pickCat" data-cat="Alle">Alle<small>${base.length}</small></button>
        <button class="chip ${ui.cat === 'Meine' ? 'on' : ''}" data-act="pickCat" data-cat="Meine">${ICON.heart}Meine</button>
        ${CAT_NAMES.filter((c) => counts[c]).map((c) => `<button class="chip cat ${ui.cat === c ? 'on' : ''}" style="--c:${CATS[c].bg}" data-act="pickCat" data-cat="${c}">${c}<small>${counts[c]}</small></button>`).join('')}
      </div>
      <label class="switch small"><input type="checkbox" data-act="toggleOpen" ${ui.onlyOpen ? 'checked' : ''}> Nur Ideen ohne Tag</label>
      <div data-results>${ideasResults(list, q)}</div>
      ${t.mapsSyncedAt ? `<p class="foot">Neue Orte aus eurer Google-Maps-Liste kommen automatisch dazu. Zuletzt ${ago(t.mapsSyncedAt)}.</p>` : ''}
    </div>${askBar()}`;
}

// Liste für "Alle": beim Suchen über alle Orte (auch geplante, jede Kategorie), sonst nach Filter
function ideasList(base) {
  if (ui.q.trim()) return matchPlaces(ui.q);
  return base.filter((p) => (ui.cat === 'Alle' || (ui.cat === 'Meine' ? heartsOf(p.id).some((m) => m.id === me().id) : p.cat === ui.cat)))
    .sort((a, b) => heartsOf(b.id).length - heartsOf(a.id).length || a.title.localeCompare(b.title, 'de'));
}
function ideasResults(list, q) {
  if (!list.length) return empty('Nichts gefunden', q ? 'Nichts in euren Orten. Über das Plus oben suchst du in ganz New York und legst den Ort neu an.' : 'Hier landen alle Orte, die noch keinen Tag haben.');
  return `${q ? `<p class="hint">${list.length} ${list.length === 1 ? 'Treffer' : 'Treffer'} in allen Orten, auch geplanten.</p>` : ''}<div class="ideas">${list.slice(0, ui.limit).map(ideaCard).join('')}</div>${list.length > ui.limit ? `<button class="btn wide" data-act="moreIdeas">${list.length - ui.limit} weitere zeigen</button>` : ''}`;
}

// ---------- INFOS ----------
const FLIGHT_DIR = { hin: 'Hinflug', rueck: 'Rückflug' };
function itemSub(i) {
  const d = i.data || {};
  if (i.kind === 'flight') {
    if (d.dep || d.arr) return `<small>${[d.date ? fmtShort(d.date) : '', `${d.dep || '?'} ${esc(d.from || '')} → ${d.arr || '?'} ${esc(d.to || '')}`, d.no ? esc(d.no) : ''].filter(Boolean).join(' · ')}</small>`;
    return '<small class="warn">Uhrzeiten fehlen noch</small>';
  }
  if (i.kind === 'stay' && d.from) return `<small>${fmtShort(d.from)} bis ${fmtShort(d.to)}${d.checkin || d.checkout ? ` · Check-in ${esc(d.checkin || '15:00')}, Check-out ${esc(d.checkout || '11:00')}` : ''}</small>`;
  return d.status ? `<small>${esc(d.status)}</small>` : '';
}
// Formular für Flug, Unterkunft oder Anreise; ohne Eintrag zum Anlegen, sonst zum Bearbeiten
function itemForm(i) {
  const k = i?.kind || 'flight';
  const d = { ...(i?.data || {}) };
  const t = trip();
  // ältere Flug-Einträge ohne Richtung: aus dem Titel ableiten
  if (k === 'flight' && !d.dir) d.dir = /rück|zurück|return/i.test(i?.title || '') ? 'rueck' : 'hin';
  const v = (x) => esc(x ?? '');
  const fs = (kind, html) => `<fieldset data-k="${kind}" ${k === kind ? '' : 'disabled hidden'}>${html}</fieldset>`;
  return `<form class="form" data-itemform ${i ? `data-id="${i.id}"` : ''}>
    ${i ? `<input type="hidden" name="kind" value="${k}">` : `<label>Art<select name="kind" data-kindsel><option value="flight">Flug</option><option value="stay">Unterkunft</option><option value="transport">Anreise, Zug, Auto</option></select></label>`}
    ${fs('flight', `
      <div class="two"><label>Richtung<select name="d.dir"><option value="hin" ${d.dir !== 'rueck' ? 'selected' : ''}>Hinflug</option><option value="rueck" ${d.dir === 'rueck' ? 'selected' : ''}>Rückflug</option></select></label>
        <label>Datum (Abflug)<input type="date" name="d.date" value="${v(d.date || (d.dir === 'rueck' ? t.end : t.start))}"></label></div>
      <div class="two"><label>Von (Flughafen)<input name="d.from" value="${v(d.from)}" maxlength="4" placeholder="FRA" autocapitalize="characters"></label>
        <label>Nach<input name="d.to" value="${v(d.to)}" maxlength="4" placeholder="JFK" autocapitalize="characters"></label></div>
      <div class="two"><label>Abflug (Ortszeit)<input type="time" name="d.dep" value="${v(d.dep)}"></label>
        <label>Ankunft (Ortszeit)<input type="time" name="d.arr" value="${v(d.arr)}"></label></div>
      <label>Flugnummer<input name="d.no" value="${v(d.no)}" maxlength="12" placeholder="DE 2014"></label>
      <p class="hint">Mit den Uhrzeiten plant die App Anreise- und Abreisetag: Einreise, Fahrt ins Hotel, wann ihr zum Flughafen müsst.</p>`)}
    ${fs('stay', `
      <div class="two"><label>Von<input type="date" name="d.from" value="${v(d.from || t.start)}"></label><label>Bis<input type="date" name="d.to" value="${v(d.to || t.end)}"></label></div>
      <div class="two"><label>Check-in ab<input type="time" name="d.checkin" value="${v(d.checkin || '15:00')}"></label><label>Check-out bis<input type="time" name="d.checkout" value="${v(d.checkout || '11:00')}"></label></div>
      <label>Link zur Buchung<input name="d.link" type="url" value="${v(d.link)}" placeholder="https://…"></label>`)}
    <label>Titel<input name="title" maxlength="300" value="${v(i?.title)}" placeholder="z. B. Condor FRA nach JFK"></label>
    <label>Notiz<textarea name="note" rows="2" maxlength="2000" placeholder="Buchungsnummer, wer die Tickets hat">${v(i?.note)}</textarea></label>
    <button class="btn primary">${i ? 'Speichern' : 'Eintragen'}</button></form>`;
}

export function viewInfos() {
  const t = trip();
  const isAdmin = me().role === 'admin';
  const travel = S.data.items;
  const ps = pushState();
  const icon = { flight: ICON.plane, stay: ICON.bed, transport: ICON.car };

  return `<div class="top"><h1>Infos</h1></div>
  <div class="page">
    <section class="block"><div class="block-h"><h2>Flüge und Hotel</h2></div>
      ${travel.map((i) => `<details class="info"><summary><span class="ic">${icon[i.kind] || ICON.doc}</span><span><b>${esc(i.title)}</b>${itemSub(i)}</span></summary>
        ${i.note ? `<p>${esc(i.note)}</p>` : ''}${i.data.link ? `<p><a href="${esc(i.data.link)}" target="_blank" rel="noopener">Buchung ansehen</a></p>` : ''}
        ${isAdmin ? `<details class="edit"><summary>${ICON.edit} Bearbeiten</summary>${itemForm(i)}</details>
          <p><button class="link" data-act="delItem" data-id="${i.id}">${ICON.trash}Entfernen</button></p>` : ''}</details>`).join('') || '<p class="hint">Noch nichts eingetragen.</p>'}
      ${isAdmin ? `<details class="edit"><summary>${ICON.plus} Flug, Hotel oder Anreise eintragen</summary>${itemForm(null)}</details>` : ''}
    </section>

    <section class="block"><div class="block-h"><h2>Unterkunft auf der Karte</h2></div>
      <div class="mem"><span class="ic">${ICON.bed}</span><span><b>${esc(t.hotel?.name || 'Noch nicht festgelegt')}</b><small>${t.hotel ? 'Startpunkt und Ziel jedes Tages' : 'Dann starten und enden die Tage dort.'}</small></span>
        ${isAdmin ? `<button class="btn sm" data-act="setHotel">${t.hotel ? 'Ändern' : 'Festlegen'}</button>` : ''}</div>
    </section>

    <section class="block"><div class="block-h"><h2>Die Bande</h2></div>
      <div class="members">${S.data.members.map((m) => `<div class="mem">${avatar(m)}<span><b>${esc(m.name)}</b><small>${m.role === 'admin' ? 'Reiseleitung' : !m.claimed ? 'wartet auf die Einladung' : m.lastSeen ? `zuletzt ${ago(m.lastSeen)}` : 'dabei'}</small></span>
        ${isAdmin && m.claimed && m.id !== me().id ? `<button class="btn sm ghost" data-act="relink" data-id="${m.id}" data-name="${esc(m.name)}" title="Falls das Handy weg ist">Neuer Link</button>` : ''}</div>`).join('')}</div>
      ${isAdmin ? `<button class="btn primary wide" data-act="invite">${ICON.plus}Jemanden einladen</button>` : ''}
      <button class="btn wide ghost" data-act="trips">Andere Reise öffnen</button>
    </section>

    <section class="block"><div class="block-h"><h2>Abendbriefing</h2></div>
      <p class="hint">Um ${t.briefingHour} Uhr Ortszeit kommt der Plan für morgen aufs Handy, am Abend vor dem Abflug schon zu Hause.</p>
      ${ps === 'unsupported' ? '<p class="hint">Auf dem iPhone geht das nur in der App vom Home-Bildschirm (Safari, Teilen, Zum Home-Bildschirm).</p>'
        : ps === 'on' ? `<div class="row-btns"><button class="btn" data-act="testPush">${ICON.bell}Test schicken</button><button class="btn ghost" data-act="pushOff">Ausschalten</button></div>`
        : `<button class="btn primary" data-act="pushOn">${ICON.bell}Benachrichtigungen einschalten</button>`}
    </section>

    <section class="block"><div class="block-h"><h2>Ich</h2></div>
      <form class="form" data-me>
        <div class="two"><label>Name<input name="name" value="${esc(me().name)}" maxlength="40"></label><label>Farbe<input name="color" type="color" value="${esc(me().color)}"></label></div>
        <button class="btn">Speichern</button>
      </form>
    </section>

    ${isAdmin ? `<section class="block"><div class="block-h"><h2>Reise einstellen</h2></div>
      <form class="form" data-trip>
        <label>Name<input name="name" value="${esc(t.name)}"></label>
        <label>Reiseziel<input name="dest" value="${esc(t.dest)}"></label>
        <div class="two"><label>Von<input type="date" name="start" value="${esc(t.start || '')}"></label><label>Bis<input type="date" name="end" value="${esc(t.end || '')}"></label></div>
        <label>Gestaltung<select name="theme">${Object.entries(THEMES).map(([k, v]) => `<option value="${k}" ${k === t.theme ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label>Zeitzone am Ziel<input name="tz" value="${esc(t.tz)}"></label>
        <label>Briefing um (Uhr)<input name="briefingHour" type="number" min="0" max="23" value="${t.briefingHour}"></label>
        <button class="btn primary">Speichern</button>
      </form></section>` : ''}
    <p class="foot">Reisebande · <span id="ver"></span></p>
  </div>`;
}

export function mountView(root, name) {
  resolveImages(root);
  if (name === 'ideen') mountSwipe(root);
  const search = root.querySelector('[data-search]');
  // beim Tippen nur die Treffer neu zeichnen, nicht das Suchfeld (sonst schließt sich auf dem iPhone die Tastatur)
  if (search) search.addEventListener('input', () => {
    ui.q = search.value;
    const box = root.querySelector('[data-results]');
    if (!box) return;
    const base = ui.onlyOpen ? S.data.places.filter((p) => !p.day) : S.data.places;
    box.innerHTML = ideasResults(ideasList(base), ui.q.trim());
    resolveImages(box);
  });
  root.querySelector('form[data-me]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await mutate('/me', { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); toast('Gespeichert'); } catch (err) { toast(err.message); }
  });
  root.querySelector('form[data-trip]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.briefingHour = Number(f.briefingHour);
    try { await mutate('/trip', { method: 'PATCH', body: f }); toast('Gespeichert'); } catch (err) { toast(err.message); }
  });
  root.querySelectorAll('[data-kindsel]').forEach((sel) => sel.addEventListener('change', () => {
    sel.closest('form').querySelectorAll('fieldset[data-k]').forEach((f) => { const on = f.dataset.k === sel.value; f.disabled = !on; f.hidden = !on; });
  }));
  root.querySelectorAll('form[data-itemform]').forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const id = form.dataset.id;
    const old = id ? S.data.items.find((x) => x.id === id) : null;
    const data = { ...(old?.data || {}) };
    for (const [k, val] of f.entries()) if (k.startsWith('d.')) data[k.slice(2)] = ['from', 'to'].includes(k.slice(2)) && f.get('kind') === 'flight' ? String(val).trim().toUpperCase() : String(val).trim();
    let title = String(f.get('title') || '').trim();
    if (!title && f.get('kind') === 'flight') title = `${FLIGHT_DIR[data.dir] || 'Flug'} ${data.from || ''} → ${data.to || ''}`.trim();
    if (!title) { toast('Bitte einen Titel angeben.'); return; }
    const body = { kind: f.get('kind'), title, note: f.get('note') || '', data };
    try { await mutate(id ? `/items/${id}` : '/items', { method: id ? 'PATCH' : 'POST', body }); toast(id ? 'Gespeichert' : 'Eingetragen'); } catch (err) { toast(err.message); }
  }));
  const ver = root.querySelector('#ver');
  if (ver) fetch('/version.txt', { cache: 'no-store' }).then((r) => r.text()).then((v) => { ver.textContent = `Version ${v.trim()}`; }).catch(() => {});
}

register({
  story: (el) => openStory(el.dataset.day),
  goSwipe: () => { ui.ideasMode = 'swipen'; location.hash = '#/ideen'; },
  ideasMode: (el) => { ui.ideasMode = el.dataset.m; window.dispatchEvent(new Event('rb:render')); },
  pickCat: (el) => { ui.cat = el.dataset.cat; ui.limit = 40; window.dispatchEvent(new Event('rb:render')); },
  moreIdeas: () => { ui.limit += 60; window.dispatchEvent(new Event('rb:render')); },
  toggleOpen: (el) => { ui.onlyOpen = el.checked; window.dispatchEvent(new Event('rb:render')); },
  relink: async (el) => {
    if (!confirm(`Neuen persönlichen Link für ${el.dataset.name} erzeugen? Der alte gilt dann nicht mehr. Das braucht man nur, wenn das Handy weg ist.`)) return;
    try { const r = await api(`/members/${el.dataset.id}/link`, { method: 'POST' }); showLink(el.dataset.name, r.token); } catch (err) { toast(err.message); }
  },
  syncMaps: async (el) => {
    el.disabled = true; el.classList.add('busy');
    try { const r = await mutate('/maps/sync', { method: 'POST' }); toast(`${r.total} Orte gelesen, ${r.added} neu, ${r.updated} ergänzt`, 4000); }
    catch (err) { toast(err.message, 6000); }
    el.disabled = false; el.classList.remove('busy');
  },
  announce: () => {
    const sheet = openSheet(`<div class="sh-head"><h2>Nachricht an alle</h2><button class="icon" data-close aria-label="Schließen">${ICON.close}</button></div>
      <p class="hint">Kommt bei allen als Benachrichtigung an und steht oben auf Heute, zum Beispiel ein Treffpunkt.</p>
      <form class="form" data-ann><textarea name="text" rows="3" maxlength="300" placeholder="Treffpunkt 15 Uhr in der Hotel-Lobby" autofocus></textarea>
      <button class="btn primary big">${ICON.send}Schicken</button></form>`);
    sheet.querySelector('[data-ann]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = e.target.text.value.trim();
      if (!text) return;
      try { const r = await mutate('/announce', { method: 'POST', body: { text } }); closeSheet(); toast(r.sent ? `An ${r.sent} Geräte geschickt` : 'Gespeichert. Benachrichtigungen hat noch niemand eingeschaltet.'); } catch (err) { toast(err.message); }
    });
  },
  pickFromPool: (el) => pickFromPool(el.dataset.day),
  setHotel: () => {
    const sheet = openSheet(`<div class="sh-head"><h2>Unterkunft</h2><button class="icon" data-close aria-label="Schließen">${ICON.close}</button></div>
      <input class="search big" type="search" placeholder="Hotel oder Adresse suchen" autocomplete="off" autofocus data-q aria-label="Unterkunft suchen">
      <div class="results"></div>`, { tall: true });
    const input = sheet.querySelector('[data-q]'); const box = sheet.querySelector('.results');
    const withCoords = S.data.places.filter((p) => Number.isFinite(p.lat));
    const near = withCoords.length ? { lat: withCoords[0].lat, lng: withCoords[0].lng } : null;
    let results = []; let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { box.innerHTML = ''; return; }
      timer = setTimeout(async () => {
        try { results = await searchPlaces(q, near); } catch { results = []; }
        box.innerHTML = results.map((r, i) => `<button class="res" data-i="${i}">${ICON.bed}<span><b>${esc(r.title)}</b><small>${esc(r.address || r.area)}</small></span></button>`).join('') || '<p class="hint">Nichts gefunden.</p>';
      }, 280);
    });
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const r = results[Number(b.dataset.i)];
      try { await mutate('/trip', { method: 'PATCH', body: { hotel: { name: r.title, lat: r.lat, lng: r.lng } } }); closeSheet(); toast('Unterkunft gespeichert'); } catch (err) { toast(err.message); }
    });
  },
  delItem: async (el) => { if (!confirm('Eintrag entfernen?')) return; try { await mutate(`/items/${el.dataset.id}`, { method: 'DELETE' }); } catch (err) { toast(err.message); } },
  pushOn: async () => { try { await enablePush(); window.dispatchEvent(new Event('rb:render')); toast('Benachrichtigungen sind an'); } catch (e) { toast(e.message, 5000); } },
  pushOff: async () => { await disablePush(); window.dispatchEvent(new Event('rb:render')); },
  testPush: async () => {
    try {
      const r = await testPush();
      if (r.ok) toast('Ist unterwegs');
      else if (!r.devices) toast('Dieses Gerät ist nicht angemeldet. Bitte Benachrichtigungen aus- und wieder einschalten.', 5000);
      else toast(`Nicht angekommen (${r.results?.[0]?.status || '?'} ${r.results?.[0]?.detail || ''}). Bitte aus- und wieder einschalten.`, 6000);
    } catch (e) { toast(e.message); }
  },
});

// Ideen auswählen und auf einen Tag legen
function pickFromPool(day) {
  const list = pool().sort((a, b) => heartsOf(b.id).length - heartsOf(a.id).length || a.title.localeCompare(b.title, 'de'));
  const sheet = openSheet(`<div class="sh-head"><h2>Auf ${fmtShort(day)} legen</h2><button class="icon" data-close aria-label="Schließen">${ICON.close}</button></div>
    <input class="search" type="search" placeholder="Suchen …" data-q aria-label="Ideen durchsuchen">
    <div class="picklist">${list.map((p) => `<label class="sug" data-name="${esc((p.title + ' ' + p.area).toLowerCase())}"><input type="checkbox" value="${p.id}">${sticker(p.cat, 'sm')}<b>${esc(p.title)}</b>${avatars(heartsOf(p.id), 'xs')}</label>`).join('')}</div>
    <button class="btn primary big" data-ok>${ICON.check}Hinzufügen</button>`, { tall: true });
  sheet.querySelector('[data-q]').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    sheet.querySelectorAll('.picklist label').forEach((l) => { l.hidden = q && !l.dataset.name.includes(q); });
  });
  sheet.querySelector('[data-ok]').addEventListener('click', async () => {
    const ids = [...sheet.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
    if (!ids.length) { closeSheet(); return; }
    const base = stopsOf(day).length;
    try { await mutate('/plan/apply', { method: 'POST', body: { moves: ids.map((id, i) => ({ id, day, time: '', ord: base + i + 1 })) } }); closeSheet(); toast(`${ids.length} Orte auf ${fmtShort(day)}`); } catch (e) { toast(e.message); }
  });
}
