// Вкладка «Настройки»: все справочники (выпадающие списки), привязка установки и служебные действия проекта в одном месте.
import { POOL_KINDS, usesOf, usesText, DOOR_PARTS, doorPartOf, DOOR_PART_NAMES, doorColorOf } from '../../domain/index.js';
import { poolButton } from './poolview.js';
import { allGroups } from '../typegroups.js';
import { h, formModal, confirmDialog, toast, qtyList, openModal } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { newId } from '../repo.js';
import { inheritedOfType, inheritedFromCables, tablesOf, mainTable, hasDeviceId, libraryOps, auditRefs, buildContext, typePool, bundleFrom, libWith, addBundleOps, isSystemType } from '../../domain/index.js';
import { projectForm } from './projects.js';
import { themeLabel, setTheme, nextTheme } from '../theme.js';
import { updateManagerTable, backupNow, organizeDrive } from './project.js';
import { exportExcel } from '../excel.js';
import { catalogModal } from './catalogview.js';
import { doorConfigsView } from './doorcfgview.js';
import { colorField } from './doorchips.js';

export const WORK_TYPES = ['Протяжка', 'Перетяжка', 'Перенос', 'Хивут', 'Установка', 'Проверка', 'Шилют', 'Доп. работа', 'Время'];
const STAGES = ['Протяжка', 'Хивут', 'Установка', 'Проверка', 'Шилют'];

// Список галочек: варианты {value,label}; get() возвращает выбранные значения в порядке списка
// locked(values) → Map значение → «откуда»: такие пункты уже есть на нижнем уровне — серая отмеченная галочка, не сохраняются здесь
function checkList(options, { empty = 'Список пуст', onCreate, createLabel = '🆕 Создать новое', onChange, locked } = {}) {
  const boxes = new Map(); const notes = new Map(); const manual = new Map(); let lockMap = new Map(); options = [...options];
  const row = (o) => { const cb = h('input', { type: 'checkbox', onchange: () => onChange?.() }); const note = h('small', { class: 'mut' }); boxes.set(o.value, cb); notes.set(o.value, note); return h('label', { class: 'pickrow' }, cb, h('span', {}, o.label, note)); };
  const applyLocks = (m) => {
    lockMap = m || new Map();
    boxes.forEach((cb, v) => {
      if (lockMap.has(v)) { if (!cb.disabled) manual.set(v, cb.checked); cb.checked = true; cb.disabled = true; notes.get(v).textContent = `  · уже есть: ${lockMap.get(v)}`; }
      else if (cb.disabled) { cb.disabled = false; cb.checked = !!manual.get(v); notes.get(v).textContent = ''; }
    });
  };
  const list = h('div', { class: 'picklist', style: { maxHeight: '220px' } }, options.length ? options.map(row) : h('div', { class: 'empty' }, empty));
  // новый пункт: в начало списка и сразу отмечен
  const add = (o) => { if (!options.length) list.replaceChildren(); if (!boxes.has(o.value)) { options.unshift(o); list.prepend(row(o)); } boxes.get(o.value).checked = true; onChange?.(); };
  const el = onCreate ? h('div', {}, list, h('div', { class: 'btns', style: { marginTop: '4px' } }, h('button', { type: 'button', class: 'sec', onclick: () => onCreate(add) }, createLabel))) : list;
  return {
    el, get: () => options.filter((o) => boxes.get(o.value).checked && !lockMap.has(o.value)).map((o) => o.value),
    set: (vals) => { boxes.forEach((cb, v) => { cb.disabled = false; cb.checked = (vals || []).includes(v); manual.set(v, cb.checked); }); applyLocks(lockMap); },
    update: (v) => { if (locked) applyLocks(locked(v)); },
  };
}
const custom = (key, label, options, extra = {}) => ({
  key, label, type: 'custom', ...extra, build: (api) => { const c = checkList(options, { ...extra, onChange: api.changed }); c.set(api.value); if (extra.locked) setTimeout(() => { try { c.update(api.values()); } catch { /* форма ещё строится */ } }, 0); return c; },
});
// «🆕 Новое …» внутри формы: открыть форму справочника поверх, после «Сохранить» вернуться и сразу добавить созданное
const workLabel = (d) => `${d.name} · ${d.workType}`;
const creator = (key, label, after) => ({ createLabel: label, onCreate: (add) => itemForm(key, null, { onSaved: (id, data) => { add({ value: id, label: key === 'catalog' ? workLabel(data) : (data.name || id) }); after?.(id, data); } }) });

