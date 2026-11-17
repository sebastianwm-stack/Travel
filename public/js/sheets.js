// Bottom-Sheets: Ort im Detail, neue Idee, Reisebegleiter, Tagesvorschlag, Einladungslink.
import { esc, linkify, ICON, avatar, openSheet, closeSheet, toast, fmtChip, fmtShort, ago } from './ui.js';
import { api, fileUrl } from './api.js';
import { S, mutate, place, heartsOf, iHeart, commentsOf, member, me, trip, refresh } from './state.js';
import { sticker, avatars, routeUrl, register, photo, resolveImages } from './components.js';
import { findImage } from './images.js';
import { CAT_NAMES } from './themes.js';

// ---------- Kommentare (für Orte, Tage, ganze Reise) ----------
export function thread(target, { placeholder = 'Schreib was dazu …' } = {}) {
  const list = commentsOf(target);
  return `<div class="thread" data-target="${esc(target)}">
    ${list.map(commentHTML).join('') || '<p class="hint">Noch keine Kommentare.</p>'}
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
    const gmaps = p.url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.title} ${p.area || ''} ${trip().dest || ''}`)}`;
    const sheet = openSheet(`
      <div class="sh-head">${sticker(p.cat)}<button class="icon" data-close aria-label="Schließen">${ICON.close}</button></div>
      ${p.image ? `<figure class="sh-ph">${photo(p)}${p.imageCredit?.t ? `<figcaption>${p.imageCredit.l ? `<a href="${esc(p.imageCredit.l)}" target="_blank" rel="noopener">Foto: ${esc(p.imageCredit.t)}</a>` : `Foto: ${esc(p.imageCredit.t)}`}</figcaption>` : ''}</figure>` : ''}
      <h2>${esc(p.title)}</h2>
      ${p.area ? `<p class="ar">${esc(p.area)}</p>` : ''}
      ${p.note ? `<p class="note big">${linkify(p.note)}</p>` : ''}
      <div class="row-btns">
        <button class="btn heartbtn ${mine ? 'on' : ''}" data-h>${mine ? ICON.heartFill : ICON.heart}${mine ? 'Gemerkt' : 'Will ich'}</button>
        <a class="btn" href="${routeUrl(p)}" target="_blank" rel="noopener">${ICON.route}Route</a>
        <a class="btn" href="${esc(gmaps)}" target="_blank" rel="noopener">${ICON.map}Maps</a>
      </div>
      ${hs.length ? `<p class="who">${avatars(hs)} ${hs.map((m) => esc(m.name)).join(', ')} ${hs.length === 1 ? 'will' : 'wollen'} hin</p>` : ''}
      ${p.approx ? '<p class="hint">Lage nur ungefähr, bis die Google-Maps-Liste abgeglichen ist.</p>' : ''}

      <h4>Wann?</h4>
      <div class="chips wrap">
        <button class="chip ${!p.day ? 'on' : ''}" data-day="">Ohne Tag</button>
        ${trip().days.map((d) => `<button class="chip ${p.day === d ? 'on' : ''}" data-day="${d}">${fmtChip(d)}</button>`).join('')}
      </div>
      <div class="when">
        <label>Uhrzeit <input type="time" value="${esc(p.time)}" data-time ${p.day ? '' : 'disabled'}></label>
        <label class="switch"><input type="checkbox" data-booked ${p.booked ? 'checked' : ''}> Gebucht</label>
      </div>

      <h4>Kommentare & Fotos</h4>
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
      try { await mutate(`/places/${p.id}/heart`, { method: 'POST' }); draw(); } catch (e) { toast(e.message); }
    });
    sheet.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', async () => {
      const day = b.dataset.day || null;
      try { await mutate(`/places/${p.id}`, { method: 'PATCH', body: { day, ...(day ? {} : { time: '' }) } }); draw(); toast(day ? `Auf ${fmtShort(day)} gelegt` : 'Zurück in die Ideen'); } catch (e) { toast(e.message); }
    }));
    sheet.querySelector('[data-time]').addEventListener('change', async (e) => {
      try { await mutate(`/places/${p.id}`, { method: 'PATCH', body: { time: e.target.value } }); } catch (err) { toast(err.message); }
    });
    sheet.querySelector('[data-booked]').addEventListener('change', async (e) => {
      try { await mutate(`/places/${p.id}`, { method: 'PATCH', body: { booked: e.target.checked } }); } catch (err) { toast(err.message); }
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
export function openAddIdea({ day = null } = {}) {
  current = null;
  const sheet = openSheet(`
    <div class="sh-head"><h2>Neue Idee</h2><button class="icon" data-close aria-label="Schließen">${ICON.close}</button></div>
    <p class="hint">In Google Maps auf Teilen tippen, den Link kopieren und hier einfügen. Ein Name reicht auch.</p>
    <form class="form" data-add>
      <label>Google-Maps-Link<input name="link" inputmode="url" placeholder="https://maps.app.goo.gl/…" autofocus></label>
      <label>oder Name<input name="title" maxlength="200" placeholder="z. B. Joe's Pizza"></label>
      <label>Kategorie<select name="cat"><option value="">automatisch</option>${CAT_NAMES.map((c) => `<option>${c}</option>`).join('')}</select></label>
      <label>Notiz<textarea name="note" rows="2" maxlength="2000" placeholder="Warum wollen wir da hin?"></textarea></label>
      ${day ? `<p class="hint">Landet direkt auf ${fmtShort(day)}.</p>` : ''}
      <button class="btn primary big">${ICON.plus}Hinzufügen</button>
    </form>`);
  sheet.querySelector('[data-add]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.link && !f.title) { toast('Link oder Name fehlt'); return; }
    if (!f.cat) delete f.cat;
    if (day) f.day = day;
    e.target.classList.add('busy');
    try { const r = await mutate('/places', { method: 'POST', body: f }); closeSheet(); toast('Idee ist drin'); openPlace(r.id); }
    catch (err) { toast(err.message); e.target.classList.remove('busy'); }
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
      const r = await api('/ask', { method: 'POST', body: { question: q, history: h } });
      h.push({ role: 'user', content: q }, { role: 'assistant', content: r.answer });
      saveHist(h);
      chat.querySelector('.busy').outerHTML = msgHTML({ role: 'assistant', content: r.answer });
    } catch (e) {
      chat.querySelector('.busy').outerHTML = `<div class="msg a err">${esc(e.message)}</div>`;
    }
    chat.scrollTop = chat.scrollHeight;
  };
  sheet.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => send(b.dataset.s)));
  sheet.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); send(ta.value); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(ta.value); } });
  sheet.querySelector('[data-reset]')?.addEventListener('click', () => { saveHist([]); openAsk(); });
  if (prefill) send(prefill);
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
export async function openSuggest(days) {
  current = null;
  let moves;
  try { moves = (await api('/plan/suggest', { method: 'POST', body: days ? { days } : {} })).moves; }
  catch (e) { toast(e.message); return; }
  if (!moves.length) { toast('Keine passenden Ideen ohne Tag gefunden.'); return; }
  const byDay = {};
  for (const mv of moves) (byDay[mv.day] = byDay[mv.day] || []).push(mv);
  const sheet = openSheet(`
    <div class="sh-head"><h2>${ICON.spark} Vorschlag</h2><button class="icon" data-close aria-label="Schließen">${ICON.close}</button></div>
    <p class="hint">Nahe Orte landen am selben Tag, Ideen mit vielen Herzen kommen zuerst dran. Verschieben könnt ihr danach alles.</p>
    ${Object.entries(byDay).map(([d, list]) => `<div class="sug-day"><h4>${fmtShort(d)}</h4>
      ${list.map((mv) => { const p = place(mv.id); return `<label class="sug"><input type="checkbox" checked data-mv="${mv.id}"><span class="time">${mv.time}</span>${sticker(p.cat, 'sm')}<b>${esc(p.title)}</b></label>`; }).join('')}</div>`).join('')}
    <button class="btn primary big" data-apply>${ICON.check}Übernehmen</button>`, { tall: true });
  sheet.querySelector('[data-apply]').addEventListener('click', async () => {
    const keep = new Set([...sheet.querySelectorAll('[data-mv]:checked')].map((c) => c.dataset.mv));
    try {
      const r = await mutate('/plan/apply', { method: 'POST', body: { moves: moves.filter((m) => keep.has(m.id)) } });
      closeSheet();
      toast(`${r.applied} Orte verplant`);
    } catch (e) { toast(e.message); }
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
    try { await mutate(`/places/${el.dataset.id}/heart`, { method: 'POST' }); } catch (err) { toast(err.message); }
  },
  addIdea: (el) => openAddIdea({ day: el.dataset.day || null }),
  ask: (el) => openAsk(el.dataset.q || ''),
  suggest: (el) => openSuggest(el.dataset.day ? [el.dataset.day] : null),
  reload: () => refresh().catch((e) => toast(e.message)),
});
