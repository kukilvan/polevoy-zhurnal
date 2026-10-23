// Точки: форма точки, генератор пачкой, карточка точки с историей, вкладка «Точки».
import { h, formModal, openModal, confirmDialog, toast, qtyList, attachShortcuts } from '../ui.js';
import { state, getRepo, pointsSorted, infoOf, currentProject } from '../store.js';
import { generateLabels, generatedTotal, MAX_GENERATED, parseSuffixes, comparePoints, renameLabel, renameIssue, sameLabelClash, labelKey, inheritedFromCables, usesConfig, missingStages, hasDeviceId, normalizeMac, findDuplicate } from '../../domain/index.js';
import { scanDevice } from '../scan.js';
import { statusClass } from './project.js';
import { hint } from './guide.js';
import { doorCfgOf, doorCfgShort, isDoorCfg } from '../../domain/index.js';
import { dateText, cablesText, missingDetails, isComposedType, isSystemType, UNSORTED_TYPE, cableOverrideFor } from '../../domain/index.js';
import { addWorkForPoint, addWorkForPoints } from './doh.js';
import { whoIs } from './journal.js';
import { pointsFromFile } from './pointsfile.js';
import { drawingsHub, unsortedModal } from './tohnitview.js';
import { cablesField, cablesPicker } from './cablespick.js';
import { doorField } from './doorcfgview.js';
import { doorChips, doorShortChip } from './doorchips.js';
import { ensureDoorCfg, pinsOf as doorPins, allDoorCfgs } from '../doorpool.js';
import { drawingFor, drawingsOf } from '../drawings.js';
import { typeMatch, typeFilterOptions, typeFilterValid } from '../typegroups.js';
import { latinKey } from '../../domain/index.js';
import { cfgMatch, cfgFilterOptions, cfgFilterValid } from '../cfgfilter.js';
import { planModal } from './planmodal.js';
import { choosePoint } from './pointchooser.js';
import { printedPortsOf, panelText, panelOf, parsePanelPorts, panelOccupancy, rackPortsOf, matchesPanelQuery, fmtPanelPort, slotKey, subsOf, subNameOf, blockedOf } from '../../domain/rack.js';

const typeOptions = () => [...state.ctx.types.values()].filter((t) => !isSystemType(t)).map((t) => ({ value: t.id, label: t.id }));
const hasIdType = (id) => hasDeviceId(state.ctx.types.get(id));
const isDoorType = (id) => usesConfig(state.ctx.types.get(id));
const reasonOptions = () => [...state.ctx.delayReasons.values()].map((r) => ({ value: r.id, label: r.id }));

// ---- состав точки (тип из устройств): галочки устройств с количеством + кабели самой точки ----
const typeOf = (id) => state.ctx.types.get(id);
const composedType = (id) => isComposedType(typeOf(id));
// у двери выбрана конфигурация (новая схема): состав и кабели — из неё, поля «Состав» и «Кабели» не нужны
const doorShort = (p) => { const c = doorCfgOf(p, state.ctx); return c ? doorCfgShort(state.ctx, c) : ''; };
const doorCfgSet = (v) => isDoorType(v.typeId) && !!v.configId && v.configId !== '__clear' && isDoorCfg(state.ctx.configs.get(v.configId) || allDoorCfgs().get(v.configId));
const sameList = (a, b, k) => JSON.stringify((a || []).map((x) => [x[k], Number(x.count), x.cables || null, x.workIds || null]))
  === JSON.stringify((b || []).map((x) => [x[k], Number(x.count), x.cables || null, x.workIds || null]));
