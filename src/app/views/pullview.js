// «🧵 Протяжки»: выбор точек на плане → «До шкафа» → метраж по точкам (своя цифровая панель) → чеклист → «Завершить» (форма отчёта).
// Каждое действие сразу сохраняется на телефоне (localStorage) и на сервере (коллекция pulls) — открыл заново и продолжил с того же места.
import { h, openModal, toast, confirmDialog, formModal } from '../ui.js';
import { state, getRepo, currentProject, infoOf, subscribe } from '../store.js';
import { newId } from '../repo.js';
import { drawingsOf, drawingTitle, drawingFor, loadDrawing, posKey } from '../drawings.js';
import { comparePoints, statusColor, workFits } from '../../domain/index.js';
import { pullStatus, pullColor, pullTotal, isMeasured, nearestPoint, pullTitle, canDeletePull, mergeRemote, pairsToMap, mapToPairs } from '../../domain/pull.js';
import { createViewer } from './planview.js';
import { makeWorker } from './tohnitview.js';
import { outline, placeTags, tagOf, shOf, isText } from './planmodal.js';
import { addWorkForPoints } from './doh.js';
import { latinKey } from '../../domain/index.js';
import { typeMatch, typeFilterOptions } from '../typegroups.js';
import { cfgMatch, cfgFilterOptions } from '../cfgfilter.js';

