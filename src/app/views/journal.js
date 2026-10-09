// Вкладка «Журнал»: строки точка × работа (из них считаются статусы) и «Правка» без записи в дох.
import { h, formModal, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { dateText } from '../../domain/index.js';
import { pointsPicker, todayIso } from './doh.js';

let search = '';

function rows() {
  const ctx = state.ctx; const out = [];
  ctx.journalByPoint.forEach((list, pointId) => {
    const pt = ctx.points.get(pointId);
    list.forEach((r) => out.push({ ...r, label: pt?.label || '?', work: ctx.catalog.get(r.workId)?.name || r.workId, point: pt }));
  });
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.label.localeCompare(b.label, 'ru', { numeric: true })));
}

function editForm() {
  const repo = getRepo(); const pid = currentProject().id; const ctx = state.ctx;
  const picker = pointsPicker({ typesOf: () => null });
  let selected = new Set(); let box = null; let lastKey = '';
  const works = {
    el: (box = h('div', { class: 'picklist' }, h('div', { class: 'mut' }, 'Сначала выберите точки'))),
    get: () => [...selected],
    update: (v) => {
      const types = new Set((v.pointIds || []).map((id) => ctx.points.get(id)?.typeId));
      const list = [...ctx.catalog.values()].filter((w) => w.active !== false && (w.forTypes || []).some((t) => types.has(t)));
      const key = list.map((w) => w.id).join(',');
      if (key === lastKey) return; lastKey = key;
      selected = new Set([...selected].filter((id) => list.some((w) => w.id === id)));
      box.replaceChildren();
      if (!list.length) { box.append(h('div', { class: 'mut' }, 'Сначала выберите точки')); return; }
      list.forEach((w) => {
        const cb = h('input', { type: 'checkbox', checked: selected.has(w.id), onchange: () => { cb.checked ? selected.add(w.id) : selected.delete(w.id); } });
        box.append(h('label', { class: 'pickrow' }, cb, h('span', {}, w.name), h('small', {}, w.workType)));
      });
    },
  };
  formModal({
    title: 'Правка журнала', submitLabel: 'Применить',
    fields: [
      { key: 'date', label: 'Дата', type: 'date', required: true },
      { key: 'pointIds', label: 'Точки', type: 'custom', required: true, build: (api) => { picker.bind(api.values, api.changed); return picker; } },
      { key: 'workIds', label: 'Работы', type: 'custom', required: true, build: () => works },
      { key: 'remove', label: 'Убрать отметки (вместо добавления)', type: 'checkbox', hint: 'Без галочки — отметки добавятся с этой датой, если их ещё нет. В дох правка не попадает.' },
    ],
    values: { date: todayIso() },
    onSubmit: (v) => {
      let n = 0;
      if (v.remove) {
        v.pointIds.forEach((pId) => (ctx.journalByPoint.get(pId) || []).filter((r) => v.workIds.includes(r.workId)).forEach((r) => { repo.remove(pid, 'journal', r.id); n += 1; }));
        toast(`Убрано строк: ${n}`); return;
      }
      const ops = [];
      v.pointIds.forEach((pId) => v.workIds.forEach((wId) => {
        if ((ctx.journalByPoint.get(pId) || []).some((r) => r.workId === wId)) return;
        ops.push({ coll: 'journal', id: `edit_${pId}_${wId}`, data: { pointId: pId, editDate: v.date, editWorkId: wId, entryId: null, deleted: false } });
      }));
      if (ops.length) repo.save(pid, ops);
      toast(`Добавлено строк: ${ops.length}`);
    },
  });
}

export function journalView() {
  const all = rows();
  const info = h('div', { class: 'mut', style: { margin: '10px 2px' } });
  const box = h('div', {});
  const fill = () => {
    const q = search.trim().toLowerCase();
    const list = all.filter((r) => !q || `${r.label} ${r.work} ${r.action}`.toLowerCase().includes(q));
    const shown = list.slice(0, 300);
    info.textContent = `Строк: ${all.length}${list.length > shown.length ? ` · показаны первые ${shown.length}` : ''}`;
    box.replaceChildren(shown.length ? h('div', { class: 'card', style: { padding: 0 } }, shown.map((r) =>
      h('div', { class: 'item' },
        h('div', { class: 'name' }, `${r.label} · ${r.work}`,
          h('div', { class: 'sub' }, `${dateText(r.date)}${r.result === 'Не работает' ? ' · не работает' : ''}${r.fromEdit ? ' · правка' : ''}`)))))
      : h('div', { class: 'empty' }, all.length ? 'Ничего не найдено' : 'Строк журнала пока нет. Они появляются, когда в дохе отмечены точки.'));
  };
  fill();
  return h('div', {},
    h('div', { class: 'btns', style: { marginTop: 0 } }, h('button', { class: 'sec', onclick: editForm }, '✏️ Правка журнала')),
    info,
    h('input', { type: 'search', placeholder: 'Поиск: точка или работа', value: search, oninput: (e) => { search = e.target.value; fill(); } }),
    h('div', { style: { height: '10px' } }), box);
}
