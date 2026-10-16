// «🔎 Значки без номеров»: план чертежа с увеличением; нажал на значок → нашлись такие же → убрать лишние (нажатием или рамкой) →
// тип, кабели, буквы номера → номера цепочкой по соседям (W01, W02…). Можно несколько видов значков подряд.
import { h, openModal, toast } from '../ui.js';
import { chainOrder, numberLabels } from '../../tohnit/icons.js';
import { typePicker, cablesFor } from './tohnitview.js';

const COLORS = ['#e0007a', '#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff453a', '#64d2ff'];

// wk — фоновый разборщик (open уже сделан); pages — [{w,h}]; floor — этаж; groups — уже добавленные (для повторного открытия)
export function iconsPicker({ wk, pages, floor = '', sheet = '', groups = [], onDone }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let page = 0; let base = null; let baseZ = 1; let tile = null; let tileTimer = null;
  const view = { s: 1, ox: 0, oy: 0 };
  let rectNow = null; let mode = 'pick'; let found = null; let off = new Set(); let start = null; // текущий вид значка
  const done = groups.map((g) => ({ ...g }));

  const wrap = h('div', { style: { position: 'relative', height: '58vh', overflow: 'hidden', background: '#fff', borderRadius: '8px', touchAction: 'none', userSelect: 'none' } });
  const cv = h('canvas', { style: { position: 'absolute', inset: 0, width: '100%', height: '100%' } }); wrap.append(cv);
  const g = cv.getContext('2d');
  const info = h('div', { style: { margin: '8px 0', fontWeight: 600 } }, 'Нажмите на значок на плане (увеличьте пальцами или колёсиком).');
  const modeBtns = {};
  const setMode = (m) => { mode = m; Object.entries(modeBtns).forEach(([k, b]) => { b.className = k === m ? '' : 'sec'; }); };
  const mb = (k, t) => { modeBtns[k] = h('button', { type: 'button', class: 'sec', style: { padding: '6px 10px' }, onclick: () => setMode(k) }, t); return modeBtns[k]; };
  const zoomBy = (f) => { const r = wrap.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); };
  const tools = h('div', { class: 'btns', style: { marginTop: 0 } }, mb('pick', '👆 Значок'), mb('off', '🚫 Убрать/вернуть'), mb('rect', '▭ Убрать рамкой'), mb('start', '1️⃣ Начать отсюда'),
    h('button', { type: 'button', class: 'sec', style: { padding: '6px 12px' }, onclick: () => zoomBy(1.5) }, '＋'),
    h('button', { type: 'button', class: 'sec', style: { padding: '6px 12px' }, onclick: () => zoomBy(1 / 1.5) }, '－'),
    h('button', { type: 'button', class: 'sec', style: { padding: '6px 10px' }, onclick: () => fit() }, '⤢ Весь лист'));
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

  // ---- рисование ----
  function size() { const r = wrap.getBoundingClientRect(); cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); return r; }
  function fit() { const r = wrap.getBoundingClientRect(); const pg = pages[page]; view.s = Math.min(r.width / pg.w, r.height / pg.h); view.ox = -(r.width / view.s - pg.w) / 2; view.oy = -(r.height / view.s - pg.h) / 2; tile = null; drawAll(); schedTile(); }
  const toScr = (x, y) => [(x - view.ox) * view.s, (y - view.oy) * view.s];
  const toPt = (sx, sy) => [sx / view.s + view.ox, sy / view.s + view.oy];
  function drawAll() {
    if (!cv.width) size();
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    if (base) g.drawImage(base, -view.ox * view.s, -view.oy * view.s, (base.width / baseZ) * view.s, (base.height / baseZ) * view.s);
    if (tile) { const [x0, y0] = toScr(tile.clip[0], tile.clip[1]); g.drawImage(tile.img, x0, y0, (tile.clip[2] - tile.clip[0]) * view.s, (tile.clip[3] - tile.clip[1]) * view.s); }
    const mark = (it, color, label, crossed) => {
      if ((it.page || 0) !== page) return;
      const [x, y] = toScr(it.x, it.y); const r = Math.max(6, (Math.max(it.w, it.h) / 2 + 2) * view.s);
      g.lineWidth = 2; g.strokeStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      if (crossed) { g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke(); }
      if (label && view.s > 0.35) { g.font = 'bold 12px system-ui'; const w = g.measureText(label).width; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(x + r, y - r - 12, w + 4, 14); g.fillStyle = color; g.fillText(label, x + r + 2, y - r); }
    };
    done.forEach((gr, i) => gr.points.forEach((p) => mark(p.pos, COLORS[i % COLORS.length], p.label)));
    if (found) {
      const o = ordered(); const lab = labelsNow(); const idx = new Map(o.map((it, i) => [it, i]));
      found.items.forEach((it, i) => mark(it, off.has(i) ? '#8e8e93' : '#e0007a', off.has(i) ? '' : lab[idx.get(it)], off.has(i)));
      if (o.length > 1 && view.s > 0.2) { g.strokeStyle = 'rgba(224,0,122,.35)'; g.lineWidth = 1; g.beginPath(); o.forEach((it, i) => { if ((it.page || 0) !== page) return; const [x, y] = toScr(it.x, it.y); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
    }
    if (rectNow) { g.strokeStyle = '#ff453a'; g.setLineDash([6, 4]); g.lineWidth = 2; g.strokeRect(rectNow[0], rectNow[1], rectNow[2] - rectNow[0], rectNow[3] - rectNow[1]); g.setLineDash([]); }
  }
  async function pngToImg(png) { const img = new Image(); img.src = URL.createObjectURL(new Blob([png], { type: 'image/png' })); await img.decode(); return img; }
  async function loadBase() {
    const pg = pages[page]; baseZ = Math.min(1, 2400 / Math.max(pg.w, pg.h));
    base = await pngToImg(await wk.call('crop', { page, clip: [0, 0, pg.w, pg.h], zoom: baseZ })); fit();
  }
  function schedTile() {  // чёткая картинка видимой части при увеличении
    clearTimeout(tileTimer);
    tileTimer = setTimeout(async () => {
      const r = wrap.getBoundingClientRect(); const z = Math.min(8, view.s * dpr);
      if (z <= baseZ * 1.2) { tile = null; drawAll(); return; }
      const pg = pages[page]; const [x0, y0] = toPt(0, 0); const [x1, y1] = toPt(r.width, r.height);
      const clip = [Math.max(0, x0), Math.max(0, y0), Math.min(pg.w, x1), Math.min(pg.h, y1)]; if (clip[2] <= clip[0] || clip[3] <= clip[1]) return;
      const want = JSON.stringify([page, view.s, view.ox, view.oy]);
      try { const img = await pngToImg(await wk.call('crop', { page, clip, zoom: z })); if (want === JSON.stringify([page, view.s, view.ox, view.oy])) { tile = { clip, img }; drawAll(); } } catch { /* не страшно */ }
    }, 250);
  }
  function zoomAt(sx, sy, f) {
    const [px, py] = toPt(sx, sy); view.s = Math.min(20, Math.max(0.05, view.s * f)); view.ox = px - sx / view.s; view.oy = py - sy / view.s; tile = null; drawAll(); schedTile();
  }

  // ---- касания: перетаскивание, щипок, колесо, нажатие ----
  const ptrs = new Map(); let downAt = null; let moved = false; let pinch = null;
  const local = (e) => { const r = wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  wrap.addEventListener('pointerdown', (e) => { wrap.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, local(e)); downAt = local(e); moved = false;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: view.s, c: toPt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) }; } });
  wrap.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return; const prev = ptrs.get(e.pointerId); const cur = local(e); ptrs.set(e.pointerId, cur);
    if (Math.hypot(cur[0] - downAt[0], cur[1] - downAt[1]) > 6) moved = true;
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const mx = (a[0] + b[0]) / 2; const my = (a[1] + b[1]) / 2;
      view.s = Math.min(20, Math.max(0.05, pinch.s * d / pinch.d)); view.ox = pinch.c[0] - mx / view.s; view.oy = pinch.c[1] - my / view.s; tile = null; drawAll(); return;
    }
    if (mode === 'rect' && found) { rectNow = [Math.min(downAt[0], cur[0]), Math.min(downAt[1], cur[1]), Math.max(downAt[0], cur[0]), Math.max(downAt[1], cur[1])]; drawAll(); return; }
    view.ox -= (cur[0] - prev[0]) / view.s; view.oy -= (cur[1] - prev[1]) / view.s; tile = null; drawAll();
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
    if (pinch) { if (!ptrs.size) { pinch = null; schedTile(); } return; }
    if (rectNow) {
      const [a0, b0] = toPt(rectNow[0], rectNow[1]); const [a1, b1] = toPt(rectNow[2], rectNow[3]);
      found.items.forEach((it, i) => { if ((it.page || 0) === page && it.x >= a0 && it.x <= a1 && it.y >= b0 && it.y <= b1) off.add(i); });
      rectNow = null; refresh(); return;
    }
    if (moved) { schedTile(); return; }
    tap(...local(e));
  };
  wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
  wrap.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = local(e); zoomAt(x, y, e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });

  async function tap(sx, sy) {
    const [x, y] = toPt(sx, sy);
    const nearest = () => { let best = -1; let bd = Infinity; found.items.forEach((it, i) => { if ((it.page || 0) !== page) return; const d = Math.hypot(it.x - x, it.y - y) * view.s; if (d < bd) { bd = d; best = i; } }); return bd < 30 ? best : -1; };
    if (mode === 'off' && found) { const i = nearest(); if (i >= 0) { off.has(i) ? off.delete(i) : off.add(i); refresh(); } return; }
    if (mode === 'start' && found) { const i = nearest(); if (i >= 0) { start = found.items[i]; off.delete(i); refresh(); setMode('off'); } return; }
    if (mode !== 'pick') return;
    info.textContent = 'Ищу такие же…';
    try {
      const r = await wk.call('pick', { page, x, y, pad: 8 / view.s });
      if (!r || !r.items.length) { info.textContent = 'Здесь значка не нашлось — увеличьте и нажмите точно на значок.'; return; }
      found = r; off = new Set(); start = null;
      if (r.text && !prefIn.value) prefIn.value = /^[A-Za-z]{1,3}\d?$/.test(r.text) ? r.text : '';
      refresh(); setMode('off');
      toast(`Найдено: ${r.items.length}. Лишние (легенда, детали) — уберите нажатием или рамкой.`);
    } catch (e) { info.textContent = `Не получилось: ${e.message}`; }
  }

  const pageSel = pages.length > 1 ? h('select', { onchange: (e) => { page = +e.target.value; tile = null; loadBase(); } }, pages.map((_, i) => h('option', { value: i }, `Лист ${i + 1}`))) : null;
  const close = openModal('🔎 Значки без номеров', h('div', {},
    h('div', { class: 'mut' }, `${sheet ? `${sheet}. ` : ''}1) Нажмите на значок — приложение найдёт такие же. 2) Лишние уберите: «🚫» нажатием или «▭» рамкой (легенда, детали). 3) Тип, кабели, буквы номера → «Добавить». Повторите для других значков.`),
    pageSel, tools, wrap, info, form,
    h('div', { class: 'group', style: { margin: '10px 2px 4px' } }, 'Добавлено'), list,
    h('div', { class: 'btns' }, finish)), { sticky: true, wide: true });
  requestAnimationFrame(() => { size(); loadBase().catch((e) => { info.textContent = `Не получилось показать лист: ${e.message}`; }); });
  window.addEventListener('resize', () => { if (wrap.isConnected) { size(); drawAll(); } });
  refresh();
}