// Поле «вариант × количество»: хранится как [{ <key>: значение, count }]
const qtyField = (key, label, options, itemKey, extra = {}) => ({
  key, label, type: 'custom', ...extra,
  build: (api) => {
    const q = qtyList([...options], { ...extra, onChange: () => api.changed() });
    q.set((api.value || []).map((x) => ({ value: x[itemKey], count: x.count })));
    return { el: q.el, get: () => q.get().map((x) => ({ [itemKey]: x.value, count: x.count })) };
  },
});
// Работы, которые можно требовать от кабеля/устройства/точки (протяжка учитывается сама; время — не работа по точкам)
const taskWorks = () => [...ctx().catalog.values()].filter((w) => ['Хивут', 'Установка', 'Проверка', 'Шилют', 'Доп. работа'].includes(w.workType) && w.active !== false)
  .sort((a, b) => WORK_TYPES.indexOf(a.workType) - WORK_TYPES.indexOf(b.workType) || a.name.localeCompare(b.name, 'ru'))
  .map((w) => ({ value: w.id, label: `${w.name} · ${w.workType}` }));
const nameOf = (coll, id) => ctx()[coll].get(id)?.name || id;
const compText = (list) => (list || []).map((d) => `${nameOf('devices', d.deviceId)}${d.count > 1 ? ` ×${d.count}` : ''}`).join(' + ');

// Формы справочников пишут в проект; администратор пула открывает те же формы для общего пула (target: свой ctx и куда сохранять)
let formTarget = null;
export const setFormTarget = (t) => { formTarget = t; };
const ctx = () => formTarget?.ctx || state.ctx;
const opts = (map, label) => [...map.values()].map((x) => ({ value: x.id, label: label(x) }));

