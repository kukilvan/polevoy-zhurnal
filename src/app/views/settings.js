// Вкладка «Настройки»: все справочники (выпадающие списки), привязка установки и служебные действия проекта в одном месте.
import { h, formModal, confirmDialog, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { newId } from '../repo.js';
import { installBinding, tablesOf, mainTable, hasDeviceId } from '../../domain/index.js';
import { installFields, describeBinding } from './install.js';
import { projectForm } from './projects.js';
import { themeLabel, setTheme, nextTheme } from '../theme.js';
import { updateManagerTable, backupNow } from './project.js';
import { exportExcel } from '../excel.js';

export const WORK_TYPES = ['Протяжка', 'Перетяжка', 'Перенос', 'Хивут', 'Установка', 'Проверка', 'Шилют', 'Доп. работа', 'Время'];
const STAGES = ['Протяжка', 'Хивут', 'Установка', 'Проверка', 'Шилют'];

// Список галочек: варианты {value,label}; get() возвращает выбранные значения в порядке списка
function checkList(options, { empty = 'Список пуст' } = {}) {
  const boxes = new Map();
  const el = h('div', { class: 'picklist', style: { maxHeight: '220px' } },
    options.length ? options.map((o) => { const cb = h('input', { type: 'checkbox' }); boxes.set(o.value, cb); return h('label', { class: 'pickrow' }, cb, h('span', {}, o.label)); })
      : h('div', { class: 'empty' }, empty));
  return { el, get: () => options.filter((o) => boxes.get(o.value).checked).map((o) => o.value), set: (vals) => boxes.forEach((cb, v) => { cb.checked = (vals || []).includes(v); }) };
}
const custom = (key, label, options, extra = {}) => ({
  key, label, type: 'custom', ...extra, build: (api) => { const c = checkList(options, extra); c.set(api.value); return c; },
});

const ctx = () => state.ctx;
const opts = (map, label) => [...map.values()].map((x) => ({ value: x.id, label: label(x) }));

// ---- описание справочников ----
// name: поле с названием (если id = название, оно задаётся только при создании)
export const REFS = {
  catalog: {
    title: 'Каталог работ', coll: 'catalog', hint: 'Работы, которые выбираются в доху. Тип работы определяет, как работа влияет на статус точки.',
    idMode: 'generated', prefix: 'W_', nameKey: 'name',
    items: () => [...ctx().catalog.values()],
    group: (x) => x.workType, groupOrder: WORK_TYPES,
    line: (x) => [x.name, `${x.nameHe || '—'} · ${(x.forTypes || []).join(', ') || 'без точек'}${x.active === false ? ' · скрыта' : ''}`],
    fields: () => [
      { key: 'name', label: 'Название (русский)', required: true },
      { key: 'nameHe', label: 'Название (иврит)', required: true },
      { key: 'workType', label: 'Тип работы', type: 'select', required: true, options: WORK_TYPES.map((t) => ({ value: t, label: t })), emptyLabel: 'Выберите',
        hint: 'Установка — влияет на статус «Установлено»; Протяжка, Хивут, Проверка, Шилют — на этапы точки; Время и Доп. работа — только в дох.' },
      { key: 'unit', label: 'Единица измерения', type: 'select', required: true, options: opts(ctx().units, (u) => u.id), emptyLabel: 'Выберите' },
      { key: 'multiplier', label: 'Множитель', type: 'number', hint: 'Обычно 1' },
      custom('forTypes', 'Для каких типов точек', opts(ctx().types, (t) => t.id), { hint: 'Ничего не выбрано — работа без точек (доп. работа, время).' }),
      { key: 'isDoorComponent', label: 'Может входить в набор двери (конфигурацию)', type: 'checkbox', visible: (v) => v.workType === 'Установка' },
      { key: 'active', label: 'Показывать в списках', type: 'checkbox' },
    ],
    defaults: { multiplier: 1, active: true },
    prepare: (v) => ({ name: v.name, nameHe: v.nameHe, workType: v.workType, unit: v.unit, multiplier: v.multiplier ?? 1, forTypes: v.forTypes || [],
      isDoorComponent: !!v.isDoorComponent && v.workType === 'Установка', active: v.active !== false }),
    usage: (x) => [...ctx().entries.values()].filter((e) => e.workId === x.id).length,
  },
  types: {
    title: 'Типы точек', coll: 'types', hint: 'Камера, дверь, вайфай… Здесь же — что считается установкой точки этого типа.',
    idMode: 'name', nameLabel: 'Название типа (русский)',
    items: () => [...ctx().types.values()],
    line: (x) => [x.id, `${x.nameHe || '—'} · ${x.defaultCable || 'без кабеля'} ×${x.defaultCables ?? '?'} · установка: ${describeBinding(installBinding(x), ctx())}`],
    fields: () => [
      { key: 'nameHe', label: 'Название (иврит)', required: true },
      { key: 'defaultCable', label: 'Кабель по умолчанию', type: 'select', required: true, options: opts(ctx().cables, (c) => c.id), emptyLabel: 'Выберите' },
      { key: 'defaultCables', label: 'Кабелей на точку', type: 'number', required: true },
      { key: 'scanId', label: 'Серийный номер и MAC (со сканером)', type: 'checkbox', hint: 'Поля появятся в карточке точки этого типа. У камер и вайфая включено по умолчанию.' },
      custom('stages', 'Этапы точки (видны в таблице руководства)', STAGES.map((s) => ({ value: s, label: s }))),
      ...installFields(ctx()),
      { key: 'asDefault', label: 'Привязку установки сделать умолчанием для новых проектов', type: 'checkbox' },
    ],
    defaults: { defaultCables: 1, stages: ['Протяжка', 'Хивут', 'Проверка'], mode: 'none' },
    toForm: (x) => ({ ...x, scanId: hasDeviceId(x), mode: installBinding(x).mode, workIds: installBinding(x).workIds }),
    prepare: (v) => ({ scanId: !!v.scanId, nameHe: v.nameHe, defaultCable: v.defaultCable, defaultCables: v.defaultCables, stages: v.stages || [],
      installMode: v.mode, installWorkIds: v.mode === 'works' ? (v.workIds || []) : [], isDoor: v.mode === 'config' }),
    after: (v, id) => {
      if (v.asDefault) getRepo().saveUserPrefs({ installDefaults: { ...(getRepo().prefs.installDefaults || {}), [id]: { mode: v.mode, workIds: v.mode === 'works' ? (v.workIds || []) : [] } } });
    },
    usage: (x) => [...ctx().points.values()].filter((p) => p.typeId === x.id).length,
  },
  cables: {
    title: 'Кабели', coll: 'cables', hint: 'Как считается протяжка этим кабелем: по точкам (cat7) или по метрам (6005, оптика).',
    idMode: 'name', nameLabel: 'Название кабеля (русский/латиница)',
    items: () => [...ctx().cables.values()],
    line: (x) => [x.id, `${x.nameHe || '—'} · считается: ${x.accounting || '—'}`],
    fields: () => [
      { key: 'nameHe', label: 'Название в доху (иврит)', required: true, hint: 'Например: כבל CAT7' },
      { key: 'accounting', label: 'Как считать протяжку', type: 'select', required: true, options: [{ value: 'Точки', label: 'По точкам' }, { value: 'Метры', label: 'По кабелям и метрам' }], emptyLabel: 'Выберите' },
    ],
    defaults: {},
    prepare: (v) => ({ nameHe: v.nameHe, accounting: v.accounting }),
    usage: (x) => [...ctx().types.values()].filter((t) => t.defaultCable === x.id).length,
  },
  configs: {
    title: 'Конфигурации дверей', coll: 'configs', hint: 'Наборы установки для двери: из каких работ она состоит. Дверь «установлена», когда сделаны все компоненты.',
    idMode: 'generated', prefix: 'CFG_', nameKey: 'name',
    items: () => [...ctx().configs.values()],
    line: (x) => [x.name, (x.components || []).map((id) => ctx().catalog.get(id)?.name || id).join(' + ')],
    fields: () => [
      { key: 'name', label: 'Название (русский)', required: true, hint: 'Например: Коре + мануль + магнит' },
      custom('components', 'Из каких работ состоит', opts(new Map([...ctx().catalog].filter(([, w]) => w.workType === 'Установка')), (w) => w.name), { hint: 'Работы с типом «Установка» из каталога.', empty: 'В каталоге нет работ типа «Установка»' }),
    ],
    defaults: {},
    prepare: (v) => ({ name: v.name, components: v.components || [] }),
    usage: (x) => [...ctx().points.values()].filter((p) => p.configId === x.id).length + (currentProject()?.defaultConfigId === x.id ? 1 : 0),
  },
  units: { title: 'Единицы измерения', coll: 'units', hint: 'Шт, м, мин… Показываются в доху.', idMode: 'name', nameLabel: 'Единица (русский)', heKey: 'he', heLabel: 'Единица (иврит)',
    items: () => [...ctx().units.values()], line: (x) => [x.id, x.he || '—'], usage: (x) => [...ctx().catalog.values()].filter((w) => w.unit === x.id).length },
  culprits: { title: 'Виновники простоя', coll: 'culprits', hint: 'Кто виноват в простое или задержке — выбирается в доху.', idMode: 'name', nameLabel: 'Виновник (русский)', heKey: 'he', heLabel: 'Виновник (иврит)',
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

function itemForm(key, existing) {
  const def = REFS[key]; const repo = getRepo(); const pid = currentProject().id;
  const fields = [];
  if (!existing && def.idMode === 'name') fields.push({ key: '_name', label: def.nameLabel, required: true, hint: 'Название потом изменить нельзя — только удалить и создать заново.' });
  fields.push(...def.fields());
  const live = def.items();
  formModal({
    title: existing ? (existing.name || existing.id) : `Новый пункт — ${def.title}`,
    fields, values: existing ? (def.toForm ? def.toForm(existing) : existing) : { ...def.defaults },
    extra: existing ? [{ label: 'Удалить', kind: 'danger', onClick: async () => {
      const n = def.usage?.(existing) || 0;
      const msg = n ? `«${existing.name || existing.id}» используется (${n}). Удалить из списка? Старые записи сохранятся, но выбрать пункт будет нельзя.` : `Удалить «${existing.name || existing.id}»?`;
      if (!(await confirmDialog(msg, { yes: 'Удалить', danger: true }))) return false;
      repo.remove(pid, def.coll, existing.id); toast('Удалено (можно вернуть через «История и откат»)'); return true;
    } }] : [],
    onSubmit: (v) => {
      let id = existing?.id;
      if (!existing) {
        if (def.idMode === 'name') {
          id = String(v._name || '').trim();
          if (live.some((x) => x.id === id)) { toast('Такой пункт уже есть'); return false; }
        } else id = `${def.prefix}${newId(6)}`;
      }
      const data = def.prepare ? def.prepare(v) : {};
      repo.save(pid, [{ coll: def.coll, id, data: { ...data, deleted: false } }]);
      def.after?.(v, id);
      toast('Сохранено');
    },
  });
}

export function refView() {
  const key = state.settingsRef; const def = REFS[key];
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
    h('div', { class: 'btns', style: { marginTop: 0 } }, h('button', { onclick: () => itemForm(key, null) }, '➕ Добавить пункт')),
    h('div', { class: 'card', style: { padding: 0, marginTop: '12px' } }, rows.length ? rows : h('div', { class: 'empty' }, 'Список пуст.')));
}

export function settingsView(ui) {
  const p = currentProject();
  const row = (icon, title, sub, fn) => h('div', { class: 'item', onclick: fn }, h('div', { class: 'name' }, `${icon} ${title}`, sub ? h('div', { class: 'sub' }, sub) : null));
  const ref = (k) => row('📋', REFS[k].title, `${REFS[k].items().length} пунктов`, () => { state.settingsRef = k; ui.open('ref'); });
  return h('div', {},
    h('div', { class: 'card', style: { padding: 0 } },
      row('📖', 'Как пользоваться', 'Шаги работы, что такое дох, словарик', () => ui.open('guide')),
      row('🎨', `Тема: ${themeLabel()}`, 'Нажмите, чтобы переключить: тёмная → светлая → как в телефоне (только на этом устройстве)', () => { setTheme(nextTheme()); ui.render(); })),
    h('div', { class: 'card', style: { padding: 0 } },
      h('div', { class: 'group', style: { padding: '10px 14px 4px' } }, 'Выпадающие списки (справочники)'),
      ['catalog', 'types', 'cables', 'configs', 'units', 'culprits', 'delayReasons'].map(ref)),
    h('div', { class: 'card', style: { padding: 0 } },
      h('div', { class: 'group', style: { padding: '10px 14px 4px' } }, `Проект «${p.name}»`),
      row('🔧', 'Привязка установки', 'Что считается установкой для каждого типа точек', () => ui.open('install')),
      row('📊', 'Таблицы для руководства', `${tablesOf(p).length} шт. · основная: ${mainTable(p).name}`, () => ui.open('tables')),
      row('🗄', 'Настройки шкафа', 'Свои кабели и их число для шкафа', () => ui.open('cabinets')),
      row('👥', 'Участники', `${(p.memberEmails || []).length} в проекте`, () => ui.open('members')),
      row('✏️', 'Данные проекта', 'Название, помощник, иврит, примечание', () => projectForm(p, ui)),
      row('📁', 'Все проекты', null, () => ui.open('projects'))),
    h('div', { class: 'card', style: { padding: 0 } },
      h('div', { class: 'group', style: { padding: '10px 14px 4px' } }, 'Данные'),
      row('🔄', 'Обновить таблицу для руководства', mainTable(p).syncedAt ? `Основная обновлена: ${new Date(mainTable(p).syncedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}` : null, updateManagerTable),
      mainTable(p).link ? row('📊', 'Открыть таблицу руководства', null, () => window.open(mainTable(p).link, '_blank')) : null,
      row('💾', 'Резервная копия на Диск', p.backupAt ? `Последняя: ${new Date(p.backupAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}` : null, backupNow),
      row('📊', 'Выгрузить всё в Excel', 'Файл .xlsx: точки, журнал, дни, справочники', exportExcel),
      row('📥', 'Импорт данных', null, () => ui.open('import')),
      row('🕘', 'История и откат', null, () => ui.open('history')),
      row('🧾', 'Журнал событий', null, () => ui.open('log'))));
}
