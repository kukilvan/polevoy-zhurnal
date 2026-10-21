// «🗺 План»: чертёж проекта с точками по статусу. Нажал на точку — её карточка; из карточки точки «📍 На чертеже» — сюда же, к ней.
import { matchesPanelQuery } from '../../domain/rack.js';
import { pickPdf } from './pdfpick.js';
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { state, currentProject, infoOf, getRepo, subscribe } from '../store.js';
import { drawingsOf, drawingTitle, drawingFor, loadDrawing, addDrawing, pushDrawing, removeDrawing, updateDrawing, posKey } from '../drawings.js';
import { missingStages, comparePoints, nextLabel, combineLabels, sameLabelClash } from '../../domain/index.js';
import { newId } from '../repo.js';
import { typePicker } from './tohnitview.js';
import { cablesPicker } from './cablespick.js';
import { addWorkForPoints } from './doh.js';
import { makeWorker, pointsFromDrawing } from './tohnitview.js';
import { createViewer } from './planview.js';
import { exportNumberedPdf, publishNumbered } from './plannumbers.js';
import { linkPoints } from './planlink.js';
import { choosePoint } from './pointchooser.js';
import { bulkEditForm, renameForm } from './points.js';
import { doorCfgOf, doorCfgShort, usesConfig } from '../../domain/index.js';
import { allDoorCfgs, pinsOf as doorPins, ensureDoorCfg } from '../doorpool.js';
import { doorPicker } from './doorcfgview.js';
// подпись точки на плане: у двери с конфигурацией — ещё ЭМ / МХ
const tagOf = (p) => { const c = doorCfgOf(p, state.ctx); const sh = c ? doorCfgShort(state.ctx, c) : ''; return sh ? `${p.label} ${sh}` : p.label; };
import { typeMatch, typeFilterOptions } from '../typegroups.js';