// ---- описание справочников ----
// name: поле с названием (если id = название, оно задаётся только при создании)
export const REFS = {
  catalog: {
    title: 'Каталог работ', coll: 'catalog', hint: 'Работы, которые выбираются в отчёте. Тип работы определяет, как работа влияет на статус точки.',
    idMode: 'generated', prefix: 'W_', nameKey: 'name',
    items: () => [...ctx().catalog.values()],
    group: (x) => x.workType, groupOrder: WORK_TYPES,
    line: (x) => [x.name, `${x.nameHe || '—'} · ${(x.forTypes || []).join(', ') || 'без точек'}${x.active === false ? ' · скрыта' : ''}`],
    fields: () => [
      { key: 'name', label: 'Название (русский)', required: true },
      { key: 'nameHe', label: 'Название (иврит)', required: true },
      { key: 'workType', label: 'Тип работы', type: 'select', required: true, options: WORK_TYPES.map((t) => ({ value: t, label: t })), emptyLabel: 'Выберите',
        hint: 'Установка — влияет на статус «Установлено»; Протяжка, Хивут, Проверка, Шилют — на этапы точки; Время и Доп. работа — только в отчёт.' },
      { key: 'unit', label: 'Единица измерения', type: 'select', required: true, options: opts(ctx().units, (u) => u.id), emptyLabel: 'Выберите' },
      { key: 'multiplier', label: 'Множитель', type: 'number', hint: 'Обычно 1' },
      custom('forTypes', 'Для каких типов точек', opts(ctx().types, (t) => t.id), { hint: 'Ничего не выбрано — работа без точек (доп. работа, время).' }),
      { key: 'isDoorComponent', label: 'Может входить в набор двери (конфигурацию)', type: 'checkbox', visible: (v) => v.workType === 'Установка' },
      { key: 'active', label: 'Показывать в списках', type: 'checkbox' },
    ],
    defaults: { multiplier: 1, active: true },
    prepare: (v) => ({ name: v.name, nameHe: v.nameHe, workType: v.workType, unit: v.unit, multiplier: v.multiplier ?? 1, forTypes: v.forTypes || [],
      isDoorComponent: !!v.isDoorComponent && v.workType === 'Установка', active: v.active !== false }),
    usage: (x) => usesOf(ctx(), 'catalog', x.id).reduce((n, u) => n + u.n, 0), uses: (x) => usesOf(ctx(), 'catalog', x.id),
  },
  types: {
    title: 'Типы точек', coll: 'types', hint: 'Камера, дверь, вайфай… Тип — это одна строка в таблице руководства. Состав типа — устройства (с их кабелями и работами) плюс работы на всю точку.',
    idMode: 'name', nameLabel: 'Название типа (русский)',
    items: () => [...ctx().types.values()].filter((t) => !isSystemType(t)),
    line: (x) => [x.id, Array.isArray(x.devices) && x.devices.length
      || x.cables?.length ? `состав: ${[compText(x.devices), x.cables?.length ? `кабели точки ${x.cables.map((c) => `${c.cable}×${c.count}`).join(' + ')}` : ''].filter(Boolean).join(' + ')}${x.workIds?.length ? ` · на точку: ${x.workIds.map((w) => nameOf('catalog', w)).join(', ')}` : ''} · ${x.nameHe || '—'}`
      : `${x.nameHe || '—'} · состав пуст`],
    fields: ({ existing, created } = {}) => {
      return [
        { key: 'nameHe', label: 'Название (иврит)', required: true },
        { key: 'group', label: 'Общая группа (для фильтров)', placeholder: 'например: Дверь', hint: `Типы с одной группой можно выбрать в фильтрах точек все вместе («▸ Все: Дверь»), каждый тип тоже остаётся в фильтре отдельно.${allGroups().length ? ` Уже есть: ${allGroups().join(', ')}.` : ''}` },
        qtyField('devices', 'Состав точки (устройства)', opts(ctx().devices, (d) => d.name), 'deviceId',
          { addLabel: '➕ Добавить устройство', empty: 'Пусто — состав можно дописать потом', ...creator('devices', '🆕 Новое устройство'),
            hint: 'Из каких устройств состоит точка этого типа по умолчанию. При добавлении точек состав можно поменять. Устройства — в «Ещё → Устройства».' }),
        qtyField('cables', 'Кабели точки (не от устройств)', opts(ctx().cables, (c) => c.id), 'cable',
          { addLabel: '➕ Добавить кабель', empty: 'Нет — кабели только от устройств', ...creator('cables', '🆕 Новый кабель'),
            hint: 'Когда несколько авизарим сидят на одном кабеле: например, дверь — 2×6005 на точку, а устройства без кабелей. Работы кабелей (хивут, проверка…) добавятся сами.' }),
        { ...custom('pointWorks', 'Работы на всю точку', taskWorks(), { hint: 'Не по устройствам, а один раз на точку: например, проверка двери. Серые галочки — работы, которые уже есть у устройств или кабелей состава (второй раз не нужны). Новая работа, созданная здесь, сама получит этот тип в «Для каких типов точек».', empty: 'Нет работ',
          locked: (v) => inheritedOfType(ctx(), v.devices, v.cables),
          ...creator('catalog', '🆕 Новая работа', (id, data) => created?.set(id, data.forTypes || [])) }) },
        { key: 'scanId', label: 'Серийный номер и MAC (со сканером)', type: 'checkbox', hint: 'Поля появятся в карточке точки этого типа. У камер и вайфая включено по умолчанию.' },
      ];
    },
    defaults: {},
    toForm: (x) => ({ ...x, scanId: hasDeviceId(x), pointWorks: x.workIds || [], devices: Array.isArray(x.devices) ? x.devices : [], cables: Array.isArray(x.cables) ? x.cables : [] }),
    prepare: (v) => ({ scanId: !!v.scanId, nameHe: v.nameHe, group: String(v.group || '').trim(), devices: v.devices || [], cables: v.cables || [], workIds: v.pointWorks || [] }),
    usage: (x) => [...ctx().points.values()].filter((p) => p.typeId === x.id).length,
  },
  cables: {
    title: 'Кабели', coll: 'cables', hint: 'Как считается протяжка этим кабелем: по точкам (cat7) или по метрам (6005, оптика).',
    idMode: 'name', nameLabel: 'Название кабеля (русский/латиница)',
    items: () => [...ctx().cables.values()],
    line: (x) => [x.id, `${x.nameHe || '—'} · считается: ${x.accounting || '—'}${x.workIds?.length ? ` · работы: ${x.workIds.map((w) => nameOf('catalog', w)).join(', ')}` : ''}`],
    fields: () => [
      { key: 'nameHe', label: 'Название в отчёте (иврит)', required: true, hint: 'Например: כבל CAT7' },
      { key: 'accounting', label: 'Как считать протяжку', type: 'select', required: true, options: [{ value: 'Точки', label: 'По точкам' }, { value: 'Метры', label: 'По кабелям и метрам' }], emptyLabel: 'Выберите' },
      custom('workIds', 'Какие работы нужны каждому такому кабелю', taskWorks(), { hint: 'Например, cat7: хивут кистона, хивут в шкафу, проверка, шилют; 6005: хивут в шкафу. Протяжка учитывается всегда.', empty: 'Нет работ', ...creator('catalog', '🆕 Новая работа') }),
    ],
    defaults: {},
    prepare: (v) => ({ nameHe: v.nameHe, accounting: v.accounting, workIds: v.workIds || [] }),
    usage: (x) => usesOf(ctx(), 'cables', x.id).reduce((n, u) => n + u.n, 0), uses: (x) => usesOf(ctx(), 'cables', x.id),
  },
  devices: {
    title: 'Устройства', coll: 'devices', hint: 'Составляющие точек: авизар и его кабели. Например: Магнит индикация = 6005×1 + установка магнита; Лахцан нипуц — без кабеля.',
    idMode: 'generated', prefix: 'DV_', nameKey: 'name',
    items: () => [...ctx().devices.values()],
    line: (x) => [x.name, `${doorPartOf(x) ? `🚪 ${DOOR_PART_NAMES[doorPartOf(x)]} · ` : ''}${(x.cables || []).length ? (x.cables || []).map((c) => `${c.cable}×${c.count}`).join(' + ') : 'без кабеля'}${x.workIds?.length ? ` · ${x.workIds.map((w) => nameOf('catalog', w)).join(', ')}` : ''} · ${x.nameHe || '—'}`],
    fields: () => [
      { key: 'name', label: 'Название (русский)', required: true },
      { key: 'nameHe', label: 'Название (иврит)', required: true },
      qtyField('cables', 'Кабели', opts(ctx().cables, (c) => c.id), 'cable', { addLabel: '➕ Добавить кабель', empty: 'Без кабеля', ...creator('cables', '🆕 Новый кабель'), hint: 'Работы самого кабеля (хивут, проверка, шилют) добавятся сами — они заданы в «Кабели».' }),
      custom('workIds', 'Работы устройства', taskWorks(), { hint: 'Обычно установка авизара; можно и другие (кивун, доп. работа). Серые галочки — работы его кабелей (уже есть, второй раз не нужны).', empty: 'Нет работ', locked: (v) => inheritedFromCables(ctx(), v.cables), ...creator('catalog', '🆕 Новая работа') }),
      { key: 'doorPart', label: 'Часть двери', type: 'select', emptyLabel: 'Авто (по названию)', options: [...DOOR_PARTS.map((p) => ({ value: p.key, label: p.name })), { value: 'none', label: 'Не для двери' }],
        hint: 'В какой части окна «Конфигурация двери» показывать устройство. Авто: ЭМ и мануль — запирание, коре — считыватель, лахцаны — кнопки, магнит — датчики, интерком и цофар — дополнительно.' },
      { ...colorField('color', 'Цвет в названии двери', { hint: 'Каким цветом это устройство в названиях конфигураций. По умолчанию — цвет части двери: ЭМ красный, МХ синий, считыватели фиолетовые, кнопки оранжевые, датчики бирюзовые, дополнительное розовое.',
        fallback: (v) => doorColorOf({ name: v.name, doorPart: v.doorPart }) }), visible: (v) => v.doorPart !== 'none' && !!doorPartOf({ name: v.name, doorPart: v.doorPart }) },
      { key: 'short', label: 'Коротко (в названии двери)', placeholder: 'например: ЭМ, коре, цофар', hint: 'Пусто — как обычно: ЭМ, МХ, коре, птиха, нипуц, магнит…' },
    ],
    defaults: {},
    prepare: (v) => ({ name: v.name, nameHe: v.nameHe, cables: v.cables || [], workIds: v.workIds || [], doorPart: v.doorPart || null, short: String(v.short || '').trim() || null, color: v.color || null }),
    usage: (x) => usesOf(ctx(), 'devices', x.id).reduce((n, u) => n + u.n, 0), uses: (x) => usesOf(ctx(), 'devices', x.id),
  },
  // вход во вкладку «Конфигурации дверей» (сама вкладка рисуется в doorcfgview.js)
  configs: { title: 'Конфигурации дверей', coll: 'configs', items: () => [...ctx().configs.values()].filter((c) => Array.isArray(c.devices) && !c.deleted) },
  units: { title: 'Единицы измерения', coll: 'units', hint: 'Шт, м, мин… Показываются в отчёте.', idMode: 'name', nameLabel: 'Единица (русский)', heKey: 'he', heLabel: 'Единица (иврит)',
    items: () => [...ctx().units.values()], line: (x) => [x.id, x.he || '—'], usage: (x) => [...ctx().catalog.values()].filter((w) => w.unit === x.id).length },
  culprits: { title: 'Виновники простоя', coll: 'culprits', hint: 'Кто виноват в простое или задержке — выбирается в отчёте.', idMode: 'name', nameLabel: 'Виновник (русский)', heKey: 'he', heLabel: 'Виновник (иврит)',
    items: () => [...ctx().culprits.values()], line: (x) => [x.id, x.he || '—'], usage: (x) => [...ctx().entries.values()].filter((e) => e.culprit === x.id).length },
  delayReasons: { title: 'Причины задержки точек', coll: 'delayReasons', hint: 'Почему точка не сделана — выбирается в карточке точки.', idMode: 'name', nameLabel: 'Причина (русский)', heKey: 'he', heLabel: 'Причина (иврит)',
    items: () => [...ctx().delayReasons.values()], line: (x) => [x.id, x.he || '—'], usage: (x) => [...ctx().points.values()].filter((p) => p.delayReasonId === x.id).length },
};
// упрощённые справочники «русский + иврит»
['units', 'culprits', 'delayReasons'].forEach((k) => {
  const r = REFS[k];
  r.fields = () => [{ key: r.heKey, label: r.heLabel, required: true }];
  r.defaults = {}; r.prepare = (v) => ({ [r.heKey]: v[r.heKey] });
});