// ---------- хранение: телефон + сервер ----------
const lsKey = (pid, id) => `pz.pull.${pid}.${id}`;
const readLocal = (pid, id) => { try { return JSON.parse(localStorage.getItem(lsKey(pid, id)) || 'null'); } catch { return null; } };
const writeLocal = (pid, p) => { try { localStorage.setItem(lsKey(pid, p.id), JSON.stringify(p)); } catch { /* память телефона недоступна */ } };
const dropLocal = (pid, id) => { try { localStorage.removeItem(lsKey(pid, id)); } catch { /* ok */ } };
function localAll(pid) {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(`pz.pull.${pid}.`)) { const v = JSON.parse(localStorage.getItem(k) || 'null'); if (v?.id) out.push(v); } } } catch { /* ok */ }
  return out;
}
const FIELDS = ['name', 'createdAt', 'drawingId', 'screen', 'curId', 'pad', 'pointIds', 'base', 'meters', 'kept', 'checked', 'finished', 'fixed', 'finishedAt', 'savedAt'];
const pick = (p) => Object.fromEntries(FIELDS.map((k) => [k, p[k] === undefined ? null : p[k]]));
/** Все протяжки проекта: сервер + телефон (берётся более свежая копия) */
export function allPulls() {
  const pid = currentProject()?.id; if (!pid) return [];
  const m = new Map(); const gone = new Set((state.data.pulls || []).filter((x) => x.deleted).map((x) => x.id));
  (state.data.pulls || []).filter((x) => !x.deleted).forEach((x) => m.set(x.id, x));
  localAll(pid).forEach((x) => { if (gone.has(x.id)) { dropLocal(pid, x.id); return; } const s = m.get(x.id); if (!s || (x.savedAt || 0) > (s.savedAt || 0)) m.set(x.id, x); });
  return [...m.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
const getPull = (id) => allPulls().find((x) => x.id === id) || null;
function savePull(p) {
  const pid = currentProject().id; const next = { ...p, savedAt: Date.now() };
  writeLocal(pid, next);
  getRepo().save(pid, [{ coll: 'pulls', id: p.id, data: { ...pick(next), deleted: false } }]);
  return next;
}

// ---------- список «Протяжки» ----------
export function openPulls() {
  const body = h('div', {}); let q = '';
  const search = h('input', { type: 'search', placeholder: 'Найти точку: в каких протяжках была', oninput: (e) => { q = e.target.value.trim().toLowerCase(); paint(); } });
  const list = h('div', {});
  function paint() {
    const ctx = state.ctx; if (!ctx) return;
    const rows = allPulls().map((p) => {
      const hits = q ? (p.pointIds || []).map((id) => ctx.points.get(id)).filter((x) => x && latinKey(`${x.label} ${x.planName || ''}`).includes(latinKey(q))) : [];
      return { p, hits };
    }).filter((r) => !q || r.hits.length);
    list.replaceChildren(...(rows.length ? rows.map(({ p, hits }) => {
      const st = pullStatus(p, (id) => state.ctx.points.has(id)); const n = (p.pointIds || []).length; const m = (p.pointIds || []).filter((id) => isMeasured(p, id)).length; const f = (p.finished || []).length;
      const fin = new Set(p.finished || []);
      return h('div', { class: 'card', style: { margin: '6px 0', padding: '10px', cursor: 'pointer', borderInlineStart: `6px solid ${pullColor(st)}` }, onclick: () => openPull(p.id) },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' } },
          h('div', { style: { minWidth: 0 } }, h('b', {}, pullTitle(p)),
            h('div', { class: 'mut', style: { fontSize: '13px' } }, `${drawingTitle(drawingsOf().find((d) => d.id === p.drawingId)) || 'чертёж?'} · точек ${n} · метраж ${m}/${n}${f ? ` · протянуто ${f}` : ''}`)),
          h('span', { style: { background: pullColor(st), color: '#fff', borderRadius: '10px', padding: '2px 8px', fontSize: '12px', whiteSpace: 'nowrap' } }, st)),
        hits.length ? h('div', { style: { fontSize: '13px', marginTop: '4px' } }, ...hits.map((x) => h('div', {}, `${fin.has(x.id) ? '✅' : '•'} ${x.label}${pullTotal(p, x.id) != null ? ` — ${pullTotal(p, x.id)} м` : ''}${fin.has(x.id) && p.finishedAt ? ` · протянута ${new Date(p.finishedAt).toLocaleDateString('ru-RU')}` : ''}`))) : null,
        h('div', { class: 'btns', style: { marginTop: '6px' }, onclick: (e) => e.stopPropagation() },
          h('button', { class: 'sec', style: { padding: '4px 10px' }, onclick: () => renameForm(p) }, '✏️ Название'),
          canDeletePull(p) ? h('button', { class: 'sec', style: { padding: '4px 10px' }, onclick: async () => {
            if (!(await confirmDialog(`Удалить протяжку «${pullTitle(p)}»? Метражи в карточках точек останутся.`, { yes: 'Удалить', danger: true }))) return;
            const pid = currentProject().id; dropLocal(pid, p.id); getRepo().remove(pid, 'pulls', p.id); toast('Удалена'); setTimeout(paint, 200);
          } }, '🗑') : null));
    }) : [h('div', { class: 'empty' }, q ? 'Нет протяжек с такой точкой' : 'Протяжек пока нет')]));
  }
  body.append(h('div', { class: 'btns', style: { marginTop: 0 } }, h('button', { class: 'wide', onclick: () => newPull() }, '➕ Новая протяжка')), search, list);
  paint();
  const off = subscribe(() => { if (!body.isConnected) { off?.(); return; } paint(); });
  openModal('🧵 Протяжки', body, {});
}
function renameForm(p) {
  formModal({ title: 'Название протяжки', fields: [{ key: 'name', label: 'Название', required: true }], values: { name: p.name },
    onSubmit: (v) => { savePull({ ...getPull(p.id), name: String(v.name).trim() }); toast('Сохранено'); } });
}
function newPull() {
  const list = drawingsOf();
  if (!list.length) { toast('В проекте нет чертежей — добавьте их в «🗺 План»'); return; }
  const last = allPulls()[0];
  formModal({
    title: '🧵 Новая протяжка', submitLabel: 'Дальше →',
    fields: [
      { key: 'name', label: 'Название', required: true, hint: 'Можно повторять — протяжки различаются датой и временем, они добавятся сами.' },
      { key: 'drawingId', label: 'Этаж (чертёж)', type: 'select', required: true, options: list.map((d) => ({ value: d.id, label: `${drawingTitle(d)}${d.floor ? ` (этаж ${d.floor})` : ''}` })) },
    ],
    values: { drawingId: last?.drawingId && list.some((d) => d.id === last.drawingId) ? last.drawingId : list[0].id },
    onSubmit: (v) => {
      const p = savePull({ id: newId(), name: String(v.name).trim(), createdAt: Date.now(), drawingId: v.drawingId, screen: 'select', pointIds: [], base: null, meters: [], kept: [], checked: [], finished: [] });
      setTimeout(() => openPull(p.id), 50);
    },
  });
}

// ---------- работа с протяжкой ----------
const hitDist = (s, pos, x, y) => { const pad = 2 + 10 / s;
  if (isText(pos)) { const dx = Math.max(0, Math.abs(x - pos.x) - pos.w / 2 - pad); const dy = Math.max(0, Math.abs(y - pos.y) - pos.h / 2 - pad); return Math.hypot(dx, dy); }
  return Math.max(0, Math.hypot(x - pos.x, y - pos.y) - Math.max(pos.w || 8, pos.h || 8) / 2 - pad); };

export async function openPull(id) {
  let P = getPull(id); if (!P) { toast('Протяжка не найдена'); return; }
  const d = drawingsOf().find((x) => x.id === P.drawingId);
  const body = h('div', {}, h('div', { class: 'mut' }, 'Открываю чертёж…'));
  let wk = null; let padClose = null;
  const close = openModal(`🧵 ${pullTitle(P)}`, body, { sticky: true, wide: true, onClose: () => { padClose?.(); wk?.stop(); } });
  if (!d) { body.replaceChildren(h('div', { class: 'empty' }, 'Чертёж этой протяжки убран из проекта.')); return; }
  const set = (patch) => {
    const remote = getPull(P.id); let base = P;
    if (remote && (remote.savedAt || 0) > (P.savedAt || 0)) base = mergeRemote(P, remote); // другой телефон успел сохранить раньше
    P = savePull({ ...base, ...patch });
  };
  const ctx = () => state.ctx;
  const sheetPts = () => [...ctx().points.values()].filter((p) => p.pos && drawingFor(p)?.id === d.id);
  const chosen = () => (P.pointIds || []).map((x) => ctx().points.get(x)).filter(Boolean);
  const meas = (id) => isMeasured(P, id) || finSet().has(id);
  const meters = () => pairsToMap(P.meters); const kept = () => pairsToMap(P.kept);
  // «протянута» в протяжке, но записи о протяжке в отчёте уже нет (удалили) — точка снова не протянута
  const finSet = () => new Set((P.finished || []).filter((id) => {
    const pt = ctx().points.get(id); return !(pt && !infoOf(pt).pulled && Date.now() - (P.finishedAt || 0) > 60000);
  }));
  const lostFin = (id) => (P.finished || []).includes(id) && !finSet().has(id);
  const pulledBefore = (p) => { const i = infoOf(p); return !!(i.pulled) && !finSet().has(p.id); };

  let buf; let o;
  try { buf = await loadDrawing(d); wk = makeWorker(); o = await wk.call('openDoc', { data: buf.slice(0) }); }
  catch (e) { body.replaceChildren(h('div', { class: 'empty' }, `Чертёж не открылся: ${e.message}`)); return; }

  // фильтры выбора
  let fType = ''; let fCab = ''; let fCfg = ''; let onlyOpen = false; let rectSel = false; let focusId = P.curId || null;
  const visible = () => sheetPts().filter((p) => typeMatch(fType, p.typeId) && cfgMatch(fCfg, p) && (!fCab || (p.cabinet || '') === fCab) && (!onlyOpen || !infoOf(p).pulled));
  const selSet = () => new Set(P.pointIds || []);
  const toggle = (list, on) => { const s = selSet(); list.forEach((p) => (on ? s.add(p.id) : s.delete(p.id))); set({ pointIds: [...s] }); };

  const viewer = createViewer({ wk, pages: o.pages, height: '60vh', dim: () => (P.screen === 'measure' ? 0.35 : 1), rectMode: () => P.screen === 'select' && rectSel,
    onRect: (b, page) => { toggle(visible().filter((p) => (p.pos.page || 0) === page && p.pos.x >= b[0] && p.pos.x <= b[2] && p.pos.y >= b[1] && p.pos.y <= b[3]), true); screen(); },
    onTap: (x, y, page) => {
      const pool = P.screen === 'measure' ? chosen() : visible();
      let best = null; let bd = Infinity; for (const p of pool) { if ((p.pos.page || 0) !== page) continue; const dd = hitDist(viewer.view.s, p.pos, x, y); if (dd < bd) { bd = dd; best = p; } }
      if (bd !== 0 || !best) return;
      const group = pool.filter((p) => posKey(p.pos) === posKey(best.pos));
      if (P.screen === 'select') { const on = !selSet().has(best.id); toggle(group, on); if (on && group.some(pulledBefore)) toast(`${best.label}: уже протянута`); screen(); return; }
      if (P.screen === 'measure') numpad(best.id);
    },
    overlay: (g, api) => {
      const s = selSet(); const big = api.view.s > 0.6; const tags = []; const circles = []; const frames = []; const byKey = new Map();
      const list = P.screen === 'measure' ? chosen() : visible();
      for (const p of list) {
        if ((p.pos.page || 0) !== api.page) continue;
        let col; let width = big ? 1.5 : 2;
        if (P.screen === 'measure') { col = meas(p.id) ? '#34c759' : '#ff9500'; width = 3; }
        else col = infoOf(p).pulled ? '#b0b0b0' : statusColor(infoOf(p).status);
        outline(g, api, p.pos, col, { width });
        if (P.screen === 'select' && s.has(p.id)) outline(g, api, p.pos, '#00b7ff', { width: 3, pad: 1.5 + 3 / api.view.s });
        const k = posKey(p.pos); const same = byKey.get(k);
        const lab = P.screen === 'measure' && pullTotal(P, p.id) != null ? `${p.label} · ${pullTotal(P, p.id)} м` : tagOf(p);
        if (same) { same.labels.push(lab); same.need = true; continue; }
        const [x, y] = api.toScr(p.pos.x, p.pos.y);
        if (isText(p.pos)) { const hw = (p.pos.w / 2 + 2) * api.view.s; const hh = (p.pos.h / 2 + 2) * api.view.s; frames.push([x - hw, y - hh, x + hw, y + hh]);
          const t = { p, col, x, y, r: Math.max(hw, hh), labels: [lab], sh: shOf(p), textPos: true, need: P.screen === 'measure' || !!(p.pos.text && p.pos.text !== p.label) }; byKey.set(k, t); if (big || P.screen === 'measure') tags.push(t); }
        else { const r = Math.max(5, (Math.max(p.pos.w || 8, p.pos.h || 8) / 2 + 1.5) * api.view.s); circles.push([x, y, r]);
          const t = { p, col, x, y, r, labels: [lab], sh: shOf(p) }; byKey.set(k, t); if (big || P.screen === 'measure') tags.push(t); }
      }
      placeTags(g, api, tags.filter((t) => !t.textPos || t.need), circles, frames);
      const f = focusId && ctx().points.get(focusId);
      if (f?.pos && (f.pos.page || 0) === api.page && drawingFor(f)?.id === d.id) outline(g, api, f.pos, '#e0007a', { width: 3, pad: 1.5 + 4 / api.view.s });
    } });

  const unsub = subscribe(() => { if (!body.isConnected) { unsub?.(); return; } viewer.draw(); });

  // ---- шаг 1: выбор точек ----
  function selectScreen() {
    const pts = sheetPts();
    const types = [...new Set(pts.map((p) => p.typeId))].sort((a, b) => a.localeCompare(b, 'ru'));
    const cabs = [...new Set(pts.map((p) => p.cabinet || ''))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
    const sel = (first, opts, cur, fn) => h('select', { onchange: (e) => { fn(e.target.value); screen(); } }, h('option', { value: '' }, first), ...opts.map(([v, t]) => h('option', { value: v, selected: v === cur }, t)));
    const cfgOpts = cfgFilterOptions(pts);
    const search = h('input', { type: 'search', placeholder: 'Найти точку и добавить', style: { flex: 1, minWidth: '140px' }, onchange: (e) => {
      const q = e.target.value.trim().toLowerCase(); if (!q) return;
      const p = pts.find((x) => latinKey(x.label) === latinKey(q)) || pts.find((x) => latinKey(x.label).includes(latinKey(q)));
      if (!p) { toast('Такой точки на этом чертеже нет'); return; }
      toggle([p], true); focusId = p.id; e.target.value = ''; toast(`${p.label} добавлена${pulledBefore(p) ? ' (уже протянута)' : ''}`); screen(); viewer.focus(p.pos.x, p.pos.y, p.pos.page || 0);
    } });
    const n = (P.pointIds || []).length;
    return [
      h('div', { class: 'mut', style: { fontSize: '13px' } }, h('b', {}, 'Шаг 1. Выберите точки'), ' — нажатием, рамкой, поиском или «Все видимые» после фильтров. Серые — уже протянуты.'),
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '6px 0' } }, search,
        sel('Все типы', typeFilterOptions(types), fType, (v) => { fType = v; }),
        cfgOpts.length ? sel('Все конфигурации дверей', cfgOpts, fCfg, (v) => { fCfg = v; }) : null,
        cabs.length ? sel('Все шкафы', cabs.map((c) => [c, `Шкаф ${c}`]), fCab, (v) => { fCab = v; }) : null,
        h('label', { class: 'pickrow', style: { margin: 0 } }, h('input', { type: 'checkbox', checked: onlyOpen, onchange: (e) => { onlyOpen = e.target.checked; screen(); } }), h('span', {}, 'Только не протянутые'))),
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', margin: '4px 0' } }, ...viewer.zoomBtns(),
        h('button', { class: rectSel ? '' : 'sec', onclick: () => { rectSel = !rectSel; screen(); } }, rectSel ? '▭ Рамкой (вкл.)' : '▭ Рамкой'),
        h('button', { class: 'sec', onclick: () => { toggle(visible(), true); screen(); } }, `☑ Все видимые (${visible().length})`)),
      viewer.el,
      h('div', { class: 'card', style: { position: 'sticky', bottom: 0, display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', margin: '6px 0', padding: '8px' } },
        h('b', {}, `Выбрано: ${n}`),
        n ? h('button', { class: 'sec', onclick: async () => { if (await confirmDialog('Снять все выбранные точки?', { yes: 'Снять' })) { set({ pointIds: [] }); screen(); } } }, 'Снять все') : null,
        h('button', { style: { marginInlineStart: 'auto' }, disabled: !n, onclick: () => { set({ screen: 'base' }); screen(); } }, 'Далее →')),
    ];
  }

  // ---- шаг 2: «Выбрано N» + «До шкафа» ----
  let showList = false;
  function baseScreen() {
    const pts = chosen().sort(comparePoints); const cabs = [...new Set(pts.map((p) => p.cabinet || '').filter(Boolean))];
    const inp = h('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', value: P.base ?? '', placeholder: '0', style: { fontSize: '22px', width: '120px', textAlign: 'center' } });
    const go = () => {
      const v = inp.value.trim() === '' ? 0 : Math.round(Number(inp.value.replace(',', '.')));
      if (!Number.isFinite(v) || v < 0) { toast('Введите целое число метров'); return; }
      const changed = v !== (P.base ?? null);
      set({ base: v, screen: 'measure' });
      if (changed) rewriteLengths();
      screen();
      const next = nearestPoint(null, chosen().filter((p) => !meas(p.id)));
      if (next) setTimeout(() => viewer.focus(next.pos.x, next.pos.y, next.pos.page || 0, Math.max(viewer.view.s, 1)), 50);
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return [
      h('div', { class: 'mut', style: { fontSize: '13px' } }, h('b', {}, 'Шаг 2. До шкафа')),
      h('button', { class: 'sec wide', style: { margin: '6px 0' }, onclick: () => { showList = !showList; screen(); } }, `Выбрано: ${pts.length} ${showList ? '▴' : '▾'}`),
      showList ? h('div', { class: 'card', style: { padding: 0 } }, ...pts.map((p) => h('div', { class: 'item' }, h('div', { class: 'name' }, p.label, pulledBefore(p) ? h('div', { class: 'sub' }, 'уже протянута') : null),
        h('button', { class: 'sec', style: { padding: '4px 10px' }, onclick: () => { toggle([p], false); screen(); } }, '✕')))) : null,
      cabs.length > 1 ? h('div', { class: 'card', style: { background: '#fff4e0', margin: '6px 0' } }, `⚠ Выбраны точки из разных шкафов (${cabs.join(', ')}). «До шкафа» одно на всю протяжку — у части точек длина выйдет неверной. Лучше делать отдельные протяжки по шкафам.`) : null,
      h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => { set({ screen: 'select' }); screen(); } }, '➕ Добавить точки')),
      h('div', { class: 'card', style: { marginTop: '10px' } },
        h('div', {}, h('b', {}, 'До шкафа, м')),
        h('div', { class: 'mut', style: { fontSize: '13px', margin: '4px 0 8px' } }, 'Сколько метров кабеля от шкафа до места, где трасса расходится к точкам (общий для всех участок). Эти метры прибавляются к метражу каждой точки.'),
        inp),
      h('div', { class: 'btns' }, h('button', { class: 'wide', onclick: go }, 'Далее →')),
    ];
  }
  // «До шкафа» поменяли — метражи в карточках пересчитать
  function rewriteLengths() {
    const ops = chosen().filter((p) => meters()[p.id] != null && !finSet().has(p.id)).map((p) => ({ coll: 'points', id: p.id, data: { length: pullTotal(P, p.id) } }));
    if (ops.length) { getRepo().save(currentProject().id, ops); toast(`Метраж пересчитан у точек: ${ops.length}`); }
  }

  // ---- шаг 3: метраж по точкам ----
  function measureScreen() {
    const all = chosen(); const done = all.filter((p) => meas(p.id)).length;
    const next = () => { const left = all.filter((p) => !meas(p.id)); const cur = ctx().points.get(P.curId); return nearestPoint(cur, left); };
    return [
      h('div', { class: 'mut', style: { fontSize: '13px' } }, h('b', {}, 'Шаг 3. Метраж'), ' — нажмите выделенную точку. Зелёные — с метражом, оранжевые — без.'),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' } },
        h('b', {}, `Метраж: ${done} из ${all.length}`),
        h('button', { class: 'sec', onclick: () => { set({ screen: 'base' }); screen(); } }, `До шкафа: ${P.base ?? 0} м ✎`)),
      h('div', { class: 'mut', style: { fontSize: '12px', margin: '-2px 0 6px' } }, '«До шкафа» — сколько метров кабеля от шкафа до места, где трасса расходится к точкам (общий для всех участок). Эти метры прибавляются к метражу каждой точки.'),
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', margin: '4px 0' } }, ...viewer.zoomBtns(),
        done < all.length ? h('button', { class: 'sec', onclick: () => { const p = next(); if (p) numpad(p.id); } }, '▶ Следующая') : null,
        h('button', { onclick: () => { set({ screen: 'check' }); screen(); } }, '📋 Чеклист →')),
      viewer.el,
    ];
  }

  // окно ввода метража: название, кусок чертежа вокруг точки, своя цифровая панель (системная клавиатура не выезжает)
  function numpad(pointId, skip = new Set()) {
    padClose?.(); const p = ctx().points.get(pointId); if (!p) return;
    if (finSet().has(p.id)) { toast(`${p.label}: уже протянута, метраж не меняется`); return; }
    focusId = p.id; set({ curId: p.id, pad: true }); viewer.draw();
    const own = meters()[p.id]; const kv = kept()[p.id];
    let val = own != null ? String(own) : '';
    const card = p.length !== undefined && p.length !== null && p.length !== '' ? Number(p.length) : null;
    const disp = h('div', { style: { fontSize: '30px', fontWeight: 700, textAlign: 'center', padding: '4px', border: '2px solid #00b7ff', borderRadius: '10px', minHeight: '44px' } });
    const sumL = h('div', { class: 'mut', style: { textAlign: 'center', fontSize: '13px' } });
    const paint = () => { disp.textContent = val || ' '; sumL.textContent = val !== '' ? `до шкафа ${P.base ?? 0} + ${val} = ${(P.base ?? 0) + Number(val)} м в карточку` : `до шкафа ${P.base ?? 0} м + метраж точки`; };
    const key = (k) => { if (k === '⌫') val = val.slice(0, -1); else if (val.length < 4) val = (val === '0' ? '' : val) + k; paint(); };
    const cv = h('canvas', { style: { width: '100%', height: '23vh', display: 'block', borderRadius: '8px', background: '#fff', border: '1px solid #ddd', cursor: 'pointer' }, onclick: () => { padClose?.(); set({ pad: false }); viewer.focus(p.pos.x, p.pos.y, p.pos.page || 0, Math.max(viewer.view.s, 1.5)); } });
    const btn = (t, fn, style = {}) => h('button', { type: 'button', class: 'sec', style: { fontSize: '24px', padding: '10px 0', ...style }, onclick: fn }, t);
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', margin: '6px 0' } },
      ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => btn(k, () => key(k))), btn('⌫', () => key('⌫')), btn('0', () => key('0')),
      h('button', { type: 'button', style: { fontSize: '20px', padding: '10px 0' }, onclick: () => enter() }, '✓ Ввод'));
    const goNext = (from, sk = skip) => {
      const left = chosen().filter((x) => !meas(x.id) && !sk.has(x.id) && x.id !== from.id);
      const nx = nearestPoint(from, left);
      if (nx) { numpad(nx.id, sk); return; }
      padClose?.(); padClose = null;
      if (chosen().every((x) => meas(x.id))) { set({ screen: 'check', pad: false }); toast('Метраж у всех точек ✅'); screen(); }
      else { set({ pad: false }); toast('Остались пропущенные — нажмите их на плане'); }
    };
    function enter() {
      if (val === '') { toast('Введите метраж'); return; }
      const v = Math.round(Number(val)); const m = meters(); const k = kept(); m[p.id] = v; delete k[p.id];
      set({ meters: mapToPairs(m), kept: mapToPairs(k) });
      getRepo().save(currentProject().id, [{ coll: 'points', id: p.id, data: { length: pullTotal(P, p.id) } }]);
      goNext(p);
    }
    function keep() {
      const m = meters(); const k = kept(); delete m[p.id]; k[p.id] = card;
      set({ meters: mapToPairs(m), kept: mapToPairs(k) }); goNext(p);
    }
    const onKey = (e) => { if (/^[0-9]$/.test(e.key)) key(e.key); else if (e.key === 'Backspace') key('⌫'); else if (e.key === 'Enter') enter(); };
    document.addEventListener('keydown', onKey);
    const content = h('div', {},
      p.planName ? h('div', { class: 'mut', style: { fontSize: '13px', marginTop: '-4px' } }, p.planName) : null,
      cv, disp, sumL,
      (card != null && own == null) || kv != null ? h('button', { type: 'button', class: kv != null ? '' : 'sec', style: { width: '100%', marginTop: '6px' }, onclick: keep }, `✓ Оставить из карточки: ${card} м`) : null,
      grid,
      h('div', { style: { display: 'flex', gap: '6px' } },
        h('button', { type: 'button', class: 'sec', style: { flex: 1 }, onclick: () => { const sk = new Set([...skip, p.id]); goNext(p, sk); } }, '⏭ Другая'),
        h('button', { type: 'button', class: 'sec', style: { flex: 1 }, onclick: () => { padClose?.(); set({ pad: false }); } }, '🗺 На план')));
    paint();
    const c = openModal(`📏 ${p.label}${pulledBefore(p) ? ' (уже протянута)' : ''}`, content, { onClose: () => { document.removeEventListener('keydown', onKey); if (padClose === c) padClose = null; } });
    padClose = c;
    // кусок чертежа вокруг точки
    requestAnimationFrame(async () => {
      try {
        const r = cv.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
        const pg = o.pages[p.pos.page || 0]; const hw = 90; const hh = hw * r.height / r.width;
        const clip = [Math.max(0, p.pos.x - hw), Math.max(0, p.pos.y - hh), Math.min(pg.w, p.pos.x + hw), Math.min(pg.h, p.pos.y + hh)];
        const zoom = Math.min(8, cv.width / (clip[2] - clip[0]));
        const res = await wk.call('crop', { page: p.pos.page || 0, clip, zoom, raw: true });
        const img = await createImageBitmap(new ImageData(res.data, res.w, res.h));
        const g = cv.getContext('2d'); const sc = cv.width / (clip[2] - clip[0]);
        g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, (clip[2] - clip[0]) * sc, (clip[3] - clip[1]) * sc);
        const api = { view: { s: sc }, toScr: (x, y) => [(x - clip[0]) * sc, (y - clip[1]) * sc] };
        chosen().filter((x) => (x.pos.page || 0) === (p.pos.page || 0) && x.id !== p.id).forEach((x) => outline(g, api, x.pos, meas(x.id) ? '#34c759' : '#ff9500', { width: 2 * dpr }));
        outline(g, api, p.pos, '#e0007a', { width: 4 * dpr, pad: 3 });
      } catch { /* без картинки */ }
    });
  }

  // ---- шаг 4: чеклист «Протяжка» ----
  function checkScreen() {
    const pts = chosen().sort(comparePoints); const chk = new Set(P.checked || []); const fin = finSet();
    const toDo = pts.filter((p) => chk.has(p.id) && !fin.has(p.id));
    const row = (p) => {
      const t = pullTotal(P, p.id); const f = fin.has(p.id);
      const cb = h('input', { type: 'checkbox', checked: f || chk.has(p.id), disabled: f, style: { width: '26px', height: '26px', flex: 'none' }, onchange: async (e) => {
        const on = e.target.checked;
        if (on && t === 0 && !(await confirmDialog(`${p.label}: «до шкафа» 0 и метраж точки 0 — длина будет 0 м. Всё равно отметить?`, { yes: 'Отметить' }))) { screen(); return; }
        const s = new Set(P.checked || []); if (on) s.add(p.id); else s.delete(p.id); set({ checked: [...s] }); screen(); } });
      return h('label', { class: 'item', style: { display: 'flex', alignItems: 'center', gap: '10px', background: f ? '#e8f8ec' : '' } },
        h('div', { class: 'name', style: { flex: 1 } }, p.label,
          h('div', { class: 'sub' }, f ? `✅ протянута${P.finishedAt ? ` ${new Date(P.finishedAt).toLocaleDateString('ru-RU')}` : ''}` : lostFin(p.id) ? '⚠ запись о протяжке удалена — отметьте и завершите снова' : pulledBefore(p) ? '⚠ уже протянута раньше' : (t == null ? 'без метража' : kept()[p.id] != null ? 'метраж из карточки' : `${P.base ?? 0} + ${meters()[p.id]}`))),
        h('b', { style: { whiteSpace: 'nowrap' } }, t == null ? '— м' : `${t} м`), cb);
    };
    return [
      h('div', { class: 'mut', style: { fontSize: '13px' } }, h('b', {}, 'Протяжка'), ' — отмечайте протянутые. Всё сохраняется сразу.'),
      h('div', { class: 'btns', style: { marginTop: '6px' } },
        h('button', { class: 'sec', onclick: () => { set({ screen: 'measure' }); screen(); } }, '🗺 Метраж на плане'),
        h('button', { class: 'sec', onclick: () => { set({ screen: 'select' }); screen(); } }, '➕ Точки')),
      h('div', { class: 'card', style: { padding: 0 } }, ...pts.map(row)),
      h('div', { class: 'card', style: { position: 'sticky', bottom: 0, padding: '8px', margin: '6px 0' } },
        h('button', { class: 'wide', disabled: !toDo.length, onclick: () => finish(toDo) }, `✅ Завершить протяжку (${toDo.length})`),
        fin.size ? h('div', { class: 'mut', style: { fontSize: '13px', marginTop: '4px' } }, `Уже протянуто в этой протяжке: ${fin.size} из ${pts.length}`) : null),
    ];
  }
  async function finish(list) {
    const nom = list.filter((p) => pullTotal(P, p.id) == null);
    if (nom.length && !(await confirmDialog(`У точек без метража: ${nom.length} (${nom.slice(0, 5).map((p) => p.label).join(', ')}${nom.length > 5 ? '…' : ''}). Протяжка запишется без длины. Завершить всё равно?`, { yes: 'Завершить' }))) return;
    const c = state.ctx; const works = [...c.catalog.values()].filter((w) => w.active !== false && w.workType === 'Протяжка');
    const w = works.find((x) => list.every((p) => workFits(p, c, x))) || works.find((x) => workFits(list[0], c, x)) || works[0];
    if (!w) { toast('В каталоге нет работы типа «Протяжка»'); return; }
    addWorkForPoints(list.map((p) => p.id), { workType: 'Протяжка', workId: w.id, lockPull: true, onSaved: (ids) => {
      const fin = new Set([...(P.finished || []), ...ids]);
      const fx = pairsToMap(P.fixed); ids.forEach((id) => { const t = pullTotal(P, id); if (t != null) fx[id] = t; });
      set({ finished: [...fin], fixed: mapToPairs(fx), finishedAt: Date.now() });
      toast(pullStatus(P, (id) => ctx().points.has(id)) === 'Завершена' ? 'Протяжка завершена ✅' : 'Протяжка завершена частично'); screen();
    } });
  }

  function screen() {
    if (!body.isConnected) return;
    const s = P.screen || 'select';
    const parts = s === 'select' ? selectScreen() : s === 'base' ? baseScreen() : s === 'measure' ? measureScreen() : checkScreen();
    body.replaceChildren(...parts.filter(Boolean));
    if (s === 'select' || s === 'measure') { if (!started) startViewer(); else viewer.draw(); }
  }
  // чертёж запускается, когда он впервые на экране (до этого у него нет размера)
  let started = null;
  function startViewer() {
    started = (async () => {
      await viewer.start();
      const f = (P.curId && ctx().points.get(P.curId)) || chosen()[0];
      if (f?.pos && drawingFor(f)?.id === d.id) await viewer.focus(f.pos.x, f.pos.y, f.pos.page || 0, 1.5);
    })().catch(() => {});
  }
  screen();
  if (P.screen === 'measure' && P.pad && P.curId) { await started; numpad(P.curId); }
  void close;
}
