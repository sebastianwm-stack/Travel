// Ziehen und Ablegen im Ablauf: Stopp am Griff fassen, in einen anderen Abschnitt oder auf einen Tag ziehen.
// Läuft mit Pointer-Events (Finger und Maus). Ziele: section.slot[data-slot] und die Tages-Chips [data-day].
export function mountDrag(root, onDrop) {
  root.querySelectorAll('[data-drag]').forEach((h) => h.addEventListener('pointerdown', (e) => start(e, h, root, onDrop)));
}

function start(e, handle, root, onDrop) {
  if (e.button > 0) return;
  e.preventDefault();
  const card = handle.closest('.row-card');
  const id = handle.dataset.drag;
  const r = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add('drag-ghost');
  Object.assign(ghost.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
  document.body.appendChild(ghost);
  card.classList.add('dragging');
  const line = document.createElement('div');
  line.className = 'drop-line';
  const dy = e.clientY - r.top, dx = e.clientX - r.left;
  let target = null, scrollTimer = null, lastY = e.clientY;
  handle.setPointerCapture?.(e.pointerId);
  navigator.vibrate?.(8);

  const clear = () => { root.querySelectorAll('.drop-on').forEach((x) => x.classList.remove('drop-on')); line.remove(); };
  const find = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const chip = el?.closest?.('.chips.days [data-day]');
    if (chip) return { kind: 'day', el: chip, day: chip.dataset.day };
    const sec = el?.closest?.('section.slot[data-slot]');
    if (!sec) return null;
    // Einfügestelle: vor dem ersten Stopp, dessen Mitte unter dem Finger liegt
    const cards = [...sec.querySelectorAll('.row-card')].filter((c) => c !== card);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) { const b = cards[i].getBoundingClientRect(); if (y < b.top + b.height / 2) { index = i; break; } }
    return { kind: 'slot', el: sec, slot: sec.dataset.slot, day: sec.dataset.day, index, before: cards[index] || null, cards };
  };
  const move = (ev) => {
    lastY = ev.clientY;
    ghost.style.transform = `translate(${ev.clientX - dx - r.left}px, ${ev.clientY - dy - r.top}px) rotate(-1.5deg)`;
    clear();
    target = find(ev.clientX, ev.clientY);
    if (!target) return;
    target.el.classList.add('drop-on');
    if (target.kind === 'slot') {
      if (target.before) target.before.before(line);
      else (target.cards.at(-1) || target.el.querySelector('.slot-h'))?.after(line);
    }
  };
  // am Rand automatisch scrollen
  scrollTimer = setInterval(() => {
    const edge = 70, h = window.innerHeight;
    if (lastY < edge) window.scrollBy(0, -12); else if (lastY > h - edge - 70) window.scrollBy(0, 12);
  }, 16);
  const end = (ev, cancel = false) => {
    clearInterval(scrollTimer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancelFn);
    clear();
    ghost.remove();
    card.classList.remove('dragging');
    if (!cancel && target) onDrop({ id, ...target, el: undefined, cards: undefined, before: undefined });
  };
  const up = (ev) => end(ev);
  const cancelFn = (ev) => end(ev, true);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancelFn);
  move(e);
}