export function itemForm(key, existing, { onSaved } = {}) {  // onSaved(id) — для создания «на лету» из другого окна
  const def = REFS[key]; const repo = getRepo(); const pid = currentProject().id; const tgt = formTarget;
  const fields = []; const created = new Map(); // работы, созданные из этой формы (id → их «для каких типов»)
  if (!existing && def.idMode === 'name') fields.push({ key: '_name', label: def.nameLabel, required: true, hint: 'Название потом изменить нельзя — только удалить и создать заново.' });
  fields.push(...def.fields({ existing, created }));
  const live = tgt ? [...tgt.ctx[def.coll].values()] : def.items();
  formModal({
    title: existing ? (existing.name || existing.id) : `Новый пункт — ${def.title}`,
    fields, values: existing ? (def.toForm ? def.toForm(existing) : existing) : { ...def.defaults },
    extra: existing && !tgt ? [{ label: 'Удалить', kind: 'danger', onClick: async () => {
      const n = def.usage?.(existing) || 0;
      const msg = n ? `«${existing.name || existing.id}» используется (${def.uses ? usesText(def.uses(existing)) : n}). Если удалить, там пропадут связанные работы/кабели/устройства. Удалить из списка? Старые записи сохранятся, но выбрать пункт будет нельзя.` : `Удалить «${existing.name || existing.id}»?`;
      if (!(await confirmDialog(msg, { yes: 'Удалить', danger: true }))) return false;
      repo.remove(pid, def.coll, existing.id); toast('Удалено (можно вернуть через «Откат записей»)'); return true;
    } }] : [],
    onSubmit: (v) => {
      let id = existing?.id;
      if (!existing) {
        if (def.idMode === 'name') {
          id = String(v._name || '').trim();
          if (live.some((x) => x.id === id)) { toast('Такой пункт уже есть'); return false; }
        } else id = `${def.prefix}${newId(6)}`;
      }
      const err = def.check?.(v); if (err) { toast(err); return false; }
      const data = def.prepare ? def.prepare(v, { existing }) : {};
      const ops = [{ coll: def.coll, id, data: { ...data, deleted: false } }];
      // новые работы, созданные из формы типа, — отметить этот тип в «Для каких типов точек»
      if (key === 'types') created.forEach((ft, wid) => { if (!ft.includes(id)) ops.push({ coll: 'catalog', id: wid, data: { forTypes: [...ft, id] } }); });
      if (tgt) { tgt.save(ops); tgt.ctx[def.coll].set(id, { ...(existing || {}), ...data, id }); toast('Сохранено в общем пуле'); onSaved?.(id, data); return; }
      repo.save(pid, ops);
      def.after?.(v, id);
      toast('Сохранено'); onSaved?.(id, data);
    },
  });
}

