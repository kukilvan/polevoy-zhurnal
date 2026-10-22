// Выбор точки проекта: поиск, тип, шкаф, «только без места на чертеже»; по выбору — onPick(point, { rename })
import { h, openModal } from '../ui.js';
import { state } from '../store.js';
import { comparePoints, latinKey } from '../../domain/index.js';
import { drawingFor } from '../drawings.js';

import { typeMatch, typeFilterOptions } from '../typegroups.js';

// onPickMany(points) — можно выбрать несколько точек на одну отметку плана (двойной значок и т.п.)
export function choosePoint({ title, typeId = '', exclude = null, renameLabel = '', onPick, onPickMany = null }) {
  const all = [...state.ctx.points.values()].filter((p) => p.id !== exclude);
  const q = h('input', { type: 'search', placeholder: 'Поиск по названию', style: { flex: 1, minWidth: '120px' } });
  const tSel = h('select', {}, h('option', { value: '' }, 'Все типы'), ...typeFilterOptions(all.map((p) => p.typeId)).map(([v, t]) => h('option', { value: v, selected: v === typeId }, t)));
  const cSel = h('select', {}, h('option', { value: '' }, 'Все шкафы'), ...[...new Set(all.map((p) => p.cabinet || ''))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true })).map((x) => h('option', { value: x }, `Шкаф ${x}`)));
  const noPos = h('input', { type: 'checkbox', checked: true });
  const ren = renameLabel ? h('input', { type: 'checkbox', checked: false }) : null;
  const multi = onPickMany ? h('input', { type: 'checkbox', checked: false }) : null;
  const picked = new Map();
  const goMany = h('button', { style: { display: 'none' }, onclick: async () => { if (!picked.size) return; if ((await onPickMany([...picked.values()].sort(comparePoints))) !== false) c(); } });
  const updGo = () => { goMany.style.display = multi?.checked ? '' : 'none'; goMany.disabled = !picked.size; goMany.textContent = `🔗 Привязать выбранные (${picked.size})${picked.size ? `: ${[...picked.values()].sort(comparePoints).map((p) => p.label).join(', ')}` : ''}`; };
  const listEl = h('div', { class: 'card', style: { padding: 0, maxHeight: '45vh', overflow: 'auto' } });
  const fill = () => {
    const s = q.value.trim().toLowerCase();
    const rows = all.filter((p) => (!s || latinKey(`${p.label} ${p.planName || ''}`).includes(latinKey(s))) && typeMatch(tSel.value, p.typeId) && (!cSel.value || (p.cabinet || '') === cSel.value) && (!noPos.checked || !drawingFor(p)))
      .sort(comparePoints).slice(0, 200);
    listEl.replaceChildren(...(rows.length ? rows.map((p) => { const cb = multi?.checked ? h('input', { type: 'checkbox', checked: picked.has(p.id), style: { width: '22px', height: '22px', flex: 'none' } }) : null; return h('div', { class: 'item', onclick: async () => {
      if (cb) { if (picked.has(p.id)) picked.delete(p.id); else picked.set(p.id, p); cb.checked = picked.has(p.id); updGo(); return; }
      if ((await onPick(p, { rename: !!ren?.checked })) !== false) c(); } }, cb,
      h('div', { class: 'name' }, p.label, h('div', { class: 'sub' }, `${p.typeId}${p.cabinet ? ` · шкаф ${p.cabinet}` : ''}${drawingFor(p) ? ' · уже на чертеже' : ''}`))); }) : [h('div', { class: 'empty' }, 'Ничего не найдено')]));
  };
  [q, tSel, cSel, noPos].forEach((el) => el.addEventListener('input', fill));
  multi?.addEventListener('change', () => { if (ren) { ren.checked = false; ren.disabled = multi.checked; } fill(); updGo(); });
  const c = openModal(title, h('div', {},
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, q, tSel, cSel),
    h('label', { class: 'pickrow' }, noPos, h('span', {}, 'Только точки без места на чертеже')),
    ren ? h('label', { class: 'pickrow' }, ren, h('span', {}, `Переименовать выбранную точку в «${renameLabel}» (как на чертеже)`)) : null,
    multi ? h('label', { class: 'pickrow' }, multi, h('span', {}, '☑ Несколько точек на эту отметку (например, двойной значок)')) : null,
    listEl, onPickMany ? h('div', { class: 'btns' }, goMany) : null), { sticky: true });
  fill();
  return c;
}
