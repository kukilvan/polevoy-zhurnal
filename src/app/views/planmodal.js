// «🗺 План»: чертёж проекта с точками по статусу. Нажал на точку — её карточка; из карточки точки «📍 На чертеже» — сюда же, к ней.
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { state, currentProject, infoOf, getRepo, subscribe } from '../store.js';
import { drawingsOf, drawingFor, loadDrawing, addDrawing, pushDrawing, removeDrawing } from '../drawings.js';
import { makeWorker, pointsFromDrawing } from './tohnitview.js';
import { createViewer } from './planview.js';
import { exportNumberedPdf } from './plannumbers.js';
import { linkPoints } from './planlink.js';

// Цвет по статусу: померяно — синий, протянуто — жёлтый, дальше от жёлтого к зелёному: установлено не всё → установлено → проверено; проблема — красный
export const STATUS_COLORS = [['#9e9e9e', 'новая'], ['#2979ff', 'померяно'], ['#ffb300', 'протянуто частично'], ['#ffd600', 'протянуто'], ['#e4e000', 'захивучено'],
  ['#b5d800', 'установлено не всё'], ['#6ccf00', 'установлено'], ['#00c853', 'проверено'], ['#ff1744', 'проблема']];
const C = Object.fromEntries(STATUS_COLORS.map(([c, t]) => [t, c]));
export const statusColor = (st = '') => (st === 'Неисправна' ? C['проблема'] : st === 'Проверена' ? C['проверено'] : st === 'Установлена' ? C['установлено']
  : st.startsWith('Установлено') ? C['установлено не всё'] : st === 'Захивучена' ? C['захивучено'] : st === 'Протянута' ? C['протянуто']
  : st.startsWith('Протянуто') ? C['протянуто частично'] : st === 'Посчитана' ? C['померяно'] : C['новая']);
// подпись на чертеже — рамка вокруг текста; значок без подписи — кружок его размера
const isText = (pos) => { const w = pos.w || 0; const hh = pos.h || 0; return w && hh && Math.max(w, hh) / Math.min(w, hh) > 1.6; };
function outline(g, api, pos, color, { width = 1.5, pad = 1.5 } = {}) {
  const s = api.view.s; const [x, y] = api.toScr(pos.x, pos.y);
  g.strokeStyle = color; g.lineWidth = width; g.beginPath();
  if (isText(pos)) { const w = (pos.w / 2 + pad) * s; const hh = (pos.h / 2 + pad) * s; g.rect(x - Math.max(w, 4), y - Math.max(hh, 3), 2 * Math.max(w, 4), 2 * Math.max(hh, 3)); }
  else g.arc(x, y, Math.max(5, (Math.max(pos.w || 8, pos.h || 8) / 2 + pad) * s), 0, Math.PI * 2);
  g.stroke();
}

