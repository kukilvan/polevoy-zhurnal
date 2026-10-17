// «🔎 Значки без номеров»: план чертежа с увеличением; нажал на значок → нашлись такие же → убрать лишние (нажатием или рамкой),
// добавить пропущенные вручную → тип, кабели, буквы номера → номера по областям (W01, W02…). Можно несколько видов значков подряд,
// добавленный вид можно открыть снова (✏️) и поправить. В режиме правки чертежа группы — уже существующие точки (с id).
import { h, openModal, toast } from '../ui.js';
import { regionOrder, numberLabels } from '../../tohnit/icons.js';
import { typePicker, cablesFor } from './tohnitview.js';
import { createViewer, mark } from './planview.js';

const COLORS = ['#e0007a', '#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff453a', '#64d2ff'];
export const ICON_NOTE = 'значок без номера на чертеже — номер дан приложением';

// буквы и номер из обозначений группы: A01…A71 → { prefix: 'A', from: 1, digits: 2 }
function guessNumbering(labels) {
  const ms = labels.map((l) => String(l).match(/^(.*?)(\d+)$/)).filter(Boolean);
  if (!ms.length) return { prefix: '', from: 1, digits: 2 };
  const prefix = ms[0][1]; const nums = ms.filter((m) => m[1] === prefix).map((m) => +m[2]);
  return { prefix, from: nums.length ? Math.min(...nums) : 1, digits: ms[0][2].length };
}

