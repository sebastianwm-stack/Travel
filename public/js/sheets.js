// Bottom-Sheets: Ort im Detail, neue Idee, Reisebegleiter, Tagesvorschlag, Einladungslink.
import { esc, linkify, ICON, avatar, openSheet, closeSheet, toast, fmtChip, fmtShort, ago } from './ui.js';
import { api, fileUrl } from './api.js';
import { S, mutate, place, heartsOf, iHeart, commentsOf, member, me, trip, refresh, SLOTS, SLOT_LABEL, slotOf, localPlace, localHeart, matchPlaces } from './state.js';
import { sticker, avatars, routeUrl, register, photo, resolveImages, mapsUrl } from './components.js';
import { findImage } from './images.js';
import { CAT_NAMES } from './themes.js';
import { searchPlaces } from './search.js';

// ---------- Kommentare (für Orte, Tage, ganze Reise) ----------
export function thread(target, { placeholder = 'Notiz schreiben …' } = {}) {
  const list = commentsOf(target);
  return `<div class="thread" data-target="${esc(target)}">
    ${list.map(commentHTML).join('') || '<p class="hint">Noch keine Notizen. Die anderen bekommen eine Benachrichtigung, wenn du etwas schreibst.</p>'}
    <form class="composer" data-target="${esc(target)}">
      <label class="attach" title="Foto oder Datei anhängen">${ICON.clip}<input type="file" accept="image/*,application/pdf" hidden></label>
      <textarea rows="1" placeholder="${esc(placeholder)}" aria-label="Kommentar"></textarea>
      <button class="send" aria-label="Senden">${ICON.send}</button>
    </form>
  </div>`;
}
function commentHTML(c) {
  const m = member(c.by);
  const f = c.file && S.data.files[c.file];
  const isImg = f && f.type.startsWith('image/');
  const mine = c.by === me().id || me().role === 'admin';
  return `<div class="cmt">${avatar(m)}<div class="cmt-b"><div class="cmt-h"><b>${esc(m?.name || 'Ehemalig')}</b><span>${ago(c.at)}</span>
    ${mine ? `<button class="x" data-del-comment="${c.id}" aria-label="Löschen">${ICON.trash}</button>` : ''}</div>
    ${c.body ? `<p>${linkify(c.body)}</p>` : ''}
    ${f ? (isImg ? `<img class="thumb" data-file="${c.file}" alt="${esc(f.name)}">` : `<button class="filelink" data-open-file="${c.file}">${ICON.doc}${esc(f.name)}</button>`) : ''}
  </div></div>`;
}
export function mountThread(root) {
  root.querySelectorAll('img[data-file]').forEach(async (img) => {
    try { img.src = await fileUrl(img.dataset.file); } catch { img.alt = 'Bild nicht verfügbar'; }
  });
  root.querySelectorAll('[data-open-file]').forEach((b) => b.addEventListener('click', async () => {
    try { window.open(await fileUrl(b.dataset.openFile), '_blank'); } catch (e) { toast(e.message); }
  }));
  root.querySelectorAll('img[data-file]').forEach((img) => img.addEventListener('click', () => img.src && window.open(img.src, '_blank')));
  root.querySelectorAll('[data-del-comment]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Kommentar löschen?')) return;
    try { await mutate(`/comments/${b.dataset.delComment}`, { method: 'DELETE' }); rerenderSheet(); } catch (e) { toast(e.message); }
  }));
  root.querySelectorAll('form.composer').forEach((form) => {
    const ta = form.querySelector('textarea');
    const fileIn = form.querySelector('input[type=file]');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
    fileIn.addEventListener('change', () => { if (fileIn.files[0]) form.querySelector('.attach').classList.add('has'); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      const file = fileIn.files[0];
      if (!body && !file) return;
      form.classList.add('busy');
      try {
        let fileId = null;
        if (file) {
          const up = await api('/files', { method: 'POST', body: await shrink(file), headers: { 'x-name': encodeURIComponent(file.name), 'content-type': file.type || 'application/octet-stream' } });
          fileId = up.id;
        }
        await mutate('/comments', { method: 'POST', body: { target: form.dataset.target, body, file: fileId } });
        rerenderSheet();
      } catch (err) { toast(err.message); form.classList.remove('busy'); }
    });
  });
}

