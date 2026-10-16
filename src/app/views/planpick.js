// «🔎 Значки без номеров»: план чертежа с увеличением; нажал на значок → нашлись такие же → убрать лишние (нажатием или рамкой) →
// тип, кабели, буквы номера → номера цепочкой по соседям (W01, W02…). Можно несколько видов значков подряд.
import { h, openModal, toast } from '../ui.js';
import { chainOrder, numberLabels } from '../../tohnit/icons.js';
import { typePicker, cablesFor } from './tohnitview.js';
import { createViewer, mark } from './planview.js';

const COLORS = ['#e0007a', '#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff453a', '#64d2ff'];

// wk — фоновый разборщик (open уже сделан); pages — [{w,h}]; floor — этаж; groups — уже добавленные (для повторного открытия)
export function iconsPicker({ wk, pages, floor = '', sheet = '', groups = [], onDone }) {
  let mode = 'pick'; let found = null; let off = new Set(); let start = null; // текущий вид значка
  const done = groups.map((g) => ({ ...g }));
  const viewer = createViewer({ wk, pages, onTap: (x, y, page) => tap(x, y, page), rectMode: () => mode === 'rect' && !!found,
    onRect: (b, page) => { found.items.forEach((it, i) => { if ((it.page || 0) === page && it.x >= b[0] && it.x <= b[2] && it.y >= b[1] && it.y <= b[3]) off.add(i); }); refresh(); },
    overlay: (g, api) => {
      const pg = api.page; const m = (it, c, l, o) => { if ((it.page || 0) === pg) mark(g, api, it, c, l, o); };
      done.forEach((gr, i) => gr.points.forEach((p) => m(p.pos, COLORS[i % COLORS.length], p.label)));
      if (!found) return;
      const o = ordered(); const lab = labelsNow(); const idx = new Map(o.map((it, i) => [it, i]));
      found.items.forEach((it, i) => m(it, off.has(i) ? '#8e8e93' : '#e0007a', off.has(i) ? '' : lab[idx.get(it)], { crossed: off.has(i) }));
      if (o.length > 1 && api.view.s > 0.2) { g.strokeStyle = 'rgba(224,0,122,.35)'; g.lineWidth = 1; g.beginPath(); let first = true; o.forEach((it) => { if ((it.page || 0) !== pg) return; const [x, y] = api.toScr(it.x, it.y); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }); g.stroke(); }
    } });
  const drawAll = () => viewer.draw();
  const info = h('div', { style: { margin: '8px 0', fontWeight: 600 } });
  const modeBtns = {};
  const setMode = (m) => { mode = m; Object.entries(modeBtns).forEach(([k, b]) => { b.className = k === m ? '' : 'sec'; }); };
  const mb = (k, t) => { modeBtns[k] = h('button', { type: 'button', class: 'sec', style: { padding: '6px 10px' }, onclick: () => setMode(k) }, t); return modeBtns[k]; };
  const tools = h('div', { class: 'btns', style: { marginTop: 0 } }, mb('pick', '👆 Значок'), mb('off', '🚫 Убрать/вернуть'), mb('rect', '▭ Убрать рамкой'), mb('start', '1️⃣ Начать отсюда'), ...viewer.zoomBtns());
  setMode('pick');

  // параметры вида значка
  let typeId = '';
  const cab = cablesFor(() => {});
  const tp = typePicker({ onChange: (v) => { typeId = v; cab.set(v); } });
  const prefIn = h('input', { type: 'text', placeholder: 'например W, C, 1D', style: { width: '110px' }, autocapitalize: 'characters', oninput: () => drawAll() });
  const fromIn = h('input', { type: 'text', inputMode: 'numeric', value: '1', style: { width: '60px' }, oninput: () => drawAll() });
  const digIn = h('input', { type: 'text', inputMode: 'numeric', value: '2', style: { width: '50px' }, oninput: () => drawAll() });
  const addBtn = h('button', { disabled: true, onclick: () => addGroup() }, '✔ Добавить');
  const form = h('div', { class: 'card', style: { margin: '8px 0', display: 'none' } },
    h('label', { class: 'field' }, h('span', {}, 'Тип точки'), tp), cab.box,
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'end' } },
      h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'Буквы номера'), prefIn),
      h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'С номера'), fromIn),
      h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'Цифр'), digIn)),
    h('div', { class: 'mut', style: { margin: '6px 0' } }, 'Номера идут цепочкой по соседям от верхнего левого значка (или от выбранного «1️⃣ Начать отсюда»).'),
    h('div', { class: 'btns' }, addBtn, h('button', { class: 'sec', onclick: () => { found = null; off = new Set(); start = null; refresh(); } }, 'Отмена')));
  const list = h('div', {});
  const finish = h('button', { onclick: () => { onDone?.(done); close(); } });

  const ordered = () => { if (!found) return []; const its = found.items.filter((_, i) => !off.has(i)); return chainOrder(its, start); };
  const labelsNow = () => { const o = ordered(); return numberLabels(prefIn.value.trim(), o.length, { from: Math.max(0, parseInt(fromIn.value, 10) || 1), digits: Math.min(6, Math.max(0, parseInt(digIn.value, 10) || 0)) }); };

  function refresh() {
    const n = found ? found.items.length - off.size : 0;
    info.textContent = found ? `Найдено: ${found.what} — ${found.items.length}${off.size ? `, убрано ${off.size}` : ''} → будет точек: ${n}` : 'Нажмите на значок на плане (увеличьте пальцами или колёсиком).';
    form.style.display = found ? '' : 'none';
    addBtn.textContent = `✔ Добавить точек: ${n}`; addBtn.disabled = !n;
    list.replaceChildren(...done.map((gr, i) => h('div', { class: 'item' },
      h('div', { class: 'name', style: { color: COLORS[i % COLORS.length] } }, `${gr.typeId}: ${gr.points.length} шт. (${gr.points[0]?.label}…${gr.points[gr.points.length - 1]?.label})`, h('div', { class: 'sub' }, gr.what)),
      h('button', { class: 'sec', style: { padding: '4px 10px' }, onclick: () => { done.splice(i, 1); refresh(); } }, '✖'))));
    const total = done.reduce((s, gr) => s + gr.points.length, 0);
    finish.textContent = `Готово (${total} точек)`;
    drawAll();
  }
  function addGroup() {
    if (!typeId) { toast('Выберите тип точки'); return; }
    const o = ordered(); const labels = labelsNow(); const own = cab.own();
    const points = o.map((it, i) => ({ label: labels[i], typeId, cabinet: '', floor, note: 'значок без номера на чертеже — номер дан приложением', pos: { page: it.page, x: it.x, y: it.y, w: it.w, h: it.h }, ...(own ? { cableOverride: own } : {}) }));
    const clash = new Set(done.flatMap((gr) => gr.points.map((p) => p.label)));
    if (points.some((p) => clash.has(p.label))) { toast('Такие номера уже есть в другом виде значков — поменяйте буквы или «с номера»'); return; }
    done.push({ what: found.what, typeId, points });
    found = null; off = new Set(); start = null; refresh();
  }

  async function tap(x, y, page) {
    const nearest = () => { let best = -1; let bd = Infinity; found.items.forEach((it, i) => { if ((it.page || 0) !== page) return; const d = Math.hypot(it.x - x, it.y - y) * viewer.view.s; if (d < bd) { bd = d; best = i; } }); return bd < 30 ? best : -1; };
    if (mode === 'off' && found) { const i = nearest(); if (i >= 0) { off.has(i) ? off.delete(i) : off.add(i); refresh(); } return; }
    if (mode === 'start' && found) { const i = nearest(); if (i >= 0) { start = found.items[i]; off.delete(i); refresh(); setMode('off'); } return; }
    if (mode !== 'pick') return;
    info.textContent = 'Ищу такие же…';
    try {
      const r = await wk.call('pick', { page, x, y, pad: 8 / viewer.view.s });
      if (!r || !r.items.length) { info.textContent = 'Здесь значка не нашлось — увеличьте и нажмите точно на значок.'; return; }
      found = r; off = new Set(); start = null;
      if (r.text && !prefIn.value) prefIn.value = /^[A-Za-z]{1,3}\d?$/.test(r.text) ? r.text : '';
      refresh(); setMode('off');
      toast(`Найдено: ${r.items.length}. Лишние (легенда, детали) — уберите нажатием или рамкой.`);
    } catch (e) { info.textContent = `Не получилось: ${e.message}`; }
  }

  const pageSel = pages.length > 1 ? h('select', { onchange: (e) => { viewer.load(+e.target.value); } }, pages.map((_, i) => h('option', { value: i }, `Лист ${i + 1}`))) : null;
  const close = openModal('🔎 Значки без номеров', h('div', {},
    h('div', { class: 'mut' }, `${sheet ? `${sheet}. ` : ''}1) Нажмите на значок — приложение найдёт такие же. 2) Лишние уберите: «🚫» нажатием или «▭» рамкой (легенда, детали). 3) Тип, кабели, буквы номера → «Добавить». Повторите для других значков.`),
    pageSel, tools, viewer.el, info, form,
    h('div', { class: 'group', style: { margin: '10px 2px 4px' } }, 'Добавлено'), list,
    h('div', { class: 'btns' }, finish)), { sticky: true, wide: true });
  viewer.start().catch((e) => { info.textContent = `Не получилось показать лист: ${e.message}`; });
  refresh();
}
