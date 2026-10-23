// Движок тура: затемнение с «окном» вокруг нужного элемента, подпись и кнопка «Далее».
// Шаг: { title, text, sel (функция → элемент или null), go (подготовка экрана), click (ждём нажатия на подсвеченное) }
import { h } from '../ui.js';
import { tr } from '../../i18n/index.js';

const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
/** Найти видимый элемент по селектору и тексту */
// текст сравнивается и по-русски, и в переводе (интерфейс может быть на другом языке)
export const find = (sel, text) => () => [...document.querySelectorAll(sel)].filter((e) => !e.closest('.tour-ui') && vis(e) && (!text || e.textContent.includes(text) || e.textContent.includes(tr(text))))[0] || null;
/** Окно (модальное) поверх приложения */
export const sheet = () => [...document.querySelectorAll('.backdrop .sheet')].filter(vis).pop() || null;
export const closeModals = () => { [...document.querySelectorAll('.backdrop .sheet-head .x')].reverse().forEach((b) => b.click()); };

let cur = null;
export const tourActive = () => !!cur;

/** Запуск: steps — плоский список шагов; onEnd(done) вызывается при выходе или завершении */
export function runSteps(steps, { onEnd } = {}) {
  stop(false);
  const dim = [0, 1, 2, 3, 4].map(() => h('div', { class: 'tour-dim' }));   // 4 стороны + крышка поверх «окна» (если нажимать не нужно)
  const ring = h('div', { class: 'tour-ring' });
  const cap = h('div', { class: 'tour-cap tour-ui' });
  const layer = h('div', { class: 'tour-layer' }, ...dim, ring, cap);
  document.body.appendChild(layer); document.body.classList.add('tour-on');
  const st = { i: -1, steps, layer, dim, ring, cap, timer: null, target: null, since: 0, onEnd, ended: false };
  cur = st;
  st.timer = setInterval(() => tick(st), 150);
  document.addEventListener('click', onDocClick, true);
  window.addEventListener('resize', () => tick(st, true));
  show(st, 0);
  return () => stop(false);
}

function onDocClick(e) {
  const st = cur; if (!st) return;
  const step = st.steps[st.i];
  if (!step?.click || !st.target || st.advancing) return;
  if (st.target.contains(e.target)) { st.advancing = true; setTimeout(() => { if (cur === st) next(st); }, 450); }
}

async function show(st, i) {
  if (i >= st.steps.length) { stop(true); return; }
  st.i = i; st.target = null; st.advancing = false; st.since = Date.now();
  const step = st.steps[i];
  if (step.go) { if (step.keepModals !== true) closeModals(); await step.go(); }
  if (cur !== st) return;
  draw(st);
  dock(st); tick(st, true);
}

function next(st) { show(st, st.i + 1); }
function prev(st) { show(st, Math.max(0, st.i - 1)); }

function draw(st) {
  const step = st.steps[st.i]; const n = st.steps.length;
  const last = st.i === n - 1;
  const btns = h('div', { class: 'tour-btns' },
    h('button', { class: 'sec', onclick: () => stop(false) }, 'Выйти'),
    ...(st.i > 0 ? [h('button', { class: 'sec', onclick: () => prev(st) }, '←')] : []),
    step.click
      ? h('button', { class: 'sec', title: 'Нажать за вас', onclick: () => { const t = st.target; if (t) t.click(); else next(st); } }, 'Нажать за меня')
      : h('button', { onclick: () => next(st) }, last ? 'Готово' : 'Далее'));
  st.cap.replaceChildren(...[
    h('div', { class: 'tour-count' }, `${st.i + 1} из ${n}`, step.topic ? ' · ' : '', step.topic || ''),
    step.title ? h('b', { class: 'tour-title' }, step.title) : null,
    h('div', { class: 'tour-text' }, step.text),
    step.click ? h('div', { class: 'tour-tap' }, '👆 Нажмите на подсвеченное') : null,
    btns].filter(Boolean));
}

function place(st, rect) {
  const W = window.innerWidth; const H = window.innerHeight;
  const dim = st.dim; const set = (el, l, t, w, hh) => Object.assign(el.style, { left: `${l}px`, top: `${t}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, hh)}px` });
  const step = st.steps[st.i];
  if (!rect) {
    set(dim[0], 0, 0, W, H); [1, 2, 3, 4].forEach((k) => set(dim[k], 0, 0, 0, 0));
    st.ring.style.display = 'none';
    dock(st);
    return;
  }
  const pad = 6;
  const l = Math.max(0, rect.left - pad); const t = Math.max(0, rect.top - pad); const r = Math.min(W, rect.right + pad); const b = Math.min(H, rect.bottom + pad);
  set(dim[0], 0, 0, W, t); set(dim[1], 0, b, W, H - b); set(dim[2], 0, t, l, b - t); set(dim[3], r, t, W - r, b - t);
  set(dim[4], l, t, r - l, b - t);   // крышка над окном: не даёт нажать, пока шаг без нажатия
  dim[4].style.background = 'transparent'; dim[4].style.display = step.click ? 'none' : '';
  Object.assign(st.ring.style, { display: '', left: `${l}px`, top: `${t}px`, width: `${r - l}px`, height: `${b - t}px` });
  dock(st);
}

// Подпись закреплена вверху, приложение сдвинуто вниз (см. .tour-on в style.css): окна приложения занимают всё место под подписью
function dock(st) {
  const hh = Math.ceil(st.cap.getBoundingClientRect().bottom) + 8;
  if (hh !== st.dockH) { st.dockH = hh; document.documentElement.style.setProperty('--tour-h', `${hh}px`); }
}

function tick(st, force = false) {
  if (cur !== st) return;
  const step = st.steps[st.i]; if (!step) return;
  let el = null;
  try { el = typeof step.sel === 'function' ? step.sel() : null; } catch { el = null; }
  if (el && el !== st.target) { st.target = el; try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch { /* ok */ } force = true; }
  if (!el) st.target = null;
  const rect = el ? el.getBoundingClientRect() : null;
  const key = rect ? `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}` : 'none';
  if (force || key !== st.lastKey) { st.lastKey = key; place(st, rect && !step.center ? rect : null); }
}

function stop(done) {
  const st = cur; if (!st) return;
  cur = null; clearInterval(st.timer);
  document.removeEventListener('click', onDocClick, true);
  st.layer.remove(); document.body.classList.remove('tour-on'); document.documentElement.style.removeProperty('--tour-h');
  if (!st.ended) { st.ended = true; st.onEnd?.(done); }
}
export const endTour = () => stop(false);