// Все id, которые когда-либо были в проекте (вместе с удалёнными) — удалённое из библиотеки не возвращаем
const knownIds = () => Object.fromEntries(['catalog', 'devices', 'cables', 'types'].map((c) => [c, new Set((state.data[c] || []).map((x) => x.id))]));
// Контекст «как будет после» операций (для предпросмотра)
function ctxAfter(ops) {
  const data = { ...state.data, projects: [currentProject()] };
  ['catalog', 'devices', 'cables', 'types', 'journal'].forEach((c) => {
    const m = new Map((data[c] || []).map((x) => [x.id, x]));
    ops.filter((o) => o.coll === c).forEach((o) => m.set(o.id, { ...(m.get(o.id) || {}), ...o.data, id: o.id, deleted: false }));
    data[c] = [...m.values()];
  });
  return buildContext(data);
}
const auditBox = (list) => {
  const icon = { error: '❌', warn: '⚠️', info: 'ℹ️' };
  const order = { error: 0, warn: 1, info: 2 };
  return list.length ? h('div', { style: { fontSize: '14px' } }, [...list].sort((a, b) => order[a.level] - order[b.level]).map((x) => h('div', { style: { padding: '3px 0' } }, `${icon[x.level]} ${x.text}`)))
    : h('div', {}, '✅ Противоречий нет');
};
export function auditModal() {
  openModal('Проверка справочников', h('div', {},
    h('div', { class: 'mut', style: { marginBottom: '8px' } }, '❌ — ссылка на то, чего нет (исправьте); ⚠️ — стоит посмотреть; ℹ️ — для сведения (не используется).'),
    auditBox(auditRefs(state.ctx))));
}


