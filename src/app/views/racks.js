// «🗄 Шкафы и шильют»: план шкафа — какие точки cat7 в каких панелях (U) и портах (1–24).
// Мастер раскладывает точки по типам в панели на указанных U; дальше — ручная правка: поставить с любого порта, переставить, убрать.
import { h, openModal, toast, confirmDialog, formModal } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { comparePoints } from '../../domain/index.js';
import {
  PANEL_PORTS, rackPortsOf, panelOf, fmtPanelPort, defaultPortLabels, rackOf, uOrder, panelsInOrder, rackPointsOf,
  cabinetFloor, autoFill, rackProblems,
} from '../../domain/rack.js';
import { pointCard } from './points.js';

let openCab = null;   // открытый шкаф
let moving = null;    // перенос порта: { id, i }
let editMode = false; // режим перестановки: нажал точку → нажал порт, без окон

const sortRu = (a, b) => a.localeCompare(b, 'ru', { numeric: true });
const HUES = [205, 140, 45, 0, 275, 175, 25, 320, 95, 240];
const hueOf = (typeId) => { let x = 0; for (const ch of String(typeId)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return HUES[x % HUES.length]; };
const allPoints = () => [...state.ctx.points.values()];
const cabPoints = (cab) => rackPointsOf(allPoints(), state.ctx, cab);
const slotLabel = (pt, i) => panelOf(pt)[i]?.label || defaultPortLabels(pt.label, rackPortsOf(pt, state.ctx))[i] || pt.label;
const shortLabel = (txt, cab) => (cab && (txt.startsWith(`${cab}-`) || txt.startsWith(`${cab}/`)) ? txt.slice(cab.length + 1) : txt);
// «U|порт» → { pt, i } для точек шкафа
function slotsOf(cab) {
  const m = new Map();
  cabPoints(cab).forEach((pt) => panelOf(pt).forEach((x, i) => m.set(`${x.u}|${x.p}`, { pt, i })));
  return m;
}
function saveRack(cab, rack) {
  const p = currentProject();
  getRepo().saveProject(p.id, { racks: { ...(p.racks || {}), [cab]: rack } });
}
function savePanels(list) {  // [[pointId, panel[]]]
  if (!list.length) return;
  getRepo().save(currentProject().id, list.map(([id, panel]) => ({ coll: 'points', id, data: { panel } })));
}

// ---------- список шкафов ----------
export function racksView(ui) {
  if (openCab !== null) return rackEditor(ui, openCab);
  const p = currentProject();
  const byCab = new Map();
  allPoints().forEach((pt) => { const n = rackPortsOf(pt, state.ctx); if (!n) return; const c = pt.cabinet || ''; if (!byCab.has(c)) byCab.set(c, { pts: 0, ports: 0, placed: 0 }); const x = byCab.get(c); x.pts++; x.ports += n; if (panelOf(pt).length) x.placed++; });
  const cabs = [...byCab.keys()].filter(Boolean).sort(sortRu);
  const noCab = byCab.get('');
  return h('div', {},
    h('div', { class: 'mut', style: { margin: '0 2px 10px' } }, 'План шкафа: в каких панелях (U) и портах стоят точки с кабелями cat7. Порт попадает в поле точки «Порт в панели». Таблица для шильюта — следующим шагом.'),
    noCab ? h('div', { class: 'card l-warn' }, `Точек cat7 без шкафа: ${noCab.pts} — их нельзя поставить в панель, пока не указан шкаф.`) : null,
    h('div', { class: 'card', style: { padding: 0 } }, cabs.length ? cabs.map((c) => {
      const x = byCab.get(c); const r = rackOf(p, c);
      return h('div', { class: 'item', onclick: () => { openCab = c; moving = null; ui.render(); } },
        h('div', { class: 'name' }, `🗄 Шкаф ${c}`, h('div', { class: 'sub' }, `точек cat7: ${x.pts} (портов ${x.ports}) · расставлено ${x.placed} из ${x.pts}${r ? ` · ${r.height}U, панелей ${r.panels?.length || 0}` : ' · плана ещё нет'}`)),
        h('span', { style: { fontSize: '20px' } }, x.placed === x.pts && x.pts ? '✅' : '›'));
    }) : h('div', { class: 'empty' }, 'Нет точек с кабелями cat7 и шкафом')));
}

// ---------- размер и нумерация шкафа ----------
function rackForm(cab, done) {
  const r = rackOf(currentProject(), cab) || { height: 42, bottomUp: true, panels: [] };
  formModal({
    title: `Шкаф ${cab}: размер и нумерация`, submitLabel: 'Сохранить',
    values: { height: r.height, numbering: r.bottomUp === false ? 'top' : 'bottom' },
    fields: [
      { key: 'height', label: 'Высота шкафа, U', type: 'number', required: true },
      { key: 'numbering', label: 'Нумерация U', type: 'select', options: [{ value: 'bottom', label: 'U1 внизу (сверху: U42, U41, …)' }, { value: 'top', label: 'U1 вверху (сверху: U01, U02, …)' }] },
    ],
    onSubmit: (v) => {
      const height = Math.round(Number(v.height));
      if (!(height >= 1 && height <= 60)) { toast('Высота — от 1 до 60 U'); return false; }
      const out = (r.panels || []).filter((x) => x.u > height);
      if (out.length) { toast(`Панели выше ${height}U: ${out.map((x) => `U${x.u}`).join(', ')} — сначала перенесите их`); return false; }
      saveRack(cab, { ...r, height, bottomUp: v.numbering !== 'top' }); done?.();
    },
  });
}

// ---------- мастер: панели по типам ----------
function wizard(cab, ui) {
  const r = rackOf(currentProject(), cab);
  if (!r) { rackForm(cab, () => setTimeout(() => wizard(cab, ui), 300)); return; }
  const pts = cabPoints(cab);
  const types = [...new Set(pts.map((p) => p.typeId))].sort(sortRu).map((t) => {
    const list = pts.filter((p) => p.typeId === t).sort(comparePoints);
    const ports = list.reduce((n, p) => n + rackPortsOf(p, state.ctx), 0);
    const placed = list.filter((p) => panelOf(p).length).length;
    const holding = [...new Set(list.flatMap((p) => panelOf(p).map((x) => x.u)))];  // где они сейчас
    return { t, list, ports, placed, on: placed === 0, us: holding.length ? holding : Array(Math.ceil(ports / PANEL_PORTS)).fill('') };
  });
  const box = h('div', {});
  const draw = () => box.replaceChildren(...types.map((x) => {
    const cb = h('input', { type: 'checkbox', checked: x.on, onchange: () => { x.on = cb.checked; draw(); } });
    const need = Math.ceil(x.ports / PANEL_PORTS);
    return h('div', { class: 'card', style: { margin: '8px 0', opacity: x.on ? 1 : 0.6 } },
      h('label', { class: 'pickrow', style: { margin: 0 } }, cb, h('span', {}, h('b', {}, x.t), ` — точек ${x.list.length}, портов ${x.ports} → нужно панелей: ${need}${x.placed ? ` · уже расставлено ${x.placed} (будут разложены заново)` : ''}`)),
      x.on ? h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '6px' } },
        ...x.us.map((u, i) => h('label', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, h('small', { class: 'mut' }, `${i + 1}-я на U`),
          h('input', { type: 'text', inputMode: 'numeric', value: u, style: { width: '64px' }, oninput: (e) => { x.us[i] = e.target.value; } }))),
        h('button', { class: 'sec', style: { padding: '4px 12px' }, onclick: () => { x.us.push(''); draw(); } }, '＋'),
        x.us.length > 1 ? h('button', { class: 'sec', style: { padding: '4px 12px' }, onclick: () => { x.us.pop(); draw(); } }, '－') : null) : null);
  }));
  draw();
  const go = h('button', { onclick: async () => {
    const chosen = types.filter((x) => x.on);
    if (!chosen.length) { toast('Отметьте хотя бы один тип'); return; }
    for (const x of chosen) {
      const us = x.us.map((u) => Number(String(u).trim()));
      if (us.some((u) => !Number.isInteger(u) || u < 1 || u > r.height)) { toast(`${x.t}: укажите U каждой панели (1–${r.height})`); return; }
      if (new Set(us).size !== us.length) { toast(`${x.t}: две панели на одном U`); return; }
    }
    const replaced = chosen.reduce((n, x) => n + x.placed, 0);
    if (replaced && !(await confirmDialog(`Уже расставленные точки этих типов (${replaced}) будут разложены заново по порядку номеров. Продолжить?`, { yes: 'Разложить' }))) return;
    const again = new Set(chosen.flatMap((x) => x.list.map((p) => p.id)));
    const occupied = new Set(); cabPoints(cab).filter((p) => !again.has(p.id)).forEach((p) => panelOf(p).forEach((s) => occupied.add(`${s.u}|${s.p}`)));
    const panels = [...(r.panels || [])]; const writes = []; const left = [];
    for (const x of chosen) {
      const tp = x.us.map((u) => ({ u: Number(u) }));
      tp.forEach((pnl) => { if (!panels.some((q) => q.u === pnl.u)) panels.push({ u: pnl.u }); });
      const res = autoFill(x.list, state.ctx, tp, occupied);
      x.list.forEach((p) => writes.push([p.id, res.assign.get(p.id) || []]));
      res.assign.forEach((list) => list.forEach((s) => occupied.add(`${s.u}|${s.p}`)));
      left.push(...res.left);
    }
    saveRack(cab, { ...r, panels }); savePanels(writes); close();
    toast(left.length ? `Разложено. Не поместились (нет мест в панелях): ${left.map((p) => p.label).slice(0, 8).join(', ')}${left.length > 8 ? '…' : ''}` : 'Точки разложены по панелям');
    ui.render();
  } }, '✅ Разложить');
  const close = openModal(`🧙 Мастер: шкаф ${cab}`, h('div', {},
    h('div', { class: 'mut' }, `Шкаф ${r.height}U, ${r.bottomUp === false ? 'U1 вверху' : 'U1 внизу'}. Для каждого типа укажите, на каких U стоят его панели (по порядку: первая, вторая…). Точки ляжут по возрастанию номера с 1-го порта; занятые другими точками порты пропускаются. Одну и ту же панель можно указать у двух типов — второй тип займёт свободные порты.`),
    box, h('div', { class: 'btns' }, go)), { sticky: true });
}