// Fotos vor dem Hochladen verkleinern (lange Kante 2000 px)
async function shrink(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 600e3) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.85));
  } catch { return file; }
}

// Offenes Sheet nach Änderungen neu zeichnen
let current = null;
export function rerenderSheet() { if (current) current(); }
export function keepOpen(draw) { current = draw; draw(); }

// ---------- Ort ----------
export function openPlace(id) {
  const draw = () => {
    const p = place(id);
    if (!p) { closeSheet(); return; }
    const hs = heartsOf(p.id);
    const mine = iHeart(p.id);
    const gmaps = mapsUrl(p);
    const sheet = openSheet(`
      <div class="sh-head">${sticker(p.cat)}<button class="icon" data-close aria-label="Schließen">${ICON.close}</button></div>
      <figure class="sh-ph ${p.image ? '' : 'art'}">${photo(p)}${p.image && p.imageCredit?.t ? `<figcaption>${p.imageCredit.l ? `<a href="${esc(p.imageCredit.l)}" target="_blank" rel="noopener">Foto: ${esc(p.imageCredit.t)}</a>` : `Foto: ${esc(p.imageCredit.t)}`}</figcaption>` : ''}</figure>
      <h2>${esc(p.title)}</h2>
      ${p.area ? `<p class="ar">${esc(p.area)}</p>` : ''}
      ${p.note ? `<p class="note big">${linkify(p.note)}</p>` : ''}
      <div class="row-btns">
        <button class="btn heartbtn ${mine ? 'on' : ''}" data-h>${mine ? ICON.heartFill : ICON.heart}${mine ? 'Gemerkt' : 'Will ich'}</button>
        <a class="btn" href="${routeUrl(p)}" target="_blank" rel="noopener">${ICON.route}Route</a>
        <a class="btn" href="${esc(gmaps)}" target="_blank" rel="noopener">${ICON.map}Maps</a>
      </div>
      ${hs.length ? `<p class="who">${avatars(hs)} ${hs.map((m) => esc(m.name)).join(', ')} ${hs.length === 1 ? 'will' : 'wollen'} hin</p>` : ''}

      <h4>Wann?</h4>
      <div class="chips wrap">
        <button class="chip ${!p.day ? 'on' : ''}" data-day="">Ohne Tag</button>
        ${trip().days.map((d) => `<button class="chip ${p.day === d ? 'on' : ''}" data-day="${d}">${fmtChip(d)}</button>`).join('')}
      </div>
      ${p.day ? `<div class="chips wrap">${SLOTS.map((sl) => `<button class="chip ${slotOf(p) === sl ? 'on' : ''}" data-slot="${sl}">${SLOT_LABEL[sl]}</button>`).join('')}</div>` : ''}
      <div class="when">
        <label>Genaue Uhrzeit <input type="time" value="${esc(p.time)}" data-time ${p.day ? '' : 'disabled'}></label>
        <label class="switch"><input type="checkbox" data-booked ${p.booked ? 'checked' : ''}> Gebucht</label>
      </div>

      <h4>Notizen und Fotos</h4>
      ${thread(`place:${p.id}`)}

      <details class="edit"><summary>${ICON.edit} Bearbeiten</summary>
        <form class="form" data-edit>
          <label>Name<input name="title" value="${esc(p.title)}" required maxlength="200"></label>
          <label>Gegend<input name="area" value="${esc(p.area)}" maxlength="120"></label>
          <label>Kategorie<select name="cat">${CAT_NAMES.map((c) => `<option ${c === p.cat ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label>Notiz<textarea name="note" rows="3" maxlength="2000">${esc(p.note)}</textarea></label>
          <label>Bild-Link<input name="image" value="${esc(p.image)}" inputmode="url" placeholder="https://…"></label>
          <div class="row-btns"><button type="button" class="btn sm" data-imgsearch>${ICON.refresh}Bild suchen</button><label class="btn sm">${ICON.clip}Eigenes Foto<input type="file" accept="image/*" hidden data-imgfile></label></div>
          <div class="row-btns"><button class="btn primary">Speichern</button><button type="button" class="btn danger" data-delete>${ICON.trash}Löschen</button></div>
        </form>
      </details>`, { tall: true, onClose: () => { current = null; } });

    sheet.querySelector('[data-h]').addEventListener('click', async () => {
      mutate(`/places/${p.id}/heart`, { method: 'POST' }, localHeart(p.id)).catch((e) => toast(e.message));
      draw();
    });
    sheet.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', async () => {
      const day = b.dataset.day || null;
      const fields = { day, ...(day ? {} : { time: '', slot: null }) };
      mutate(`/places/${p.id}`, { method: 'PATCH', body: fields }, localPlace(p.id, fields)).catch((e) => toast(e.message));
      draw(); toast(day ? `Auf ${fmtShort(day)} gelegt` : 'Zurück in die Ideen');
    }));
    sheet.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', async () => {
      const fields = { slot: b.dataset.slot, time: '' };
      mutate(`/places/${p.id}`, { method: 'PATCH', body: fields }, localPlace(p.id, fields)).catch((e) => toast(e.message));
      draw();
    }));
    sheet.querySelector('[data-time]').addEventListener('change', async (e) => {
      mutate(`/places/${p.id}`, { method: 'PATCH', body: { time: e.target.value } }, localPlace(p.id, { time: e.target.value })).catch((err) => toast(err.message));
    });
    sheet.querySelector('[data-booked]').addEventListener('change', async (e) => {
      mutate(`/places/${p.id}`, { method: 'PATCH', body: { booked: e.target.checked } }, localPlace(p.id, { booked: e.target.checked })).catch((err) => toast(err.message));
    });
    sheet.querySelector('[data-edit]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try { await mutate(`/places/${p.id}`, { method: 'PATCH', body: f }); draw(); toast('Gespeichert'); } catch (err) { toast(err.message); }
    });
    sheet.querySelector('[data-delete]').addEventListener('click', async () => {
      if (!confirm(`${p.title} löschen?`)) return;
      try { await mutate(`/places/${p.id}`, { method: 'DELETE' }); closeSheet(); toast('Gelöscht'); } catch (err) { toast(err.message); }
    });
    sheet.querySelector('[data-imgsearch]').addEventListener('click', async (e) => {
      e.target.classList.add('busy');
      try {
        const img = await findImage(p, trip().dest);
        if (!img) { toast('Kein passendes Bild gefunden. Ein eigenes Foto oder ein Bild-Link geht immer.', 4000); e.target.classList.remove('busy'); return; }
        await mutate(`/places/${p.id}`, { method: 'PATCH', body: { image: img.url, imageCredit: { t: img.credit, l: img.link } } });
        draw();
      } catch (err) { toast(err.message || 'Gerade keine Bildsuche möglich.'); e.target.classList.remove('busy'); }
    });
    sheet.querySelector('[data-imgfile]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const up = await api('/files', { method: 'POST', body: await shrink(file), headers: { 'x-name': encodeURIComponent(file.name), 'content-type': file.type || 'image/jpeg' } });
        await mutate(`/places/${p.id}`, { method: 'PATCH', body: { image: `file:${up.id}` } });
        draw();
      } catch (err) { toast(err.message); }
    });
    resolveImages(sheet);
    mountThread(sheet);
  };
  current = draw;
  draw();
}

// ---------- Neue Idee ----------
export function openAddIdea({ day = null, slot = null } = {}) {
  current = null;
  const sheet = openSheet(`
    <div class="sh-head"><h2>${day ? `Ort für ${fmtShort(day)}${slot ? `, ${SLOT_LABEL[slot]}` : ''}` : 'Neue Idee'}</h2><button class="icon" data-close aria-label="Schließen">${ICON.close}</button></div>
    <input class="search big" type="search" placeholder="Ort suchen, z. B. Joe's Pizza" autocomplete="off" aria-label="Ort suchen" autofocus data-q>
    <div class="results" aria-live="polite"><p class="hint">Name tippen und Treffer antippen. Ein Google-Maps-Link geht auch.</p></div>`, { tall: true });
  const input = sheet.querySelector('[data-q]');
  const box = sheet.querySelector('.results');
  const withCoords = S.data.places.filter((p) => Number.isFinite(p.lat));
  const near = withCoords.length ? { lat: withCoords.reduce((n, p) => n + p.lat, 0) / withCoords.length, lng: withCoords.reduce((n, p) => n + p.lng, 0) / withCoords.length } : null;
  let results = [];
  let timer, seq = 0;
  const create = async (body) => {
    box.classList.add('busy');
    try {
      const r = await mutate('/places', { method: 'POST', body: { ...body, ...(day ? { day } : {}), ...(slot ? { slot } : {}) } });
      closeSheet(); toast('Ist drin'); openPlace(r.id);
    } catch (err) { toast(err.message); box.classList.remove('busy'); }
  };
  const draw = (q) => {
    const isLink = /^https?:\/\//.test(q);
    if (isLink) { box.innerHTML = `<button class="res" data-link>${ICON.link}<span><b>Link übernehmen</b><small>${esc(q.slice(0, 60))}</small></span></button>`; return; }
    const mine = q.length > 1 ? matchPlaces(q).slice(0, 4) : [];
    box.innerHTML = (mine.length ? `<p class="res-h">Schon bei euch</p>${mine.map((p) => `<button class="res mine" data-have="${p.id}">${sticker(p.cat, 'sm')}<span><b>${esc(p.title)}</b><small>${esc([p.area, p.day ? 'geplant' : 'in den Ideen'].filter(Boolean).join(' · '))}</small></span></button>`).join('')}${results.length ? '<p class="res-h">Neu hinzufügen</p>' : ''}` : '') + results.map((r, i) => `<button class="res" data-i="${i}">${sticker(r.cat, 'sm')}<span><b>${esc(r.title)}</b><small>${esc(r.address || r.area)}</small></span></button>`).join('')
      + (q.length > 1 ? `<button class="res plain" data-free>${ICON.plus}<span><b>"${esc(q)}" ohne genaue Lage hinzufügen</b></span></button>` : '');
  };
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (/^https?:\/\//.test(q) || q.length < 2) { results = []; draw(q); return; }
    draw(q); // eigene Orte sofort zeigen, Ortssuche kommt dazu
    timer = setTimeout(async () => {
      const mine = ++seq;
      try { const r = await searchPlaces(q, near); if (mine === seq) { results = r; draw(q); } }
      catch (err) { if (mine === seq) { results = []; draw(q); } }
    }, 280);
  });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const q = input.value.trim();
    if (b.dataset.have) { closeSheet(); openPlace(b.dataset.have); return; }
    if (b.hasAttribute('data-link')) create({ link: q });
    else if (b.hasAttribute('data-free')) create({ title: q });
    else { const r = results[Number(b.dataset.i)]; create({ title: r.title, area: r.area, lat: r.lat, lng: r.lng, cat: r.cat }); }
  });
}

// ---------- Reisebegleiter ----------
const HIST = 'rb.ask';
const loadHist = () => { try { return JSON.parse(sessionStorage.getItem(HIST) || '[]'); } catch { return []; } };
const saveHist = (h) => { try { sessionStorage.setItem(HIST, JSON.stringify(h.slice(-12))); } catch { /* egal */ } };
const suggestions = () => ['Was machen wir, wenn es regnet?', 'Wo frühstücken wir morgen?', 'Welche Ideen passen an einen Tag?', S.data.members.length > 1 ? 'Was wollen alle unbedingt?' : 'Was sollte ich auf keinen Fall verpassen?'];

export function openAsk(prefill = '') {
  current = null;
  const hist = loadHist();
  const sheet = openSheet(`
    <div class="sh-head"><h2>${ICON.spark} Reiseberater</h2><button class="icon" data-close aria-label="Schließen">${ICON.close}</button></div>
    <div class="chat" aria-live="polite">
      ${hist.length ? hist.map(msgHTML).join('') : `<p class="hint">Der Reiseberater kennt euren Plan, alle Ideen und weiß, wer wo hinwill.</p>
        <div class="sugg">${suggestions().map((s) => `<button class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>`}
    </div>
    <form class="composer ask">
      <textarea rows="1" placeholder="Was möchtest du wissen?" aria-label="Frage" autofocus>${esc(prefill)}</textarea>
      <button class="send" aria-label="Fragen">${ICON.send}</button>
    </form>
    ${hist.length ? '<button class="link" data-reset>Neues Gespräch</button>' : ''}`, { tall: true });
  const chat = sheet.querySelector('.chat');
  const ta = sheet.querySelector('textarea');
  chat.scrollTop = chat.scrollHeight;
  const send = async (q) => {
    if (!q.trim()) return;
    const h = loadHist();
    chat.querySelector('.sugg')?.remove();
    chat.querySelector('.hint')?.remove();
    chat.insertAdjacentHTML('beforeend', msgHTML({ role: 'user', content: q }) + '<div class="msg a busy"><span class="dots"><i></i><i></i><i></i></span></div>');
    chat.scrollTop = chat.scrollHeight;
    ta.value = '';
    try {
      const answer = await askStreaming(q, h, (text) => {
        const bubble = chat.querySelector('.msg.a.busy, .msg.a.live');
        if (!bubble) return;
        bubble.classList.remove('busy'); bubble.classList.add('live');
        bubble.outerHTML = msgHTML({ role: 'assistant', content: text }).replace('class="msg a"', 'class="msg a live"');
        chat.scrollTop = chat.scrollHeight;
      });
      h.push({ role: 'user', content: q }, { role: 'assistant', content: answer });
      saveHist(h);
      const live = chat.querySelector('.msg.a.live, .msg.a.busy');
      if (live) live.outerHTML = msgHTML({ role: 'assistant', content: answer || 'Darauf habe ich gerade keine Antwort.' });
    } catch (e) {
      const b = chat.querySelector('.msg.a.busy, .msg.a.live');
      if (b) b.outerHTML = `<div class="msg a err">${esc(e.message)}</div>`;
    }
    chat.scrollTop = chat.scrollHeight;
  };
  sheet.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => send(b.dataset.s)));
  sheet.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); send(ta.value); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(ta.value); } });
  sheet.querySelector('[data-reset]')?.addEventListener('click', () => { saveHist([]); openAsk(); });
  if (prefill) send(prefill);
}
// Antwort Stück für Stück lesen (Server-Sent Events)
async function askStreaming(question, history, onText) {
  const res = await api('/ask', { method: 'POST', body: { question, history, stream: true }, raw: true });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith('data:')) continue;
      const data = l.slice(5).trim();
      if (data === '[DONE]') continue;
      try { const j = JSON.parse(data); if (j.response) { text += j.response; onText(text); } } catch { /* unvollständig */ }
    }
  }
  return text.trim();
}

