// «🗄 Шкафы и шильют»: план шкафа — какие точки cat7 в каких панелях (U) и портах (1–24).
// Мастер раскладывает точки по типам в панели на указанных U; дальше — ручная правка: поставить с любого порта, переставить, убрать.
import { h, openModal, toast, confirmDialog, formModal } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { comparePoints } from '../../domain/index.js';
import {
  PANEL_PORTS, rackPortsOf, panelOf, fmtPanelPort, defaultPortLabels, rackOf, panelsInOrder, rackPointsOf,
  cabinetFloor, autoFill, rackProblems, typeColorOf, slotKey, subsOf, blockedOf, blockPort, unblockPort, shilutLabel, shilutOf,
} from '../../domain/rack.js';
import { pointCard } from './points.js';
import { shilutSettings, panelModels, modelName } from './shilutsettings.js';

let openCab = null;   // открытый шкаф
let moving = null;    // перенос порта: { id, i }
let editMode = false; // режим перестановки: нажал точку → нажал порт, без окон
let blockMode = false; // режим «закрыть порты»: нажал порт → на нём крестик (или снял)

const sortRu = (a, b) => a.localeCompare(b, 'ru', { numeric: true });
const HUES = [205, 140, 45, 0, 275, 175, 25, 320, 95, 240];
const hueOf = (typeId) => { let x = 0; for (const ch of String(typeId)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return HUES[x % HUES.length]; };
const allPoints = () => [...state.ctx.points.values()];
const cabPoints = (cab) => rackPointsOf(allPoints(), state.ctx, cab);
const slotLabel = (pt, i) => shilutLabel(pt, i, currentProject(), state.ctx) || pt.label;
const shortLabel = (txt, cab) => (cab && (txt.startsWith(`${cab}-`) || txt.startsWith(`${cab}/`)) ? txt.slice(cab.length + 1) : txt);
// «секция|U|порт» → { pt, i } для точек шкафа
function slotsOf(cab) {
  const m = new Map();
  cabPoints(cab).forEach((pt) => panelOf(pt).forEach((x, i) => m.set(slotKey(x), { pt, i })));
  return m;
}
const multi = (cab) => subsOf(rackOf(currentProject(), cab), cab).length > 1;
const subName = (cab, sid) => (multi(cab) ? subsOf(rackOf(currentProject(), cab), cab).find((x) => x.id === (sid || ''))?.name || '' : '');
const pName = (cab, pnl) => `${multi(cab) ? `${subName(cab, pnl.s)} ` : ''}U${pnl.u}`;
const samePanel = (a, b) => (a.s || '') === (b.s || '') && a.u === b.u;
const withS = (x, sid) => { const o = { ...x }; if (sid) o.s = sid; else delete o.s; return o; };
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
    h('div', { class: 'btns', style: { margin: '0 0 8px' } }, h('button', { class: 'sec', onclick: () => shilutSettings(ui) }, '🎨 Настройки шильюта: модели панелей, цвета, подписи')),
    noCab ? h('div', { class: 'card l-warn' }, `Точек cat7 без шкафа: ${noCab.pts} — их нельзя поставить в панель, пока не указан шкаф.`) : null,
    h('div', { class: 'card', style: { padding: 0 } }, cabs.length ? cabs.map((c) => {
      const x = byCab.get(c); const r = rackOf(p, c);
      return h('div', { class: 'item', onclick: () => { openCab = c; moving = null; blockMode = false; ui.render(); } },
        h('div', { class: 'name' }, `🗄 Шкаф ${c}`, h('div', { class: 'sub' }, `точек cat7: ${x.pts} (портов ${x.ports}) · расставлено ${x.placed} из ${x.pts}${r ? ` · ${subsOf(r, c).map((x) => `${subsOf(r, c).length > 1 ? `${x.name} ` : ''}${x.height}U`).join(' + ')}, панелей ${r.panels?.length || 0}` : ' · плана ещё нет'}`)),
        h('span', { style: { fontSize: '20px' } }, x.placed === x.pts && x.pts ? '✅' : '›'));
    }) : h('div', { class: 'empty' }, 'Нет точек с кабелями cat7 и шкафом')));
}

