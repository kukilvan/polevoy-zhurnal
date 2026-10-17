// Точки: форма точки, генератор пачкой, карточка точки с историей, вкладка «Точки».
import { h, formModal, openModal, confirmDialog, toast, qtyList } from '../ui.js';
import { state, getRepo, pointsSorted, infoOf, currentProject } from '../store.js';
import { generateLabels, parseSuffixes, comparePoints, usesConfig, remaining, REMAIN_STAGES, hasDeviceId, normalizeMac, findDuplicate } from '../../domain/index.js';
import { scanDevice } from '../scan.js';
import { statusClass } from './project.js';
import { hint } from './guide.js';
import { dateText, cablesText, missingDetails, isComposedType, isSystemType, UNSORTED_TYPE, cableOverrideFor } from '../../domain/index.js';
import { addWorkForPoint } from './doh.js';
import { whoIs } from './journal.js';
import { pointsFromFile } from './pointsfile.js';
import { pointsFromDrawing, unsortedModal } from './tohnitview.js';
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
    const q = qtyList(cableOpts, { addLabel: '➕ Кабель', empty: 'Без кабеля', onChange: () => { r.cables = q.get().map((c) => ({ cable: c.value, count: c.count })); mark(); } });
    q.set((Array.isArray(r.cables) ? r.cables : dev.cables || []).map((c) => ({ value: c.cable, count: c.count })));
    const cur = new Set(Array.isArray(r.workIds) ? r.workIds : dev.workIds || []);
    const wl = h('div', { class: 'picklist', style: { maxHeight: '180px' } }, [...works].sort((a, b) => cur.has(b.id) - cur.has(a.id)).map((w) => {
      const cb = h('input', { type: 'checkbox', checked: cur.has(w.id), onchange: () => { cb.checked ? cur.add(w.id) : cur.delete(w.id); r.workIds = works.filter((x) => cur.has(x.id)).map((x) => x.id); mark(); } });
      return h('label', { class: 'pickrow' }, cb, h('span', {}, w.name), h('small', {}, w.workType));
    }));
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

export function pointForm(point, { onDone } = {}) {
  const repo = getRepo(); const pid = currentProject().id;
  const fields = [
    { key: 'label', label: 'Обозначение', required: true, hint: 'Например: 1A-01-02' },
    { key: 'planName', label: 'Имя в плане заказчика (по тохниту)' },
    { key: 'cabinet', label: 'Шкаф' }, { key: 'floor', label: 'Этаж' },
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
    { key: 'cabinet', label: 'Шкаф' }, { key: 'floor', label: 'Этаж' },
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

// «Что осталось»: точки без хивута / установки / проверки по шкафам
function remainingModal() {
  let stage = '';
  const body = h('div', {});
  let close = () => {};
  const fill = () => {
    const groups = remaining(state.ctx).map((g) => ({ ...g, items: g.items.filter((x) => !stage || x.missing.includes(stage)) })).filter((g) => g.items.length);
    const n = groups.reduce((s, g) => s + g.items.length, 0);
    const sel = h('select', { onchange: (e) => { stage = e.target.value; fill(); } },
      h('option', { value: '' }, 'Все этапы'), ...REMAIN_STAGES.map((s) => h('option', { value: s, selected: s === stage }, `Без этапа «${s}»`)));
    const CHIP = { 'Дотянуть': ['pul', 'дотянуть'], 'Хивут': ['hiv', 'хивут'], 'Установка': ['ins', 'установка'], 'Проверка': ['chk', 'проверка'] };
    const chipText = (m, point) => {
      if (m !== 'Дотянуть') return CHIP[m]?.[1] || m;
      const i = infoOf(point); return `дотянуть ${i.cableList.filter((c) => !i.pulledKinds.includes(c.cable)).map((c) => c.cable).join(', ')}`;
    };
    const list = h('div', { class: 'rem-list' }, ...groups.flatMap((g) => [
      h('div', { class: 'rem-group' }, h('span', {}, g.cabinet ? `Шкаф ${g.cabinet}` : 'Без шкафа'), h('span', { class: 'rem-count' }, g.items.length)),
      ...g.items.map(({ point, missing }) => h('div', { class: 'rem-row', onclick: () => { close(); setTimeout(() => pointCard(point), 60); } },
        h('div', { class: 'rem-name' }, h('b', {}, point.label), h('span', {}, `${point.typeId}${point.planName ? ` · ${point.planName}` : ''}`)),
        h('div', { class: 'rem-chips' }, missing.map((m) => h('span', { class: `chip ${CHIP[m]?.[0] || ''}` }, chipText(m, point)))))),
    ]));
    body.replaceChildren(sel, h('div', { class: 'rem-total' }, n ? h('span', {}, 'Осталось точек: ', h('b', {}, n)) : 'Всё сделано 🎉'), n ? list : '');
  };
  fill();
  close = openModal('Что осталось', body);
}

// Массовые действия: выбранные точки (живёт, пока открыто приложение)
let selMode = false; const selected = new Set();

function bulkEditForm(ids, done) {
  const repo = getRepo(); const pid = currentProject().id;
  formModal({
    title: `Изменить точек: ${ids.length}`, submitLabel: 'Применить',
    fields: [
      { key: 'cabinet', label: 'Шкаф', hint: 'Пусто — не менять' }, { key: 'floor', label: 'Этаж', hint: 'Пусто — не менять' },
      { key: 'typeId', label: 'Тип', type: 'select', options: typeOptions(), emptyLabel: 'Не менять' },
      { key: 'setCables', label: 'Изменить кабели', type: 'checkbox', hint: 'Без галочки: при смене типа кабели станут как у нового типа, иначе не меняются.' },
      { key: 'cables', label: 'Кабели каждой точки', type: 'custom', visible: (v) => !!v.setCables, build: () => {
        const first = state.ctx.points.get(ids[0]); const p = cablesPicker({ typeId: first?.typeId || '', cabinet: first?.cabinet || '', compact: true });
        return { el: p.el, update: (v) => { if (v.typeId) p.setType(v.typeId); }, get: () => p.get() };
      } },
    ],
    onSubmit: (v) => {
      if (!v.cabinet && !v.floor && !v.typeId && !v.setCables) { toast('Ничего не выбрано для изменения'); return false; }
      const ops = ids.map((id) => {
        const data = {};
        if (v.cabinet) data.cabinet = v.cabinet;
        if (v.floor) data.floor = v.floor;
        if (v.typeId) { data.typeId = v.typeId; data.devices = null; data.cables = null; data.cableOverride = null; if (!isDoorType(v.typeId)) data.configId = undefined; }
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
      h('button', { class: 'sec', onclick: () => pointsFromDrawing() }, '📐 Из чертежа'),
      h('button', { class: 'sec', onclick: () => planModal() }, '🗺 План'),
      h('button', { class: 'wide sec', onclick: () => remainingModal() }, '🧾 Что осталось'),
      total.some((p) => p.typeId === UNSORTED_TYPE) ? h('button', { class: 'wide', onclick: () => unsortedModal(ui) }, `❓ Не разобрано: ${total.filter((p) => p.typeId === UNSORTED_TYPE).length} — разобрать`) : null),
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 2px' } },
      h('span', { class: 'mut' }, `Точек: ${total.length} · с длиной: ${withLen}`),
      selMode ? null : h('button', { class: 'sec', style: { padding: '6px 12px' }, onclick: () => { selMode = true; ui.render(); } }, '☑ Выбрать')),
    search, filters, bar, h('div', { style: { height: '10px' } }), list);
}