// ---------- поставить точки в панель ----------
function placeModal(cab, ui, { u = null, p = 1 } = {}) {
  const r = rackOf(currentProject(), cab); const panels = panelsInOrder(r);
  if (!panels.length) { toast('Сначала добавьте панель'); return; }
  const free = cabPoints(cab).filter((pt) => !panelOf(pt).length).sort(comparePoints);
  if (!free.length) { toast('Все точки шкафа уже расставлены'); return; }
  const types = [...new Set(free.map((x) => x.typeId))].sort(sortRu);
  let fType = types.length === 1 ? types[0] : ''; const on = new Set();
  const panelSel = h('select', {}, panels.map((x) => h('option', { value: x.u, selected: x.u === u }, `Панель U${x.u}`)));
  const portIn = h('input', { type: 'text', inputMode: 'numeric', value: String(p), style: { width: '64px' } });
  const list = h('div', { class: 'picklist' }); const go = h('button', {});
  const label = () => { go.textContent = `Поставить (${on.size})`; go.disabled = !on.size; };
  const draw = () => {
    const shown = free.filter((x) => !fType || x.typeId === fType);
    list.replaceChildren(...shown.map((x) => {
      const cb = h('input', { type: 'checkbox', checked: on.has(x.id), onchange: () => { cb.checked ? on.add(x.id) : on.delete(x.id); label(); } });
      const n = rackPortsOf(x, state.ctx);
      return h('label', { class: 'pickrow' }, cb, h('span', {}, x.label, h('small', { class: 'mut' }, ` · ${x.typeId}${n > 1 ? ` · портов ${n}` : ''}`)));
    }));
    label();
  };
  const typeSel = h('select', { onchange: (e) => { fType = e.target.value; draw(); } }, h('option', { value: '' }, 'Все типы'), ...types.map((t) => h('option', { value: t, selected: t === fType }, t)));
  go.onclick = () => {
    const start = Number(portIn.value); if (!(start >= 1 && start <= PANEL_PORTS)) { toast('Порт — от 1 до 24'); return; }
    const pu = Number(panelSel.value); const chosen = free.filter((x) => on.has(x.id));
    const occupied = new Set(slotsOf(cab).keys());
    const res = autoFill(chosen, state.ctx, [{ u: pu }], occupied, { start });
    savePanels([...res.assign.entries()]); c();
    toast(res.left.length ? `Поставлено ${res.assign.size}. Не поместились до конца панели: ${res.left.map((x) => x.label).join(', ')}` : `Поставлено: ${res.assign.size}`);
    ui.render();
  };
  draw();
  const c = openModal('➕ Поставить точки в панель', h('div', {},
    h('div', { class: 'mut' }, 'Отмеченные точки встанут подряд по возрастанию номера, начиная с порта; занятые порты пропускаются.'),
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' } }, panelSel, h('span', {}, 'с порта'), portIn, typeSel),
    h('div', { class: 'btns', style: { marginTop: 0 } },
      h('button', { class: 'sec', onclick: () => { free.filter((x) => !fType || x.typeId === fType).forEach((x) => on.add(x.id)); draw(); } }, 'Отметить все'),
      h('button', { class: 'sec', onclick: () => { on.clear(); draw(); } }, 'Снять')),
    list, h('div', { class: 'btns' }, go)), { sticky: true });
}