// ---------- размер и нумерация шкафа (и секции: несколько физических шкафов под одним именем) ----------
function rackForm(cab, done) {
  const r = rackOf(currentProject(), cab) || { height: 42, bottomUp: true, panels: [] };
  const subs = subsOf(r, cab).map((x) => ({ ...x }));
  let many = subs.length > 1;
  const box = h('div', {});
  const used = (sid) => (r.panels || []).some((x) => (x.s || '') === sid) || cabPoints(cab).some((pt) => panelOf(pt).some((x) => (x.s || '') === sid));
  const row = (x, i) => {
    const name = h('input', { type: 'text', value: x.name, placeholder: `${cab}-${String.fromCharCode(65 + i)}`, style: { flex: 2, minWidth: '110px' }, oninput: (e) => { x.name = e.target.value; } });
    const hgt = h('input', { type: 'text', inputMode: 'numeric', value: String(x.height || 42), style: { width: '64px' }, oninput: (e) => { x.height = e.target.value; } });
    const num = h('select', { onchange: (e) => { x.bottomUp = e.target.value !== 'top'; } },
      h('option', { value: 'bottom', selected: x.bottomUp !== false }, 'U1 внизу (сверху U42, U41…)'), h('option', { value: 'top', selected: x.bottomUp === false }, 'U1 вверху (сверху U01, U02…)'));
    return h('div', { class: 'card', style: { margin: '6px 0' } },
      many ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } }, h('small', { class: 'mut' }, `Шкаф ${i + 1}:`), name,
        i > 0 ? h('button', { class: 'sec', style: { padding: '4px 10px' }, onclick: () => { if (used(x.id)) { toast('В этом шкафу есть панели или точки — сначала уберите их'); return; } subs.splice(i, 1); draw(); } }, '✖') : null) : null,
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, h('span', {}, 'Высота, U'), hgt, num));
  };
  const multiCb = h('input', { type: 'checkbox', checked: many, onchange: () => {
    if (!multiCb.checked && subs.slice(1).some((x) => used(x.id))) { multiCb.checked = true; toast('Во 2-м и следующих шкафах есть панели или точки — сначала уберите их'); return; }
    many = multiCb.checked;
    if (many && subs.length < 2) { if (!subs[0].name || subs[0].name === cab) subs[0].name = `${cab}-A`; subs.push({ id: `s${Date.now().toString(36)}`, name: `${cab}-B`, height: subs[0].height, bottomUp: subs[0].bottomUp }); }
    if (!many) subs.splice(1);
    draw();
  } });
  const draw = () => box.replaceChildren(...subs.map(row),
    many ? h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => { subs.push({ id: `s${Date.now().toString(36)}`, name: `${cab}-${String.fromCharCode(65 + subs.length)}`, height: subs[0].height, bottomUp: subs[0].bottomUp }); draw(); } }, '➕ Ещё шкаф')) : null);
  draw();
  const save = h('button', { onclick: () => {
    for (const x of subs) {
      x.height = Math.round(Number(x.height));
      if (!(x.height >= 1 && x.height <= 60)) { toast('Высота — от 1 до 60 U'); return; }
      const out = (r.panels || []).filter((q) => (q.s || '') === x.id && q.u > x.height);
      if (out.length) { toast(`Панели выше ${x.height}U: ${out.map((q) => `U${q.u}`).join(', ')} — сначала перенесите их`); return; }
      if (many && !String(x.name || '').trim()) { toast('Назовите каждый шкаф'); return; }
    }
    const names = subs.map((x) => String(x.name).trim().toLowerCase());
    if (many && new Set(names).size !== names.length) { toast('Названия шкафов не должны повторяться'); return; }
    const s0 = subs[0];
    saveRack(cab, { ...r, height: s0.height, bottomUp: s0.bottomUp !== false, subs: many ? subs.map((x) => ({ id: x.id || '', name: String(x.name).trim(), height: x.height, bottomUp: x.bottomUp !== false })) : null });
    c(); done?.();
  } }, 'Сохранить');
  const c = openModal(`Шкаф ${cab}: размер и нумерация`, h('div', {},
    h('label', { class: 'pickrow' }, multiCb, h('span', {}, 'Несколько шкафов в одном (точки этого шкафа стоят в разных физических шкафах)')),
    box, h('div', { class: 'btns' }, save)), { sticky: true });
}