// wk — фоновый разборщик (open уже сделан); pages — [{w,h}]; floor — этаж; groups — уже добавленные (для повторного открытия / правки)
export function iconsPicker({ wk, pages, floor = '', sheet = '', groups = [], onDone, title = '🔎 Значки без номеров' }) {
  let mode = 'pick'; let found = null; let off = new Set(); let start = null; let editing = null; // текущий вид значка
  const done = groups.map((g) => ({ ...g, points: g.points.map((p) => ({ ...p })) }));
  const faded = () => mode === 'pick' || mode === 'add';  // ищем новые — уже добавленные бледные, чтобы не мешали
  const viewer = createViewer({ wk, pages, onTap: (x, y, page) => tap(x, y, page), rectMode: () => mode === 'rect' && !!found,
    onRect: (b, page) => { found.items.forEach((it, i) => { if ((it.page || 0) === page && it.x >= b[0] && it.x <= b[2] && it.y >= b[1] && it.y <= b[3]) off.add(i); }); refresh(); },
    overlay: (g, api) => {
      const pg = api.page; const m = (it, c, l, o) => { if ((it.page || 0) === pg) mark(g, api, it, c, l, o); };
      done.forEach((gr, i) => gr.points.forEach((p) => {
        if (!faded()) { m(p.pos, COLORS[i % COLORS.length], p.label); return; }
        if ((p.pos.page || 0) !== pg) return;
        const [x, y] = api.toScr(p.pos.x, p.pos.y); const r = Math.max(6, (Math.max(p.pos.w || 8, p.pos.h || 8) / 2 + 2) * api.view.s);
        g.fillStyle = 'rgba(255,255,255,.92)'; g.strokeStyle = '#d6d6d6'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
      }));
      if (!found) return;
      const o = ordered(); const lab = labelsNow(); const idx = new Map(o.map((it, i) => [it, i]));
      found.items.forEach((it, i) => m(it, off.has(i) ? '#8e8e93' : '#e0007a', off.has(i) ? '' : lab[idx.get(it)], { crossed: off.has(i) }));
      if (o.length > 1 && api.view.s > 0.2) { g.strokeStyle = 'rgba(224,0,122,.35)'; g.lineWidth = 1; g.beginPath(); let first = true; o.forEach((it) => { if ((it.page || 0) !== pg) return; const [x, y] = api.toScr(it.x, it.y); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }); g.stroke(); }
    } });
  const drawAll = () => viewer.draw();
  const info = h('div', { style: { margin: '8px 0', fontWeight: 600 } });
  const modeBtns = {};
  const setMode = (m) => { mode = m; Object.entries(modeBtns).forEach(([k, b]) => { b.className = k === m ? '' : 'sec'; }); drawAll(); };
  const mb = (k, t) => { modeBtns[k] = h('button', { type: 'button', class: 'sec', style: { padding: '6px 10px' }, onclick: () => setMode(k) }, t); return modeBtns[k]; };
  const tools = h('div', { class: 'btns', style: { marginTop: 0 } }, mb('pick', '👆 Значок'), mb('add', '➕ Вручную'), mb('off', '🚫 Убрать/вернуть'), mb('rect', '▭ Убрать рамкой'), mb('start', '1️⃣ Начать отсюда'), ...viewer.zoomBtns());
  setMode('pick');

  // параметры вида значка
  let typeId = '';
  const cab = cablesFor(() => {});
  const tp = typePicker({ onChange: (v) => { typeId = v; cab.set(v); } });
  const setType = (t) => { const sel = tp.querySelector('select'); if (![...sel.options].some((o) => o.value === t)) sel.append(h('option', { value: t }, t)); sel.value = t; typeId = t; cab.set(t); };
  const prefIn = h('input', { type: 'text', placeholder: 'например W, C, 1D', style: { width: '110px' }, autocapitalize: 'characters', oninput: () => drawAll() });
  const fromIn = h('input', { type: 'text', inputMode: 'numeric', value: '1', style: { width: '60px' }, oninput: () => drawAll() });
  const digIn = h('input', { type: 'text', inputMode: 'numeric', value: '2', style: { width: '50px' }, oninput: () => drawAll() });
  const addBtn = h('button', { disabled: true, onclick: () => addGroup() }, '✔ Добавить');
  const cancel = () => { if (editing) { done.splice(editing.index, 0, editing.group); editing = null; } found = null; off = new Set(); start = null; refresh(); };
  const form = h('div', { class: 'card', style: { margin: '8px 0', display: 'none' } },
    h('label', { class: 'field' }, h('span', {}, 'Тип точки'), tp), cab.box,
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'end' } },
      h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'Буквы номера'), prefIn),
      h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'С номера'), fromIn),
      h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'Цифр'), digIn)),
    h('div', { class: 'mut', style: { margin: '6px 0' } }, 'Номера идут по областям: значки, стоящие кучно, — одна область; в ней строками слева направо, сверху вниз; потом следующая область. «1️⃣ Начать отсюда» — с какого значка начать. Пропущенный значок — «➕ Вручную».'),
    h('div', { class: 'btns' }, addBtn, h('button', { class: 'sec', onclick: cancel }, 'Отмена')));
  const list = h('div', {});
  const finish = h('button', { onclick: () => { if (found) { toast('Сначала «Добавить» или «Отмена» для текущего вида значков'); return; } onDone?.(done); close(); } });

  const ordered = () => { if (!found) return []; const its = found.items.filter((_, i) => !off.has(i)); return regionOrder(its, start && its.includes(start) ? start : null); };
  const labelsNow = () => { const o = ordered(); return numberLabels(prefIn.value.trim(), o.length, { from: Math.max(0, parseInt(fromIn.value, 10) || 1), digits: Math.min(6, Math.max(0, parseInt(digIn.value, 10) || 0)) }); };

  function refresh() {
    const n = found ? found.items.length - off.size : 0;
    info.textContent = found ? `${editing ? 'Правка: ' : 'Найдено: '}${found.what} — ${found.items.length}${off.size ? `, убрано ${off.size}` : ''} → будет точек: ${n}`
      : mode === 'add' ? 'Нажмите на план, где стоит пропущенный значок.' : 'Нажмите на значок на плане (увеличьте пальцами или колёсиком).';
    form.style.display = found ? '' : 'none';
    addBtn.textContent = `✔ ${editing ? 'Сохранить' : 'Добавить'} точек: ${n}`; addBtn.disabled = !n;
    list.replaceChildren(...done.map((gr, i) => h('div', { class: 'item' },
      h('div', { class: 'name', style: { color: COLORS[i % COLORS.length] } }, `${gr.typeId}: ${gr.points.length} шт. (${gr.points[0]?.label}…${gr.points[gr.points.length - 1]?.label})`, h('div', { class: 'sub' }, gr.what)),
      h('button', { class: 'sec', style: { padding: '4px 10px' }, onclick: () => editGroup(i) }, '✏️'),
      h('button', { class: 'sec', style: { padding: '4px 10px' }, onclick: () => { done.splice(i, 1); refresh(); } }, '✖'))));
    const total = done.reduce((s, gr) => s + gr.points.length, 0);
    finish.textContent = `Готово (${total} точек)`;
    drawAll();
  }
  // открыть добавленный вид значков снова: добавить пропущенные, убрать лишние, поменять тип/номера — номера пересчитаются
  function editGroup(i) {
    if (found) { toast('Сначала «Добавить» или «Отмена» для текущего вида значков'); return; }
    const gr = done.splice(i, 1)[0]; editing = { index: i, group: gr };
    found = { what: gr.what, items: gr.points.map((p) => ({ ...p.pos, id: p.id })) }; off = new Set(); start = null;
    const g = guessNumbering(gr.points.map((p) => p.label)); prefIn.value = g.prefix; fromIn.value = String(g.from); digIn.value = String(g.digits);
    setType(gr.typeId); cab.p.setList(gr.points[0]?.cableOverride ?? null);
    setMode('off'); refresh();
  }
  function addGroup() {
    if (!typeId) { toast('Выберите тип точки'); return; }
    const o = ordered(); const labels = labelsNow(); const own = cab.own();
    const points = o.map((it, i) => ({ ...(it.id ? { id: it.id } : {}), label: labels[i], typeId, cabinet: '', floor, note: ICON_NOTE, pos: { page: it.page || 0, x: it.x, y: it.y, w: it.w, h: it.h }, cableOverride: own || null }));
    const clash = new Set(done.flatMap((gr) => gr.points.map((p) => p.label)));
    if (points.some((p) => clash.has(p.label))) { toast('Такие номера уже есть в другом виде значков — поменяйте буквы или «с номера»'); return; }
    done.splice(editing ? editing.index : done.length, 0, { what: found.what, typeId, points });
    editing = null; found = null; off = new Set(); start = null; setMode('pick'); refresh();
  }

  async function tap(x, y, page) {
    const nearest = () => { let best = -1; let bd = Infinity; found.items.forEach((it, i) => { if ((it.page || 0) !== page) return; const d = Math.hypot(it.x - x, it.y - y) * viewer.view.s; if (d < bd) { bd = d; best = i; } }); return bd < 30 ? best : -1; };
    if (mode === 'off' && found) { const i = nearest(); if (i >= 0) { off.has(i) ? off.delete(i) : off.add(i); refresh(); } return; }
    if (mode === 'start' && found) { const i = nearest(); if (i >= 0) { start = found.items[i]; off.delete(i); refresh(); setMode('off'); } return; }
    if (mode === 'add') {  // пропущенный значок: ближайшая надпись (рамка) или значок (круг его размера); рядом ничего — маленькая отметка
      let snap = null; try { snap = await wk.call('snap', { page, x, y, r: 14 / viewer.view.s }); } catch { /* без привязки */ }
      const w = found?.items[0]?.w || 12; const hh = found?.items[0]?.h || 12;
      const it = snap ? { page, x: snap.x, y: snap.y, w: snap.w, h: snap.h } : { page, x: +x.toFixed(1), y: +y.toFixed(1), w, h: hh };
      if (found?.items.some((f) => (f.page || 0) === page && Math.hypot(f.x - it.x, f.y - it.y) < 2)) { toast('Здесь уже отмечено'); return; }
      if (!found) found = { what: 'отмечено вручную', items: [] };
      found.items.push(it); refresh(); if (snap) toast(snap.kind === 'text' ? `Надпись «${snap.label}»` : 'Значок'); return;
    }
    if (mode !== 'pick') return;
    info.textContent = 'Ищу такие же…';
    try {
      const r = await wk.call('pick', { page, x, y, pad: 8 / viewer.view.s });
      if (!r || !r.items.length) { info.textContent = 'Здесь значка не нашлось — увеличьте и нажмите точно на значок (или «➕ Вручную»).'; return; }
      // уже добавленные места не предлагаем второй раз
      const taken = done.flatMap((gr) => gr.points.map((p) => p.pos));
      r.items = r.items.filter((it) => !taken.some((p) => (p.page || 0) === (it.page || 0) && Math.hypot(p.x - it.x, p.y - it.y) < 2));
      if (!r.items.length) { info.textContent = 'Все такие значки уже добавлены.'; return; }
      if (found && !editing) { // добавить к текущему виду (например, тот же тип другим значком)
        const add = r.items.filter((it) => !found.items.some((f) => Math.hypot(f.x - it.x, f.y - it.y) < 2)); found.items.push(...add);
      } else if (found && editing) { found.items.push(...r.items.filter((it) => !found.items.some((f) => Math.hypot(f.x - it.x, f.y - it.y) < 2))); }
      else { found = r; off = new Set(); start = null; if (r.text && !prefIn.value) prefIn.value = /^[A-Za-z]{1,3}\d?$/.test(r.text) ? r.text : ''; }
      refresh(); setMode('off');
      toast(`Найдено: ${r.items.length}. Лишние (легенда, детали) — уберите нажатием или рамкой.`);
    } catch (e) { info.textContent = `Не получилось: ${e.message}`; }
  }

  const pageSel = pages.length > 1 ? h('select', { onchange: (e) => { viewer.load(+e.target.value); } }, pages.map((_, i) => h('option', { value: i }, `Лист ${i + 1}`))) : null;
  const close = openModal(title, h('div', {},
    h('div', { class: 'mut' }, `${sheet ? `${sheet}. ` : ''}1) Нажмите на значок — приложение найдёт такие же. 2) Лишние уберите: «🚫» нажатием или «▭» рамкой (легенда, детали); пропущенные — «➕ Вручную». 3) Тип, кабели, буквы номера → «Добавить». Повторите для других значков; ✏️ — поправить добавленные.`),
    pageSel, tools, viewer.el, info, form,
    h('div', { class: 'group', style: { margin: '10px 2px 4px' } }, 'Добавлено'), list,
    h('div', { class: 'btns' }, finish)), { sticky: true, wide: true });
  viewer.start().catch((e) => { info.textContent = `Не получилось показать лист: ${e.message}`; });
  refresh();
}
