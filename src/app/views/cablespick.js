// Кабели точки рядом с выбором типа: сразу показаны кабели типа по умолчанию, можно поменять вид и количество
// (например, «RJ45 X2» — тип «Точка», но 2 кабеля). Своё сохраняется в точке (cableOverride), как у типа — не сохраняется.
import { h, qtyList } from '../ui.js';
import { state, currentProject } from '../store.js';
import { typeCablesOf, cableOverrideFor } from '../../domain/index.js';

const fmt = (l) => (l?.length ? l.map((c) => `${c.cable} ×${c.count}`).join(' + ') : 'без кабеля');

// value — свои кабели точки (или null — как у типа); onChange(list) — при каждом изменении
export function cablesPicker({ typeId = '', cabinet = '', value = null, onChange, compact = false } = {}) {
  const ctx = state.ctx; const pid = currentProject()?.id;
  let tid = typeId; let cab = cabinet; let touched = Array.isArray(value);
  const def = () => (tid ? typeCablesOf(ctx, tid, cab, pid) : []);
  const note = h('small', { class: 'mut' });
  const reset = h('button', { type: 'button', class: 'sec', style: { padding: '4px 10px' }, onclick: () => { touched = false; q.set(def().map((c) => ({ value: c.cable, count: c.count }))); refresh(); } }, '↩︎ как у типа');
  const q = qtyList([...ctx.cables.values()].map((c) => ({ value: c.id, label: c.id })), { addLabel: '➕ Кабель', empty: 'Без кабеля', onChange: () => { touched = true; refresh(); } });
  const list = () => q.get().map((x) => ({ cable: x.value, count: x.count }));
  const own = () => (tid ? cableOverrideFor(list(), ctx, tid, cab, pid) : null);
  function refresh() {
    const o = own();
    note.textContent = !tid ? 'Сначала выберите тип' : o ? `Свои кабели (у типа: ${fmt(def())})` : `Как у типа: ${fmt(def())}`;
    reset.style.display = o ? '' : 'none';
    onChange?.(list());
  }
  q.set((Array.isArray(value) ? value : def()).map((c) => ({ value: c.cable, count: c.count })));
  const el = h('div', {}, compact ? null : h('div', { class: 'mut', style: { fontWeight: 600, margin: '4px 0' } }, 'Кабели точки'), q.el,
    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, note, reset));
  refresh();
  return {
    el,
    // тип/шкаф поменялись: если кабели не трогали — показать кабели нового типа
    setType(t, c = cab) { if (t === tid && c === cab) return; tid = t; cab = c; if (!touched) q.set(def().map((x) => ({ value: x.cable, count: x.count }))); refresh(); },
    get: list, override: own, isOwn: () => !!own(),
    // задать свои кабели (null — как у типа)
    setList(l) { touched = Array.isArray(l); q.set((Array.isArray(l) ? l : def()).map((c) => ({ value: c.cable, count: c.count }))); refresh(); },
  };
}

// То же как поле формы (formModal): ключ cableOverride → null (как у типа) или свой список
export function cablesField(point, { label = 'Кабели', hint } = {}) {
  return {
    key: 'cableOverride', label, type: 'custom', visible: (v) => !!v.typeId,
    hint: hint || 'Сразу показаны кабели типа. Поменяйте вид или количество, если у этой точки иначе (например, «X2» — 2 кабеля).',
    build: (api) => {
      const p = cablesPicker({ typeId: point?.typeId || '', cabinet: point?.cabinet || '', value: point?.cableOverride ?? null, compact: true });
      return { el: p.el, update: (v) => p.setType(v.typeId || '', v.cabinet || ''), get: () => p.override() };
    },
  };
}