// ---------- мастер: панели по типам ----------
function wizard(cab, ui) {
  const r = rackOf(currentProject(), cab);
  if (!r) { rackForm(cab, () => setTimeout(() => wizard(cab, ui), 300)); return; }
  const subs = subsOf(r, cab); const many = subs.length > 1;
  const pts = cabPoints(cab);
  const types = [...new Set(pts.map((p) => p.typeId))].sort(sortRu).map((t) => {
    const list = pts.filter((p) => p.typeId === t).sort(comparePoints);
    const ports = list.reduce((n, p) => n + rackPortsOf(p, state.ctx), 0);
    const placed = list.filter((p) => panelOf(p).length).length;
    const holding = [...new Map(list.flatMap((p) => panelOf(p).map((x) => [`${x.s || ''}|${x.u}`, { s: x.s || '', u: String(x.u) }]))).values()];  // где они сейчас
    return { t, list, ports, placed, on: placed === 0, us: holding.length ? holding : Array.from({ length: Math.ceil(ports / PANEL_PORTS) }, () => ({ s: '', u: '' })) };
  });
  const box = h('div', {});
  const draw = () => box.replaceChildren(...types.map((x) => {
    const cb = h('input', { type: 'checkbox', checked: x.on, onchange: () => { x.on = cb.checked; draw(); } });
    const need = Math.ceil(x.ports / PANEL_PORTS);
    return h('div', { class: 'card', style: { margin: '8px 0', opacity: x.on ? 1 : 0.6 } },
      h('label', { class: 'pickrow', style: { margin: 0 } }, cb, h('span', {}, h('b', {}, x.t), ` — точек ${x.list.length}, портов ${x.ports} → нужно панелей: ${need}${x.placed ? ` · уже расставлено ${x.placed} (будут разложены заново)` : ''}`)),
      x.on ? h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '6px' } },
        ...x.us.map((e, i) => h('label', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, h('small', { class: 'mut' }, `${i + 1}-я:`),
          many ? h('select', { style: { width: 'auto' }, onchange: (ev) => { e.s = ev.target.value; } }, subs.map((q) => h('option', { value: q.id, selected: q.id === e.s }, q.name))) : null,
          h('small', { class: 'mut' }, 'U'),
          h('input', { type: 'text', inputMode: 'numeric', value: e.u, style: { width: '64px' }, oninput: (ev) => { e.u = ev.target.value; } }))),
        h('button', { class: 'sec', style: { padding: '4px 12px' }, onclick: () => { x.us.push({ s: x.us[x.us.length - 1]?.s || '', u: '' }); draw(); } }, '＋'),
        x.us.length > 1 ? h('button', { class: 'sec', style: { padding: '4px 12px' }, onclick: () => { x.us.pop(); draw(); } }, '－') : null) : null);
  }));
  draw();
  const go = h('button', { onclick: async () => {
    const chosen = types.filter((x) => x.on);
    if (!chosen.length) { toast('Отметьте хотя бы один тип'); return; }
    for (const x of chosen) {
      for (const e of x.us) {
        const u = Number(String(e.u).trim()); const sub = subs.find((q) => q.id === (e.s || ''));
        if (!sub || !Number.isInteger(u) || u < 1 || u > sub.height) { toast(`${x.t}: укажите U каждой панели (1–${sub?.height || '?'})`); return; }
      }
      const keys = x.us.map((e) => `${e.s || ''}|${Number(e.u)}`);
      if (new Set(keys).size !== keys.length) { toast(`${x.t}: две панели на одном U`); return; }
    }
    const replaced = chosen.reduce((n, x) => n + x.placed, 0);
    if (replaced && !(await confirmDialog(`Уже расставленные точки этих типов (${replaced}) будут разложены заново по порядку номеров. Продолжить?`, { yes: 'Разложить' }))) return;
    const again = new Set(chosen.flatMap((x) => x.list.map((p) => p.id)));
    const occupied = new Set(); cabPoints(cab).filter((p) => !again.has(p.id)).forEach((p) => panelOf(p).forEach((q) => occupied.add(slotKey(q))));
    const panels = [...(r.panels || [])]; const writes = []; const left = [];
    for (const x of chosen) {
      const tp = x.us.map((e) => withS({ u: Number(e.u) }, e.s || ''));
      tp.forEach((pnl) => { if (!panels.some((q) => samePanel(q, pnl))) panels.push(pnl); });
      const res = autoFill(x.list, state.ctx, tp, occupied, { blocked: blockedOf(r) });
      x.list.forEach((p) => writes.push([p.id, res.assign.get(p.id) || []]));
      res.assign.forEach((list) => list.forEach((q) => occupied.add(slotKey(q))));
      left.push(...res.left);
    }
    saveRack(cab, { ...r, panels }); savePanels(writes); close();
    toast(left.length ? `Разложено. Не поместились (нет мест в панелях): ${left.map((p) => p.label).slice(0, 8).join(', ')}${left.length > 8 ? '…' : ''}` : 'Точки разложены по панелям');
    ui.render();
  } }, '✅ Разложить');
  const close = openModal(`🧙 Мастер: шкаф ${cab}`, h('div', {},
    h('div', { class: 'mut' }, `${subs.map((q) => `${many ? `${q.name}: ` : 'Шкаф '}${q.height}U, ${q.bottomUp === false ? 'U1 вверху' : 'U1 внизу'}`).join('; ')}. Для каждого типа укажите, ${many ? 'в каком шкафу и ' : ''}на каких U стоят его панели (по порядку: первая, вторая…). Точки ляжут по возрастанию номера с 1-го порта; занятые другими точками порты пропускаются. Одну и ту же панель можно указать у двух типов — второй тип займёт свободные порты.`),
    box, h('div', { class: 'btns' }, go)), { sticky: true });
}