function compField(point) {
  const ctx = state.ctx; const allDev = [...ctx.devices.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  let typeId = null; let rows = []; // [{ deviceId, count, on, cables?, workIds?, open? }] — cables/workIds: изменено у этой точки
  const works = [...ctx.catalog.values()].filter((w) => ['Хивут', 'Установка', 'Проверка', 'Шилют', 'Доп. работа'].includes(w.workType) && w.active !== false)
    .sort((a, b) => a.workType.localeCompare(b.workType, 'ru') || a.name.localeCompare(b.name, 'ru'));
  const cableOpts = [...ctx.cables.values()].map((c) => ({ value: c.id, label: c.id }));
  // редактор устройства для этой точки: кабели и работы (по умолчанию — как в «Устройствах»)
  const editor = (r) => {
    const dev = ctx.devices.get(r.deviceId) || {};
    const q = qtyList(cableOpts, { addLabel: '➕ Кабель', empty: 'Без кабеля', onChange: () => { r.cables = q.get().map((c) => ({ cable: c.value, count: c.count })); mark(); paintWorks(); } });
    q.set((Array.isArray(r.cables) ? r.cables : dev.cables || []).map((c) => ({ value: c.cable, count: c.count })));
    const cur = new Set(Array.isArray(r.workIds) ? r.workIds : dev.workIds || []);
    // работы кабелей устройства — серые (уже есть), здесь не сохраняются
    const wl = h('div', { class: 'picklist', style: { maxHeight: '180px' } });
    const paintWorks = () => {
      const inh = inheritedFromCables(ctx, Array.isArray(r.cables) ? r.cables : dev.cables || []);
      wl.replaceChildren(...[...works].sort((a, b) => (cur.has(b.id) || inh.has(b.id)) - (cur.has(a.id) || inh.has(a.id))).map((w) => {
        const lock = inh.has(w.id);
        const cb = h('input', { type: 'checkbox', checked: lock || cur.has(w.id), disabled: lock, onchange: () => { cb.checked ? cur.add(w.id) : cur.delete(w.id); r.workIds = works.filter((x) => cur.has(x.id) && !inh.has(x.id)).map((x) => x.id); mark(); } });
        return h('label', { class: 'pickrow' }, cb, h('span', {}, w.name, lock ? h('small', { class: 'mut' }, `  · уже есть: ${inh.get(w.id)}`) : null), h('small', {}, w.workType));
      }));
    };
    paintWorks();
    const mark = () => { title.textContent = `Устройство «${dev.name || r.deviceId}» на этой точке${Array.isArray(r.cables) || Array.isArray(r.workIds) ? ' — изменено' : ''}`; };
    const title = h('div', { class: 'mut', style: { fontWeight: 600 } }); mark();
    return h('div', { class: 'dev-edit' }, title,
      h('div', { class: 'mut', style: { marginTop: '6px' } }, 'Кабели'), q.el,
      h('div', { class: 'mut' }, 'Работы (кроме работ кабелей — они добавятся сами)'), wl,
      h('button', { type: 'button', class: 'sec', onclick: () => { delete r.cables; delete r.workIds; r.open = false; draw(); } }, '↩︎ Как в «Устройствах»'));
  };
  const devBox = h('div', { class: 'picklist', style: { maxHeight: 'none' } });
  const addSel = h('select', {}); const cableQ = qtyList([...ctx.cables.values()].map((c) => ({ value: c.id, label: c.id })), { addLabel: '➕ Кабель точки', empty: 'Кабелей точки нет' });
  const draw = () => {
    devBox.replaceChildren(...(rows.length ? rows.flatMap((r) => {
      const cb = h('input', { type: 'checkbox', checked: r.on, onchange: () => { r.on = cb.checked; } });
      const cnt = h('input', { type: 'text', inputMode: 'numeric', value: String(r.count), class: 'qty', style: { width: '52px', textAlign: 'center' }, oninput: (e) => { r.count = Number(e.target.value) || 0; } });
      const changed = Array.isArray(r.cables) || Array.isArray(r.workIds);
      const gear = h('button', { type: 'button', class: 'sec', style: { padding: '6px 10px', flex: 'none' }, onclick: () => { r.open = !r.open; draw(); } }, r.open ? '▲' : '⚙️');
      const row = h('div', { class: 'pickrow' }, cb, h('span', { onclick: () => { cb.checked = !cb.checked; r.on = cb.checked; } }, ctx.devices.get(r.deviceId)?.name || r.deviceId, changed ? h('small', { style: { color: 'var(--warn)' } }, ' · изменено') : null), h('small', {}, '×'), cnt, gear);
      return r.open ? [row, editor(r)] : [row];
    }) : [h('div', { class: 'empty' }, 'Устройств нет')]));
    addSel.replaceChildren(h('option', { value: '' }, '➕ Добавить устройство…'), ...allDev.filter((d) => !rows.some((r) => r.deviceId === d.id)).map((d) => h('option', { value: d.id }, d.name)));
  };
  addSel.onchange = () => { if (addSel.value) { rows.push({ deviceId: addSel.value, count: 1, on: true }); draw(); } };
  const load = (tid, own) => {
    typeId = tid; const t = typeOf(tid);
    const devs = own && Array.isArray(point?.devices) ? point.devices : (t?.devices || []);
    rows = devs.map((d) => ({ deviceId: d.deviceId, count: Number(d.count) || 1, on: true,
      ...(Array.isArray(d.cables) ? { cables: d.cables } : {}), ...(Array.isArray(d.workIds) ? { workIds: d.workIds } : {}) }));
    // устройства типа, снятые у этой точки, показываем без галочки
    if (own && Array.isArray(point?.devices)) (t?.devices || []).forEach((d) => { if (!rows.some((r) => r.deviceId === d.deviceId)) rows.push({ deviceId: d.deviceId, count: Number(d.count) || 1, on: false }); });
    const cbl = own && Array.isArray(point?.cables) ? point.cables : (t?.cables || []);
    cableQ.set(cbl.map((c) => ({ value: c.cable, count: c.count })));
    draw();
  };
  return {
    key: 'comp', label: 'Состав точки', type: 'custom', visible: (v) => composedType(v.typeId) && !doorCfgSet(v),
    hint: 'Снимите галочку, если устройства на этой точке нет; количество можно поменять. Кабели — в поле «Кабели» ниже.',
    build: (api) => ({
      el: h('div', {}, devBox, addSel, h('div', { style: { display: 'none' } }, cableQ.el)),  // кабели точки — в поле «Кабели» ниже (все кабели точки сразу)
      update: (v) => { if (v.typeId !== typeId) load(v.typeId, typeId === null && point && v.typeId === point.typeId); },
      get: () => ({ devices: rows.filter((r) => r.on && r.count > 0).map((r) => ({ deviceId: r.deviceId, count: r.count,
        ...(Array.isArray(r.cables) ? { cables: r.cables } : {}), ...(Array.isArray(r.workIds) ? { workIds: r.workIds } : {}) })),
        cables: cableQ.get().map((c) => ({ cable: c.value, count: c.count })) }),
    }),
  };
}
// Что записать в точку: свой состав только если он отличается от типа (иначе точка следует за типом)
function compData(typeId, comp) {
  const t = typeOf(typeId);
  if (!isComposedType(t) || !comp) return { devices: null, cables: null };
  return { devices: sameList(comp.devices, t.devices, 'deviceId') ? null : comp.devices, cables: sameList(comp.cables, t.cables, 'cable') ? null : comp.cables };
}
const compText = (p) => {
  const ctx = state.ctx; const t = typeOf(p.typeId); if (!isComposedType(t) || doorCfgOf(p, ctx)) return '';
  const devs = Array.isArray(p.devices) ? p.devices : (t.devices || []);
  return devs.map((d) => `${ctx.devices.get(d.deviceId)?.name || d.deviceId}${d.count > 1 ? ` ×${d.count}` : ''}${d.cables || d.workIds ? ' (изменено)' : ''}`).join(', ') + (Array.isArray(p.devices) || Array.isArray(p.cables) ? ' (свой состав)' : '');
};

// Поле со сканером: текстовое поле + кнопка «📷»
function scanField(key, label, kind, value) {
  const input = h('input', { type: 'text', value: value ?? '', autocomplete: 'off', autocapitalize: 'characters', style: { flex: 1, minWidth: 0 } });
  if (kind === 'mac') input.addEventListener('blur', () => { const m = normalizeMac(input.value); if (m) input.value = m; }); // 12 символов → AA:BB:…
  const btn = h('button', { type: 'button', class: 'sec', onclick: () => scanDevice({ kind, onPick: (v) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); } }) }, '📷');
  return { key, label, type: 'custom', build: () => ({ el: h('div', { style: { display: 'flex', gap: '8px' } }, input, btn), get: () => (input.value.trim() === '' ? undefined : input.value.trim()) }) };
}

// Выбор из имеющихся в проекте (шкафы, этажи) или «✏️ Новый…» — своё значение. empty — подпись пустого варианта
const sortRu = (a, b) => a.localeCompare(b, 'ru', { numeric: true });
const projectValues = (key) => [...new Set([...state.ctx.points.values()].map((p) => String(p[key] ?? '').trim()).filter(Boolean))].sort(sortRu);
function pickOrNewField(key, label, { empty = '—', hint = '' } = {}) {
  return { key, label, hint, type: 'custom', build: ({ value, changed }) => {
    const vals = projectValues(key); const cur = String(value ?? '').trim();
    if (cur && !vals.includes(cur)) vals.push(cur);
    const NEW = '__new';
    const sel = h('select', { style: { flex: 1, minWidth: 0 } }, h('option', { value: '' }, empty), ...vals.map((v) => h('option', { value: v }, v)), h('option', { value: NEW }, '✏️ Новый…'));
    const inp = h('input', { type: 'text', placeholder: `Новый: ${label.toLowerCase()}`, autocapitalize: 'characters', style: { flex: 1, minWidth: 0, display: 'none' }, oninput: () => changed() }); if (key === 'cabinet') attachShortcuts(inp);
    sel.value = cur; sel.onchange = () => { inp.style.display = sel.value === NEW ? '' : 'none'; if (sel.value === NEW) inp.focus(); changed(); };
    return { el: h('div', { style: { display: 'flex', gap: '8px' } }, sel, inp), get: () => { const v = sel.value === NEW ? inp.value.trim() : sel.value; return v === '' ? undefined : v; } };
  } };
}