// ---------- редактор шкафа ----------
function rackEditor(ui, cab) {
  const p = currentProject(); const r = rackOf(p, cab);
  const pts = cabPoints(cab);
  const back = h('button', { class: 'sec', onclick: () => { openCab = null; moving = null; editMode = false; ui.render(); } }, '← Все шкафы');
  if (!r) {
    return h('div', {}, back,
      h('div', { class: 'card', style: { marginTop: '10px' } }, h('b', {}, `Шкаф ${cab}`), h('div', { class: 'mut', style: { margin: '6px 0' } }, `Точек cat7: ${pts.length}. Плана шкафа ещё нет: укажите размер и нумерацию U, затем мастер разложит точки по панелям.`),
        h('div', { class: 'btns' }, h('button', { onclick: () => wizard(cab, ui) }, '🧙 Создать план шкафа'))));
  }
  const slots = slotsOf(cab);
  const problems = rackProblems(r, pts, state.ctx);
  const free = pts.filter((pt) => !panelOf(pt).length);
  const floor = cabinetFloor(pts);
  const cellTap = (u, port) => {
    const at = slots.get(`${u}|${port}`);
    if (editMode && !moving) { if (at) { moving = { id: at.pt.id, i: at.i }; ui.render(); } else toast('Сначала нажмите на точку, которую переносите'); return; }
    if (moving) {
      const src = state.ctx.points.get(moving.id); const sp = panelOf(src);
      if (!src || !sp[moving.i]) { moving = null; ui.render(); return; }
      const from = sp[moving.i];
      if (at && at.pt.id === src.id && at.i === moving.i) { moving = null; ui.render(); return; }
      const writes = new Map();
      const get = (pt) => writes.get(pt.id) || panelOf(pt).map((x) => ({ ...x }));
      const a = get(src); a[moving.i] = { ...a[moving.i], u, p: port }; writes.set(src.id, a);
      if (at) { const b = at.pt.id === src.id ? a : get(at.pt); b[at.i] = { ...b[at.i], u: from.u, p: from.p }; writes.set(at.pt.id, b); }
      savePanels([...writes.entries()]); moving = null; if (!editMode) toast(at ? 'Переставлено местами' : 'Перенесено'); ui.render(); return;
    }
    if (!at) { placeModal(cab, ui, { u, p: port }); return; }
    const { pt, i } = at; const n = rackPortsOf(pt, state.ctx);
    const c = openModal(`${fmtPanelPort({ u, p: port })} · ${slotLabel(pt, i)}`, h('div', {},
      h('div', { class: 'mut' }, `Точка ${pt.label} · ${pt.typeId}${n > 1 ? ` · порт ${i + 1} из ${n}: ${panelOf(pt).map((x) => fmtPanelPort(x)).join(', ')}` : ''}`),
      h('div', { class: 'btns' },
        h('button', { onclick: () => { moving = { id: pt.id, i }; c(); ui.render(); } }, '↔ Переставить'),
        h('button', { class: 'sec', onclick: () => { c(); pointCard(pt); } }, '📋 Карточка точки'),
        h('button', { class: 'danger', onclick: () => { savePanels([[pt.id, []]]); c(); toast(`${pt.label} убрана из панели`); ui.render(); } }, n > 1 ? '✖ Убрать точку (все её порты)' : '✖ Убрать из панели'))));
  };
  const panelCard = (pnl) => {
    const used = Array.from({ length: PANEL_PORTS }, (_, k) => slots.get(`${pnl.u}|${k + 1}`));
    const n = used.filter(Boolean).length;
    const types = [...new Set(used.filter(Boolean).map((x) => x.pt.typeId))];
    const cells = used.map((at, k) => {
      const mv = moving && at && at.pt.id === moving.id && at.i === moving.i;
      const hue = at ? hueOf(at.pt.typeId) : 0;
      return h('div', { title: at ? `${slotLabel(at.pt, at.i)} (${at.pt.typeId})` : 'свободно', onclick: () => cellTap(pnl.u, k + 1),
        style: { cursor: 'pointer', border: `1px solid ${mv ? '#e0007a' : 'var(--line)'}`, borderWidth: mv ? '2px' : '1px', borderRadius: '6px', padding: '2px 4px', minHeight: '38px',
          background: at ? `hsla(${hue},70%,50%,.18)` : 'transparent', display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        h('small', { class: 'mut', style: { fontSize: '10px', lineHeight: '12px' } }, String(k + 1)),
        h('span', { style: { fontSize: '12px', lineHeight: '14px', wordBreak: 'break-all', fontWeight: at ? 600 : 400 } }, at ? shortLabel(slotLabel(at.pt, at.i), cab) : ''));
    });
    return h('div', { class: 'card', style: { margin: '8px 0' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
        h('b', {}, `U${pnl.u}`, h('span', { class: 'mut', style: { fontWeight: 400 } }, ` · занято ${n}/${PANEL_PORTS}${types.length ? ` · ${types.join(', ')}` : ''}`)),
        h('div', { style: { display: 'flex', gap: '6px' } },
          h('button', { class: 'sec', style: { padding: '4px 10px' }, title: 'Переставить по порядку номеров с 1-го порта', onclick: async () => {
            const here = [...new Map(used.filter(Boolean).map((x) => [x.pt.id, x.pt])).values()].sort(comparePoints);
            if (!here.length) return;
            if (!(await confirmDialog(`Панель U${pnl.u}: поставить её точки (${here.length}) подряд по порядку номеров с 1-го порта? Пропуски (запас) исчезнут.`, { yes: 'Упорядочить' }))) return;
            const ids = new Set(here.map((x) => x.id)); const occ = new Set(); slots.forEach((v, k) => { if (!ids.has(v.pt.id)) occ.add(k); });
            const res = autoFill(here, state.ctx, [{ u: pnl.u }], occ);
            savePanels(here.map((x) => [x.id, res.assign.get(x.id) || []])); ui.render();
          } }, '🔢'),
          h('button', { class: 'sec', style: { padding: '4px 10px' }, title: 'Сменить U панели', onclick: () => formModal({ title: `Панель U${pnl.u}: новый U`, values: { u: pnl.u }, fields: [{ key: 'u', label: 'U', type: 'number', required: true }],
            onSubmit: (v) => {
              const nu = Math.round(Number(v.u)); if (!(nu >= 1 && nu <= r.height)) { toast(`U от 1 до ${r.height}`); return false; }
              if (nu !== pnl.u && (r.panels || []).some((x) => x.u === nu)) { toast(`На U${nu} уже есть панель`); return false; }
              saveRack(cab, { ...r, panels: (r.panels || []).map((x) => (x.u === pnl.u ? { ...x, u: nu } : x)) });
              savePanels(pts.filter((pt) => panelOf(pt).some((x) => x.u === pnl.u)).map((pt) => [pt.id, panelOf(pt).map((x) => (x.u === pnl.u ? { ...x, u: nu } : x))]));
              setTimeout(() => ui.render(), 200);
            } }) }, '✏️'),
          h('button', { class: 'sec', style: { padding: '4px 10px' }, title: 'Удалить панель', onclick: async () => {
            const on = pts.filter((pt) => panelOf(pt).some((x) => x.u === pnl.u));
            if (!(await confirmDialog(`Удалить панель U${pnl.u}?${on.length ? ` Точки на ней (${on.length}) станут нерасставленными.` : ''}`, { yes: 'Удалить', danger: true }))) return;
            saveRack(cab, { ...r, panels: (r.panels || []).filter((x) => x.u !== pnl.u) }); savePanels(on.map((pt) => [pt.id, []])); setTimeout(() => ui.render(), 200);
          } }, '🗑'))),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(62px, 1fr))', gap: '4px', marginTop: '8px' } }, ...cells));
  };
  const byType = new Map(); free.forEach((pt) => byType.set(pt.typeId, (byType.get(pt.typeId) || 0) + 1));
  return h('div', {}, back,
    h('div', { class: 'card', style: { marginTop: '10px' } },
      h('b', {}, `${p.name} · ${floor ? `этаж ${floor} · ` : ''}шкаф ${cab}`),
      h('div', { class: 'mut', style: { margin: '4px 0' } }, `${r.height}U · ${r.bottomUp === false ? 'U1 вверху' : 'U1 внизу'} · панелей ${r.panels?.length || 0} · точек cat7 ${pts.length}, расставлено ${pts.length - free.length}`),
      h('div', { class: 'btns' },
        h('button', { class: editMode ? '' : 'sec', onclick: () => { editMode = !editMode; moving = null; ui.render(); } }, editMode ? '✅ Готово' : '✏️ Редактировать'),
        h('button', { class: 'sec', onclick: () => wizard(cab, ui) }, '🧙 Мастер'),
        h('button', { class: 'sec', onclick: () => formModal({ title: 'Новая панель', fields: [{ key: 'u', label: `На каком U (1–${r.height})`, type: 'number', required: true }],
          onSubmit: (v) => { const u = Math.round(Number(v.u)); if (!(u >= 1 && u <= r.height)) { toast(`U от 1 до ${r.height}`); return false; } if ((r.panels || []).some((x) => x.u === u)) { toast(`На U${u} уже есть панель`); return false; } saveRack(cab, { ...r, panels: [...(r.panels || []), { u }] }); setTimeout(() => ui.render(), 200); } }) }, '➕ Панель'),
        h('button', { class: 'sec', onclick: () => rackForm(cab, () => setTimeout(() => ui.render(), 200)) }, '⚙️ Размер и нумерация'))),
    editMode ? h('div', { class: 'card', style: { borderColor: '#e0007a', position: 'sticky', top: '53px', zIndex: 6 } },
      h('b', {}, moving ? `✏️ Переношу: ${slotLabel(state.ctx.points.get(moving.id) || { label: '?' }, moving.i)}` : '✏️ Режим перестановки'),
      h('div', { class: 'mut' }, moving ? 'Нажмите на порт: свободный — перенесётся туда, занятый — поменяются местами. Нажмите ту же точку — отменить выбор.' : 'Нажмите на точку, потом на порт, куда её перенести. Так сколько угодно раз; выйти — «✅ Готово».'),
      h('div', { class: 'btns' }, h('button', { onclick: () => { editMode = false; moving = null; ui.render(); } }, '✅ Готово'))) : moving ? h('div', { class: 'card', style: { borderColor: '#e0007a', position: 'sticky', top: '53px', zIndex: 6 } },
      h('b', {}, `↔ Перенос: ${slotLabel(state.ctx.points.get(moving.id) || { label: '?' }, moving.i)}`), h('div', { class: 'mut' }, 'Нажмите на порт: свободный — перенесётся туда, занятый — поменяются местами.'),
      h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => { moving = null; ui.render(); } }, 'Отмена'))) : null,
    problems.length ? h('div', { class: 'card', style: { borderColor: '#ff9f0a' } }, h('b', {}, `⚠️ Проверка (${problems.length})`), ...problems.slice(0, 20).map((t) => h('div', { style: { fontSize: '14px' } }, `• ${t}`))) : null,
    free.length ? h('div', { class: 'card' }, h('b', {}, `Не расставлены: ${free.length}`),
      h('div', { class: 'mut', style: { margin: '4px 0' } }, [...byType.entries()].map(([t, n]) => `${t}: ${n}`).join(' · ')),
      h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => placeModal(cab, ui) }, '➕ Поставить в панель…'))) : null,
    ...panelsInOrder(r).map(panelCard),
    !(r.panels || []).length ? h('div', { class: 'empty' }, 'Панелей пока нет — «🧙 Мастер» или «➕ Панель»') : null,
    h('div', { class: 'mut', style: { margin: '10px 2px', fontSize: '13px' } }, 'Нажмите на свободный порт — поставить точки с него; на занятый — переставить, убрать или открыть точку. 🔢 — упорядочить панель по номерам.'));
}
