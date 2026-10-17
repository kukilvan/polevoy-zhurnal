// Выбор точки проекта: поиск, тип, шкаф, «только без места на чертеже»; по выбору — onPick(point, { rename })
import { h, openModal } from '../ui.js';
import { state } from '../store.js';
import { comparePoints } from '../../domain/index.js';
import { drawingFor } from '../drawings.js';

export function choosePoint({ title, typeId = '', exclude = null, renameLabel = '', onPick }) {
  const all = [...state.ctx.points.values()].filter((p) => p.id !== exclude);
  const q = h('input', { type: 'search', placeholder: 'Поиск по названию', style: { flex: 1, minWidth: '120px' } });
  const tSel = h('select', {}, h('option', { value: '' }, 'Все типы'), ...[...new Set(all.map((p) => p.typeId))].sort((a, b) => a.localeCompare(b, 'ru')).map((t) => h('option', { value: t, selected: t === typeId }, t)));
  const cSel = h('select', {}, h('option', { value: '' }, 'Все шкафы'), ...[...new Set(all.map((p) => p.cabinet || ''))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true })).map((x) => h('option', { value: x }, `Шкаф ${x}`)));
  const noPos = h('input', { type: 'checkbox', checked: true });
  const ren = renameLabel ? h('input', { type: 'checkbox', checked: false }) : null;
  const listEl = h('div', { class: 'card', style: { padding: 0, maxHeight: '45vh', overflow: 'auto' } });
  const fill = () => {
    const s = q.value.trim().toLowerCase();
    const rows = all.filter((p) => (!s || `${p.label} ${p.planName || ''}`.toLowerCase().includes(s)) && (!tSel.value || p.typeId === tSel.value) && (!cSel.value || (p.cabinet || '') === cSel.value) && (!noPos.checked || !drawingFor(p)))
      .sort(comparePoints).slice(0, 200);
    listEl.replaceChildren(...(rows.length ? rows.map((p) => h('div', { class: 'item', onclick: async () => { if ((await onPick(p, { rename: !!ren?.checked })) !== false) c(); } },
      h('div', { class: 'name' }, p.label, h('div', { class: 'sub' }, `${p.typeId}${p.cabinet ? ` · шкаф ${p.cabinet}` : ''}${drawingFor(p) ? ' · уже на чертеже' : ''}`)))) : [h('div', { class: 'empty' }, 'Ничего не найдено')]));
  };
  [q, tSel, cSel, noPos].forEach((el) => el.addEventListener('input', fill));
  const c = openModal(title, h('div', {},
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, q, tSel, cSel),
    h('label', { class: 'pickrow' }, noPos, h('span', {}, 'Только точки без места на чертеже')),
    ren ? h('label', { class: 'pickrow' }, ren, h('span', {}, `Переименовать выбранную точку в «${renameLabel}» (как на чертеже)`)) : null,
    listEl), { sticky: true });
  fill();
  return c;
}
