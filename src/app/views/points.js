// Точки: форма точки, генератор пачкой, карточка точки с историей, вкладка «Точки».
import { h, formModal, openModal, confirmDialog, toast, qtyList } from '../ui.js';
import { state, getRepo, pointsSorted, infoOf, currentProject } from '../store.js';
import { generateLabels, parseSuffixes, comparePoints, renameLabel, inheritedFromCables, usesConfig, missingStages, hasDeviceId, normalizeMac, findDuplicate } from '../../domain/index.js';
import { scanDevice } from '../scan.js';
import { statusClass } from './project.js';
import { hint } from './guide.js';
import { dateText, cablesText, missingDetails, isComposedType, isSystemType, UNSORTED_TYPE, cableOverrideFor } from '../../domain/index.js';
import { addWorkForPoint, addWorkForPoints } from './doh.js';
import { whoIs } from './journal.js';
import { pointsFromFile } from './pointsfile.js';
import { drawingsHub, unsortedModal } from './tohnitview.js';
import { cablesField, cablesPicker } from './cablespick.js';
import { drawingFor, drawingsOf } from '../drawings.js';
import { typeMatch, typeFilterOptions, typeFilterValid } from '../typegroups.js';
import { planModal } from './planmodal.js';
import { choosePoint } from './pointchooser.js';

const typeOptions = () => [...state.ctx.types.values()].filter((t) => !isSystemType(t)).map((t) => ({ value: t.id, label: t.id }));
const hasIdType = (id) => hasDeviceId(state.ctx.types.get(id));
const isDoorType = (id) => usesConfig(state.ctx.types.get(id));
const configOptions = () => [...state.ctx.configs.values()].map((c) => ({ value: c.id, label: c.name }));
const reasonOptions = () => [...state.ctx.delayReasons.values()].map((r) => ({ value: r.id, label: r.id }));

// ---- состав точки (тип из устройств): галочки устройств с количеством + кабели самой точки ----
const typeOf = (id) => state.ctx.types.get(id);
const composedType = (id) => isComposedType(typeOf(id));
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
    key: 'comp', label: 'Состав точки', type: 'custom', visible: (v) => composedType(v.typeId),
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
  const ctx = state.ctx; const t = typeOf(p.typeId); if (!isComposedType(t)) return '';
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
    const inp = h('input', { type: 'text', placeholder: `Новый: ${label.toLowerCase()}`, autocapitalize: 'characters', style: { flex: 1, minWidth: 0, display: 'none' }, oninput: () => changed() });
    sel.value = cur; sel.onchange = () => { inp.style.display = sel.value === NEW ? '' : 'none'; if (sel.value === NEW) inp.focus(); changed(); };
    return { el: h('div', { style: { display: 'flex', gap: '8px' } }, sel, inp), get: () => { const v = sel.value === NEW ? inp.value.trim() : sel.value; return v === '' ? undefined : v; } };
  } };
}