export { STATUS_COLORS, statusColor } from '../../domain/index.js';
import { statusColor, STATUS_COLORS } from '../../domain/index.js';
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
const labelLike = (t = '') => /\d/.test(t) && !/[\u0590-\u05FF]/.test(t) && t.length <= 24 && !/\s{2,}/.test(t);
// подписи значков (точки без надписи на чертеже): растут вместе с приближением, в рамке цвета статуса,
// ставятся туда, где не закрывают значки и другие подписи
function placeTags(g, api, tags, circles, frames = []) {
  const fs = Math.round(Math.min(26, Math.max(12, 5.5 * api.view.s)));
  g.font = `bold ${fs}px system-ui`; g.textBaseline = 'middle';
  const placed = [...frames]; const padX = 4;
  const hitsBox = (b) => placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
  const hitsCircle = (b) => circles.some(([cx, cy, cr]) => { const dx = Math.max(b[0] - cx, 0, cx - b[2]); const dy = Math.max(b[1] - cy, 0, cy - b[3]); return dx * dx + dy * dy < cr * cr; });
  for (const t of tags.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const lines = combineLabels(t.labels || [t.p.label]); const lh = fs + 2; const hh = lines.length * lh + 4;
    const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 2 * padX; const gap = 3; const r = t.r;
    const opts = [[t.x + r + gap, t.y - r - hh + 4], [t.x + r + gap, t.y - hh / 2], [t.x + r + gap, t.y + r - 4], [t.x - w / 2, t.y - r - hh - gap], [t.x - w / 2, t.y + r + gap],
      [t.x - r - gap - w, t.y - r - hh + 4], [t.x - r - gap - w, t.y - hh / 2], [t.x - r - gap - w, t.y + r - 4],
      [t.x + r + gap, t.y - r - 2 * hh], [t.x - w / 2, t.y + r + gap + hh], [t.x - w / 2, t.y - r - 2 * hh - gap], [t.x + r + gap, t.y + r + hh]];
    const box = ([x0, y0]) => [x0, y0, x0 + w, y0 + hh];
    const best = opts.map(box).find((b) => !hitsBox(b) && !hitsCircle(b)) || opts.map(box).find((b) => !hitsCircle(b)) || box(opts[0]);
    placed.push(best);
    // линия от значка к подписи, если подпись отодвинута
    const cx = Math.max(best[0], Math.min(t.x, best[2])); const cy = Math.max(best[1], Math.min(t.y, best[3]));
    if (Math.hypot(cx - t.x, cy - t.y) > r + gap + 4) { g.strokeStyle = t.col; g.lineWidth = 1; g.beginPath(); g.moveTo(t.x, t.y); g.lineTo(cx, cy); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(best[0], best[1], w, hh);
    g.strokeStyle = t.col; g.lineWidth = 2; g.strokeRect(best[0], best[1], w, hh);
    g.fillStyle = '#111'; lines.forEach((l, i) => g.fillText(l, best[0] + padX, best[1] + 2 + lh * i + lh / 2 + 1));
  }
  g.textBaseline = 'alphabetic';
}
const UNL = '__unlinked'; const HID = '__hidden';
// «Что осталось»: показать ярко только точки, где этот этап ещё не сделан
const STAGE_FILTERS = [['Длина', 'Осталось: длина (не померяно)'], ['Протяжка', 'Осталось: протяжка'], ['Дотянуть', 'Осталось: дотянуть'], ['Хивут', 'Осталось: хивут'], ['Установка', 'Осталось: установка'], ['Проверка', 'Осталось: проверка']];

// значки типов (картинка с чертежа): ими рисуются точки, добавленные на объекте, — на плане и в «PDF с номерами»
const iconImgs = new Map();
function iconImg(t, png, redraw) {
  const k = `${t}|${png.length}`; if (iconImgs.has(k)) return iconImgs.get(k);
  const im = new Image(); im.onload = redraw; im.src = png; iconImgs.set(k, im); return im;
}
const toDataUrl = (bytes) => { let s = ''; const u = new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return `data:image/png;base64,${btoa(s)}`; };

export function planModal({ point = null, placeFor = null } = {}) {
  const box = h('div', {});
  let wk = null; let viewer = null; let current = null; let focusId = point?.id || null; let fType = ''; let fCab = ''; let fStage = '';
  let dimDrawing = false; let selMode = false; let rectSel = false; const sel = new Set(); let selBar = () => {};
  let openCard = null; let doorPts = () => []; let goDoor = () => {}; let brushTap = () => {};
  const doorSkip = new Set(); let doorCur = null; let doorMode = 'wizard'; let brushId = ''; let pipette = false;  // «Кисть»: конфигурация по нажатию; пипетка — взять с двери  // мастер «🚪 Двери»: пропущенные и текущая дверь
  let tool = placeFor ? 'place' : null; let iconType = ''; let temp = null; let toolBar = () => {};  // tool: add — «➕ Точка на плане», icon — «📌 Значки типов», place — «📍 Отметить на плане»
  let updateInfo = () => {}; const unsub = subscribe(() => { viewer?.draw(); updateInfo(); if (tool === 'doors') toolBar(); });  // статусы и номера меняются — план следом
  const close = openModal('🗺 План', box, { sticky: true, wide: true, onClose: () => { unsub(); wk?.stop(); } });
  const sheetPts = (d) => [...state.ctx.points.values()].filter((p) => p.pos && drawingFor(p)?.id === d.id);

  function addPdf() {
    (async () => {
      const r = await pickPdf({ title: '➕ Чертёж в план', project: false }); if (!r) return;
      const f = { name: r.name }; const buf = r.buf;
      const dup = drawingsOf().find((x) => x.name === f.name);
      if (dup && !(await confirmDialog(`Этот файл уже добавлен: «${drawingTitle(dup)}» (файл ${f.name}). Заменить чертёж новым файлом? Точки и отметки останутся.`, { yes: 'Заменить' }))) return;
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
        let d = await addDrawing(buf, { name: f.name, floor: fl, pages: o.pages, fileId: r.fileId || null }).catch((e) => { toast(`Чертёж сохранён на этом устройстве, на Диск — не получилось: ${e.message}`); return null; });
        d = d || drawingsOf().find((x) => x.name === f.name);
        if (alias && d) { const p = currentProject(); getRepo().saveProject(p.id, { drawings: (p.drawings || []).map((x) => (x.id === d.id ? { ...x, aliases: [...new Set([...(x.aliases || []), alias])] } : x)) }); }
        toast('Чертёж добавлен'); setTimeout(() => draw(d?.id), 300);
        if (d && state.ctx.points.size) linkPoints(d, buf, { onDone: () => draw(d.id) }).catch((e) => toast(`Связать точки не получилось: ${e.message}`));
      } catch (e) { toast(`Не получилось: ${e.message}`); }
    })();
  }

  async function show(d) {
    current = d; wk?.stop(); wk = makeWorker(); sel.clear(); selMode = false; temp = null; doorCur = null;
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
      const pts = () => (fType === UNL || fType === HID ? [] : sheetPts(d).filter((p) => typeMatch(fType, p.typeId) && (!fCab || (p.cabinet || '') === fCab)));
      const marks = () => (fType === UNL ? unl() : fType === HID ? hid() : []);
      // попадание: внутри рамки/круга с запасом 10 px; из нескольких — ближайший край
      const hitDist = (pos, x, y) => { const s = viewer.view.s; const pad = 2 + 10 / s;
        if (isText(pos)) { const dx = Math.max(0, Math.abs(x - pos.x) - pos.w / 2 - pad); const dy = Math.max(0, Math.abs(y - pos.y) - pos.h / 2 - pad); return Math.hypot(dx, dy); }
        return Math.max(0, Math.hypot(x - pos.x, y - pos.y) - Math.max(pos.w || 8, pos.h || 8) / 2 - pad); };
      const nearest = (list, getPos, x, y, page) => { let best = null; let bd = Infinity; for (const it of list) { const pos = getPos(it); if ((pos.page || 0) !== page) continue; const dd = hitDist(pos, x, y); if (dd < bd) { bd = dd; best = it; } } return bd === 0 ? best : null; };
      viewer = createViewer({ wk, pages: o.pages, height: '62vh', dim: () => (dimDrawing ? 0.35 : 1), rectMode: () => selMode && rectSel,
        onRect: (b, page) => { pts().filter((p) => stageOk(p) && (p.pos.page || 0) === page && p.pos.x >= b[0] && p.pos.x <= b[2] && p.pos.y >= b[1] && p.pos.y <= b[3]).forEach((p) => sel.add(p.id)); selBar(); viewer.draw(); },
        onTap: (x, y, page) => {
          if (tool === 'doors') { const p = nearest(doorPts(), (q) => q.pos, x, y, page); if (p) (doorMode === 'brush' ? brushTap(p) : goDoor(p)); else if (nearest(sheetPts(d), (q) => q.pos, x, y, page)) toast('Это не дверь'); return; }
          if (tool) { toolTap(d, o.pages, x, y, page, nearest); return; }
          if (fType === UNL || fType === HID) { const m = nearest(marks(), (it) => it.pos, x, y, page); if (m) markCard(d, m, fType === HID); return; }
          const best = nearest(pts().filter(stageOk), (p) => p.pos, x, y, page); if (!best) return;
          if (selMode) sel.has(best.id) ? sel.delete(best.id) : sel.add(best.id);
          const group = pts().filter((p) => p.id !== best.id && posKey(p.pos) === posKey(best.pos));
          if (selMode) { [best, ...group].forEach((p) => (sel.has(best.id) ? sel.add(p.id) : sel.delete(p.id))); selBar(); viewer.draw(); return; }
          focusId = best.id; viewer.draw();
          if (group.length) { const all = [best, ...group].sort(comparePoints); const cc = openModal('Точки на этой отметке', h('div', { class: 'card', style: { padding: 0 } }, all.map((p) => h('div', { class: 'item', onclick: () => { cc(); openCard?.(p); } }, h('div', { class: 'name' }, p.label, h('div', { class: 'sub' }, p.typeId))))), {}); return; }
          openCard?.(best);
        },
        overlay: (g, api) => {
          const big = api.view.s > 0.6;
          if (fType === UNL || fType === HID) { for (const m of marks()) { if ((m.pos.page || 0) !== api.page) continue; if (fType === HID) { outline(g, api, m.pos, '#c7c7cc', { width: 1, fill: 'rgba(255,255,255,.9)' }); } else outline(g, api, m.pos, '#ff9500', { width: 2 }); } return; }
          // скрытые подписи и значки — закрашены белым, чтобы не мешали
          for (const m of hid()) { if ((m.pos.page || 0) === api.page) outline(g, api, m.pos, '#ffffff', { width: 2, pad: 2, fill: '#ffffff' }); }
          const icons = currentProject()?.typeIcons || {}; const tags = []; const circles = []; const frames = []; const byKey = new Map();
          for (const p of pts()) {
            if ((p.pos.page || 0) !== api.page) continue;
            const on = stageOk(p); const col = on ? statusColor(infoOf(p).status) : '#d0d0d0';
            const ic = p.pos.icon && icons[p.typeId];
            if (ic) { const im = iconImg(p.typeId, ic.png, () => viewer?.draw()); if (im.complete && im.naturalWidth) { const [sx, sy] = api.toScr(p.pos.x, p.pos.y); const w = (ic.w || 12) * api.view.s; const hh = (ic.h || 12) * api.view.s; g.globalAlpha = on ? 1 : 0.4; g.drawImage(im, sx - w / 2, sy - hh / 2, w, hh); g.globalAlpha = 1; } }
            outline(g, api, p.pos, col, { width: on ? (big ? 1.5 : 2) : 1 });
            if (sel.has(p.id)) outline(g, api, p.pos, '#00b7ff', { width: 3, pad: 1.5 + 3 / api.view.s });
            if (!isText(p.pos)) {
              const k = posKey(p.pos); const same = byKey.get(k);  // несколько точек на одной отметке — одна подпись
              if (same) { same.labels.push(tagOf(p)); continue; }
              const [x, y] = api.toScr(p.pos.x, p.pos.y); const r = Math.max(5, (Math.max(p.pos.w || 8, p.pos.h || 8) / 2 + 1.5) * api.view.s); circles.push([x, y, r]);
              const t = { p, col, x, y, r, labels: [tagOf(p)] }; byKey.set(k, t); if (on && big) tags.push(t);
            } else {
              // надпись на чертеже: своя подпись не нужна, если точка одна и называется так же; иначе (несколько точек, другое название) — подпись
              const k = posKey(p.pos); const same = byKey.get(k);
              if (same) { same.labels.push(tagOf(p)); same.need = true; continue; }
              const [x, y] = api.toScr(p.pos.x, p.pos.y); const hw = (p.pos.w / 2 + 2) * api.view.s; const hh2 = (p.pos.h / 2 + 2) * api.view.s; frames.push([x - hw, y - hh2, x + hw, y + hh2]);
              const t = { p, col, x, y, r: Math.max(hw, hh2), labels: [tagOf(p)], textPos: true, need: !!(p.pos.text && p.pos.text !== p.label) }; byKey.set(k, t); if (on && big) tags.push(t);
            }
          }
          placeTags(g, api, tags.filter((t) => !t.textPos || t.need), circles, frames);
          const f = focusId && state.ctx.points.get(focusId);
          if (f?.pos && (f.pos.page || 0) === api.page && drawingFor(f)?.id === d.id) { outline(g, api, f.pos, '#e0007a', { width: 3, pad: 1.5 + 4 / api.view.s }); }
          if (tool === 'doors') for (const p of doorPts()) { if ((p.pos.page || 0) !== api.page || p.id === doorCur) continue; outline(g, api, p.pos, doorCfgOf(p, state.ctx) ? '#34c759' : doorSkip.has(p.id) ? '#8e8e93' : '#ff9500', { width: 3, pad: 1.5 + 3 / api.view.s }); }
          if (temp && (temp.page || 0) === api.page) { g.setLineDash([5, 3]); outline(g, api, temp, '#e0007a', { width: 2.5, pad: 2 + 3 / api.view.s, fill: 'rgba(224,0,122,.12)' }); g.setLineDash([]); }
        } });
      const types = [...new Set(sheetPts(d).map((p) => p.typeId))].sort((a, b) => a.localeCompare(b, 'ru'));
      const cabs = [...new Set(sheetPts(d).map((p) => p.cabinet || ''))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
      const search = h('input', { type: 'search', placeholder: 'Найти точку или порт U38-05', style: { flex: 1, minWidth: '120px' }, onchange: (e) => {
        const q = e.target.value.trim().toLowerCase(); if (!q) return;
        let p = sheetPts(d).find((x) => x.label.toLowerCase() === q);
        if (!p) {  // по порту панели (U38-05): сначала в выбранном шкафу
          const byPort = sheetPts(d).filter((x) => matchesPanelQuery(x, q)).sort((a, b) => (b.cabinet === fCab) - (a.cabinet === fCab));
          if (byPort.length) { p = byPort[0]; toast(byPort.length > 1 ? `Порт ${q.toUpperCase()} есть в шкафах: ${byPort.map((x) => `${x.cabinet || '—'} (${x.label})`).join(', ')}. Показана ${p.label}` : `Порт в панели ${q.toUpperCase()}: ${p.label}`); }
        }
        p ??= sheetPts(d).find((x) => x.label.toLowerCase().includes(q));
        if (!p) { toast('Такой точки на этом чертеже нет'); return; }
        focusId = p.id; viewer.focus(p.pos.x, p.pos.y, p.pos.page || 0);
      } });
      const typeSel = h('select', { onchange: (e) => { fType = e.target.value; sel.clear(); selBar(); viewer.draw(); } }, h('option', { value: '' }, 'Все типы'), ...typeFilterOptions(types).map(([v, t]) => h('option', { value: v, selected: v === fType }, t)),
        h('option', { value: UNL, selected: fType === UNL }, `❔ Не размеченые (${unl().length})`), h('option', { value: HID, selected: fType === HID }, `🙈 Скрытые (${hid().length})`));
      const cabSel = cabs.length ? h('select', { onchange: (e) => { fCab = e.target.value; viewer.draw(); } }, h('option', { value: '' }, 'Все шкафы'), ...cabs.map((c) => h('option', { value: c, selected: c === fCab }, `Шкаф ${c}`))) : null;
      const stageSel = h('select', { onchange: (e) => { fStage = e.target.value; viewer.draw(); } }, h('option', { value: '' }, 'Все этапы'),
        ...STAGE_FILTERS.map(([v, t]) => h('option', { value: v, selected: v === fStage }, t)));
      const selBtn = h('button', { class: 'sec', onclick: () => { selMode = !selMode; rectSel = false; if (!selMode) sel.clear(); if (selMode) tool = null; toolBar(); selBar(); viewer.draw(); } });
      const addBtn = h('button', { class: 'sec', onclick: () => { tool = tool === 'add' ? null : 'add'; if (tool) { selMode = false; sel.clear(); selBar(); } temp = null; toolBar(); viewer.draw(); } });
      const iconBtn = h('button', { class: 'sec', onclick: () => { tool = tool === 'icon' ? null : 'icon'; if (tool) { selMode = false; sel.clear(); selBar(); } temp = null; toolBar(); viewer.draw(); } });
      const tbar = h('div', { class: 'card', style: { display: 'none', margin: '6px 0', padding: '8px', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } });
      const doorBar = h('div', { class: 'card', style: { display: 'none', margin: '6px 0', padding: '8px', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } });  // под планом: дверь видна выше
      // ---- мастер «🚪 Двери»: нажать дверь → выбрать конфигурацию → следующая ближайшая неразмеченная ----
      const isDoor = (p) => usesConfig(state.ctx.types.get(p.typeId));
      doorPts = () => sheetPts(d).filter(isDoor);
      const doorDone = (p) => !!doorCfgOf(p, state.ctx);
      const doorBtn = h('button', { class: 'sec', onclick: () => { tool = tool === 'doors' ? null : 'doors'; doorCur = null; if (tool) { selMode = false; sel.clear(); selBar(); } temp = null; toolBar(); viewer.draw(); if (tool) setTimeout(() => viewer.el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); } });
      const nextDoor = (from) => {
        const left = doorPts().filter((p) => p.id !== from?.id && !doorDone(p) && !doorSkip.has(p.id)); if (!left.length) return null;
        const pg = from?.pos?.page || 0; const dist = (p) => ((p.pos.page || 0) === pg ? 0 : 1e9) + (from ? Math.hypot(p.pos.x - from.pos.x, p.pos.y - from.pos.y) : 0);
        return left.sort((a, b) => dist(a) - dist(b))[0];
      };
      goDoor = (p) => { doorCur = p?.id || null; focusId = doorCur; toolBar(); if (p) viewer.focus(p.pos.x, p.pos.y, p.pos.page || 0, Math.max(viewer.view.s, 1.2)); else viewer.draw(); };
      const setDoor = (p, cfgId) => {
        const id = ensureDoorCfg(cfgId); if (!id) return;
        getRepo().save(currentProject().id, [{ coll: 'points', id: p.id, data: { configId: id, devices: null, cables: null, cableOverride: null } }]);
        doorSkip.delete(p.id); const nx = nextDoor({ ...p, configId: id }); toast(`${p.label}: ${allDoorCfgs().get(id)?.name || 'готово'}`);
        setTimeout(() => goDoor(nx), 250);
      };
      // все конфигурации в порядке вкладки «Конфигурации дверей»: закреплённые, потом остальные (чаще используемые выше)
      const cfgOrder = () => { const all = allDoorCfgs(); const pins = doorPins(); const used = (id) => [...state.ctx.points.values()].filter((q) => q.configId === id).length;
        return [...pins.map((id) => all.get(id)).filter(Boolean), ...[...all.values()].filter((c) => !pins.includes(c.id)).sort((a, b) => used(b.id) - used(a.id) || a.name.localeCompare(b.name, 'ru'))]; };
      brushTap = (p) => {
        focusId = p.id;
        if (pipette) { const c = doorCfgOf(p, state.ctx); if (!c) { toast(`У ${p.label} конфигурации нет`); return; } brushId = c.id; pipette = false; toast(`Кисть: ${c.name}`); toolBar(); viewer.draw(); return; }
        if (!brushId) { toast('Сначала выберите конфигурацию кисти'); return; }
        if (p.configId === brushId) { toast(`${p.label}: уже такая`); viewer.draw(); return; }
        const id = ensureDoorCfg(brushId); if (!id) return;
        getRepo().save(currentProject().id, [{ coll: 'points', id: p.id, data: { configId: id, devices: null, cables: null, cableOverride: null } }]);
        doorSkip.delete(p.id); toast(`${p.label} ✓`);
      };
      const brushPanel = (head) => {
        const list = cfgOrder(); if (!brushId || !list.some((c) => c.id === brushId)) brushId = list[0]?.id || '';
        const pins = new Set(doorPins());
        const selEl = h('select', { style: { flex: 1, minWidth: '200px' }, onchange: (e) => { brushId = e.target.value; pipette = false; toolBar(); } },
          h('optgroup', { label: '📌 Закреплённые' }, ...list.filter((c) => pins.has(c.id)).map((c) => h('option', { value: c.id, selected: c.id === brushId }, c.name))),
          h('optgroup', { label: 'Остальные' }, ...list.filter((c) => !pins.has(c.id)).map((c) => h('option', { value: c.id, selected: c.id === brushId }, c.name))));
        return [head,
          h('span', { style: { flexBasis: '100%', fontSize: '13px' } }, pipette ? '💧 Пипетка: нажмите дверь — её конфигурация станет кистью.' : 'Нажимайте двери — каждой сразу записывается выбранная конфигурация.'),
          selEl,
          h('button', { class: pipette ? '' : 'sec', onclick: () => { pipette = !pipette; toolBar(); } }, pipette ? '💧 Пипетка (вкл.)' : '💧 Пипетка')];
      };
      const doorPanel = () => {
        const all = doorPts(); const done = all.filter(doorDone).length; const skipped = all.filter((p) => !doorDone(p) && doorSkip.has(p.id)).length;
        const head = h('div', { style: { flexBasis: '100%', fontSize: '13px' } }, h('b', {}, '🚪 Двери: '), `размечено ${done} из ${all.length}`, skipped ? ` · пропущено ${skipped}` : '',
          h('span', { class: 'mut' }, '  · зелёные — размечены, оранжевые — нет, серые — пропущены'));
        const modes = h('div', { style: { flexBasis: '100%', display: 'flex', gap: '6px' } },
          h('button', { class: doorMode === 'wizard' ? '' : 'sec', style: { flex: 1 }, onclick: () => { doorMode = 'wizard'; pipette = false; toolBar(); } }, '🧭 Мастер'),
          h('button', { class: doorMode === 'brush' ? '' : 'sec', style: { flex: 1 }, onclick: () => { doorMode = 'brush'; doorCur = null; toolBar(); viewer.draw(); } }, '🖌 Кисть'),
          h('button', { class: 'sec', onclick: () => { tool = null; doorCur = null; pipette = false; toolBar(); viewer.draw(); } }, 'Готово'));
        if (doorMode === 'brush') return [modes, ...brushPanel(head)];
        const p = doorCur && state.ctx.points.get(doorCur);
        if (!p) {
          const left = all.filter((x) => !doorDone(x) && !doorSkip.has(x.id)).length;
          return [modes, head, h('span', { style: { flexBasis: '100%' } }, !all.length ? 'На этом чертеже нет дверей (точек с типом двери).' : left ? 'Нажмите на дверь, с которой начать, — дальше приложение само поведёт к ближайшим неразмеченным.' : skipped ? 'Неразмеченных больше нет, остались пропущенные.' : 'Все двери на этом чертеже размечены ✅'),
            left ? h('button', { class: 'sec', onclick: () => goDoor(nextDoor(null)) }, '▶ С любой неразмеченной') : null,
            skipped ? h('button', { class: 'sec', onclick: () => { doorSkip.clear(); goDoor(nextDoor(null)); } }, `↩ К пропущенным (${skipped})`) : null];
        }
        const cur = doorCfgOf(p, state.ctx); const cfgs = allDoorCfgs();
        return [modes, head,
          h('div', { style: { flexBasis: '100%' } }, h('b', { style: { fontSize: '17px' } }, p.label), p.planName ? h('span', { class: 'mut' }, `  (${p.planName})`) : null,
            h('div', { class: 'mut', style: { fontSize: '13px' } }, cur ? `Сейчас: ${cur.name}` : 'Конфигурация не выбрана')),
          ...doorPins().map((id) => cfgs.get(id)).filter(Boolean).map((c) => h('div', { class: `wk ${cur?.id === c.id ? 'done' : 'todo'}`, style: { cursor: 'pointer', margin: 0, padding: '6px 10px' }, onclick: () => setDoor(p, c.id) }, h('b', { style: { fontSize: '14px' } }, c.name))),
          h('button', { class: 'sec', onclick: () => doorPicker({ current: cur?.id || null, title: `🚪 ${p.label}`, onPick: (id) => setDoor(p, id) }) }, '🧩 Другая / собрать…'),
          h('button', { class: 'sec', onclick: () => { doorSkip.add(p.id); goDoor(nextDoor(p)); } }, '⏭ Пропустить'),
          cur ? h('button', { class: 'sec', onclick: () => goDoor(nextDoor(p)) }, '▶ Следующая') : null,
          h('button', { class: 'sec', onclick: () => goDoor(null) }, '✖ Стоп')];
      };
      toolBar = () => {
        addBtn.textContent = tool === 'add' ? '✔ Точка на плане: нажмите место' : '➕ Точка на плане'; addBtn.className = tool === 'add' ? '' : 'sec';
        iconBtn.textContent = tool === 'icon' ? '✔ Значки типов' : '📌 Значки типов'; iconBtn.className = tool === 'icon' ? '' : 'sec';
        doorBtn.textContent = tool === 'doors' ? '✔ Двери' : '🚪 Двери'; doorBtn.className = tool === 'doors' ? '' : 'sec';
        tbar.style.display = tool && tool !== 'doors' ? 'flex' : 'none';
        doorBar.style.display = tool === 'doors' ? 'flex' : 'none'; if (tool === 'doors') doorBar.replaceChildren(...doorPanel().filter(Boolean)); else doorBar.replaceChildren();
        if (tool === 'add') tbar.replaceChildren(h('span', {}, 'Нажмите на значок, надпись или свободное место — приложение прицепится к ближайшему значку/надписи. Потом: оставить отметку, привязать к точке или создать новую.'));
        else if (tool === 'doors') tbar.replaceChildren();
        else if (tool === 'place') tbar.replaceChildren(h('span', {}, h('b', {}, `📍 Где точка «${placeFor?.label}»? `), drawingsOf().length > 1 ? 'Выберите чертёж сверху, если не этот, и ' : '', 'нажмите на её значок или надпись.'),
          h('button', { class: 'sec', onclick: () => { tool = null; placeFor = null; temp = null; toolBar(); viewer.draw(); } }, 'Отмена'));
        else if (tool === 'icon') {
          const icons = currentProject()?.typeIcons || {};
          const tp = typePicker({ onChange: (t) => { iconType = t; } }); const s = tp.querySelector('select'); if (iconType) s.value = iconType;
          tbar.replaceChildren(h('div', { style: { flexBasis: '100%' } }, 'Выберите тип и нажмите на его значок на чертеже. Этим значком будут нарисованы точки этого типа, добавленные на объекте (на плане и в «📄 PDF с номерами»).'),
            h('div', { style: { flex: 1, minWidth: '200px' } }, tp),
            ...Object.entries(icons).map(([t, ic]) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', border: '1px solid #ddd', borderRadius: '6px', padding: '2px 6px' } },
              h('img', { src: ic.png, style: { height: '22px', background: '#fff' } }), t,
              h('button', { class: 'sec', style: { padding: '0 6px' }, title: 'Убрать значок', onclick: async () => { if (!(await confirmDialog(`Убрать значок типа «${t}»?`, { yes: 'Убрать' }))) return; const p = currentProject(); const n = { ...(p.typeIcons || {}) }; delete n[t]; getRepo().saveProject(p.id, { typeIcons: n }); setTimeout(() => { toolBar(); viewer.draw(); }, 300); } }, '✕'))));
        } else tbar.replaceChildren();
      };
      selBar = () => {
        selBtn.textContent = selMode ? '✔ Выбор: нажимайте точки' : '☑ Выбрать на плане'; selBtn.className = selMode ? '' : 'sec';
        bar.style.display = selMode ? 'flex' : 'none';
        bar.replaceChildren(h('b', {}, `Выбрано: ${sel.size}`),
          h('button', { class: rectSel ? '' : 'sec', onclick: () => { rectSel = !rectSel; selBar(); } }, rectSel ? '▭ Рамкой (вкл.)' : '▭ Рамкой'),
          h('button', { disabled: !sel.size, onclick: () => { addWorkForPoints([...sel]); } }, `➕ Работа на выбранные (${sel.size})`),
          h('button', { disabled: !sel.size, onclick: () => bulkEditForm([...sel], () => { selBar(); viewer.draw(); }) }, `✏️ Изменить (${sel.size})`),
          h('button', { disabled: !sel.size, onclick: () => renameForm([...sel], () => { selBar(); viewer.draw(); }) }, '🏷 Переименовать'),
          h('button', { class: 'sec', onclick: () => { sel.clear(); selBar(); viewer.draw(); } }, 'Снять'));
      };
      const bar = h('div', { class: 'card', style: { display: 'none', margin: '6px 0', padding: '8px', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } });
      const layersBtn = h('button', { class: 'sec', onclick: () => layersModal(d) }, '🗂 Слои чертежа');
      const dimBtn = h('button', { class: 'sec', onclick: () => { dimDrawing = !dimDrawing; dimBtn.textContent = dimDrawing ? '🌕 Чертёж ярче' : '🌗 Чертёж бледнее'; viewer.draw(); } }, dimDrawing ? '🌕 Чертёж ярче' : '🌗 Чертёж бледнее');
      updateInfo = () => {
        const n = sheetPts(d).length;
        status.textContent = `${drawingTitle(d)}${d.title ? ` (файл ${d.name})` : ''}${d.floor ? ` · этаж ${d.floor}` : ''} · точек на чертеже: ${n}${unl().length ? ` · не размеченых: ${unl().length}` : ''}`;
        const ou = typeSel.querySelector(`option[value="${UNL}"]`); if (ou) ou.textContent = `❔ Не размеченые (${unl().length})`;
        const oh = typeSel.querySelector(`option[value="${HID}"]`); if (oh) oh.textContent = `🙈 Скрытые (${hid().length})`;
      };
      updateInfo();
      holder.replaceChildren(
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '0 0 6px' } }, search, typeSel, cabSel, stageSel),
        h('div', { class: 'btns', style: { marginTop: 0 } }, ...viewer.zoomBtns(), selBtn, doorBtn, addBtn, iconBtn, dimBtn, layersBtn), bar, tbar, viewer.el, doorBar,
        h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', margin: '6px 2px', fontSize: '13px' } }, ...STATUS_COLORS.map(([c, t]) => h('span', {}, h('span', { style: { color: c } }, '■ '), t))),
        h('div', { class: 'btns' },
          h('button', { class: 'sec', onclick: () => linkPoints(d, buf, { onDone: () => draw(d.id) }).catch((e) => toast(e.message)) }, '🔗 Связать точки'),
          h('button', { class: 'sec', onclick: async () => { try { await exportNumberedPdf(cur(), buf); } catch (e) { toast(`Не получилось: ${e.message}`); } } }, '📄 Скачать PDF с номерами'),
          h('button', { class: 'sec', title: cur().numberedAt ? `На Диске с ${new Date(cur().numberedAt).toLocaleString('ru-RU')}` : '', onclick: async () => { if (!cur().fileId) { toast('Сначала «⬆ На Диск» — исходный чертёж'); return; } try { await publishNumbered(cur(), buf); } catch (e) { toast(`Не получилось: ${e.message}`); } } }, cur().numberedFileId ? '☁️ Обновить на Диске сейчас' : '☁️ PDF с номерами на Диск'),
          h('button', { class: 'sec', onclick: () => pointsFromDrawing({ drawing: d, buf }) }, '✏️ Редактировать'),
          h('button', { class: 'sec', onclick: () => pointsFromDrawing({ drawing: d, buf, iconsOnly: true, onDone: () => draw(d.id) }) }, '🔎 Значки без номеров'),
          d.fileId ? null : h('button', { class: 'sec', onclick: async () => { try { toast('Отправляю на Диск…'); await pushDrawing(d); toast('Чертёж на Диске — откроется и на других устройствах'); draw(d.id); } catch (e) { toast(`Не получилось: ${e.message}`); } } }, '⬆ На Диск'),
          h('button', { class: 'sec', onclick: async () => { if (await confirmDialog(`Убрать чертёж «${drawingTitle(d)}» из проекта? Точки останутся, файл на Диске — тоже.`, { yes: 'Убрать', danger: true })) { removeDrawing(d); setTimeout(() => draw(), 300); } } }, '🗑 Убрать чертёж')));
      selBar(); toolBar();
      await viewer.start();
      const f = focusId && state.ctx.points.get(focusId);
      if (f?.pos && drawingFor(f)?.id === d.id) await viewer.focus(f.pos.x, f.pos.y, f.pos.page || 0);
    } catch (e) { status.textContent = e.message; }
  }

  // нажатие в режиме инструмента: прицепиться к ближайшей надписи/значку, дальше — по инструменту
  async function toolTap(d, pages, x, y, page, nearest) {
    const all = sheetPts(d);
    if (tool === 'add') { const hit = nearest(all, (p) => p.pos, x, y, page); if (hit) { focusId = hit.id; viewer.draw(); existingCard(d, hit); return; } }
    let sn = null; try { sn = await wk.call('snap', { page, x, y, r: 14 / viewer.view.s }); } catch { /* без привязки */ }
    if (sn?.kind === 'text' && !labelLike(sn.label)) sn = null;  // посторонняя надпись (иврит, длинный текст) — не номер точки
    if (tool !== 'icon' && sn?.kind === 'shape' && Math.max(sn.w || 0, sn.h || 0) > 24) sn = null;  // крупное (стена, линия, штриховка) — не значок: ставим, где нажали
    const pg = pages[page] || {}; const ic = (t) => currentProject()?.typeIcons?.[t];
    // icon — нарисовать значок типа (на чертеже значка нет): по умолчанию, если рядом ничего не нашлось
    const at = (t, icon = !sn) => {
      const tap = { page, x: +x.toFixed(1), y: +y.toFixed(1) };
      const base = sn && !(icon && sn.kind === 'text') ? { page, x: sn.x, y: sn.y, w: sn.w, h: sn.h, ...(sn.kind === 'text' ? { text: sn.label } : {}) } : tap;
      return icon ? { ...base, w: ic(t)?.w || base.w || 10, h: ic(t)?.h || base.h || 10, icon: true } : { ...base, w: base.w || 10, h: base.h || 10 };
    };
    const posFor = (t, icon) => ({ ...at(t, icon), pw: pg.w, ph: pg.h, sheet: d.name });
    temp = at(''); viewer.draw();
    const done = () => { temp = null; viewer?.draw(); };
    if (tool === 'icon') return iconTap(d, sn, page, x, y, done);
    if (tool === 'place') {
      const p = placeFor; const ok = await confirmDialog(`Поставить «${p.label}» сюда${sn?.kind === 'text' ? ` (надпись «${sn.label}»)` : sn ? ' (значок)' : ''}?`, { yes: '📍 Сюда' });
      if (!ok) { done(); return; }
      getRepo().save(currentProject().id, [{ coll: 'points', id: p.id, data: { pos: posFor(p.typeId) } }]);
      toast(`«${p.label}» на чертеже`); focusId = p.id; tool = null; placeFor = null; temp = null; toolBar(); setTimeout(() => viewer?.draw(), 300); return;
    }
    addCard(d, sn, posFor, done);
  }

  // «➕ Точка на плане» по уже отмеченной точке: привязать это место к другой точке или нарисовать/убрать значок типа
  function existingCard(d, p) {
    const ic = currentProject()?.typeIcons?.[p.typeId];
    const group = sheetPts(d).filter((q) => posKey(q.pos) === posKey(p.pos)).sort(comparePoints);
    const c = openModal(`«${combineLabels(group.map((q) => q.label)).join(', ')}» на плане`, h('div', {},
      h('div', { class: 'mut' }, group.length > 1 ? `На этой отметке точек: ${group.length}.` : `${p.typeId}${p.cabinet ? ` · шкаф ${p.cabinet}` : ''}. Здесь уже стоит эта точка.`),
      h('div', { class: 'btns' },
        h('button', { class: 'sec', onclick: () => { c(); choosePoint({ title: `🔗 Какая точка здесь вместо «${p.label}»?`, exclude: p.id, onPick: (q) => {
          getRepo().save(currentProject().id, [{ coll: 'points', id: q.id, data: { pos: { ...p.pos } } }, { coll: 'points', id: p.id, data: { pos: null } }]);
          toast(`Здесь теперь «${q.label}». «${p.label}» — без места на плане`); focusId = q.id; setTimeout(() => viewer?.draw(), 300); return true;
        } }); } }, '🔗 Привязать другую точку'),
        h('button', { class: 'sec', onclick: () => {
          const on = !p.pos.icon;
          const pos = on ? { ...p.pos, icon: true, w: ic?.w || p.pos.w || 10, h: ic?.h || p.pos.h || 10 } : { ...p.pos, icon: false };
          getRepo().save(currentProject().id, [{ coll: 'points', id: p.id, data: { pos } }]);
          toast(on ? (ic ? 'Значок типа нарисован' : 'У типа значок не задан — «📌 Значки типов»') : 'Значок убран'); c(); setTimeout(() => viewer?.draw(), 300);
        } }, p.pos.icon ? '🖼 Убрать значок типа' : '🖼 Значок по типу точки'),
        h('button', { class: 'sec', onclick: async () => {
          const list = await pickGroup(group, `Убрать с плана${group.length > 1 ? ' — какие точки этой отметки?' : ` «${p.label}»?`}`, 'Точки останутся в проекте (фильтр «📍 Нет на плане»), их можно будет отметить снова.', '🗑 Убрать'); if (!list) return;
          getRepo().save(currentProject().id, list.map((q) => ({ coll: 'points', id: q.id, data: { pos: null } }))); toast(`Убрано с плана: ${combineLabels(list.map((q) => q.label)).join(', ')}`); c(); setTimeout(() => viewer?.draw(), 300);
        } }, '🗑 Убрать с плана'),
        h('button', { class: 'sec', onclick: async () => {
          const list = await pickGroup(group, `Скрыть${group.length > 1 ? ' — какие точки этой отметки?' : ` «${p.label}»?`}`, 'Место закрасится белым, точки останутся в проекте без места на плане. Вернуть — фильтр «🙈 Скрытые».', '🙈 Скрыть'); if (!list) return;
          if (list.length === group.length) hideArea(d, { label: combineLabels(list.map((q) => q.label)).join(', '), typeId: p.typeId, pos: { ...p.pos } });
          getRepo().save(currentProject().id, list.map((q) => ({ coll: 'points', id: q.id, data: { pos: null } }))); toast(`Скрыто: ${combineLabels(list.map((q) => q.label)).join(', ')}`); c();
        } }, '🙈 Скрыть'),
        h('button', { class: 'sec', onclick: () => { c(); openCard?.(p); } }, '📋 Карточка точки'))), {});
  }
  // какие из точек отметки (по умолчанию все); одна точка — просто подтверждение
  function pickGroup(group, title, note, yes) {
    if (group.length === 1) return confirmDialog(`${title} ${note}`, { yes }).then((ok) => (ok ? group : null));
    return new Promise((res) => {
      const boxes = group.map((q) => ({ q, cb: h('input', { type: 'checkbox', checked: true }) })); let done = false;
      const cc = openModal(title, h('div', {}, h('div', { class: 'mut' }, note),
        h('div', { class: 'picklist' }, boxes.map((b) => h('label', { class: 'pickrow' }, b.cb, h('span', {}, b.q.label)))),
        h('div', { class: 'btns' }, h('button', { onclick: () => { const l = boxes.filter((b) => b.cb.checked).map((b) => b.q); if (!l.length) { toast('Ничего не выбрано'); return; } done = true; cc(); res(l); } }, yes))),
      { onClose: () => { if (!done) res(null); } });
    });
  }
  // добавить место в «Скрытые» чертежа (и убрать из «Не размеченых», если оно там было)
  function hideArea(d, m) {
    const k = posKey(m.pos); const pos = { ...m.pos }; delete pos.icon;
    updateDrawing(d.id, (x) => ({ unlinked: (x.unlinked || []).filter((y) => posKey(y.pos) !== k), hidden: [...(x.hidden || []).filter((y) => posKey(y.pos) !== k), { label: m.label, typeId: m.typeId || '', pos }] }));
    setTimeout(() => viewer?.draw(), 300);
  }

  // «➕ Точка на плане»: оставить отметку / привязать к точке / новая точка
  function addCard(d, sn, posFor, done) {
    const what = sn?.kind === 'text' ? `Надпись «${sn.label}»` : sn ? 'Значок на чертеже' : 'Свободное место (рядом нет значка или надписи)';
    const area = h('div', {});
    let saved = false;
    const c = openModal('➕ Точка на плане', h('div', {}, h('div', { class: 'mut', style: { marginBottom: '6px' } }, what),
      h('div', { class: 'btns' },
        h('button', { class: 'sec', onclick: () => leaveMark() }, '❔ Оставить отметку'),
        h('button', { class: 'sec', onclick: () => bind() }, '🔗 Привязать к точке'),
        h('button', { onclick: () => fresh() }, '➕ Новая точка'),
        sn ? h('button', { class: 'sec', onclick: () => { const pos = posFor('', false); hideArea(d, { label: sn.label || '(значок)', typeId: '', pos }); toast('Скрыто — закрашено белым. Вернуть: фильтр «🙈 Скрытые»'); finish(); } }, '🙈 Скрыть') : null), area), { sticky: true, onClose: () => { if (!saved) done(); } });
    const finish = () => { saved = true; c(); done(); setTimeout(() => viewer?.draw(), 300); };
    function leaveMark() {
      const cap = h('input', { value: sn?.label || '', placeholder: 'Подпись отметки (например: «датчик над дверью?»)' });
      area.replaceChildren(h('div', { class: 'mut', style: { margin: '8px 0 4px' } }, 'Отметка попадёт в «❔ Не размеченые» (фильтр типов в плане) — потом её можно связать с точкой или скрыть.'), cap,
        h('div', { class: 'btns' }, h('button', { onclick: () => {
          const pos = posFor(''); delete pos.icon;
          updateDrawing(d.id, (x) => ({ unlinked: [...(x.unlinked || []), { label: cap.value.trim() || '(без подписи)', typeId: '', pos }] }));
          toast('Отметка сохранена — «❔ Не размеченые»'); finish();
        } }, 'Сохранить отметку')));
      cap.focus();
    }
    function bind() {
      choosePoint({ title: '🔗 Какая это точка?', renameLabel: sn?.kind === 'text' ? sn.label : '', onPick: (p, { rename }) => {
        if (rename && [...state.ctx.points.values()].some((x) => x.id !== p.id && sameLabelClash(x, { label: sn.label, cabinet: p.cabinet }))) { toast(`«${sn.label}» уже есть в этом шкафу — переименовать нельзя`); return false; }
        const data = { pos: posFor(p.typeId) };
        if (rename) { data.label = sn.label; data.planName = p.label; } else if (sn?.kind === 'text' && p.label !== sn.label) data.planName = sn.label;
        getRepo().save(currentProject().id, [{ coll: 'points', id: p.id, data }]);
        toast(`«${rename ? sn.label : p.label}» на чертеже`); focusId = p.id; finish(); return true;
      }, onPickMany: (list) => {
        getRepo().save(currentProject().id, list.map((p) => ({ coll: 'points', id: p.id, data: { pos: posFor(p.typeId) } })));
        toast(`На эту отметку: ${combineLabels(list.map((p) => p.label)).join(', ')}`); focusId = list[0].id; finish(); return true;
      } });
    }
    function fresh() {
      const pts = [...state.ctx.points.values()];
      const cabs = [...new Set(pts.map((p) => p.cabinet || ''))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
      const near = sheetPts(d).filter((p) => p.cabinet).sort((a, b) => Math.hypot(a.pos.x - temp.x, a.pos.y - temp.y) - Math.hypot(b.pos.x - temp.x, b.pos.y - temp.y))[0];
      let tid = ''; let cab = fCab || near?.cabinet || ''; let edited = false;
      const name = h('input', { placeholder: 'Название точки', oninput: () => { edited = true; hint.textContent = ''; } });
      const hint = h('small', { class: 'mut' });
      const cabSel = h('select', { onchange: () => { cab = cabSel.value; cp.setType(tid, cab); suggest(); } }, h('option', { value: '' }, '— выберите шкаф —'), ...cabs.map((x) => h('option', { value: x, selected: x === cab }, `Шкаф ${x}`)));
      const cp = cablesPicker({ compact: true });
      const iconCb = h('input', { type: 'checkbox', checked: false });
      const iconNote = h('small', { class: 'mut' });
      const iconRow = h('label', { class: 'pickrow' }, iconCb, h('span', {}, '🖼 Нарисовать значок типа (на чертеже значка этой точки нет) ', iconNote));
      const iconInfo = () => { iconNote.textContent = tid && !currentProject()?.typeIcons?.[tid] ? '— у этого типа значок не задан («📌 Значки типов»), пока будет кружок' : ''; };
      const tp = typePicker({ onChange: (t) => { tid = t; cp.setType(t, cab); suggest(); iconInfo(); } });
      function suggest() {
        if (edited) return;
        if (sn?.kind === 'text') { name.value = sn.label; hint.textContent = 'Как надпись на чертеже'; return; }
        const n = tid ? nextLabel(pts, tid, cab) : '';
        name.value = n; hint.textContent = n ? `Предложено: следующий номер после последней точки этого типа${cab ? ` в шкафу ${cab}` : ''}. Можно исправить.` : (tid ? 'Таких точек ещё нет — впишите название.' : '');
      }
      area.replaceChildren(h('div', { class: 'form', style: { marginTop: '8px' } },
        h('label', {}, 'Шкаф'), cabSel, h('label', {}, 'Тип'), tp, h('label', {}, 'Название'), name, hint,
        h('label', {}, 'Кабели'), cp.el, iconRow,
        h('div', { class: 'btns' }, h('button', { onclick: () => {
          const label = name.value.trim();
          if (!tid) { toast('Выберите тип'); return; } if (!cab) { toast('Выберите шкаф — точка добавляется только с шкафом'); return; } if (!label) { toast('Впишите название'); return; }
          if (pts.some((p) => sameLabelClash(p, { label, cabinet: cab }))) { toast(cab ? `«${label}» уже есть в шкафу ${cab}` : `«${label}» уже есть среди точек без шкафа`); return; }
          const data = { label, typeId: tid, pos: posFor(tid, iconCb.checked), note: 'добавлено на плане' };
          if (cab) data.cabinet = cab; if (d.floor) data.floor = d.floor; const ov = cp.override(); if (ov) data.cableOverride = ov;
          const id = newId(); getRepo().save(currentProject().id, [{ coll: 'points', id, data }]);
          toast(`Точка «${label}» добавлена${data.pos.icon && !currentProject()?.typeIcons?.[tid] ? ' — значок этого типа можно задать в «📌 Значки типов»' : ''}`); focusId = id; finish();
        } }, '✔ Создать точку'))));
      suggest();
    }
  }

  // «📌 Значки типов»: нажатие на значок → его картинка (маленький PNG) хранится в проекте
  async function iconTap(d, sn, page, x, y, done) {
    if (!iconType) { toast('Сначала выберите тип'); done(); return; }
    let png = null; let size;
    if (sn?.kind === 'text') {
      // надпись в рамке (например, «TV-140»): берём надпись с рамкой вокруг; наклонную — разворачиваем горизонтально
      const a = sn.angle || 0; const rad = a * Math.PI / 180; const c = Math.abs(Math.cos(rad)); const s = Math.abs(Math.sin(rad));
      const H = sn.size ? sn.size * 1.1 : Math.min(sn.w, sn.h);
      let L = c > 0.3 ? (sn.w - H * s) / c : (sn.h - H * c) / s; if (!(L > 0)) L = Math.max(sn.w, sn.h);
      size = { w: L + H * 1.4, h: H * 2.6 };
      for (const z of [6, 4, 3, 2]) { png = await wk.call('png', { page, rot: { cx: sn.x, cy: sn.y, w: size.w, h: size.h, angle: a }, zoom: Math.min(z, 200 / size.w) }); if (png.byteLength < 24000) break; }
    } else {
      const b = sn ? [sn.x - sn.w / 2, sn.y - sn.h / 2, sn.x + sn.w / 2, sn.y + sn.h / 2] : [x - 6, y - 6, x + 6, y + 6];
      const w = b[2] - b[0]; const hh = b[3] - b[1]; const pad = Math.max(0.5, Math.max(w, hh) * 0.06);
      const clip = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad]; size = { w: clip[2] - clip[0], h: clip[3] - clip[1] };
      for (const z of [6, 4, 3, 2]) { png = await wk.call('png', { page, clip, zoom: Math.min(z, 160 / (clip[2] - clip[0])) }); if (png.byteLength < 24000) break; }
    }
    const url = toDataUrl(png);
    const ok = await confirmDialog(h('div', {}, h('div', {}, `Значок для типа «${iconType}»:`), h('img', { src: url, style: { maxHeight: '80px', background: '#fff', border: '1px solid #ddd', margin: '8px 0' } }), h('div', { class: 'mut' }, sn ? '' : 'Рядом не нашёлся значок — взят кусок вокруг нажатия.')), { yes: 'Сохранить значок' });
    done();
    if (!ok) return;
    const p = currentProject(); getRepo().saveProject(p.id, { typeIcons: { ...(p.typeIcons || {}), [iconType]: { png: url, w: +size.w.toFixed(1), h: +size.h.toFixed(1) } } });
    toast(`Значок типа «${iconType}» сохранён`); setTimeout(() => { toolBar(); viewer?.draw(); }, 300);
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
        h('button', { onclick: () => { c(); chooseFor(d, m); } }, '🔗 Связать с точкой'))), {});
  }
  function moveMark(d, m, from, to) {
    const k = posKey(m.pos);
    updateDrawing(d.id, (x) => ({ [from]: (x[from] || []).filter((y) => posKey(y.pos) !== k), [to]: [...(x[to] || []), m] }));
    setTimeout(() => viewer?.draw(), 300);
  }
  // выбор точки проекта для подписи: поиск, тип, шкаф; по умолчанию — точки без места на чертеже
  function chooseFor(d, m) {
    choosePoint({ title: `🔗 Точка для «${m.label}»`, typeId: m.typeId, renameLabel: m.label, onPick: (p, { rename }) => {
      if (rename && [...state.ctx.points.values()].some((x) => x.id !== p.id && sameLabelClash(x, { label: m.label, cabinet: p.cabinet }))) { toast(`«${m.label}» уже есть в этом шкафу — переименовать нельзя`); return false; }
      const data = { pos: { ...m.pos, sheet: d.name } };
      if (rename) { data.label = m.label; data.planName = p.label; } else if (p.label !== m.label) data.planName = m.label;
      getRepo().save(currentProject().id, [{ coll: 'points', id: p.id, data }]);
      const k = posKey(m.pos); updateDrawing(d.id, (x) => ({ unlinked: (x.unlinked || []).filter((y) => posKey(y.pos) !== k), hidden: (x.hidden || []).filter((y) => posKey(y.pos) !== k) }));
      toast(`«${rename ? m.label : p.label}» связана с чертежом`); return true;
    }, onPickMany: (list) => {
      getRepo().save(currentProject().id, list.map((p) => ({ coll: 'points', id: p.id, data: { pos: { ...m.pos, sheet: d.name }, planName: m.label } })));
      const k = posKey(m.pos); updateDrawing(d.id, (x) => ({ unlinked: (x.unlinked || []).filter((y) => posKey(y.pos) !== k), hidden: (x.hidden || []).filter((y) => posKey(y.pos) !== k) }));
      toast(`На «${m.label}»: ${combineLabels(list.map((p) => p.label)).join(', ')}`); return true;
    } });
  }

  const body = h('div', {});
  function draw(selectId) {
    const list = drawingsOf();
    const want = selectId || (point && drawingFor(point)?.id) || (placeFor && list.find((x) => x.floor && x.floor === placeFor.floor)?.id) || current?.id || list[0]?.id;
    const d = list.find((x) => x.id === want) || list[0];
    const sel = list.length > 1 ? h('select', { onchange: (e) => show(list.find((x) => x.id === e.target.value)) }, list.map((x) => h('option', { value: x.id, selected: x.id === d?.id }, `${drawingTitle(x)}${x.floor ? ` (этаж ${x.floor})` : ''}`))) : null;
    box.replaceChildren(
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, sel, h('button', { class: list.length ? 'sec' : '', onclick: addPdf }, '➕ Чертёж (PDF)'),
        list.length ? h('button', { class: 'sec', onclick: () => namesModal() }, '✏️ Названия и порядок') : null),
      list.length ? body : h('div', { class: 'empty', style: { marginTop: '10px' } }, 'Чертежей пока нет. Добавьте PDF тохнита — точки с местом на чертеже (после разбора «📐 Из чертежа» или из файла) появятся на нём. Чертёж хранится на вашем Google Диске и открыт участникам проекта.'));
    if (d) show(d);
  }
  // свои названия чертежей и порядок в списке (имя файла не меняется — по нему связаны точки и ищутся дубликаты)
  function namesModal() {
    const rows = drawingsOf().map((d) => ({ d, inp: h('input', { value: d.title || '', placeholder: d.name }) }));
    const list = h('div', {});
    const paint = () => list.replaceChildren(...rows.map((r, i) => h('div', { class: 'card', style: { margin: '6px 0', padding: '8px', display: 'flex', gap: '6px', alignItems: 'center' } },
      h('div', { style: { flex: 1, minWidth: 0 } }, r.inp, h('small', { class: 'mut' }, `Файл: ${r.d.name}${r.d.floor ? ` · этаж ${r.d.floor}` : ''}`)),
      h('button', { class: 'sec', style: { padding: '6px 10px' }, disabled: i === 0, title: 'Выше', onclick: () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; paint(); } }, '↑'),
      h('button', { class: 'sec', style: { padding: '6px 10px' }, disabled: i === rows.length - 1, title: 'Ниже', onclick: () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; paint(); } }, '↓'))));
    paint();
    const c = openModal('✏️ Названия и порядок чертежей', h('div', {},
      h('div', { class: 'mut' }, 'Впишите удобное название (пусто — как имя файла). Стрелками — порядок в списке чертежей. Имя файла остаётся: по нему приложение узнаёт этот же файл при повторном добавлении.'),
      list, h('div', { class: 'btns' }, h('button', { onclick: () => {
        const p = currentProject(); const pos = new Map(rows.map((r, i) => [r.d.id, { order: i, title: r.inp.value.trim() }]));
        getRepo().saveProject(p.id, { drawings: (p.drawings || []).map((d) => (pos.has(d.id) ? { ...d, ...pos.get(d.id) } : d)) });
        c(); toast('Сохранено'); setTimeout(() => draw(current?.id), 300);
      } }, 'Сохранить'))), { sticky: true });
  }

  openCard = (p) => import('./points.js').then((m) => m.pointCard(p, { fromPlan: true }));
  draw();
  void close;
}