export function pointForm(point, { onDone } = {}) {
  const repo = getRepo(); const pid = currentProject().id;
  const fields = [
    { key: 'label', label: 'Обозначение', required: true, latin: true, hint: 'Например: 1A-01-02' },
    { key: 'planName', label: 'Имя в плане заказчика (по тохниту)', latin: true },
    pickOrNewField('cabinet', 'Шкаф', { empty: point ? '— без шкафа —' : '— выберите шкаф —', hint: point ? '' : 'Новую точку нужно привязать к шкафу' }), pickOrNewField('floor', 'Этаж', { empty: '— без этажа —' }),
    { key: 'typeId', label: 'Тип', type: 'select', required: true, options: typeOptions(), emptyLabel: 'Выберите тип' },
    doorField('configId', 'Конфигурация двери', { visible: (v) => isDoorType(v.typeId), hint: 'Состав двери и её кабели. Закреплённые — в «Настройки → Конфигурации дверей».' }),
    compField(point),
    { ...cablesField(point), visible: (v) => !!v.typeId && !doorCfgSet(v) },
    { key: 'length', label: 'Длина (м на 1 кабель)', type: 'number' },
    { key: 'port', label: 'Порт в свитче' },
    { key: 'panelText', label: 'Порт в панели', hint: 'U панели и порт 1–24, например U38-05. Точке с двумя кабелями cat7 — два порта через запятую: U38-05, U38-06. Если шкаф из нескольких секций — с названием секции: CCTV1-B U38-05' },
    { ...scanField('serial', 'Серийный номер', 'serial', point?.serial), visible: (v) => hasIdType(v.typeId) },
    { ...scanField('mac', 'MAC', 'mac', point?.mac), visible: (v) => hasIdType(v.typeId) },
    { key: 'delayReasonId', label: 'Причина задержки', type: 'select', options: reasonOptions() },
    { key: 'note', label: 'Примечание', type: 'textarea' },
  ];
  formModal({
    title: point ? point.label : 'Новая точка', fields, values: point ? { ...point, panelText: panelText(point, currentProject()) } : { typeId: typeOptions()[0]?.value, configId: doorPins()[0] },
    extra: point ? [{ label: 'Удалить', kind: 'danger', onClick: async () => {
      if (!(await confirmDialog(`Удалить точку «${point.label}»? Её можно будет вернуть из истории.`, { yes: 'Удалить', danger: true }))) return false;
      repo.remove(pid, 'points', point.id); toast('Точка удалена'); onDone?.(); return true;
    } }] : [],
    onSubmit: async (v) => {
      const label = v.label;
      if (!point && !v.cabinet) { toast('Укажите шкаф — новая точка добавляется только с шкафом'); return false; }
      const dup = [...state.ctx.points.values()].find((p) => p.id !== point?.id && sameLabelClash(p, { label, cabinet: v.cabinet }));
      if (dup) { toast(v.cabinet ? 'Точка с таким обозначением уже есть в этом шкафу' : 'Точка с таким обозначением уже есть среди точек без шкафа'); return false; }
      const idOn = hasIdType(v.typeId);
      const mac = idOn && v.mac ? (normalizeMac(v.mac) || v.mac) : undefined; const serial = idOn ? v.serial : undefined;
      const pts = state.ctx.points.values();
      const dm = mac && findDuplicate(pts, point, 'mac', mac); const ds = serial && findDuplicate(state.ctx.points.values(), point, 'serial', serial);
      if (dm || ds) { toast(`${dm ? 'Такой MAC' : 'Такой серийный номер'} уже у точки ${(dm || ds).label}`); return false; }
      if (v.length !== undefined && !(v.length >= 0)) { toast('Длина должна быть числом'); return false; }
      const pp = parsePanelPorts(v.panelText);
      if (pp.errors.length) { toast(`Порт в панели: ${pp.errors[0]}`); return false; }
      const busy = panelOccupancy([...state.ctx.points.values()].filter((x) => x.id !== point?.id && (x.cabinet || '') === (v.cabinet || '')));
      const subs = subsOf(currentProject().racks?.[v.cabinet || ''], v.cabinet || '');
      const badSub = pp.list.find((x) => x.sub && !subs.some((q) => q.name.toLowerCase() === x.sub.toLowerCase()));
      if (badSub) { toast(`Порт в панели: у шкафа ${v.cabinet || '—'} нет секции «${badSub.sub}» (есть: ${subs.map((q) => q.name).join(', ')})`); return false; }
      const slots = pp.list.map(({ sub, ...x }) => { const sid = sub ? subs.find((q) => q.name.toLowerCase() === sub.toLowerCase()).id : ''; return sid ? { ...x, s: sid } : x; });
      const closed = blockedOf(currentProject().racks?.[v.cabinet || '']); const bx = slots.find((x) => closed.has(slotKey(x)));
      if (bx) { toast(`Порт ${fmtPanelPort(bx, subNameOf(currentProject(), v.cabinet || '', bx.s))} закрыт крестиком`); return false; }
      const taken = slots.map((x) => ({ x, by: busy.get(`${v.cabinet || ''}|${slotKey(x)}`)?.[0]?.point })).find((t) => t.by);
      if (taken) { toast(`Порт ${fmtPanelPort(taken.x, subNameOf(currentProject(), v.cabinet || '', taken.x.s))} в шкафу ${v.cabinet || '(без шкафа)'} уже занят точкой ${taken.by.label}`); return false; }
      let clearHave = false;
      if (point && label !== point.label && printedPortsOf(point, state.ctx).length) {
        if (!(await confirmDialog(`У «${point.label}» шилют уже напечатан или поклеен со старой подписью. После переименования его надо перепечатать. Снять отметку «есть шилют» и продолжить?`, { yes: 'Снять и сохранить' }))) return false;
        clearHave = true;
      }
      const oldPanel = panelOf(point);
      const panel = slots.map((x) => { const o = oldPanel.find((y) => slotKey(y) === slotKey(x)); return o?.label ? { ...x, label: o.label } : x; });
      repo.save(pid, [{ coll: 'points', id: point?.id, data: { panel, ...(clearHave ? { shHave: [] } : {}),
        label, planName: v.planName, cabinet: v.cabinet, floor: v.floor, typeId: v.typeId, length: v.length,
        configId: isDoorType(v.typeId) ? (ensureDoorCfg(v.configId) || null) : undefined, port: v.port, serial, mac, delayReasonId: v.delayReasonId, note: v.note,
        ...(doorCfgSet(v) ? { devices: null, cables: null, cableOverride: null } : { ...compData(v.typeId, v.comp), cableOverride: v.cableOverride ?? null }),
      } }]);
      const need = rackPortsOf({ ...(point || {}), typeId: v.typeId, cableOverride: v.cableOverride ?? null, ...compData(v.typeId, v.comp) }, state.ctx);
      toast(panel.length && panel.length !== need ? `Сохранено. Внимание: портов в панели ${panel.length}, а кабелей cat7 у точки ${need}` : point ? 'Сохранено' : 'Точка добавлена'); onDone?.();
    },
  });
}

export function generatorForm() {
  const repo = getRepo(); const pid = currentProject().id;
  const fields = [
    { key: 'prefix', label: 'Префикс', latin: true, hint: 'Например: 1A-' },
    { key: 'from', label: 'От', type: 'number', required: true }, { key: 'to', label: 'До', type: 'number', required: true },
    { key: 'step', label: 'Шаг', type: 'number' },
    { key: 'digits', label: 'Цифр в номере (ведущие нули, 0 = без)', type: 'number' },
    { key: 'suffixes', label: 'Суффиксы через запятую', hint: 'Например: A,B — на каждый номер будет по точке с каждым суффиксом' },
    { key: 'pair', label: 'Пара номеров (вид 01-02)', type: 'checkbox' },
    { key: 'typeId', label: 'Тип', type: 'select', required: true, options: typeOptions(), emptyLabel: 'Выберите тип' },
    doorField('configId', 'Конфигурация двери', { visible: (v) => isDoorType(v.typeId) }),
    compField(null),
    { ...cablesField(null), visible: (v) => !!v.typeId && !doorCfgSet(v) },
    pickOrNewField('cabinet', 'Шкаф', { empty: '— выберите шкаф —', hint: 'Точки добавляются только с шкафом' }), pickOrNewField('floor', 'Этаж', { empty: '— без этажа —' }),
  ];
  const labelsOf = (v) => generateLabels({ prefix: v.prefix ?? '', from: v.from, to: v.to, step: v.step ?? 1, digits: v.digits ?? 0, suffixes: parseSuffixes(v.suffixes), pair: !!v.pair });
  formModal({
    title: 'Добавить точки пачкой', fields, values: { step: 1, digits: 0, typeId: typeOptions()[0]?.value, configId: doorPins()[0] }, submitLabel: 'Создать',
    preview: (v) => {
      const l = labelsOf(v); if (!l.length) return 'Укажите «от» и «до»';
      const total = generatedTotal({ from: v.from, to: v.to, step: v.step ?? 1, suffixes: parseSuffixes(v.suffixes), pair: !!v.pair });
      return `Пример: ${l.slice(0, 4).join(', ')}${l.length > 4 ? ' …' : ''}\nВсего: ${l.length}${v.pair && !(v.step >= 2) ? '\nДля пары шаг — 2 (01-02, 03-04…), чтобы номера не повторялись' : ''}${total > MAX_GENERATED ? `\n⚠ За один раз создаётся не больше ${MAX_GENERATED} — остальные (${total - MAX_GENERATED}) не создадутся` : ''}`;
    },
    onSubmit: async (v) => {
      const labels = labelsOf(v);
      if (!labels.length) { toast('Нечего создавать: проверьте «от», «до» и шаг'); return false; }
      if (!v.cabinet) { toast('Укажите шкаф — точки добавляются только с шкафом'); return false; }
      const have = new Set([...state.ctx.points.values()].filter((p) => (p.cabinet || '') === v.cabinet).map((p) => p.label));   // дубль — только в том же шкафу
      const fresh = labels.filter((l) => !have.has(l));
      if (!fresh.length) { toast('Все такие точки уже есть в этом шкафу'); return false; }
      if (fresh.length > 100 && !(await confirmDialog(`Создать ${fresh.length} точек?`, { yes: 'Создать' }))) return false;
      repo.save(pid, fresh.map((label) => ({ coll: 'points', data: {
        label, cabinet: v.cabinet, floor: v.floor, typeId: v.typeId, configId: isDoorType(v.typeId) ? (ensureDoorCfg(v.configId) || undefined) : undefined,
        ...(doorCfgSet(v) ? {} : { ...compData(v.typeId, v.comp), ...(v.cableOverride ? { cableOverride: v.cableOverride } : {}) }),
      } })));
      toast(`Создано точек: ${fresh.length}${labels.length > fresh.length ? `, уже были: ${labels.length - fresh.length}` : ''}`);
    },
  });
}

