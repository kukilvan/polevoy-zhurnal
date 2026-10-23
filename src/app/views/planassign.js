// «🗺 Распределить на плане»: отметки на чертеже, чей шкаф непонятен (один номер есть в нескольких шкафах).
// Видно весь лист: выбираешь отметки нажатием или рамкой → шкаф из имеющихся / новый → «Привязать». Пока не привязаны все —
// «Готово» предложит положить остальные в шкаф «Не уверен» (потом их можно выбрать на плане и перенести в нужный).
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { state } from '../store.js';
import { createViewer, mark } from './planview.js';

export const UNSURE_CABINET = 'Не уверен';
const NEW = '__new';

/** items: [{ f: {label, pos}, cands: [точки проекта с таким номером] }] → Promise<[{ item, cabinet }] | null> (null — отмена) */
export function assignOnPlan({ wk, pages, items, sheet = '' }) {
  return new Promise((resolve) => {
    const cabinet = new Map();   // индекс отметки → шкаф
    const sel = new Set(); let mode = 'tap'; let finished = false;
    const COL = { off: '#e0007a', sel: '#0a84ff', ok: '#30d158', unsure: '#ff9f0a' };
    const posOf = (it) => it.f.pos;
    const viewer = createViewer({ wk, pages, rectMode: () => mode === 'rect',
      onTap: (x, y, page) => { let best = -1; let bd = Infinity; items.forEach((it, i) => { if ((posOf(it).page || 0) !== page) return; const d = Math.hypot(posOf(it).x - x, posOf(it).y - y) * viewer.view.s; if (d < bd) { bd = d; best = i; } }); if (best >= 0 && bd < 30) { sel.has(best) ? sel.delete(best) : sel.add(best); refresh(); } },
      onRect: (b, page) => { items.forEach((it, i) => { const q = posOf(it); if ((q.page || 0) === page && q.x >= b[0] && q.x <= b[2] && q.y >= b[1] && q.y <= b[3]) sel.add(i); }); refresh(); },
      overlay: (g, api) => items.forEach((it, i) => {
        const q = posOf(it); if ((q.page || 0) !== api.page) return;
        const cab = cabinet.get(i);
        mark(g, api, q, sel.has(i) ? COL.sel : cab ? (cab === UNSURE_CABINET ? COL.unsure : COL.ok) : COL.off, cab ? `${it.f.label} → ${cab}` : it.f.label, { fill: sel.has(i), minR: 8 });
      }) });
    const info = h('div', { style: { margin: '8px 0', fontWeight: 600 } });
    const modeBtn = (k, t) => h('button', { type: 'button', class: mode === k ? '' : 'sec', style: { padding: '6px 10px' }, onclick: () => { mode = k; refresh(); } }, t);
    const tools = h('div', { class: 'btns', style: { marginTop: 0 } });
    const cabSel = h('select', { style: { flex: 1, minWidth: 0 } });
    const newIn = h('input', { type: 'text', placeholder: 'Название нового шкафа', autocapitalize: 'characters', style: { flex: 1, minWidth: 0, display: 'none' } });
    cabSel.onchange = () => { newIn.style.display = cabSel.value === NEW ? '' : 'none'; if (cabSel.value === NEW) newIn.focus(); };
    const assignBtn = h('button', { onclick: () => assign() });
    const summary = h('div', { class: 'mut', style: { margin: '6px 0' } });
    const allCabs = () => [...new Set([...state.ctx.points.values()].map((p) => p.cabinet).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
    function fillCabs() {
      const hint = new Set([...sel].flatMap((i) => items[i].cands.map((p) => p.cabinet).filter(Boolean)));   // шкафы, где такие номера уже есть, — первыми
      const rest = allCabs().filter((c) => !hint.has(c) && c !== UNSURE_CABINET); const keep = cabSel.value;
      cabSel.replaceChildren(h('option', { value: '' }, '— выберите шкаф —'),
        ...[...hint].map((c) => h('option', { value: c }, `Шкаф ${c} (есть такой номер)`)), ...rest.map((c) => h('option', { value: c }, `Шкаф ${c}`)),
        h('option', { value: UNSURE_CABINET }, `❓ ${UNSURE_CABINET}`), h('option', { value: NEW }, '✏️ Новый шкаф…'));
      if ([...cabSel.options].some((o) => o.value === keep)) cabSel.value = keep;
    }
    function assign() {
      let c = cabSel.value === NEW ? newIn.value.trim() : cabSel.value;
      if (!c) { toast('Выберите шкаф'); return; }
      if (!sel.size) { toast('Сначала выберите отметки на плане'); return; }
      sel.forEach((i) => cabinet.set(i, c)); sel.clear(); refresh();
    }
    function refresh() {
      const left = items.length - cabinet.size;
      info.textContent = `Отметок: ${items.length} · привязано: ${cabinet.size} · осталось: ${left} · выбрано: ${sel.size}`;
      tools.replaceChildren(modeBtn('tap', '👆 По одной'), modeBtn('rect', '▭ Рамкой'),
        h('button', { type: 'button', class: 'sec', style: { padding: '6px 10px' }, onclick: () => { items.forEach((_, i) => { if (!cabinet.has(i)) sel.add(i); }); refresh(); } }, 'Все не привязанные'),
        h('button', { type: 'button', class: 'sec', style: { padding: '6px 10px' }, onclick: () => { sel.clear(); refresh(); } }, 'Снять выбор'), ...viewer.zoomBtns());
      fillCabs();
      assignBtn.textContent = `Привязать выбранные (${sel.size})`; assignBtn.disabled = !sel.size;
      const by = new Map(); cabinet.forEach((c) => by.set(c, (by.get(c) || 0) + 1));
      summary.textContent = by.size ? `Шкафы: ${[...by].map(([c, n]) => `${c} — ${n}`).join(' · ')}` : '';
      viewer.draw();
    }
    const doneBtn = h('button', { onclick: async () => {
      const left = items.map((_, i) => i).filter((i) => !cabinet.has(i));
      if (left.length) {
        if (!(await confirmDialog(`Не привязано отметок: ${left.length}. Положить их в шкаф «${UNSURE_CABINET}»? Потом на плане выберите их и перенесите в нужный шкаф.`, { yes: `В шкаф «${UNSURE_CABINET}»`, no: 'Продолжить распределять' }))) return;
        left.forEach((i) => cabinet.set(i, UNSURE_CABINET));
      }
      finished = true; close(); resolve(items.map((item, i) => ({ item, cabinet: cabinet.get(i) })));
    } }, 'Готово');
    const pageSel = pages.length > 1 ? h('select', { onchange: (e) => viewer.load(+e.target.value) }, pages.map((_, i) => h('option', { value: i }, `Лист ${i + 1}`))) : null;
    const close = openModal('🗺 Распределить по шкафам', h('div', {},
      h('div', { class: 'mut' }, `${sheet ? `${sheet}. ` : ''}Розовые отметки — подписи с номером, который есть в нескольких шкафах. Выберите отметки (нажатием или рамкой «▭»), укажите шкаф и нажмите «Привязать». Сомневаетесь — оставьте, их можно положить в шкаф «${UNSURE_CABINET}».`),
      pageSel, tools, viewer.el, info, h('div', { style: { display: 'flex', gap: '8px', margin: '6px 0' } }, cabSel, newIn), h('div', { class: 'btns' }, assignBtn), summary, h('div', { class: 'btns' }, doneBtn)),
      { sticky: true, wide: true, onClose: () => { if (!finished) resolve(null); } });
    viewer.start().then(() => { const q = items[0] && posOf(items[0]); if (q) viewer.focus(q.x, q.y, q.page || 0, Math.max(0.6, viewer.view.s)); }).catch((e) => { info.textContent = `Не получилось показать лист: ${e.message}`; });
    refresh();
  });
}