function msgHTML(m) {
  if (m.role === 'user') return `<div class="msg u">${esc(m.content)}</div>`;
  // einfache Formatierung: **fett**, Listenpunkte, Absätze
  const html = esc(m.content)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .split(/\n{2,}/).map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => /^\s*([-*•]|\d+\.)\s/.test(l))) return `<ul>${lines.map((l) => `<li>${l.replace(/^\s*([-*•]|\d+\.)\s/, '')}</li>`).join('')}</ul>`;
      return `<p>${lines.join('<br>')}</p>`;
    }).join('');
  return `<div class="msg a">${html}</div>`;
}

// ---------- Tagesvorschlag ----------
export async function openSuggest() {
  current = null;
  let draft;
  try { draft = (await api('/plan/draft', { method: 'POST', body: {} })).draft; }
  catch (e) { toast(e.message); return; }
  const rows = Object.entries(draft).flatMap(([d, slots]) => Object.entries(slots).map(([slot, e]) => ({ d, slot, p: place(e.pick) }))).filter((x) => x.p);
  if (!rows.length) { toast('Alle Abschnitte sind schon belegt, oder es gibt keine passenden Ideen mehr.'); return; }
  const byDay = {};
  rows.forEach((r) => (byDay[r.d] = byDay[r.d] || []).push(r));
  const sheet = openSheet(`
    <div class="sh-head"><h2>${ICON.spark} Reise vorplanen</h2><button class="icon" data-close aria-label="Schließen">${ICON.close}</button></div>
    <p class="hint">Für jeden freien Abschnitt ein Vorschlag aus euren Ideen: was viele Herzen hat und zur Gegend des Tages passt. Was ihr nicht wollt, abwählen. Ändern könnt ihr danach alles.</p>
    ${Object.entries(byDay).map(([d, list]) => `<div class="sug-day"><h4>${fmtShort(d)}</h4>
      ${list.map((r) => `<label class="sug"><input type="checkbox" checked data-id="${r.p.id}" data-day="${r.d}" data-slot="${r.slot}"><span class="time">${SLOT_LABEL[r.slot]}</span><b>${esc(r.p.title)}</b>${sticker(r.p.cat, 'sm')}</label>`).join('')}</div>`).join('')}
    <button class="btn primary big" data-apply>${ICON.check}Übernehmen</button>`, { tall: true });
  sheet.querySelector('[data-apply]').addEventListener('click', async () => {
    const moves = [...sheet.querySelectorAll('input[data-id]:checked')].map((c) => ({ id: c.dataset.id, day: c.dataset.day, slot: c.dataset.slot }));
    try { const r = await mutate('/plan/apply', { method: 'POST', body: { moves } }); closeSheet(); toast(`${r.applied} Orte eingeplant`); } catch (e) { toast(e.message); }
  });
}