// ---------- поставить точки в панель ----------
function placeModal(cab, ui, { u = null, s: sid = '', p = 1 } = {}) {
  const r = rackOf(currentProject(), cab); const panels = subsOf(r, cab).flatMap((sub) => panelsInOrder(r, sub));
  if (!panels.length) { toast('Сначала добавьте панель'); return; }
  const free = cabPoints(cab).filter((pt) => !panelOf(pt).length).sort(comparePoints);
  if (!free.length) { toast('Все точки шкафа уже расставлены'); return; }
  const types = [...new Set(free.map((x) => x.typeId))].sort(sortRu);
  let fType = types.length === 1 ? types[0] : ''; const on = new Set();
  const panelSel = h('select', {}, panels.map((x, i) => h('option', { value: i, selected: x.u === u && (x.s || '') === (sid || '') }, `Панель ${pName(cab, x)}`)));
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
    const pnl = panels[Number(panelSel.value)]; const chosen = free.filter((x) => on.has(x.id));
    const occupied = new Set(slotsOf(cab).keys());
    const res = autoFill(chosen, state.ctx, [withS({ u: pnl.u }, pnl.s || '')], occupied, { start, blocked: blockedOf(r) });
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
  const back = h('button', { class: 'sec', onclick: () => { openCab = null; moving = null; editMode = false; blockMode = false; ui.render(); } }, '← Все шкафы');
  if (!r) {
    return h('div', {}, back,
      h('div', { class: 'card', style: { marginTop: '10px' } }, h('b', {}, `Шкаф ${cab}`), h('div', { class: 'mut', style: { margin: '6px 0' } }, `Точек cat7: ${pts.length}. Плана шкафа ещё нет: укажите размер и нумерацию U (или несколько шкафов в одном), затем мастер разложит точки по панелям.`),
        h('div', { class: 'btns' }, h('button', { onclick: () => wizard(cab, ui) }, '🧙 Создать план шкафа'))));
  }
  const subs = subsOf(r, cab); const many = subs.length > 1;
  const slots = slotsOf(cab);
  const problems = rackProblems(r, pts, state.ctx, cab);
  const free = pts.filter((pt) => !panelOf(pt).length);
  const floor = cabinetFloor(pts);
  const subOf = (sid) => subs.find((x) => x.id === (sid || ''));
  const blocked = blockedOf(r);
  // Своя подпись порта в шильюте (пусто — снова по умолчанию/шаблону)
  const editLabel = (pt, i) => {
    const arr = panelOf(pt).map((x) => ({ ...x })); const own = arr[i].label || '';
    const auto = shilutLabel({ ...pt, panel: arr.map((x) => ({ ...x, label: '' })) }, i, p, state.ctx);
    formModal({ title: `Подпись порта ${fmtPanelPort(arr[i], subName(cab, arr[i].s))}`, values: { label: own || auto },
      fields: [{ key: 'label', label: `В шильюте (по умолчанию: ${auto})`, type: 'text' }],
      onSubmit: (v) => { const t = String(v.label || '').trim(); if (!t || t === auto) delete arr[i].label; else arr[i].label = t; savePanels([[pt.id, arr]]); setTimeout(() => ui.render(), 200); } });
  };
  // Закрыть/открыть порт крестиком; при закрытии точки панели сдвигаются, кому не хватило места — не расставлены
  const toggleBlock = (pnl, port, isX) => {
    const sid = pnl.s || '';
    if (isX) { saveRack(cab, unblockPort(r, { s: sid, u: pnl.u, p: port })); setTimeout(() => ui.render(), 200); return; }
    const res = blockPort(r, pts, cab, { s: sid, u: pnl.u, p: port });
    saveRack(cab, res.rack); savePanels([...res.writes.entries()]);
    if (res.dropped.length) toast(`Не поместились в панель ${pName(cab, pnl)} — теперь не расставлены: ${res.dropped.map((x) => x.label).slice(0, 8).join(', ')}${res.dropped.length > 8 ? '…' : ''}`);
    else if (res.writes.size) toast(`Точки сдвинуты: ${res.writes.size}`);
    setTimeout(() => ui.render(), 200);
  };
  const cellTap = (pnl, port) => {
    const sid = pnl.s || ''; const u = pnl.u;
    const at = slots.get(slotKey({ s: sid, u, p: port }));
    const isX = blocked.has(slotKey({ s: sid, u, p: port }));
    if (blockMode) { toggleBlock(pnl, port, isX, at); return; }
    if (isX) {
      if (moving || editMode) { toast('Порт закрыт крестиком'); return; }
      const c = openModal(`${fmtPanelPort({ u, p: port }, subName(cab, sid))} · закрыт`, h('div', {},
        h('div', { class: 'mut' }, 'Порт закрыт: точки в него не ставятся. Если открыть — точки сами не сдвигаются, порт просто станет свободным.'),
        h('div', { class: 'btns' }, h('button', { onclick: () => { saveRack(cab, unblockPort(r, { s: sid, u, p: port })); c(); setTimeout(() => ui.render(), 200); } }, '✅ Открыть порт'))));
      return;
    }
    if (editMode && !moving) { if (at) { moving = { id: at.pt.id, i: at.i }; ui.render(); } else toast('Сначала нажмите на точку, которую переносите'); return; }
    if (moving) {
      const src = state.ctx.points.get(moving.id); const sp = panelOf(src);
      if (!src || !sp[moving.i]) { moving = null; ui.render(); return; }
      const from = sp[moving.i];
      if (at && at.pt.id === src.id && at.i === moving.i) { moving = null; ui.render(); return; }
      const writes = new Map();
      const get = (pt) => writes.get(pt.id) || panelOf(pt).map((x) => ({ ...x }));
      const a = get(src); a[moving.i] = withS({ ...a[moving.i], u, p: port }, sid); writes.set(src.id, a);
      if (at) { const b = at.pt.id === src.id ? a : get(at.pt); b[at.i] = withS({ ...b[at.i], u: from.u, p: from.p }, from.s || ''); writes.set(at.pt.id, b); }
      savePanels([...writes.entries()]); moving = null; if (!editMode) toast(at ? 'Переставлено местами' : 'Перенесено'); ui.render(); return;
    }
    if (!at) { placeModal(cab, ui, { u, s: sid, p: port }); return; }
    const { pt, i } = at; const n = rackPortsOf(pt, state.ctx);
    const c = openModal(`${fmtPanelPort({ u, p: port }, subName(cab, sid))} · ${slotLabel(pt, i)}`, h('div', {},
      h('div', { class: 'mut' }, `Точка ${pt.label} · ${pt.typeId}${n > 1 ? ` · порт ${i + 1} из ${n}: ${panelOf(pt).map((x) => fmtPanelPort(x, subName(cab, x.s))).join(', ')}` : ''}`),
      h('div', { class: 'btns' },
        h('button', { onclick: () => { moving = { id: pt.id, i }; c(); ui.render(); } }, '↔ Переставить'),
        h('button', { class: 'sec', onclick: () => { c(); editLabel(pt, i); } }, '🏷 Подпись для шильюта'),
        h('button', { class: 'sec', onclick: () => { c(); pointCard(pt); } }, '📋 Карточка точки'),
        h('button', { class: 'danger', onclick: () => { savePanels([[pt.id, []]]); c(); toast(`${pt.label} убрана из панели`); ui.render(); } }, n > 1 ? '✖ Убрать точку (все её порты)' : '✖ Убрать из панели'))));
  };
  const onPanel = (pnl) => (x) => samePanel(x, pnl);
  const panelCard = (pnl) => {
    const sid = pnl.s || ''; const sub = subOf(sid);
    const used = Array.from({ length: PANEL_PORTS }, (_, k) => slots.get(slotKey({ s: sid, u: pnl.u, p: k + 1 })));
    const n = used.filter(Boolean).length;
    const nx = Array.from({ length: PANEL_PORTS }, (_, k) => blocked.has(slotKey({ s: sid, u: pnl.u, p: k + 1 }))).filter(Boolean).length;
    const types = [...new Set(used.filter(Boolean).map((x) => x.pt.typeId))];
    const cells = used.map((at, k) => {
      const mv = moving && at && at.pt.id === moving.id && at.i === moving.i;
      if (blocked.has(slotKey({ s: sid, u: pnl.u, p: k + 1 }))) {
        return h('div', { title: 'порт закрыт', onclick: () => cellTap(pnl, k + 1),
          style: { cursor: 'pointer', border: '1px solid var(--line)', borderRadius: '6px', padding: '2px 4px', minHeight: '38px', background: 'repeating-linear-gradient(45deg, rgba(128,128,128,.28) 0 5px, rgba(128,128,128,.10) 5px 10px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } },
          h('small', { class: 'mut', style: { fontSize: '10px', lineHeight: '12px' } }, String(k + 1)), h('span', { style: { fontSize: '16px', lineHeight: '16px', fontWeight: 700, color: '#ff3b30' } }, '✖'));
      }
      const hue = at ? hueOf(at.pt.typeId) : 0;
      const col = at ? typeColorOf(currentProject(), at.pt.typeId, getRepo().prefs?.shilutColors || []) : null;
      return h('div', { title: at ? `${slotLabel(at.pt, at.i)} (${at.pt.typeId})` : 'свободно', onclick: () => cellTap(pnl, k + 1),
        style: { cursor: 'pointer', border: `1px solid ${mv ? '#e0007a' : 'var(--line)'}`, borderWidth: mv ? '2px' : '1px', borderRadius: '6px', outline: mv ? '3px solid #e0007a' : 'none', outlineOffset: '1px', padding: '2px 4px', minHeight: '38px',
          background: col ? col.bg : at ? `hsla(${hue},70%,50%,.18)` : 'transparent', color: col ? col.fg : 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', overflow: 'hidden' } },
        h('small', { class: col ? '' : 'mut', style: { fontSize: '10px', lineHeight: '12px', opacity: col ? 0.75 : 1 } }, String(k + 1)),
        h('span', { style: { fontSize: '12px', lineHeight: '14px', wordBreak: 'break-all', fontWeight: at ? 600 : 400 } }, at ? shortLabel(slotLabel(at.pt, at.i), cab) : ''));
    });
    return h('div', { class: 'card', style: { margin: '8px 0' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
        h('b', {}, `U${pnl.u}`, h('span', { class: 'mut', style: { fontWeight: 400 } }, `${modelName(pnl.m || shilutOf(p).panelModel) ? ` · ${modelName(pnl.m || shilutOf(p).panelModel)}` : ''} · занято ${n}/${PANEL_PORTS}${nx ? ` · закрыто ${nx}` : ''}${types.length ? ` · ${types.join(', ')}` : ''}`)),
        h('div', { style: { display: 'flex', gap: '6px' } },
          h('button', { class: 'sec', style: { padding: '4px 10px' }, title: 'Переставить по порядку номеров с 1-го порта', onclick: async () => {
            const here = [...new Map(used.filter(Boolean).map((x) => [x.pt.id, x.pt])).values()].sort(comparePoints);
            if (!here.length) return;
            if (!(await confirmDialog(`Панель ${pName(cab, pnl)}: поставить её точки (${here.length}) подряд по порядку номеров с 1-го порта? Пропуски (запас) исчезнут.`, { yes: 'Упорядочить' }))) return;
            const ids = new Set(here.map((x) => x.id)); const occ = new Set(); slots.forEach((v, k) => { if (!ids.has(v.pt.id)) occ.add(k); });
            const res = autoFill(here, state.ctx, [withS({ u: pnl.u }, sid)], occ, { blocked: blockedOf(r) });
            savePanels(here.map((x) => [x.id, res.assign.get(x.id) || []])); ui.render();
          } }, '🔢'),
          h('button', { class: 'sec', style: { padding: '4px 10px' }, title: 'U и модель панели', onclick: () => formModal({ title: `Панель ${pName(cab, pnl)}: U и модель`, values: { u: pnl.u, m: pnl.m || '' },
              fields: [{ key: 'u', label: 'U', type: 'number', required: true }, ...(panelModels().length ? [{ key: 'm', label: 'Модель панели', type: 'select', options: panelModels().map((x) => ({ value: x.id, label: x.name })), emptyLabel: 'как в настройках проекта' }] : [])],
            onSubmit: (v) => {
              const nu = Math.round(Number(v.u)); if (!(nu >= 1 && nu <= sub.height)) { toast(`U от 1 до ${sub.height}`); return false; }
              if (nu !== pnl.u && (r.panels || []).some((x) => samePanel(x, { s: sid, u: nu }))) { toast(`На U${nu} уже есть панель`); return false; }
              saveRack(cab, { ...r, panels: (r.panels || []).map((x) => (samePanel(x, pnl) ? { ...x, u: nu, m: v.m || '' } : x)), blocked: (r.blocked || []).map((x) => (samePanel(x, pnl) ? { ...x, u: nu } : x)) });
              savePanels(pts.filter((pt) => panelOf(pt).some(onPanel(pnl))).map((pt) => [pt.id, panelOf(pt).map((x) => (samePanel(x, pnl) ? { ...x, u: nu } : x))]));
              setTimeout(() => ui.render(), 200);
            } }) }, '✏️'),
          h('button', { class: 'sec', style: { padding: '4px 10px' }, title: 'Удалить панель', onclick: async () => {
            const on = pts.filter((pt) => panelOf(pt).some(onPanel(pnl)));
            if (!(await confirmDialog(`Удалить панель ${pName(cab, pnl)}?${on.length ? ` Точки на ней (${on.length}) станут нерасставленными.` : ''}`, { yes: 'Удалить', danger: true }))) return;
            saveRack(cab, { ...r, panels: (r.panels || []).filter((x) => !samePanel(x, pnl)), blocked: (r.blocked || []).filter((x) => !samePanel(x, pnl)) }); savePanels(on.map((pt) => [pt.id, []])); setTimeout(() => ui.render(), 200);
          } }, '🗑'))),
      h('div', { class: 'rackgrid' }, ...cells));
  };
  const addPanel = () => formModal({ title: 'Новая панель',
    fields: [
      ...(many ? [{ key: 's', label: 'Шкаф', type: 'select', options: subs.slice(1).map((x) => ({ value: x.id, label: x.name })), emptyLabel: subs[0].name }] : []),
      { key: 'u', label: 'На каком U', type: 'number', required: true }],
    onSubmit: (v) => {
      const sid = many ? (v.s || '') : ''; const sub = subOf(sid); const u = Math.round(Number(v.u));
      if (!(u >= 1 && u <= sub.height)) { toast(`U от 1 до ${sub.height}`); return false; }
      if ((r.panels || []).some((x) => samePanel(x, { s: sid, u }))) { toast(`На U${u} уже есть панель`); return false; }
      saveRack(cab, { ...r, panels: [...(r.panels || []), withS({ u }, sid)] }); setTimeout(() => ui.render(), 200);
    } });
  const byType = new Map(); free.forEach((pt) => byType.set(pt.typeId, (byType.get(pt.typeId) || 0) + 1));
  const subBlock = (sub) => {
    const list = panelsInOrder(r, sub);
    return h('div', {},
      many ? h('div', { class: 'group', style: { padding: '14px 2px 2px', fontSize: '15px' } }, `🗄 ${sub.name} · ${sub.height}U · ${sub.bottomUp === false ? 'U1 вверху' : 'U1 внизу'} · панелей ${list.length}`) : null,
      ...list.map(panelCard),
      !list.length ? h('div', { class: 'empty' }, many ? 'В этом шкафу панелей пока нет' : 'Панелей пока нет — «🧙 Мастер» или «➕ Панель»') : null);
  };
  return h('div', {}, back,
    h('div', { class: 'card', style: { marginTop: '10px' } },
      h('b', {}, `${p.name} · ${floor ? `этаж ${floor} · ` : ''}шкаф ${cab}`),
      h('div', { class: 'mut', style: { margin: '4px 0' } }, `${many ? `${subs.length} шкафа: ${subs.map((x) => `${x.name} ${x.height}U`).join(', ')}` : `${subs[0].height}U · ${subs[0].bottomUp === false ? 'U1 вверху' : 'U1 внизу'}`} · панелей ${r.panels?.length || 0} · точек cat7 ${pts.length}, расставлено ${pts.length - free.length}`),
      h('div', { class: 'btns' },
        h('button', { class: editMode ? '' : 'sec', onclick: () => { editMode = !editMode; blockMode = false; moving = null; ui.render(); } }, editMode ? '✅ Готово' : '✏️ Редактировать'),
        h('button', { class: blockMode ? '' : 'sec', onclick: () => { blockMode = !blockMode; editMode = false; moving = null; ui.render(); } }, blockMode ? '✅ Готово' : '🚫 Закрыть порты'),
        h('button', { class: 'sec', onclick: () => wizard(cab, ui) }, '🧙 Мастер'),
        h('button', { class: 'sec', onclick: addPanel }, '➕ Панель'),
        h('button', { class: 'sec', onclick: () => shilutSettings(ui) }, '🎨 Шильют'),
        h('button', { class: 'sec', onclick: () => rackForm(cab, () => setTimeout(() => ui.render(), 200)) }, many ? '⚙️ Шкафы, размер и нумерация' : '⚙️ Размер и нумерация'))),
    blockMode ? h('div', { class: 'card', style: { borderColor: '#ff3b30', position: 'sticky', top: '53px', zIndex: 6 } },
      h('b', {}, '🚫 Закрытие портов'),
      h('div', { class: 'mut' }, 'Нажмите на порт — на нём появится ✖ и точки в него не встанут. Точки этой панели сдвинутся на ближайшие свободные порты; кто не поместится — станет нерасставленным. Нажмите на ✖ — порт откроется (точки сами не сдвигаются).'),
      h('div', { class: 'btns' }, h('button', { onclick: () => { blockMode = false; ui.render(); } }, '✅ Готово'))) : null,
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
    ...subs.map(subBlock),
    h('div', { class: 'mut', style: { margin: '10px 2px', fontSize: '13px' } }, 'Нажмите на свободный порт — поставить точки с него; на занятый — переставить, убрать или открыть точку. 🔢 — упорядочить панель по номерам. 🚫 — закрыть порты крестиком (сломанные, зарезервированные).'));
}
