// «Привязка установки»: что считается установкой точки каждого типа в этом проекте (влияет на статус и таблицу руководства).
import { h, formModal, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { installBinding, defaultInstallBinding } from '../../domain/index.js';

const MODES = [
  { value: 'none', label: 'Установка не требуется (точка завершена без неё)' },
  { value: 'works', label: 'Выбранные работы установки' },
  { value: 'config', label: 'Набор двери (конфигурация: коре, замок, магнит…)' },
];

export function describeBinding(b, ctx) {
  if (b.mode === 'none') return 'установка не требуется';
  if (b.mode === 'config') return 'набор двери (конфигурация)';
  if (!b.workIds.length) return 'любая установка';
  return b.workIds.map((id) => ctx.catalog.get(id)?.name || id).join(' + ');
}

function worksPicker(ctx) {
  const works = [...ctx.catalog.values()].filter((w) => w.workType === 'Установка' && w.active !== false);
  const boxes = new Map();
  const box = h('div', { class: 'picklist', style: { maxHeight: '240px' } },
    works.map((w) => { const cb = h('input', { type: 'checkbox' }); boxes.set(w.id, cb); return h('label', { class: 'pickrow' }, cb, h('span', {}, w.name), h('small', {}, (w.forTypes || []).join(', '))); }));
  return {
    el: box,
    get: () => works.filter((w) => boxes.get(w.id).checked).map((w) => w.id),
    set: (ids) => boxes.forEach((cb, id) => { cb.checked = (ids || []).includes(id); }),
    update: (v) => { box.style.display = v.mode === 'works' ? '' : 'none'; },
  };
}

// Поля привязки установки (используются и в окне типа точек, и в быстром окне «Привязка установки»)
export function installFields(ctx, setPicker) {
  return [
    { key: 'mode', label: 'Что считается установкой', type: 'select', required: true, options: MODES, emptyLabel: 'Выберите' },
    { key: 'workIds', label: 'Какие работы', type: 'custom', build: (api) => { const pk = worksPicker(ctx); pk.set(api.value); setPicker?.(pk); return pk; },
      hint: 'Если выбрано несколько — точка «установлена», когда выполнены все. Нужную работу создайте в Настройках → Каталог работ (тип работы «Установка»).', visible: (v) => v.mode === 'works' },
  ];
}

function bindingForm(type) {
  const repo = getRepo(); const p = currentProject(); const ctx = state.ctx;
  const cur = installBinding(type);
  formModal({
    title: `Установка: ${type.id}`,
    fields: [
      ...installFields(ctx),
      { key: 'asDefault', label: 'Сделать так по умолчанию для новых проектов', type: 'checkbox' },
    ],
    values: { mode: cur.mode, workIds: cur.workIds },
    onSubmit: (v) => {
      const workIds = v.mode === 'works' ? v.workIds : [];
      repo.save(p.id, [{ coll: 'types', id: type.id, data: { installMode: v.mode, installWorkIds: workIds } }]);
      if (v.asDefault) repo.saveUserPrefs({ installDefaults: { ...(repo.prefs.installDefaults || {}), [type.id]: { mode: v.mode, workIds } } });
      toast('Сохранено — статусы точек пересчитаны');
    },
  });
}

export function installView() {
  const ctx = state.ctx; const repo = getRepo();
  const types = [...ctx.types.values()];
  return h('div', {},
    h('div', { class: 'mut', style: { marginBottom: '10px' } },
      'Для каждого типа точек укажите, что считается установкой. Если установка не требуется (например, бакар, TV), точка не будет висеть «неустановленной» в таблице руководства. Настройка действует для проекта «' + currentProject().name + '».'),
    h('div', { class: 'card', style: { padding: 0 } }, types.map((t) => h('div', { class: 'item', onclick: () => bindingForm(t) },
      h('div', { class: 'name' }, t.id, h('div', { class: 'sub' }, describeBinding(installBinding(t), ctx)))))),
    h('div', { class: 'btns' },
      h('button', { class: 'sec', onclick: () => {
        const inst = repo.prefs.installDefaults || {};
        repo.save(currentProject().id, types.map((t) => {
          const b = inst[t.id] || defaultInstallBinding(t.id); return b ? { coll: 'types', id: t.id, data: { installMode: b.mode, installWorkIds: b.workIds || [] } } : null;
        }).filter(Boolean));
        toast('Возвращены значения по умолчанию');
      } }, '↺ Вернуть значения по умолчанию')));
}