// Ввод длины: «Сохранить и дальше» открывает следующую точку того же шкафа и типа
export function meterForm(startPoint) {
  const repo = getRepo(); const pid = currentProject().id;
  let point = startPoint;
  const nextOf = () => {
    const list = pointsSorted();
    const i = list.findIndex((p) => p.id === point.id);
    return list.slice(i + 1).find((p) => p.cabinet === point.cabinet && p.typeId === point.typeId);
  };
  // Одно окно на всю серию точек: поле ввода не пересоздаётся, поэтому клавиатура на телефоне не закрывается
  const titleEl = h('b', {});
  const labelEl = h('span', {});
  const input = h('input', { type: 'text', inputMode: 'decimal', autocomplete: 'off', autocapitalize: 'off', enterKeyHint: 'next' });
  const errBox = h('div', { class: 'err' });
  const okBtn = h('button', { type: 'submit', class: 'grow' });
  // не даём кнопке забрать фокус у поля ввода (иначе iOS убирает клавиатуру)
  okBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  okBtn.addEventListener('mousedown', (e) => e.preventDefault());
  const more = h('button', { type: 'button', class: 'sec', onclick: () => { const pt = point; close(); setTimeout(() => pointForm(pt), 60); } }, 'Подробнее…');
  const show = (pt) => {
    point = pt;
    titleEl.textContent = pt.label;
    labelEl.textContent = `Длина, м на 1 кабель${pt.planName ? ` · ${pt.planName}` : ''}`;
    input.value = pt.length ?? '';
    errBox.textContent = '';
    okBtn.textContent = nextOf() ? 'Сохранить и дальше' : 'Сохранить';
    input.focus(); input.select();
  };
  const form = h('form', { onsubmit: (e) => {
    e.preventDefault();
    const t = input.value.trim().replace(',', '.');
    const length = t === '' ? undefined : Number(t);
    if (length !== undefined && !(length >= 0)) { errBox.textContent = 'Длина должна быть числом'; return; }
    repo.save(pid, [{ coll: 'points', id: point.id, data: { length } }]);
    const nxt = nextOf();
    if (nxt) { show(state.ctx.points.get(nxt.id) || nxt); return; }
    toast('Это была последняя точка'); close();
  } }, h('label', { class: 'field' }, labelEl, input), errBox, h('div', { class: 'row' }, okBtn, more));
  const close = openModal('Метраж', form);
  const head = form.closest('.sheet')?.querySelector('.sheet-head b');
  if (head) head.replaceWith(titleEl);
  show(point);
}

// Значок, отмеченный на плане (✋/👆), — на самом деле уже существующая точка проекта: перенести ей место на чертеже, значок удалить
function bindToPoint(src, closeCard) {
  choosePoint({ title: `🔗 Чья это отметка «${src.label}»?`, typeId: src.typeId, exclude: src.id, onPick: async (p) => {
    const rows = state.data.journal.filter((r) => r.pointId === src.id && !r.deleted);
    const msg = `Место «${src.label}» на чертеже перейдёт точке «${p.label}», а «${src.label}» будет удалена${rows.length ? `; её записи работ (${rows.length}) перейдут к «${p.label}»` : ''}.${drawingFor(p) ? ` Сейчас «${p.label}» уже стоит на чертеже — её место заменится.` : ''}`;
    if (!(await confirmDialog(msg, { yes: 'Привязать' }))) return false;
    const repo = getRepo(); const pid = currentProject().id;
    repo.save(pid, [{ coll: 'points', id: p.id, data: { pos: { ...src.pos } } },
      ...rows.map((r) => ({ coll: 'journal', id: r.id, data: { pointId: p.id } }))]);
    repo.remove(pid, 'points', src.id);
    toast(`«${p.label}» — теперь на чертеже на месте «${src.label}»`); closeCard?.(); return true;
  } });
}