// ---- Общая группа для нескольких типов сразу (например, все двери) ----
function groupModal() {
  const types = [...ctx().types.values()].filter((t) => !isSystemType(t)).sort((a, b) => a.id.localeCompare(b.id, 'ru'));
  const name = h('input', { placeholder: 'Название группы, например: Дверь', value: allGroups()[0] || '' });
  const boxes = types.map((t) => ({ t, cb: h('input', { type: 'checkbox' }) }));
  const mark = () => { const g = name.value.trim(); boxes.forEach((b) => { b.cb.checked = !!g && String(b.t.group || '').trim() === g; }); };
  name.addEventListener('input', mark);
  const guess = h('button', { class: 'sec', onclick: () => { const w = name.value.trim().toLowerCase().slice(0, 4); if (!w) return; boxes.forEach((b) => { if (b.t.id.toLowerCase().includes(w)) b.cb.checked = true; }); } }, '🔎 Отметить похожие по названию');
  const c = openModal('📂 Общая группа типов', h('div', {},
    h('div', { class: 'mut' }, 'Отметьте типы, которые в фильтрах точек можно выбрать все вместе (например, все двери с разными устройствами). Отдельные типы в фильтрах остаются.'),
    name, h('div', { class: 'btns' }, guess),
    h('div', { class: 'picklist', style: { maxHeight: '45vh' } }, boxes.map((b) => h('label', { class: 'pickrow' }, b.cb, h('span', {}, b.t.id, b.t.group ? h('small', { class: 'mut' }, `  · группа: ${b.t.group}`) : null)))),
    h('div', { class: 'btns' }, h('button', { onclick: () => {
      const g = name.value.trim(); if (!g) { toast('Впишите название группы'); return; }
      const ops = [];
      boxes.forEach((b) => { const was = String(b.t.group || '').trim(); if (b.cb.checked && was !== g) ops.push({ coll: 'types', id: b.t.id, data: { group: g } }); else if (!b.cb.checked && was === g) ops.push({ coll: 'types', id: b.t.id, data: { group: '' } }); });
      if (ops.length) getRepo().save(currentProject().id, ops);
      toast(`Группа «${g}»: ${boxes.filter((b) => b.cb.checked).length} типов`); c();
    } }, 'Сохранить'))), { sticky: true });
  mark();
}