// ---------- Einladungslink anzeigen ----------
export function showLink(name, token) {
  const url = `${location.origin}/?k=${token}`;
  const text = `Dein persönlicher Link für unsere Reise ${trip().name}: ${url}\nAm iPhone in Safari öffnen, dann Teilen und Zum Home-Bildschirm.`;
  const sheet = openSheet(`
    <div class="sh-head"><h2>Link für ${esc(name)}</h2><button class="icon" data-close aria-label="Schließen">${ICON.close}</button></div>
    <p class="hint">Der Link funktioniert wie ein Schlüssel. Schick ihn nur an ${esc(name)}.</p>
    <input class="linkbox" readonly value="${esc(url)}">
    <div class="row-btns">
      ${navigator.share ? `<button class="btn primary" data-share>${ICON.send}Teilen</button>` : ''}
      <button class="btn" data-copy>${ICON.link}Kopieren</button>
    </div>`);
  sheet.querySelector('[data-copy]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast('Link kopiert'); } catch { sheet.querySelector('.linkbox').select(); }
  });
  sheet.querySelector('[data-share]')?.addEventListener('click', () => navigator.share({ text }).catch(() => {}));
}

register({
  openPlace: (el) => openPlace(el.dataset.id),
  toggleHeart: async (el, e) => {
    e.stopPropagation();
    mutate(`/places/${el.dataset.id}/heart`, { method: 'POST' }, localHeart(el.dataset.id)).catch((err) => toast(err.message));
  },
  addIdea: (el) => openAddIdea({ day: el.dataset.day || null, slot: el.dataset.slot || null }),
  ask: (el) => openAsk(el.dataset.q || ''),
  suggest: () => openSuggest(),
  reload: () => refresh().catch((e) => toast(e.message)),
});
