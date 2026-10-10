// Настройки шкафа: своё число кабелей и тип кабеля для шкафа и типа точек (раздел 2.6).
import { h, formModal, confirmDialog, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';

const idOf = (cabinet, typeId) => `cs_${cabinet}_${typeId}`;

function settingForm(existing) {
  const repo = getRepo(); const pid = currentProject().id;
  const types = [...state.ctx.types.values()]; const cables = [...state.ctx.cables.values()];
  const cabinets = [...new Set([...state.ctx.points.values()].map((p) => p.cabinet).filter(Boolean))].sort();
  formModal({
    title: existing ? 'Настройка шкафа' : 'Новая настройка шкафа',
    fields: [
      { key: 'cabinet', label: 'Шкаф', required: true, hint: cabinets.length ? `Есть шкафы: ${cabinets.join(', ')}` : undefined },
      { key: 'typeId', label: 'Тип точек', type: 'select', required: true, options: types.map((t) => ({ value: t.id, label: t.id })), emptyLabel: 'Выберите тип' },
      { key: 'cables', label: 'Кабелей на точку', type: 'number', hint: 'Пусто — как в типе точек' },
      { key: 'cable', label: 'Кабель', type: 'select', options: cables.map((c) => ({ value: c.id, label: c.id })), emptyLabel: 'Как в типе точек' },
    ],
    values: existing || {},
    extra: existing ? [{ label: 'Удалить', kind: 'danger', onClick: async () => {
      if (!(await confirmDialog('Удалить настройку? Точки вернутся к значениям типа.', { yes: 'Удалить', danger: true }))) return false;
      repo.remove(pid, 'cabinetSettings', existing.id); return true;
    } }] : [],
    onSubmit: (v) => {
      if (v.cables !== undefined && !(v.cables >= 0)) { toast('Число кабелей — число'); return false; }
      const id = idOf(v.cabinet, v.typeId);
      const ops = [{ coll: 'cabinetSettings', id, data: { cabinet: v.cabinet, typeId: v.typeId, cables: v.cables, cable: v.cable } }];
      if (existing && existing.id !== id) repo.remove(pid, 'cabinetSettings', existing.id);
      repo.save(pid, ops);
      toast('Сохранено — метраж и дохи пересчитаны');
    },
  });
}

export function cabinetsView() {
  const rows = [...state.ctx.cabinetSettings].sort((a, b) => `${a.cabinet}${a.typeId}`.localeCompare(`${b.cabinet}${b.typeId}`, 'ru', { numeric: true }));
  return h('div', {},
    h('div', { class: 'mut', style: { marginBottom: '10px' } }, 'Для конкретного шкафа и типа точек можно задать своё число кабелей и тип кабеля. Остальные точки считаются по справочнику «Типы точек».'),
    h('div', { class: 'btns', style: { marginTop: 0 } }, h('button', { onclick: () => settingForm(null) }, '➕ Добавить настройку')),
    h('div', { class: 'card', style: { padding: 0, marginTop: '12px' } },
      rows.length ? rows.map((s) => h('div', { class: 'item', onclick: () => settingForm(s) },
        h('div', { class: 'name' }, `Шкаф ${s.cabinet} · ${s.typeId}`,
          h('div', { class: 'sub' }, `${s.cables ?? 'как в типе'} каб. · ${s.cable || 'кабель по типу'}`))))
        : h('div', { class: 'empty' }, 'Настроек пока нет.')));
}