export function pointForm(point, { onDone } = {}) {
  const repo = getRepo(); const pid = currentProject().id;
  const fields = [
    { key: 'label', label: 'Обозначение', required: true, hint: 'Например: 1A-01-02' },
    { key: 'planName', label: 'Имя в плане заказчика (по тохниту)' },
    pickOrNewField('cabinet', 'Шкаф', { empty: '— без шкафа —' }), pickOrNewField('floor', 'Этаж', { empty: '— без этажа —' }),
    { key: 'typeId', label: 'Тип', type: 'select', required: true, options: typeOptions(), emptyLabel: 'Выберите тип' },
    compField(point),
    cablesField(point),
    { key: 'length', label: 'Длина (м на 1 кабель)', type: 'number' },
    { key: 'configId', label: 'Конфигурация двери (если отличается от проекта)', type: 'select', options: configOptions(), visible: (v) => isDoorType(v.typeId) && !composedType(v.typeId) },
    { key: 'port', label: 'Порт' },
    { ...scanField('serial', 'Серийный номер', 'serial', point?.serial), visible: (v) => hasIdType(v.typeId) },
    { ...scanField('mac', 'MAC', 'mac', point?.mac), visible: (v) => hasIdType(v.typeId) },
    { key: 'delayReasonId', label: 'Причина задержки', type: 'select', options: reasonOptions() },
    { key: 'note', label: 'Примечание', type: 'textarea' },
  ];
  formModal({
    title: point ? point.label : 'Новая точка', fields, values: point || { typeId: typeOptions()[0]?.value },
    extra: point ? [{ label: 'Удалить', kind: 'danger', onClick: async () => {
      if (!(await confirmDialog(`Удалить точку «${point.label}»? Её можно будет вернуть из истории.`, { yes: 'Удалить', danger: true }))) return false;
      repo.remove(pid, 'points', point.id); toast('Точка удалена'); onDone?.(); return true;
    } }] : [],
    onSubmit: (v) => {
      const label = v.label;
      const dup = [...state.ctx.points.values()].find((p) => p.label === label && p.id !== point?.id);
      if (dup) { toast('Точка с таким обозначением уже есть'); return false; }
      const idOn = hasIdType(v.typeId);
      const mac = idOn && v.mac ? (normalizeMac(v.mac) || v.mac) : undefined; const serial = idOn ? v.serial : undefined;
      const pts = state.ctx.points.values();
      const dm = mac && findDuplicate(pts, point, 'mac', mac); const ds = serial && findDuplicate(state.ctx.points.values(), point, 'serial', serial);
      if (dm || ds) { toast(`${dm ? 'Такой MAC' : 'Такой серийный номер'} уже у точки ${(dm || ds).label}`); return false; }
      if (v.length !== undefined && !(v.length >= 0)) { toast('Длина должна быть числом'); return false; }
      repo.save(pid, [{ coll: 'points', id: point?.id, data: {
        label, planName: v.planName, cabinet: v.cabinet, floor: v.floor, typeId: v.typeId, length: v.length,
        configId: isDoorType(v.typeId) ? v.configId : undefined, port: v.port, serial, mac, delayReasonId: v.delayReasonId, note: v.note,
        ...compData(v.typeId, v.comp), cableOverride: v.cableOverride ?? null,
      } }]);
      toast(point ? 'Сохранено' : 'Точка добавлена'); onDone?.();
    },
  });
}