// Карточка точки: сведения, история работ (что, когда, кто) и действия
export function pointCard(startPoint, { fromPlan = false } = {}) {
  const proj = currentProject();
  let close = () => {};
  const body = h('div', {});
  const render = () => {
    const ctx = state.ctx;
    const p = ctx.points.get(startPoint.id);
    if (!p) { close(); return; }
    const info = infoOf(p);
    const cfg = ctx.configs.get(p.configId || proj.defaultConfigId);
    const hasLen = p.length !== undefined && p.length !== null && p.length !== '';
    const facts = [
      ['Шкаф / этаж', [p.cabinet && `шкаф ${p.cabinet}`, p.floor && `этаж ${p.floor}`].filter(Boolean).join(', ')],
      ['Тип', p.typeId], ['Конфигурация', (doorCfgOf(p, ctx) && doorChips(doorCfgOf(p, ctx))) || (usesConfig(ctx.types.get(p.typeId)) ? cfg?.name : '')], ['Состав', compText(p)], ['Имя в плане', p.planName], ['Кабели', `${info.cableList?.length ? cablesText(info.cableList) : info.cable || ''}${Array.isArray(p.cableOverride) ? ' (свои у точки)' : ''}`],
      ['Длина', hasLen ? `${p.length} м на 1 кабель${info.metrage ? ` (всего ${Math.round(info.metrage * 100) / 100} м)` : ''}` : ''],
      ['Порт в свитче', p.port], ['Порт в панели', panelText(p, proj)], ['Серийный номер', p.serial], ['MAC', p.mac], ['Причина задержки', p.delayReasonId], ['Примечание', p.note],
    ].filter(([, v]) => v);
    const left = leftTasksOf(p);
    const rows = (ctx.journalByPoint.get(p.id) || []).map((r) => ({ ...r, work: `${ctx.catalog.get(r.workId)?.name || r.action || '?'}${r.action === 'Протяжка' && r.cableId ? ` (${r.cableId})` : ''}` }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.order - a.order));
    body.replaceChildren(
      h('div', { style: { margin: '2px 0 10px' } }, h('span', { class: statusClass(info.status) }, info.status)),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: '14px' } },
        facts.flatMap(([k, v]) => [h('span', { class: 'mut' }, k), h('span', { style: { fontWeight: 600 } }, v instanceof Node ? v : String(v))])),
      h('div', { class: 'btns' },
        h('button', { onclick: () => { close(); setTimeout(() => addWorkForPoint(p.id), 60); } }, '➕ Добавить работу на эту точку')),
      h('div', { class: 'btns' },
        h('button', { class: 'sec', onclick: () => { close(); setTimeout(() => meterForm(p), 60); } }, '📏 Длина'),
        h('button', { class: 'sec', onclick: () => { close(); setTimeout(() => pointForm(p), 60); } }, '✏️ Изменить'),
        !fromPlan && p.pos && drawingFor(p) ? h('button', { class: 'sec', onclick: () => { close(); setTimeout(() => planModal({ point: p }), 60); } }, '📍 На чертеже') : null,
        !fromPlan && !(p.pos && drawingFor(p)) && drawingsOf().length ? h('button', { class: 'sec', onclick: () => { close(); setTimeout(() => planModal({ placeFor: p }), 60); } }, '📍 Отметить на плане') : null,
        fromPlan && p.pos && String(p.note || '').includes('значок без номера') ? h('button', { class: 'sec', onclick: () => bindToPoint(p, close) }, '🔗 Привязать к точке') : null,
        // значок типа на плане у точки, добавленной на объекте: показать / убрать
        fromPlan && p.pos && (p.pos.icon || String(p.note || '').includes('добавлено на плане')) ? h('button', { class: 'sec', onclick: () => {
          const ic = currentProject()?.typeIcons?.[p.typeId]; const on = !p.pos.icon;
          const pos = on ? { ...p.pos, icon: true, w: ic?.w || p.pos.w || 10, h: ic?.h || p.pos.h || 10 } : { ...p.pos, icon: false };
          getRepo().save(currentProject().id, [{ coll: 'points', id: p.id, data: { pos } }]);
          toast(on ? (ic ? 'Значок типа нарисован' : 'Значок у типа не задан — задайте в плане «📌 Значки типов»') : 'Значок убран'); close();
        } }, p.pos.icon ? '🖼 Убрать значок типа' : '🖼 Нарисовать значок типа') : null),
      // работы по точке: сверху — что ещё не сделано (цвет по этапу), ниже — сделанное зелёным (дата, кто, правка)
      h('div', { class: 'group', style: { padding: '12px 0 6px' } }, `Работы: осталось ${left.length} · сделано ${rows.length}`),
      left.length ? h('div', {}, left.map((t) => h('div', { class: `wk todo ${t.chip || ''}` }, h('b', {}, t.label), h('span', { class: 'wk-st' }, 'осталось')))) : h('div', { class: 'wk done' }, h('b', {}, '✅ Всё сделано')),
      ...rows.map((r) => {
        const who = whoIs(proj, r.by); const bad = r.result === 'Не работает';
        return h('div', { class: `wk ${bad ? 'bad' : 'done'}` }, h('b', {}, `${bad ? '✖' : '✔'} ${r.work}`),
          h('div', { class: 'wk-sub' }, [dateText(r.date), bad ? 'не работает' : '', r.fromEdit ? 'правка' : '', who].filter(Boolean).join(' · ')));
      }));
  };
  render();
  close = openModal(startPoint.label, body);
}

