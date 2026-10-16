// «🗺 План»: чертёж проекта с точками по статусу. Нажал на точку — её карточка; из карточки точки «📍 На чертеже» — сюда же, к ней.
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { state, currentProject, infoOf, getRepo, subscribe } from '../store.js';
import { drawingsOf, drawingFor, loadDrawing, addDrawing, pushDrawing, removeDrawing, updateDrawing, posKey } from '../drawings.js';
import { missingStages, comparePoints } from '../../domain/index.js';
import { addWorkForPoints } from './doh.js';
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
function outline(g, api, pos, color, { width = 1.5, pad = 1.5, fill = null } = {}) {
  const s = api.view.s; const [x, y] = api.toScr(pos.x, pos.y);
  g.strokeStyle = color; g.lineWidth = width; g.beginPath();
  if (isText(pos)) { const w = (pos.w / 2 + pad) * s; const hh = (pos.h / 2 + pad) * s; g.rect(x - Math.max(w, 4), y - Math.max(hh, 3), 2 * Math.max(w, 4), 2 * Math.max(hh, 3)); }
  else g.arc(x, y, Math.max(5, (Math.max(pos.w || 8, pos.h || 8) / 2 + pad) * s), 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  g.stroke();
}
const UNL = '__unlinked'; const HID = '__hidden';
// «Что осталось»: показать ярко только точки, где этот этап ещё не сделан
const STAGE_FILTERS = [['Длина', 'Осталось: длина (не померяно)'], ['Протяжка', 'Осталось: протяжка'], ['Дотянуть', 'Осталось: дотянуть'], ['Хивут', 'Осталось: хивут'], ['Установка', 'Осталось: установка'], ['Проверка', 'Осталось: проверка']];

export function planModal({ point = null } = {}) {
  const box = h('div', {});
  let wk = null; let viewer = null; let current = null; let focusId = point?.id || null; let fType = ''; let fCab = ''; let fStage = '';
  let dimDrawing = false; let selMode = false; let rectSel = false; const sel = new Set(); let selBar = () => {};
  let openCard = null;
  let updateInfo = () => {}; const unsub = subscribe(() => { viewer?.draw(); updateInfo(); });  // статусы и номера меняются — план следом
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
    current = d; wk?.stop(); wk = makeWorker(); sel.clear(); selMode = false;
    const status = h('div', { class: 'mut', style: { margin: '6px 0' } }, 'Открываю чертёж…');
    const holder = h('div', {}); body.replaceChildren(status, holder);
    try {
      const buf = await loadDrawing(d);
      const o = await wk.call('openDoc', { data: buf.slice(0) });
      const offLayers = (() => { try { return JSON.parse(localStorage.getItem(`pz.layers.${d.id}`) || '[]'); } catch { return []; } })();
      if (offLayers.length) await wk.call('setLayers', { off: offLayers });
      const cur = () => drawingsOf().find((x) => x.id === d.id) || d;
      const unl = () => (cur().unlinked || []); const hid = () => (cur().hidden || []);
      const stageOk = (p) => { if (!fStage) return true; if (fStage === 'Длина') return p.length === undefined || p.length === null || p.length === ''; const info = infoOf(p);
        if (fStage === 'Протяжка') return !info.pulled && !info.pullDone; return missingStages(p, state.ctx).includes(fStage); };
      const pts = () => (fType === UNL || fType === HID ? [] : sheetPts(d).filter((p) => (!fType || p.typeId === fType) && (!fCab || (p.cabinet || '') === fCab)));
      const marks = () => (fType === UNL ? unl() : fType === HID ? hid() : []);
      // попадание: внутри рамки/круга с запасом 10 px; из нескольких — ближайший край
      const hitDist = (pos, x, y) => { const s = viewer.view.s; const pad = 2 + 10 / s;
        if (isText(pos)) { const dx = Math.max(0, Math.abs(x - pos.x) - pos.w / 2 - pad); const dy = Math.max(0, Math.abs(y - pos.y) - pos.h / 2 - pad); return Math.hypot(dx, dy); }
        return Math.max(0, Math.hypot(x - pos.x, y - pos.y) - Math.max(pos.w || 8, pos.h || 8) / 2 - pad); };
      const nearest = (list, getPos, x, y, page) => { let best = null; let bd = Infinity; for (const it of list) { const pos = getPos(it); if ((pos.page || 0) !== page) continue; const dd = hitDist(pos, x, y); if (dd < bd) { bd = dd; best = it; } } return bd === 0 ? best : null; };
      viewer = createViewer({ wk, pages: o.pages, height: '62vh', dim: () => (dimDrawing ? 0.35 : 1), rectMode: () => selMode && rectSel,
        onRect: (b, page) => { pts().filter((p) => stageOk(p) && (p.pos.page || 0) === page && p.pos.x >= b[0] && p.pos.x <= b[2] && p.pos.y >= b[1] && p.pos.y <= b[3]).forEach((p) => sel.add(p.id)); selBar(); viewer.draw(); },
        onTap: (x, y, page) => {
          if (fType === UNL || fType === HID) { const m = nearest(marks(), (it) => it.pos, x, y, page); if (m) markCard(d, m, fType === HID); return; }
          const best = nearest(pts().filter(stageOk), (p) => p.pos, x, y, page); if (!best) return;
          if (selMode) { sel.has(best.id) ? sel.delete(best.id) : sel.add(best.id); selBar(); viewer.draw(); return; }
          focusId = best.id; viewer.draw(); openCard?.(best);
        },
        overlay: (g, api) => {
          const big = api.view.s > 0.6;
          if (fType === UNL || fType === HID) { for (const m of marks()) { if ((m.pos.page || 0) !== api.page) continue; if (fType === HID) { outline(g, api, m.pos, '#c7c7cc', { width: 1, fill: 'rgba(255,255,255,.9)' }); } else outline(g, api, m.pos, '#ff9500', { width: 2 }); } return; }
          for (const p of pts()) {
            if ((p.pos.page || 0) !== api.page) continue;
            const on = stageOk(p); const col = on ? statusColor(infoOf(p).status) : '#d0d0d0';
            outline(g, api, p.pos, col, { width: on ? (big ? 1.5 : 2) : 1 });
            if (sel.has(p.id)) outline(g, api, p.pos, '#00b7ff', { width: 3, pad: 1.5 + 3 / api.view.s });
            if (on && big && !isText(p.pos)) { const [x, y] = api.toScr(p.pos.x, p.pos.y); const r = Math.max(5, (Math.max(p.pos.w || 8, p.pos.h || 8) / 2 + 1.5) * api.view.s); g.font = 'bold 12px system-ui'; const w = g.measureText(p.label).width; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(x + r, y - r - 12, w + 4, 14); g.fillStyle = col; g.fillText(p.label, x + r + 2, y - r); }
          }
          const f = focusId && state.ctx.points.get(focusId);
          if (f?.pos && (f.pos.page || 0) === api.page && drawingFor(f)?.id === d.id) { outline(g, api, f.pos, '#e0007a', { width: 3, pad: 1.5 + 4 / api.view.s }); }
        } });
      const types = [...new Set(sheetPts(d).map((p) => p.typeId))].sort((a, b) => a.localeCompare(b, 'ru'));
      const cabs = [...new Set(sheetPts(d).map((p) => p.cabinet || ''))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
      const search = h('input', { type: 'search', placeholder: 'Найти точку', style: { flex: 1, minWidth: '120px' }, onchange: (e) => {
        const q = e.target.value.trim().toLowerCase(); if (!q) return;
        const p = sheetPts(d).find((x) => x.label.toLowerCase() === q) || sheetPts(d).find((x) => x.label.toLowerCase().includes(q));
        if (!p) { toast('Такой точки на этом чертеже нет'); return; }
        focusId = p.id; viewer.focus(p.pos.x, p.pos.y, p.pos.page || 0);
      } });
      const typeSel = h('select', { onchange: (e) => { fType = e.target.value; sel.clear(); selBar(); viewer.draw(); } }, h('option', { value: '' }, 'Все типы'), ...types.map((t) => h('option', { value: t, selected: t === fType }, t)),
        h('option', { value: UNL, selected: fType === UNL }, `❔ Не размеченые (${unl().length})`), h('option', { value: HID, selected: fType === HID }, `🙈 Скрытые (${hid().length})`));
      const cabSel = cabs.length ? h('select', { onchange: (e) => { fCab = e.target.value; viewer.draw(); } }, h('option', { value: '' }, 'Все шкафы'), ...cabs.map((c) => h('option', { value: c, selected: c === fCab }, `Шкаф ${c}`))) : null;
      const stageSel = h('select', { onchange: (e) => { fStage = e.target.value; viewer.draw(); } }, h('option', { value: '' }, 'Все этапы'),
        ...STAGE_FILTERS.map(([v, t]) => h('option', { value: v, selected: v === fStage }, t)));
      const selBtn = h('button', { class: 'sec', onclick: () => { selMode = !selMode; rectSel = false; if (!selMode) sel.clear(); selBar(); viewer.draw(); } });
      selBar = () => {
        selBtn.textContent = selMode ? '✔ Выбор: нажимайте точки' : '☑ Выбрать на плане'; selBtn.className = selMode ? '' : 'sec';
        bar.style.display = selMode ? 'flex' : 'none';
        bar.replaceChildren(h('b', {}, `Выбрано: ${sel.size}`),
          h('button', { class: rectSel ? '' : 'sec', onclick: () => { rectSel = !rectSel; selBar(); } }, rectSel ? '▭ Рамкой (вкл.)' : '▭ Рамкой'),
          h('button', { disabled: !sel.size, onclick: () => { addWorkForPoints([...sel]); } }, `➕ Работа на выбранные (${sel.size})`),
          h('button', { class: 'sec', onclick: () => { sel.clear(); selBar(); viewer.draw(); } }, 'Снять'));
      };
      const bar = h('div', { class: 'card', style: { display: 'none', margin: '6px 0', padding: '8px', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } });
      const layersBtn = h('button', { class: 'sec', onclick: () => layersModal(d) }, '🗂 Слои чертежа');
      const dimBtn = h('button', { class: 'sec', onclick: () => { dimDrawing = !dimDrawing; dimBtn.textContent = dimDrawing ? '🌕 Чертёж ярче' : '🌗 Чертёж бледнее'; viewer.draw(); } }, dimDrawing ? '🌕 Чертёж ярче' : '🌗 Чертёж бледнее');
      updateInfo = () => {
        const n = sheetPts(d).length;
        status.textContent = `${d.name}${d.floor ? ` · этаж ${d.floor}` : ''} · точек на чертеже: ${n}${unl().length ? ` · не размеченых: ${unl().length}` : ''}`;
        const ou = typeSel.querySelector(`option[value="${UNL}"]`); if (ou) ou.textContent = `❔ Не размеченые (${unl().length})`;
        const oh = typeSel.querySelector(`option[value="${HID}"]`); if (oh) oh.textContent = `🙈 Скрытые (${hid().length})`;
      };
      updateInfo();
      holder.replaceChildren(
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '0 0 6px' } }, search, typeSel, cabSel, stageSel),
        h('div', { class: 'btns', style: { marginTop: 0 } }, ...viewer.zoomBtns(), selBtn, dimBtn, layersBtn), bar, viewer.el,
        h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', margin: '6px 2px', fontSize: '13px' } }, ...STATUS_COLORS.map(([c, t]) => h('span', {}, h('span', { style: { color: c } }, '■ '), t))),
        h('div', { class: 'btns' },
          h('button', { class: 'sec', onclick: () => linkPoints(d, buf, { onDone: () => draw(d.id) }).catch((e) => toast(e.message)) }, '🔗 Связать точки'),
          h('button', { class: 'sec', onclick: async () => { try { toast('Готовлю PDF…'); await exportNumberedPdf(d, buf, sheetPts(d)); } catch (e) { toast(`Не получилось: ${e.message}`); } } }, '📄 PDF с номерами'),
          h('button', { class: 'sec', onclick: () => pointsFromDrawing({ drawing: d, buf }) }, '✏️ Редактировать'),
          d.fileId ? null : h('button', { class: 'sec', onclick: async () => { try { toast('Отправляю на Диск…'); await pushDrawing(d); toast('Чертёж на Диске — откроется и на других устройствах'); draw(d.id); } catch (e) { toast(`Не получилось: ${e.message}`); } } }, '⬆ На Диск'),
          h('button', { class: 'sec', onclick: async () => { if (await confirmDialog(`Убрать чертёж «${d.name}» из проекта? Точки останутся, файл на Диске — тоже.`, { yes: 'Убрать', danger: true })) { removeDrawing(d); setTimeout(() => draw(), 300); } } }, '🗑 Убрать чертёж')));
      selBar();
      await viewer.start();
      const f = focusId && state.ctx.points.get(focusId);
      if (f?.pos && drawingFor(f)?.id === d.id) await viewer.focus(f.pos.x, f.pos.y, f.pos.page || 0);
    } catch (e) { status.textContent = e.message; }
  }

  // слои чертежа (AutoCAD): выключить лишнее — мебель, штриховки, размеры; запоминается на этом устройстве
  async function layersModal(d) {
    const list = await wk.call('layers');
    if (!list.length) { toast('В этом чертеже нет слоёв'); return; }
    const boxes = list.map((l) => ({ l, cb: h('input', { type: 'checkbox', checked: l.on }) }));
    const c = openModal('🗂 Слои чертежа', h('div', {},
      h('div', { class: 'mut' }, 'Снимите галочки со слоёв, которые мешают (мебель, штриховки, размеры). Точки и номера не скрываются. Запоминается на этом устройстве.'),
      h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => boxes.forEach((b) => { b.cb.checked = true; }) }, 'Все'), h('button', { class: 'sec', onclick: () => boxes.forEach((b) => { b.cb.checked = false; }) }, 'Ничего')),
      h('div', { class: 'picklist', style: { maxHeight: '50vh' } }, boxes.map((b) => h('label', { class: 'pickrow' }, b.cb, h('span', {}, b.l.name)))),
      h('div', { class: 'btns' }, h('button', { onclick: async () => {
        const off = boxes.filter((b) => !b.cb.checked).map((b) => b.l.name);
        try { localStorage.setItem(`pz.layers.${d.id}`, JSON.stringify(off)); } catch { /* ok */ }
        await wk.call('setLayers', { off }); c(); await viewer.refreshImage();
      } }, 'Применить'))), { sticky: true });
  }

  // «Не размеченая» подпись на чертеже: скрыть или связать с точкой проекта
  function markCard(d, m, isHidden) {
    const c = openModal(`«${m.label}» на чертеже`, h('div', {},
      h('div', { class: 'mut' }, isHidden ? 'Скрытая подпись: на плане почти не видна.' : `Подпись есть на чертеже, но не связана с точкой проекта.${m.typeId ? ` Похоже на: ${m.typeId}.` : ''}`),
      h('div', { class: 'btns' },
        isHidden ? h('button', { class: 'sec', onclick: () => { moveMark(d, m, 'hidden', 'unlinked'); c(); } }, '👁 Вернуть в «Не размеченые»')
          : h('button', { class: 'sec', onclick: () => { moveMark(d, m, 'unlinked', 'hidden'); c(); } }, '🙈 Скрыть'),
        h('button', { onclick: () => { c(); chooseFor(d, m, isHidden); } }, '🔗 Связать с точкой'))), {});
  }
  function moveMark(d, m, from, to) {
    const k = posKey(m.pos);
    updateDrawing(d.id, (x) => ({ [from]: (x[from] || []).filter((y) => posKey(y.pos) !== k), [to]: [...(x[to] || []), m] }));
    setTimeout(() => viewer?.draw(), 300);
  }
  // выбор точки проекта для подписи: поиск, тип, шкаф; по умолчанию — точки без места на чертеже
  function chooseFor(d, m, fromHidden) {
    const all = [...state.ctx.points.values()];
    const q = h('input', { type: 'search', placeholder: 'Поиск по названию', style: { flex: 1 } });
    const tSel = h('select', {}, h('option', { value: '' }, 'Все типы'), ...[...new Set(all.map((p) => p.typeId))].sort((a, b) => a.localeCompare(b, 'ru')).map((t) => h('option', { value: t, selected: t === m.typeId }, t)));
    const cSel = h('select', {}, h('option', { value: '' }, 'Все шкафы'), ...[...new Set(all.map((p) => p.cabinet || ''))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true })).map((x) => h('option', { value: x }, `Шкаф ${x}`)));
    const noPos = h('input', { type: 'checkbox', checked: true });
    const ren = h('input', { type: 'checkbox', checked: false });
    const listEl = h('div', { class: 'card', style: { padding: 0, maxHeight: '45vh', overflow: 'auto' } });
    const fill = () => {
      const s = q.value.trim().toLowerCase();
      const rows = all.filter((p) => (!s || `${p.label} ${p.planName || ''}`.toLowerCase().includes(s)) && (!tSel.value || p.typeId === tSel.value) && (!cSel.value || (p.cabinet || '') === cSel.value) && (!noPos.checked || !drawingFor(p)))
        .sort(comparePoints).slice(0, 200);
      listEl.replaceChildren(...(rows.length ? rows.map((p) => h('div', { class: 'item', onclick: () => pick(p) }, h('div', { class: 'name' }, p.label, h('div', { class: 'sub' }, `${p.typeId}${p.cabinet ? ` · шкаф ${p.cabinet}` : ''}${drawingFor(p) ? ' · уже на чертеже' : ''}`)))) : [h('div', { class: 'empty' }, 'Ничего не найдено')]));
    };
    [q, tSel, cSel, noPos].forEach((el) => el.addEventListener('input', fill));
    const pick = (p) => {
      const taken = all.some((x) => x.id !== p.id && x.label === m.label);
      if (ren.checked && taken) { toast(`«${m.label}» уже есть в проекте — переименовать нельзя`); return; }
      const data = { pos: { ...m.pos, sheet: d.name } };
      if (ren.checked) { data.label = m.label; data.planName = p.label; } else if (p.label !== m.label) data.planName = m.label;
      getRepo().save(currentProject().id, [{ coll: 'points', id: p.id, data }]);
      const k = posKey(m.pos); updateDrawing(d.id, (x) => ({ unlinked: (x.unlinked || []).filter((y) => posKey(y.pos) !== k), hidden: (x.hidden || []).filter((y) => posKey(y.pos) !== k) }));
      toast(`«${ren.checked ? m.label : p.label}» связана с чертежом`); c(); void fromHidden;
    };
    const c = openModal(`🔗 Точка для «${m.label}»`, h('div', {},
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, q, tSel, cSel),
      h('label', { class: 'pickrow' }, noPos, h('span', {}, 'Только точки без места на чертеже')),
      h('label', { class: 'pickrow' }, ren, h('span', {}, `Переименовать выбранную точку в «${m.label}» (как на чертеже)`)),
      listEl), { sticky: true });
    fill();
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