export function generatorForm() {
  const repo = getRepo(); const pid = currentProject().id;
  const fields = [
    { key: 'prefix', label: 'Префикс', hint: 'Например: 1A-' },
    { key: 'from', label: 'От', type: 'number', required: true }, { key: 'to', label: 'До', type: 'number', required: true },
    { key: 'step', label: 'Шаг', type: 'number' },
    { key: 'digits', label: 'Цифр в номере (ведущие нули, 0 = без)', type: 'number' },
    { key: 'suffixes', label: 'Суффиксы через запятую', hint: 'Например: A,B — на каждый номер будет по точке с каждым суффиксом' },
    { key: 'pair', label: 'Пара номеров (вид 01-02)', type: 'checkbox' },
    { key: 'typeId', label: 'Тип', type: 'select', required: true, options: typeOptions(), emptyLabel: 'Выберите тип' },
    compField(null),
    cablesField(null),
    pickOrNewField('cabinet', 'Шкаф', { empty: '— без шкафа —' }), pickOrNewField('floor', 'Этаж', { empty: '— без этажа —' }),
    { key: 'configId', label: 'Конфигурация двери', type: 'select', options: configOptions(), visible: (v) => isDoorType(v.typeId) && !composedType(v.typeId) },
  ];
  const labelsOf = (v) => generateLabels({ prefix: v.prefix ?? '', from: v.from, to: v.to, step: v.step ?? 1, digits: v.digits ?? 0, suffixes: parseSuffixes(v.suffixes), pair: !!v.pair });
  formModal({
    title: 'Добавить точки пачкой', fields, values: { step: 1, digits: 0, typeId: typeOptions()[0]?.value }, submitLabel: 'Создать',
    preview: (v) => { const l = labelsOf(v); return l.length ? `Пример: ${l.slice(0, 4).join(', ')}${l.length > 4 ? ' …' : ''}\nВсего: ${l.length}` : 'Укажите «от» и «до»'; },
    onSubmit: async (v) => {
      const labels = labelsOf(v);
      if (!labels.length) { toast('Нечего создавать: проверьте «от», «до» и шаг'); return false; }
      const have = new Set([...state.ctx.points.values()].map((p) => p.label));
      const fresh = labels.filter((l) => !have.has(l));
      if (!fresh.length) { toast('Все такие точки уже есть'); return false; }
      if (fresh.length > 100 && !(await confirmDialog(`Создать ${fresh.length} точек?`, { yes: 'Создать' }))) return false;
      repo.save(pid, fresh.map((label) => ({ coll: 'points', data: {
        label, cabinet: v.cabinet, floor: v.floor, typeId: v.typeId, configId: isDoorType(v.typeId) ? v.configId : undefined,
        ...compData(v.typeId, v.comp), ...(v.cableOverride ? { cableOverride: v.cableOverride } : {}),
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
      ['Тип', p.typeId], ['Состав', compText(p)], ['Имя в плане', p.planName], ['Кабели', `${info.cableList?.length ? cablesText(info.cableList) : info.cable || ''}${Array.isArray(p.cableOverride) ? ' (свои у точки)' : ''}`],
      ['Длина', hasLen ? `${p.length} м на 1 кабель${info.metrage ? ` (всего ${Math.round(info.metrage * 100) / 100} м)` : ''}` : ''],
      ['Конфигурация', usesConfig(ctx.types.get(p.typeId)) ? cfg?.name : ''], ['Порт', p.port], ['Серийный номер', p.serial], ['MAC', p.mac], ['Причина задержки', p.delayReasonId], ['Примечание', p.note],
    ].filter(([, v]) => v);
    const rows = (ctx.journalByPoint.get(p.id) || []).map((r) => ({ ...r, work: `${ctx.catalog.get(r.workId)?.name || r.action || '?'}${r.action === 'Протяжка' && r.cableId ? ` (${r.cableId})` : ''}` }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.order - a.order));
    body.replaceChildren(
      h('div', { style: { margin: '2px 0 10px' } }, h('span', { class: statusClass(info.status) }, info.status)),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: '14px' } },
        facts.flatMap(([k, v]) => [h('span', { class: 'mut' }, k), h('span', { style: { fontWeight: 600 } }, String(v))])),
      info.composed ? (() => { // что осталось по устройствам
        const miss = missingDetails(info, ctx);
        return h('div', { style: { marginTop: '10px', fontSize: '14px' } },
          h('div', { class: 'group', style: { padding: '4px 0' } }, miss.length ? 'Осталось сделать' : 'Всё сделано ✅'),
          miss.map((m) => h('div', {}, h('span', { class: 'mut' }, `${m.stage}: `), m.items.join(', '))));
      })() : null,
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
      h('div', { class: 'group', style: { padding: '12px 0 6px' } }, `История работ (${rows.length})`),
      rows.length ? h('div', {}, rows.map((r) => {
        const who = whoIs(proj, r.by);
        return h('div', { class: 'item', style: { cursor: 'default' } },
          h('div', { class: 'name' }, r.work,
            h('div', { class: 'sub' }, `${dateText(r.date)}${r.result === 'Не работает' ? ' · не работает' : ''}${r.fromEdit ? ' · правка' : ''}${who ? ` · ${who}` : ''}`)));
      })) : h('div', { class: 'empty' }, 'По этой точке работ пока не отмечено'));
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
  let fWork = ''; let fCab = ''; let fType = ''; let fPull = ''; const chosen = new Set();
  const all = pointsSorted().map((point) => ({ point, left: leftTasksOf(point), info: infoOf(point) })).filter((r) => r.left.length);
  const body = h('div', {});
  let close = () => {};
  // варианты работ — с числом точек
  const counts = new Map(); all.forEach((r) => r.left.forEach((t) => { const c = counts.get(t.key) || { ...t, n: 0 }; c.n++; counts.set(t.key, c); }));
  const order = (k) => (k.startsWith('p:') || k === 's:Протяжка' || k === 's:Дотянуть' ? 0 : 1);
  const workOpts = [...counts.values()].sort((a, b) => order(a.key) - order(b.key) || a.label.localeCompare(b.label, 'ru'));
  const cabs = [...new Set(all.map((r) => r.point.cabinet || ''))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  const shown = () => all.filter((r) => (!fWork || r.left.some((t) => t.key === fWork)) && (!fCab || (fCab === '__none' ? !r.point.cabinet : r.point.cabinet === fCab))
    && typeMatch(fType, r.point.typeId) && (!fPull || (fPull === 'yes' ? r.info.pulled : !r.info.pulled)));
  const sel = (first, opts, cur, set) => h('select', { onchange: (e) => { set(e.target.value); fill(); } }, h('option', { value: '' }, first), ...opts.map(([v, t]) => h('option', { value: v, selected: v === cur }, t)));
  const filters = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' } },
    sel('Все работы', workOpts.map((w) => [w.key, `${w.label} (${w.n})`]), fWork, (v) => { fWork = v; }),
    cabs.length > 1 ? sel('Все шкафы', cabs.map((c) => (c ? [c, `Шкаф ${c}`] : ['__none', 'Без шкафа'])), fCab, (v) => { fCab = v; }) : null,
    sel('Все типы', typeFilterOptions(all.map((r) => r.point.typeId)), fType, (v) => { fType = v; }),
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
function renameForm(ids, done) {
  const pts = ids.map((id) => state.ctx.points.get(id)).filter(Boolean).sort(comparePoints);
  const others = new Set([...state.ctx.points.values()].filter((p) => !ids.includes(p.id)).map((p) => p.label));
  // общее начало у всех выбранных — подсказка «убрать»
  let common = pts[0]?.label || ''; for (const p of pts) { while (common && !p.label.startsWith(common)) common = common.slice(0, -1); }
  const find = h('input', { placeholder: common ? `Что убрать, например: ${common}` : 'Что убрать или заменить' });
  const where = h('select', {}, h('option', { value: 'start' }, 'в начале'), h('option', { value: 'any' }, 'везде'), h('option', { value: 'end' }, 'в конце'));
  const repl = h('input', { placeholder: 'На что заменить (пусто — убрать)' });
  const shift = h('input', { type: 'number', placeholder: '0', style: { width: '90px' } });
  const prefix = h('input', { placeholder: 'Добавить в начало' }); const suffix = h('input', { placeholder: 'Добавить в конец' });
  const keep = h('input', { type: 'checkbox', checked: true });
  const prev = h('div', { class: 'card', style: { padding: 0, maxHeight: '40vh', overflow: 'auto' } }); const info = h('div', { style: { margin: '6px 0', fontWeight: 600 } });
  const go = h('button', {});
  let plan = [];
  const calc = () => {
    const op = { find: find.value, replace: repl.value, where: where.value, shift: shift.value, prefix: prefix.value, suffix: suffix.value };
    plan = pts.map((p) => ({ p, to: renameLabel(p.label, op).trim() }));
    const cnt = new Map(); plan.forEach((x) => cnt.set(x.to, (cnt.get(x.to) || 0) + 1));
    plan.forEach((x) => { x.bad = !x.to ? 'пустое название' : others.has(x.to) ? 'уже есть в проекте' : cnt.get(x.to) > 1 ? 'повтор' : ''; });
    const changed = plan.filter((x) => x.to !== x.p.label); const bad = plan.filter((x) => x.bad && x.to !== x.p.label);
    prev.replaceChildren(...plan.map((x) => h('div', { class: 'item', style: { cursor: 'default' } },
      h('div', { class: 'name' }, x.p.label, h('span', { class: 'mut' }, '  →  '), h('b', { style: { color: x.bad && x.to !== x.p.label ? '#ff453a' : x.to !== x.p.label ? '#30a14e' : '' } }, x.to || '—'),
        x.bad && x.to !== x.p.label ? h('div', { class: 'sub', style: { color: '#ff453a' } }, x.bad) : null))));
    info.textContent = `Изменится: ${changed.length} из ${plan.length}${bad.length ? ` · ошибок: ${bad.length} — исправьте, иначе сохранить нельзя` : ''}`;
    go.disabled = !changed.length || !!bad.length; go.textContent = `🏷 Переименовать (${changed.length})`;
  };
  [find, where, repl, shift, prefix, suffix].forEach((el) => el.addEventListener('input', calc));
  go.onclick = async () => {
    const changed = plan.filter((x) => x.to !== x.p.label);
    if (!(await confirmDialog(`Переименовать точек: ${changed.length}? История работ у точек останется.`, { yes: 'Переименовать' }))) return;
    getRepo().save(currentProject().id, changed.map((x) => ({ coll: 'points', id: x.p.id, data: { label: x.to, ...(keep.checked && !x.p.planName && x.p.pos ? { planName: x.p.label } : {}) } })));
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

function bulkEditForm(ids, done) {
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
      { key: 'noteAdd', label: 'Добавить к примечанию', type: 'textarea', hint: 'Допишется к примечанию каждой точки (старое не стирается)' },
    ],
    onSubmit: (v) => {
      if (!v.cabinet && !v.floor && !v.typeId && !v.setCables && v.length === undefined && !v.clearLength && !v.delayReasonId && !v.noteAdd) { toast('Ничего не выбрано для изменения'); return false; }
      if (v.length !== undefined && !(v.length >= 0)) { toast('Длина — число метров'); return false; }
      const ops = ids.map((id) => {
        const data = {};
        if (v.cabinet) data.cabinet = v.cabinet;
        if (v.floor) data.floor = v.floor;
        if (v.typeId) { data.typeId = v.typeId; data.devices = null; data.cables = null; data.cableOverride = null; if (!isDoorType(v.typeId)) data.configId = undefined; }
        const pt = state.ctx.points.get(id);
        if (v.length !== undefined) data.length = v.length; else if (v.clearLength) data.length = null;
        if (v.delayReasonId) data.delayReasonId = v.delayReasonId === '__clear' ? null : v.delayReasonId;
        if (v.noteAdd) data.note = [String(pt?.note || '').trim(), v.noteAdd].filter(Boolean).join('\n');
        if (v.setCables) { const p = state.ctx.points.get(id); data.cableOverride = cableOverrideFor(v.cables, state.ctx, data.typeId || p?.typeId, data.cabinet || p?.cabinet, pid); }
        return { coll: 'points', id, data };
      });
      repo.save(pid, ops); toast(`Изменено точек: ${ids.length}`); done();
    },
  });
}

let searchText = ''; let fCab = ''; let fType = ''; let fPlan = '';
const planOk = (p) => !fPlan || (fPlan === 'off' ? !drawingFor(p) : !!drawingFor(p));  // «Нет на плане» / «На плане»
export function meterView(ui) {
  const list = h('div', { class: 'card', style: { padding: 0 } });
  const total = pointsSorted();
  const withLen = total.filter((p) => p.length !== undefined && p.length !== null && p.length !== '').length;
  const bar = h('div', { class: 'card selbar', style: { position: 'sticky', top: '53px', zIndex: 6, margin: '8px 0 0' } });
  const shown = () => pointsSorted().filter((p) => { const q = searchText.trim().toLowerCase();
    return (!q || `${p.label} ${p.planName ?? ''}`.toLowerCase().includes(q)) && (!fCab || (fCab === '__none' ? !p.cabinet : p.cabinet === fCab)) && typeMatch(fType, p.typeId) && planOk(p); });
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
    const q = searchText.trim().toLowerCase();
    const pts = pointsSorted().filter((p) => (!q || `${p.label} ${p.planName ?? ''}`.toLowerCase().includes(q))
      && (!fCab || (fCab === '__none' ? !p.cabinet : p.cabinet === fCab)) && typeMatch(fType, p.typeId) && planOk(p));
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
        h('div', { class: 'name' }, p.label, p.planName ? h('div', { class: 'sub' }, p.planName) : null),
        h('div', { class: 'len' }, p.length !== undefined && p.length !== null && p.length !== '' ? `${p.length} м` : '—'),
        h('span', { class: statusClass(info.status) }, info.status)));
    });
  }
  const search = h('input', { type: 'search', placeholder: 'Поиск по обозначению', value: searchText, oninput: (e) => { searchText = e.target.value; fill(); } });
  const cabs = [...new Set(total.map((p) => p.cabinet || ''))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  const types = [...new Set(total.map((p) => p.typeId))].sort((a, b) => String(a).localeCompare(String(b), 'ru'));
  if (!cabs.includes(fCab) && fCab !== '__none') fCab = '';
  if (!typeFilterValid(fType, types)) fType = '';
  const sel = (all, opts, cur, set) => h('select', { onchange: (e) => { set(e.target.value); fill(); } },
    h('option', { value: '' }, all), ...opts.map(([v, t]) => h('option', { value: v, selected: v === cur }, t)));
  const filters = h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } },
    sel('Все шкафы', cabs.map((c) => (c ? [c, `Шкаф ${c}`] : ['__none', 'Без шкафа'])), fCab, (v) => { fCab = v; }),
    sel('Все типы', typeFilterOptions(types), fType, (v) => { fType = v; }),
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