// «Что осталось»: все работы, которые ещё ждут точки проекта (по составу точки), с фильтрами по работе, шкафу, типу и протяжке.
// Галочками выбрать точки → «✅ Записать работу» (форма записи доха с выбранной работой и точками).
function leftTasksOf(point) {
  const ctx = state.ctx; const info = infoOf(point); const out = new Map();
  const add = (key, label, chip) => { if (!out.has(key)) out.set(key, { key, label, chip }); };
  if (info.composed) {
    info.tasks.filter((t) => !t.done).forEach((t) => {
      if (t.stage === 'Протяжка') add(`p:${t.cable}`, `Протяжка ${t.cable}`, 'pul');
      else { const w = ctx.catalog.get(t.workId); add(`w:${t.workId}`, w?.name || t.workId, { 'Хивут': 'hiv', 'Установка': 'ins', 'Проверка': 'chk' }[t.stage] || ''); }
    });
  } else {
    const type = ctx.types.get(point.typeId); const has = (st) => !type?.stages || type.stages.includes(st);
    if (has('Протяжка') && !info.pulled && !info.pullDone) add('s:Протяжка', 'Протяжка', 'pul');
    missingStages(point, ctx).forEach((m) => add(`s:${m}`, m, { 'Дотянуть': 'pul', 'Хивут': 'hiv', 'Установка': 'ins', 'Проверка': 'chk' }[m] || ''));
    if (has('Шилют') && !info.shilut && info.checked) add('s:Шилют', 'Шилют', '');
  }
  return [...out.values()];
}
function remainingModal() {
  const ctx = state.ctx;
  let fWork = ''; let fCab = ''; let fType = ''; let fPull = ''; let fCfg = ''; const chosen = new Set();
  const all = pointsSorted().map((point) => ({ point, left: leftTasksOf(point), info: infoOf(point) })).filter((r) => r.left.length);
  const body = h('div', {});
  let close = () => {};
  // варианты работ — с числом точек
  const counts = new Map(); all.forEach((r) => r.left.forEach((t) => { const c = counts.get(t.key) || { ...t, n: 0 }; c.n++; counts.set(t.key, c); }));
  const order = (k) => (k.startsWith('p:') || k === 's:Протяжка' || k === 's:Дотянуть' ? 0 : 1);
  const workOpts = [...counts.values()].sort((a, b) => order(a.key) - order(b.key) || a.label.localeCompare(b.label, 'ru'));
  const cabs = [...new Set(all.map((r) => r.point.cabinet || ''))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  const shown = () => all.filter((r) => (!fWork || r.left.some((t) => t.key === fWork)) && (!fCab || (fCab === '__none' ? !r.point.cabinet : r.point.cabinet === fCab))
    && typeMatch(fType, r.point.typeId) && cfgMatch(fCfg, r.point) && (!fPull || (fPull === 'yes' ? r.info.pulled : !r.info.pulled)));
  const sel = (first, opts, cur, set) => h('select', { onchange: (e) => { set(e.target.value); fill(); } }, h('option', { value: '' }, first), ...opts.map(([v, t]) => h('option', { value: v, selected: v === cur }, t)));
  const filters = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' } },
    sel('Все работы', workOpts.map((w) => [w.key, `${w.label} (${w.n})`]), fWork, (v) => { fWork = v; }),
    cabs.length > 1 ? sel('Все шкафы', cabs.map((c) => (c ? [c, `Шкаф ${c}`] : ['__none', 'Без шкафа'])), fCab, (v) => { fCab = v; }) : null,
    sel('Все типы', typeFilterOptions(all.map((r) => r.point.typeId)), fType, (v) => { fType = v; }),
    cfgFilterOptions(all.map((r) => r.point)).length ? sel('Все конфигурации', cfgFilterOptions(all.map((r) => r.point)), fCfg, (v) => { fCfg = v; }) : null,
    sel('Протяжка: все', [['yes', 'Только протянутые'], ['no', 'Ещё не протянутые']], fPull, (v) => { fPull = v; }));
  const bar = h('div', { class: 'btns', style: { marginTop: '6px' } });
  const listBox = h('div', {});
  function fill() {
    const rows = shown(); const ids = new Set(rows.map((r) => r.point.id));
    [...chosen].forEach((id) => { if (!ids.has(id)) chosen.delete(id); });
    const groups = new Map(); rows.forEach((r) => { const k = r.point.cabinet || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    const w = counts.get(fWork);
    bar.replaceChildren(h('b', { style: { alignSelf: 'center' } }, `Выбрано: ${chosen.size}`),
      h('button', { class: 'sec', onclick: () => { rows.forEach((r) => chosen.add(r.point.id)); fill(); } }, 'Все показанные'),
      h('button', { class: 'sec', onclick: () => { chosen.clear(); fill(); } }, 'Снять'),
      h('button', { disabled: !chosen.size || !w || w.key.startsWith('s:'), title: !w ? 'Сначала выберите работу в фильтре' : '', onclick: () => {
        const preset = w.key.startsWith('p:') ? { workType: 'Протяжка', cableId: w.key.slice(2), workId: [...ctx.catalog.values()].find((x) => x.workType === 'Протяжка' && x.active !== false)?.id }
          : { workId: w.key.slice(2), workType: ctx.catalog.get(w.key.slice(2))?.workType };
        const ids2 = rows.map((r) => r.point.id).filter((id) => chosen.has(id));
        close(); setTimeout(() => addWorkForPoints(ids2, preset), 60);
      } }, w && !w.key.startsWith('s:') ? `✅ Записать «${w.label}» (${chosen.size})` : '✅ Записать работу'));
    listBox.replaceChildren(h('div', { class: 'rem-total' }, rows.length ? h('span', {}, 'Точек: ', h('b', {}, rows.length), fWork ? ' — фильтр по работе' : '') : (all.length ? 'Ничего не найдено' : 'Всё сделано 🎉')),
      rows.length ? h('div', { class: 'rem-list' }, ...[...groups.entries()].flatMap(([cab, items]) => [
        h('div', { class: 'rem-group' }, h('span', {}, cab ? `Шкаф ${cab}` : 'Без шкафа'), h('span', { class: 'rem-count' }, items.length)),
        ...items.map(({ point, left }) => {
          const cb = h('input', { type: 'checkbox', checked: chosen.has(point.id), style: { width: '22px', height: '22px', flex: 'none' }, onclick: (e) => e.stopPropagation(), onchange: () => { cb.checked ? chosen.add(point.id) : chosen.delete(point.id); fill(); } });
          return h('div', { class: 'rem-row', onclick: () => { cb.checked = !cb.checked; cb.checked ? chosen.add(point.id) : chosen.delete(point.id); fill(); } }, cb,
            h('div', { class: 'rem-name' }, h('b', { onclick: (e) => { e.stopPropagation(); close(); setTimeout(() => pointCard(point), 60); }, style: { textDecoration: 'underline dotted' } }, point.label), h('span', {}, `${point.typeId}${point.planName ? ` · ${point.planName}` : ''}`)),
            h('div', { class: 'rem-chips' }, left.map((t) => h('span', { class: `chip ${t.chip}`, style: t.key === fWork ? { outline: '2px solid var(--txt)' } : {} }, t.label))));
        }),
      ])) : '');
  }
  body.replaceChildren(h('div', { class: 'mut', style: { marginBottom: '6px' } }, 'Выберите работу, шкаф или тип — галочками отметьте точки и запишите работу сразу на все. Нажатие на название — карточка точки.'), filters, bar, listBox);
  fill();
  close = openModal('Что осталось', body, { wide: true });
}

// Массовые действия: выбранные точки (живёт, пока открыто приложение)
let selMode = false; const selected = new Set();

// Групповое переименование: убрать/заменить часть названия, сдвинуть номер, добавить в начало/конец — с предпросмотром и проверкой повторов
export function renameForm(ids, done) {
  const pts = ids.map((id) => state.ctx.points.get(id)).filter(Boolean).sort(comparePoints);
  const others = [...state.ctx.points.values()].filter((p) => !ids.includes(p.id));
  // общее начало у всех выбранных — подсказка «убрать»
  let common = pts[0]?.label || ''; for (const p of pts) { while (common && !p.label.startsWith(common)) common = common.slice(0, -1); }
  const find = h('input', { placeholder: common ? `Что убрать, например: ${common}` : 'Что убрать или заменить' });
  const where = h('select', {}, h('option', { value: 'start' }, 'в начале'), h('option', { value: 'any' }, 'везде'), h('option', { value: 'end' }, 'в конце'));
  const repl = attachShortcuts(h('input', { placeholder: 'На что заменить (пусто — убрать)' }));
  const shift = h('input', { type: 'number', placeholder: '0', style: { width: '90px' } });
  const prefix = attachShortcuts(h('input', { placeholder: 'Добавить в начало' })); const suffix = attachShortcuts(h('input', { placeholder: 'Добавить в конец' }));
  const keep = h('input', { type: 'checkbox', checked: true });
  const prev = h('div', { class: 'card', style: { padding: 0, maxHeight: '40vh', overflow: 'auto' } }); const info = h('div', { style: { margin: '6px 0', fontWeight: 600 } });
  const go = h('button', {});
  let plan = [];
  const calc = () => {
    const op = { find: find.value, replace: repl.value, where: where.value, shift: shift.value, prefix: prefix.value, suffix: suffix.value };
    plan = pts.map((p) => ({ p, to: renameLabel(p.label, op).trim(), issue: renameIssue(p.label, op) }));
    // повтор — только в одном и том же шкафу (в разных шкафах и у точек без шкафа одинаковые названия можно)
    const cnt = new Map(); plan.forEach((x) => { const k = labelKey(x.to, x.p.cabinet); cnt.set(k, (cnt.get(k) || 0) + 1); });
    plan.forEach((x) => { x.bad = !x.to ? 'пустое название' : x.issue === 'negative' ? 'номер стал бы отрицательным' : others.some((o) => sameLabelClash(o, { label: x.to, cabinet: x.p.cabinet })) ? (x.p.cabinet ? 'уже есть в этом шкафу' : 'уже есть среди точек без шкафа') : cnt.get(labelKey(x.to, x.p.cabinet)) > 1 ? 'повтор' : ''; });
    const changed = plan.filter((x) => x.to !== x.p.label); const bad = plan.filter((x) => x.bad && x.to !== x.p.label);
    prev.replaceChildren(...plan.map((x) => h('div', { class: 'item', style: { cursor: 'default' } },
      h('div', { class: 'name' }, x.p.label, h('span', { class: 'mut' }, '  →  '), h('b', { style: { color: x.bad && x.to !== x.p.label ? '#ff453a' : x.to !== x.p.label ? '#30a14e' : '' } }, x.to || '—'),
        x.bad && x.to !== x.p.label ? h('div', { class: 'sub', style: { color: '#ff453a' } }, x.bad) : null))));
    const zeros = changed.filter((x) => x.issue === 'zero' && !x.bad);
    info.textContent = `Изменится: ${changed.length} из ${plan.length}${zeros.length ? ` · ⚠ номер 0 у ${zeros.length}` : ''}${bad.length ? ` · ошибок: ${bad.length} — исправьте, иначе сохранить нельзя` : ''}`;
    go.disabled = !changed.length || !!bad.length; go.textContent = `🏷 Переименовать (${changed.length})`;
  };
  [find, where, repl, shift, prefix, suffix].forEach((el) => el.addEventListener('input', calc));
  go.onclick = async () => {
    const changed = plan.filter((x) => x.to !== x.p.label);
    const zeros = changed.filter((x) => x.issue === 'zero');
    if (!(await confirmDialog(`Переименовать точек: ${changed.length}? История работ у точек останется.${zeros.length ? `\n\n⚠ У ${zeros.length} точек номер станет 0 (${zeros.slice(0, 3).map((x) => x.to).join(', ')}${zeros.length > 3 ? '…' : ''}).` : ''}`, { yes: 'Переименовать' }))) return;
    const printed = changed.filter((x) => printedPortsOf(x.p, state.ctx).length);
    if (printed.length && !(await confirmDialog(`У ${printed.length} точек (${printed.slice(0, 4).map((x) => x.p.label).join(', ')}${printed.length > 4 ? '…' : ''}) шилют уже напечатан или поклеен со старой подписью — его надо перепечатать. Снять у них отметку «есть шилют» и переименовать?`, { yes: 'Снять и переименовать' }))) return;
    const printedIds = new Set(printed.map((x) => x.p.id));
    getRepo().save(currentProject().id, changed.map((x) => ({ coll: 'points', id: x.p.id, data: { label: x.to, ...(printedIds.has(x.p.id) ? { shHave: [] } : {}), ...(keep.checked && !x.p.planName && x.p.pos ? { planName: x.p.label } : {}) } })));
    toast(`Переименовано: ${changed.length}`); c(); done?.();
  };
  const row = (label, ...els) => h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' } }, h('span', { style: { minWidth: '150px' } }, label), ...els);
  const c = openModal(`🏷 Переименовать точек: ${pts.length}`, h('div', {},
    h('div', { class: 'mut' }, 'Можно сразу несколько действий: сначала замена, потом сдвиг номера, потом добавление. Справа видно, что получится.'),
    row('Убрать / заменить', find, where), row('на', repl),
    row('Сдвинуть номер на', shift, h('small', { class: 'mut' }, 'например 2 или -1; пара «17-18» сдвигается целиком')),
    row('Добавить', prefix, suffix),
    h('label', { class: 'pickrow' }, keep, h('span', {}, 'У точек на чертеже запомнить старое название как «Имя в плане» (если оно ещё не задано)')),
    info, prev, h('div', { class: 'btns' }, go)), { sticky: true, wide: true });
  calc();
}

export function bulkEditForm(ids, done) {
  const repo = getRepo(); const pid = currentProject().id;
  formModal({
    title: `Изменить точек: ${ids.length}`, submitLabel: 'Применить',
    fields: [
      pickOrNewField('cabinet', 'Шкаф', { empty: 'Не менять' }), pickOrNewField('floor', 'Этаж', { empty: 'Не менять' }),
      { key: 'typeId', label: 'Тип', type: 'select', options: typeOptions(), emptyLabel: 'Не менять' },
      { key: 'setCables', label: 'Изменить кабели', type: 'checkbox', hint: 'Без галочки: при смене типа кабели станут как у нового типа, иначе не меняются.' },
      { key: 'cables', label: 'Кабели каждой точки', type: 'custom', visible: (v) => !!v.setCables, build: () => {
        const first = state.ctx.points.get(ids[0]); const p = cablesPicker({ typeId: first?.typeId || '', cabinet: first?.cabinet || '', compact: true });
        return { el: p.el, update: (v) => { if (v.typeId) p.setType(v.typeId); }, get: () => p.get() };
      } },
      { key: 'length', label: 'Длина (м на 1 кабель)', type: 'number', hint: 'Пусто — не менять' },
      { key: 'clearLength', label: 'Стереть длину', type: 'checkbox', visible: (v) => v.length === undefined },
      { key: 'delayReasonId', label: 'Причина задержки', type: 'select', options: [{ value: '__clear', label: '✖ Убрать причину' }, ...reasonOptions()], emptyLabel: 'Не менять' },
      doorField('configId', 'Конфигурация двери', { bulk: true, hint: 'Меняется только у дверей среди выбранных', visible: (v) => ids.some((id) => isDoorType(v.typeId || state.ctx.points.get(id)?.typeId)) }),
      { key: 'portFrom', label: 'Порт в свитче по порядку: начиная с', type: 'number', hint: 'Пусто — не менять. Номера идут по возрастанию номера точки' },
      { key: 'portStep', label: 'Шаг порта в свитче', type: 'number', visible: (v) => v.portFrom !== undefined },
      { key: 'clearPort', label: 'Стереть порт в свитче', type: 'checkbox', visible: (v) => v.portFrom === undefined },
      { key: 'noteAdd', label: 'Добавить к примечанию', type: 'textarea', hint: 'Допишется к примечанию каждой точки (старое не стирается)' },
    ],
    onSubmit: async (v) => {
      if (!v.cabinet && !v.floor && !v.typeId && !v.setCables && v.length === undefined && !v.clearLength && !v.delayReasonId && !v.noteAdd && !v.configId && v.portFrom === undefined && !v.clearPort) { toast('Ничего не выбрано для изменения'); return false; }
      if (v.cabinet) {   // в шкафу не должно появиться двух точек с одним обозначением
        const sel = ids.map((id) => state.ctx.points.get(id)).filter(Boolean); const seenL = new Set();
        const bad = sel.find((pt) => { if (seenL.has(pt.label)) return true; seenL.add(pt.label); return [...state.ctx.points.values()].some((x) => !ids.includes(x.id) && sameLabelClash(x, { label: pt.label, cabinet: v.cabinet })); });
        if (bad) { toast(`«${bad.label}» уже есть в шкафу ${v.cabinet} — перенести нельзя`); return false; }
      }
      let clearPanel = new Set();
      if (v.cabinet) {   // порты панели переезжают вместе с точкой: если в новом шкафу они заняты или закрыты крестиком — предупредить
        const sel = ids.map((id) => state.ctx.points.get(id)).filter((pt) => pt && panelOf(pt).length && (pt.cabinet || '') !== v.cabinet);
        if (sel.length) {
          const busy = panelOccupancy([...state.ctx.points.values()].filter((x) => !ids.includes(x.id) && (x.cabinet || '') === v.cabinet));
          const closed = blockedOf(currentProject().racks?.[v.cabinet]); const taken = new Set();
          const bad = sel.filter((pt) => {
            const hit = panelOf(pt).some((x) => busy.has(`${v.cabinet}|${slotKey(x)}`) || closed.has(slotKey(x)) || taken.has(slotKey(x)));
            panelOf(pt).forEach((x) => taken.add(slotKey(x))); return hit;
          });
          if (bad.length) {
            const ok = await confirmDialog(`В шкафу ${v.cabinet} порты панели уже заняты или закрыты у ${bad.length} точек (${bad.slice(0, 3).map((x) => x.label).join(', ')}${bad.length > 3 ? '…' : ''}). Перенести их без портов панели (порты придётся назначить заново)?`, { yes: 'Перенести без портов' });
            if (!ok) return false;
            clearPanel = new Set(bad.map((x) => x.id));
          }
        }
      }
      const portOf = new Map();
      if (v.portFrom !== undefined) {
        const step = v.portStep === undefined || !(v.portStep > 0) ? 1 : v.portStep;
        ids.map((id) => state.ctx.points.get(id)).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }))
          .forEach((pt, i) => portOf.set(pt.id, String(v.portFrom + i * step)));
      }
      if (v.length !== undefined && !(v.length >= 0)) { toast('Длина — число метров'); return false; }
      const ops = ids.map((id) => {
        const data = {};
        if (v.cabinet) data.cabinet = v.cabinet;
        if (clearPanel.has(id)) data.panel = [];
        if (v.floor) data.floor = v.floor;
        if (v.typeId) { data.typeId = v.typeId; data.devices = null; data.cables = null; data.cableOverride = null; if (!isDoorType(v.typeId)) data.configId = undefined; }
        const pt = state.ctx.points.get(id);
        if (v.length !== undefined) data.length = v.length; else if (v.clearLength) data.length = null;
        if (v.delayReasonId) data.delayReasonId = v.delayReasonId === '__clear' ? null : v.delayReasonId;
        if (portOf.has(id)) data.port = portOf.get(id); else if (v.clearPort) data.port = null;
        if (v.configId && isDoorType(data.typeId || pt?.typeId)) { data.configId = v.configId === '__clear' ? null : ensureDoorCfg(v.configId); if (isDoorCfg(state.ctx.configs.get(data.configId) || allDoorCfgs().get(data.configId))) { data.devices = null; data.cables = null; data.cableOverride = null; } }
        if (v.noteAdd) data.note = [String(pt?.note || '').trim(), v.noteAdd].filter(Boolean).join('\n');
        if (v.setCables) { const p = state.ctx.points.get(id); data.cableOverride = cableOverrideFor(v.cables, state.ctx, data.typeId || p?.typeId, data.cabinet || p?.cabinet, pid); }
        return { coll: 'points', id, data };
      });
      repo.save(pid, ops); toast(`Изменено точек: ${ids.length}`); done();
    },
  });
}