export function refView() {
  const key = state.settingsRef; const def = REFS[key];
  if (key === 'configs') return doorConfigsView();
  const items = def.items();
  const rows = []; let last;
  const sorted = [...items].sort((a, b) => {
    if (def.group) { const ia = def.groupOrder.indexOf(def.group(a)); const ib = def.groupOrder.indexOf(def.group(b)); if (ia !== ib) return ia - ib; }
    return String(def.line(a)[0]).localeCompare(String(def.line(b)[0]), 'ru');
  });
  sorted.forEach((x) => {
    if (def.group && def.group(x) !== last) { last = def.group(x); rows.push(h('div', { class: 'group', style: { padding: '10px 14px 4px' } }, last || 'Без типа')); }
    const [name, sub] = def.line(x);
    rows.push(h('div', { class: 'item', onclick: () => itemForm(key, x) }, h('div', { class: 'name' }, name, h('div', { class: 'sub' }, sub))));
  });
  return h('div', {},
    h('div', { class: 'mut', style: { marginBottom: '10px' } }, def.hint),
    h('div', { class: 'btns', style: { marginTop: 0 } }, h('button', { onclick: () => itemForm(key, null) }, '➕ Добавить пункт'),
      POOL_KINDS.includes(key) ? poolButton(key) : null,
      key === 'types' ? h('button', { class: 'sec', onclick: () => groupModal() }, '📂 Общая группа') : null),
    h('div', { class: 'card', style: { padding: 0, marginTop: '12px' } }, rows.length ? rows : h('div', { class: 'empty' }, 'Список пуст.')));
}

// Обновить приложение: сбросить сервис-воркер и кэш (кроме mupdf) и перезагрузить
export async function refreshApp() {
  toast('Обновляю…');
  try { const regs = await navigator.serviceWorker?.getRegistrations?.() || []; await Promise.all(regs.map((r) => r.update().catch(() => {}))); await Promise.all(regs.map((r) => r.unregister())); } catch { /* ok */ }
  try { const keys = await caches.keys(); await Promise.all(keys.filter((k) => !/mupdf/.test(k)).map((k) => caches.delete(k))); } catch { /* ok */ }
  location.reload();
}

let refsOpen = false;   // справочники в Настройках свёрнуты по умолчанию
export function settingsView(ui) {
  const p = currentProject();
  const row = (icon, title, sub, fn) => h('div', { class: 'item', onclick: fn }, h('div', { class: 'name' }, `${icon} ${title}`, sub ? h('div', { class: 'sub' }, sub) : null));
  const ref = (k) => row('📋', REFS[k].title, `${REFS[k].items().length} пунктов`, () => { state.settingsRef = k; ui.open('ref'); });
  return h('div', {},
    h('div', { class: 'card', style: { padding: 0 } },
      h('div', { class: 'group', style: { padding: '10px 14px 4px' } }, `Проект «${p.name}»`),
      row('👔', 'Для руководства', `Папка со ссылкой · таблиц: ${tablesOf(p).length} · основная: ${mainTable(p).name}`, () => ui.open('tables')),
      row('🗄', 'Шкафы и шильют', `План шкафа: точки cat7 по панелям и портам${Object.keys(p.racks || {}).length ? ` · планов: ${Object.keys(p.racks).length}` : ''}`, () => ui.open('racks')),
      row('📊', 'Таблицы', `Google Таблицы проекта «${p.name}»${(p.sheetLinks || []).length ? ` · добавлено: ${p.sheetLinks.length}` : ''}`, () => ui.open('sheets'))),
    h('div', { class: 'card', style: { padding: 0 } },
      h('div', { class: 'group', style: { padding: '10px 14px 4px', cursor: 'pointer', userSelect: 'none' }, onclick: () => { refsOpen = !refsOpen; ui.render(); } }, `${refsOpen ? '▾' : '▸'} Выпадающие списки (справочники)`),
      ...(refsOpen ? [['types', 'devices', 'cables', 'catalog', 'configs', 'units', 'culprits', 'delayReasons'].map(ref),
        row('⌨', 'Быстрый ввод латиницей', 'Слова вроде «тв», «кам» сами становятся TV, CAM при вводе названий', () => import('./latinfix.js').then((m) => m.shortcutsModal()))] : [])));
}