export function planModal({ point = null } = {}) {
  const box = h('div', {});
  let wk = null; let viewer = null; let current = null; let focusId = point?.id || null; let fType = '';
  let openCard = null;
  let lastCtx = state.ctx; const unsub = subscribe(() => { if (state.ctx !== lastCtx) { lastCtx = state.ctx; viewer?.draw(); } });  // статусы и номера меняются — план следом
  const close = openModal('🗺 План', box, { sticky: true, wide: true, onClose: () => { unsub(); wk?.stop(); } });
  const sheetPts = (d) => [...state.ctx.points.values()].filter((p) => p.pos && drawingFor(p)?.id === d.id);

  function addPdf() {
    const input = h('input', { type: 'file', accept: '.pdf,application/pdf', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const f = input.files?.[0]; if (!f) return;
      const buf = await f.arrayBuffer();
      // точки, чей чертёж ещё не добавлен: предложить связать с этим файлом
      const orphan = [...new Set([...state.ctx.points.values()].filter((p) => p.pos?.sheet && !drawingFor(p)).map((p) => p.pos.sheet))];
      let alias = null;
      if (orphan.length && !orphan.includes(f.name)) {
        alias = await new Promise((res) => {
          const c = openModal('Чей это чертёж?', h('div', {},
            h('div', { class: 'mut' }, `Точки проекта ссылаются на чертежи: ${orphan.join(', ')}. Если «${f.name}» — один из них (переименованный), выберите его — точки появятся на плане.`),
            ...orphan.map((o) => h('button', { class: 'wide', style: { margin: '6px 0' }, onclick: () => { c(); res(o); } }, `Это «${o}» (${[...state.ctx.points.values()].filter((p) => p.pos?.sheet === o).length} точек)`)),
            h('button', { class: 'sec wide', onclick: () => { c(); res(null); } }, 'Нет, это другой чертёж')), { onClose: () => res(null) });
        });
      }
      toast('Сохраняю чертёж…');
      try {
        const tmp = makeWorker(); const o = await tmp.call('openDoc', { data: buf.slice(0) }); tmp.stop();
        const fl = [...state.ctx.points.values()].find((p) => p.pos?.sheet === (alias || f.name))?.floor || '';
        let d = await addDrawing(buf, { name: f.name, floor: fl, pages: o.pages }).catch((e) => { toast(`Чертёж сохранён на этом устройстве, на Диск — не получилось: ${e.message}`); return null; });
        d = d || drawingsOf().find((x) => x.name === f.name);
        if (alias && d) { const p = currentProject(); getRepo().saveProject(p.id, { drawings: (p.drawings || []).map((x) => (x.id === d.id ? { ...x, aliases: [...new Set([...(x.aliases || []), alias])] } : x)) }); }
        toast('Чертёж добавлен'); setTimeout(() => draw(d?.id), 300);
        if (d && state.ctx.points.size) linkPoints(d, buf, { onDone: () => draw(d.id) }).catch((e) => toast(`Связать точки не получилось: ${e.message}`));
      } catch (e) { toast(`Не получилось: ${e.message}`); }
    });
    input.click();
  }

  async function show(d) {
    current = d; wk?.stop(); wk = makeWorker();
    const status = h('div', { class: 'mut', style: { margin: '6px 0' } }, 'Открываю чертёж…');
    const holder = h('div', {}); body.replaceChildren(status, holder);
    try {
      const buf = await loadDrawing(d);
      const o = await wk.call('openDoc', { data: buf.slice(0) });
      const pts = () => sheetPts(d).filter((p) => !fType || p.typeId === fType);
      viewer = createViewer({ wk, pages: o.pages, height: '62vh',
        onTap: (x, y, page) => {
          let best = null; let bd = Infinity;
          for (const p of pts()) { if ((p.pos.page || 0) !== page) continue; const dd = Math.hypot(p.pos.x - x, p.pos.y - y) * viewer.view.s; if (dd < bd) { bd = dd; best = p; } }
          if (best && bd < 24) { focusId = best.id; viewer.draw(); openCard?.(best); }
        },
        overlay: (g, api) => {
          const all = pts(); const big = api.view.s > 0.6;
          for (const p of all) {
            if ((p.pos.page || 0) !== api.page) continue; const col = statusColor(infoOf(p).status);
            outline(g, api, p.pos, col, { width: big ? 1.5 : 2 });
            if (big && !isText(p.pos)) { const [x, y] = api.toScr(p.pos.x, p.pos.y); const r = Math.max(5, (Math.max(p.pos.w || 8, p.pos.h || 8) / 2 + 1.5) * api.view.s); g.font = 'bold 12px system-ui'; const w = g.measureText(p.label).width; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(x + r, y - r - 12, w + 4, 14); g.fillStyle = col; g.fillText(p.label, x + r + 2, y - r); }
          }
          const f = focusId && state.ctx.points.get(focusId);
          if (f?.pos && (f.pos.page || 0) === api.page) { outline(g, api, f.pos, '#e0007a', { width: 3, pad: 1.5 + 4 / api.view.s }); }
        } });
      const types = [...new Set(sheetPts(d).map((p) => p.typeId))].sort((a, b) => a.localeCompare(b, 'ru'));
      const search = h('input', { type: 'search', placeholder: 'Найти точку', style: { flex: 1, minWidth: '120px' }, onchange: (e) => {
        const q = e.target.value.trim().toLowerCase(); if (!q) return;
        const p = sheetPts(d).find((x) => x.label.toLowerCase() === q) || sheetPts(d).find((x) => x.label.toLowerCase().includes(q));
        if (!p) { toast('Такой точки на этом чертеже нет'); return; }
        focusId = p.id; viewer.focus(p.pos.x, p.pos.y, p.pos.page || 0);
      } });
      const typeSel = h('select', { onchange: (e) => { fType = e.target.value; viewer.draw(); } }, h('option', { value: '' }, 'Все типы'), ...types.map((t) => h('option', { value: t, selected: t === fType }, t)));
      const n = sheetPts(d).length;
      status.textContent = `${d.name}${d.floor ? ` · этаж ${d.floor}` : ''} · точек на чертеже: ${n}${n ? '' : ' (точки привязаны к чертежу по имени файла)'}`;
      holder.replaceChildren(
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '0 0 6px' } }, search, typeSel),
        h('div', { class: 'btns', style: { marginTop: 0 } }, ...viewer.zoomBtns()), viewer.el,
        h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', margin: '6px 2px', fontSize: '13px' } }, ...STATUS_COLORS.map(([c, t]) => h('span', {}, h('span', { style: { color: c } }, '■ '), t))),
        h('div', { class: 'btns' },
          h('button', { class: 'sec', onclick: () => linkPoints(d, buf, { onDone: () => draw(d.id) }).catch((e) => toast(e.message)) }, '🔗 Связать точки'),
          h('button', { class: 'sec', onclick: async () => { try { toast('Готовлю PDF…'); await exportNumberedPdf(d, buf, sheetPts(d)); } catch (e) { toast(`Не получилось: ${e.message}`); } } }, '📄 PDF с номерами'),
          h('button', { class: 'sec', onclick: () => pointsFromDrawing({ drawing: d, buf }) }, '✏️ Редактировать'),
          d.fileId ? null : h('button', { class: 'sec', onclick: async () => { try { toast('Отправляю на Диск…'); await pushDrawing(d); toast('Чертёж на Диске — откроется и на других устройствах'); draw(d.id); } catch (e) { toast(`Не получилось: ${e.message}`); } } }, '⬆ На Диск'),
          h('button', { class: 'sec', onclick: async () => { if (await confirmDialog(`Убрать чертёж «${d.name}» из проекта? Точки останутся, файл на Диске — тоже.`, { yes: 'Убрать', danger: true })) { removeDrawing(d); setTimeout(() => draw(), 300); } } }, '🗑 Убрать чертёж')));
      await viewer.start();
      const f = focusId && state.ctx.points.get(focusId);
      if (f?.pos && drawingFor(f)?.id === d.id) await viewer.focus(f.pos.x, f.pos.y, f.pos.page || 0);
    } catch (e) { status.textContent = e.message; }
  }

  const body = h('div', {});
  function draw(selectId) {
    const list = drawingsOf();
    const want = selectId || (point && drawingFor(point)?.id) || current?.id || list[0]?.id;
    const d = list.find((x) => x.id === want) || list[0];
    const sel = list.length > 1 ? h('select', { onchange: (e) => show(list.find((x) => x.id === e.target.value)) }, list.map((x) => h('option', { value: x.id, selected: x.id === d?.id }, `${x.name}${x.floor ? ` (этаж ${x.floor})` : ''}`))) : null;
    box.replaceChildren(
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, sel, h('button', { class: list.length ? 'sec' : '', onclick: addPdf }, '➕ Чертёж (PDF)')),
      list.length ? body : h('div', { class: 'empty', style: { marginTop: '10px' } }, 'Чертежей пока нет. Добавьте PDF тохнита — точки с местом на чертеже (после разбора «📐 Из чертежа» или из файла) появятся на нём. Чертёж хранится на вашем Google Диске и открыт участникам проекта.'));
    if (d) show(d);
  }
  openCard = (p) => import('./points.js').then((m) => m.pointCard(p, { fromPlan: true }));
  draw();
  void close;
}