let searchText = ''; let fCab = ''; let fType = ''; let fPlan = ''; let fCfg = '';
const planOk = (p) => !fPlan || (fPlan === 'off' ? !drawingFor(p) : !!drawingFor(p));  // «Нет на плане» / «На плане»
export function meterView(ui) {
  const list = h('div', { class: 'card', style: { padding: 0 } });
  const total = pointsSorted();
  const withLen = total.filter((p) => p.length !== undefined && p.length !== null && p.length !== '').length;
  const bar = h('div', { class: 'card selbar', style: { position: 'sticky', top: '53px', zIndex: 6, margin: '8px 0 0' } });
  const shown = () => pointsSorted().filter((p) => { const q = searchText.trim().toLowerCase(); const qk = latinKey(q);
    return (!q || latinKey(`${p.label} ${p.planName ?? ''} ${panelText(p)}`).includes(qk) || matchesPanelQuery(p, q)) && (!fCab || (fCab === '__none' ? !p.cabinet : p.cabinet === fCab)) && typeMatch(fType, p.typeId) && cfgMatch(fCfg, p) && planOk(p); });
  function updateBar() {
    for (const id of [...selected]) if (!state.ctx.points.has(id)) selected.delete(id);
    bar.style.display = selMode ? '' : 'none';
    const ids = [...selected];
    bar.replaceChildren(h('b', {}, `Выбрано: ${ids.length}`),
      h('div', { class: 'btns', style: { marginTop: '8px' } },
        h('button', { class: 'sec', onclick: () => { shown().forEach((p) => selected.add(p.id)); fill(); } }, 'Все в списке'),
        h('button', { class: 'sec', onclick: () => { selected.clear(); fill(); } }, 'Снять')),
      h('div', { class: 'btns' },
        h('button', { disabled: !ids.length, onclick: () => bulkEditForm(ids, () => { selected.clear(); selMode = false; ui.render(); }) }, '✏️ Изменить'),
        h('button', { disabled: !ids.length, onclick: () => renameForm(ids, () => { selected.clear(); selMode = false; ui.render(); }) }, '🏷 Переименовать'),
        h('button', { class: 'danger', disabled: !ids.length, onclick: async () => {
          if (!(await confirmDialog(`Удалить точек: ${ids.length}? Их можно будет вернуть из истории.`, { yes: 'Удалить', danger: true }))) return;
          const repo = getRepo(); const pid = currentProject().id;
          ids.forEach((id) => repo.remove(pid, 'points', id)); toast(`Удалено точек: ${ids.length}`); selected.clear(); selMode = false; ui.render();
        } }, '🗑 Удалить')),
      h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => { selMode = false; selected.clear(); ui.render(); } }, 'Готово')));
  }
  function fill() {
    updateBar();
    const q = searchText.trim().toLowerCase(); const qk = latinKey(q);
    const pts = pointsSorted().filter((p) => (!q || latinKey(`${p.label} ${p.planName ?? ''} ${panelText(p)}`).includes(qk) || matchesPanelQuery(p, q))
      && (!fCab || (fCab === '__none' ? !p.cabinet : p.cabinet === fCab)) && typeMatch(fType, p.typeId) && cfgMatch(fCfg, p) && planOk(p));
    list.replaceChildren();
    if (!pts.length) { list.append(total.length ? h('div', { class: 'empty' }, 'Ничего не найдено') : hint(ui, 'Точек пока нет. Добавьте их пачкой («Точки пачкой») или по одной. Нажмите точку: откроется её карточка с историей работ, там же кнопка «📏 Длина».', 'meter', '📖 Как вносить метраж')); return; }
    let lastKey = null;
    pts.forEach((p) => {
      const key = `${p.cabinet || ''}\u0000${p.typeId}`;
      if (key !== lastKey) { list.append(h('div', { class: 'group', style: { padding: '10px 12px 6px' } }, `${p.cabinet ? `Шкаф ${p.cabinet}` : 'Без шкафа'} · ${p.typeId}`)); lastKey = key; }
      const info = infoOf(p);
      const cb = selMode ? h('input', { type: 'checkbox', checked: selected.has(p.id), style: { width: '22px', height: '22px', flex: 'none' } }) : null;
      list.append(h('div', { class: 'item', onclick: () => {
        if (!selMode) { pointCard(p); return; }
        if (selected.has(p.id)) selected.delete(p.id); else selected.add(p.id);
        cb.checked = selected.has(p.id); updateBar();
      } }, cb,
        h('div', { class: 'name' }, p.label, doorCfgOf(p, state.ctx) ? doorShortChip(doorCfgOf(p, state.ctx)) : null, p.planName ? h('div', { class: 'sub' }, p.planName) : null),
        h('div', { class: 'len' }, p.length !== undefined && p.length !== null && p.length !== '' ? `${p.length} м` : '—'),
        h('span', { class: statusClass(info.status) }, info.status)));
    });
  }
  const search = h('input', { type: 'search', placeholder: 'Поиск по обозначению', value: searchText, oninput: (e) => { searchText = e.target.value; fill(); } });
  const cabs = [...new Set(total.map((p) => p.cabinet || ''))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  const types = [...new Set(total.map((p) => p.typeId))].sort((a, b) => String(a).localeCompare(String(b), 'ru'));
  if (!cabs.includes(fCab) && fCab !== '__none') fCab = '';
  if (!typeFilterValid(fType, types)) fType = '';
  if (!cfgFilterValid(fCfg, total)) fCfg = '';
  const sel = (all, opts, cur, set) => h('select', { onchange: (e) => { set(e.target.value); fill(); } },
    h('option', { value: '' }, all), ...opts.map(([v, t]) => h('option', { value: v, selected: v === cur }, t)));
  const filters = h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } },
    sel('Все шкафы', cabs.map((c) => (c ? [c, `Шкаф ${c}`] : ['__none', 'Без шкафа'])), fCab, (v) => { fCab = v; }),
    sel('Все типы', typeFilterOptions(types), fType, (v) => { fType = v; }),
    cfgFilterOptions(total).length ? sel('Все конфигурации', cfgFilterOptions(total), fCfg, (v) => { fCfg = v; }) : null,
    sel('План: все', [['off', '📍 Нет на плане'], ['on', '🗺 На плане']], fPlan, (v) => { fPlan = v; }));
  fill();
  return h('div', {},
    h('div', { class: 'btns', style: { marginTop: 0 } },
      h('button', { onclick: () => generatorForm() }, '➕ Точки пачкой'),
      h('button', { class: 'sec', onclick: () => pointForm(null) }, 'Новая точка'),
      h('button', { class: 'sec', onclick: () => pointsFromFile() }, '📥 Из файла'),
      h('button', { class: 'sec', onclick: () => drawingsHub() }, '📐 Из чертежа'),
      h('button', { class: 'sec', onclick: () => planModal() }, '🗺 План'),
      h('button', { class: 'wide sec', onclick: () => remainingModal() }, '🧾 Что осталось'),
      total.some((p) => p.typeId === UNSORTED_TYPE) ? h('button', { class: 'wide', onclick: () => unsortedModal(ui) }, `❓ Не разобрано: ${total.filter((p) => p.typeId === UNSORTED_TYPE).length} — разобрать`) : null),
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 2px' } },
      h('span', { class: 'mut' }, `Точек: ${total.length} · с длиной: ${withLen}`),
      selMode ? null : h('button', { class: 'sec', style: { padding: '6px 12px' }, onclick: () => { selMode = true; ui.render(); } }, '☑ Выбрать')),
    search, filters, bar, h('div', { style: { height: '10px' } }), list);
}
