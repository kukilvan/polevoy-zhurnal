// Вкладка «История»: строки точка × работа (из них считаются статусы) и «Правка» без записи в отчёт.
import { h, formModal, toast } from '../ui.js';
import { state, getRepo, currentProject, infoOf } from '../store.js';
import { dateText, workApplicable } from '../../domain/index.js';
import { hint } from './guide.js';
import { memberName } from './members.js';
import { pointsPicker, todayIso } from './doh.js';

let search = '';

export function whoIs(p, uid) {
  if (!uid) return '';
  const i = (p.memberUids || []).indexOf(uid);
  const email = i >= 0 ? (p.memberEmails || [])[i] : (p.removedMembers || {})[uid];
  if (!email) return '';
  return memberName(p, email) || email;
}

function rows() {
  const ctx = state.ctx; const out = [];
  ctx.journalByPoint.forEach((list, pointId) => {
    const pt = ctx.points.get(pointId);
    list.forEach((r) => out.push({ ...r, label: pt?.label || '?', work: ctx.catalog.get(r.workId)?.name || r.workId, point: pt }));
  });
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.label.localeCompare(b.label, 'ru', { numeric: true })));
}

// presetIds — точки, уже выбранные (например, на плане); тогда окно называется «Работы по выбранным точкам»
export function editForm(presetIds = null, onDone = null) {
  const repo = getRepo(); const pid = currentProject().id; const ctx = state.ctx;
  // добавлять отметки — точкам, которым ещё есть что делать; убирать — только там, где отметки есть
  const anyOpen = (pt) => [...ctx.catalog.values()].some((w) => w.active !== false && workApplicable(pt, ctx, w, infoOf));
  const picker = pointsPicker({ fits: (pt, v) => (v.remove ? (ctx.journalByPoint.get(pt.id) || []).length > 0 : anyOpen(pt)) });
  if (presetIds?.length) picker.set(presetIds);
  let selected = new Set(); let box = null; let lastKey = '';
  const works = {
    el: (box = h('div', { class: 'picklist' }, h('div', { class: 'mut' }, 'Сначала выберите точки'))),
    get: () => [...selected],
    update: (v) => {
      const pts = (v.pointIds || []).map((id) => ctx.points.get(id)).filter(Boolean);
      // добавление — работы, которые ждёт хотя бы одна из точек; удаление — работы, по которым у этих точек есть отметки
      const marked = new Set(pts.flatMap((pt) => (ctx.journalByPoint.get(pt.id) || []).map((r) => r.workId)));
      const list = [...ctx.catalog.values()].filter((w) => (v.remove ? marked.has(w.id) : (w.active !== false && pts.some((pt) => workApplicable(pt, ctx, w, infoOf)))));
      const key = `${v.remove ? 'r' : 'a'}:${list.map((w) => w.id).join(',')}`;
      if (key === lastKey) return; lastKey = key;
      selected = new Set([...selected].filter((id) => list.some((w) => w.id === id)));
      box.replaceChildren();
      if (!list.length) { box.append(h('div', { class: 'mut' }, pts.length ? (v.remove ? 'У этих точек нет отметок' : 'Для этих точек нет работ, которых они ждут') : 'Сначала выберите точки')); return; }
      list.forEach((w) => {
        const cb = h('input', { type: 'checkbox', checked: selected.has(w.id), onchange: () => { cb.checked ? selected.add(w.id) : selected.delete(w.id); } });
        box.append(h('label', { class: 'pickrow' }, cb, h('span', {}, w.name), h('small', {}, w.workType)));
      });
    },
  };
  formModal({
    title: presetIds?.length ? 'Работы по выбранным точкам' : 'Правка истории', submitLabel: 'Применить',
    fields: [
      { key: 'date', label: 'Дата', type: 'date', required: true },
      { key: 'pointIds', label: 'Точки', type: 'custom', required: true, build: (api) => { picker.bind(api.values, api.changed); if (presetIds?.length) picker.set(presetIds); return picker; } },
      { key: 'workIds', label: 'Работы', type: 'custom', required: true, build: () => works },
      { key: 'remove', label: 'Убрать отметки (вместо добавления)', type: 'checkbox', hint: 'Без галочки — отметки добавятся с этой датой, если их ещё нет. В отчёт правка не попадает.' },
    ],
    values: { date: todayIso() },
    onSubmit: (v) => {
      let n = 0;
      if (v.remove) {
        v.pointIds.forEach((pId) => (ctx.journalByPoint.get(pId) || []).filter((r) => v.workIds.includes(r.workId)).forEach((r) => { repo.remove(pid, 'journal', r.id); n += 1; }));
        toast(`Убрано строк: ${n}`); onDone?.(); return;
      }
      const ops = [];
      v.pointIds.forEach((pId) => v.workIds.forEach((wId) => {
        if ((ctx.journalByPoint.get(pId) || []).some((r) => r.workId === wId)) return;
        ops.push({ coll: 'journal', id: `edit_${pId}_${wId}`, data: { pointId: pId, editDate: v.date, editWorkId: wId, entryId: null, deleted: false } });
      }));
      if (ops.length) repo.save(pid, ops);
      toast(`Добавлено строк: ${ops.length}`); onDone?.();
    },
  });
}

export function journalView(ui) {
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
          h('div', { class: 'sub' }, `${dateText(r.date)}${r.result === 'Не работает' ? ' · не работает' : ''}${r.fromEdit ? ' · правка' : ''}${whoIs(currentProject(), r.by) ? ` · ${whoIs(currentProject(), r.by)}` : ''}`)))))
      : (all.length ? h('div', { class: 'empty' }, 'Ничего не найдено') : hint(ui, 'Записей в истории пока нет. Они появляются сами, когда в отчёте отмечены работы на точках.', 'status', '📖 Как это работает')));
  };
  fill();
  return h('div', {},
    h('div', { class: 'btns', style: { marginTop: 0 } }, h('button', { class: 'sec', onclick: editForm }, '✏️ Правка истории')),
    info,
    h('input', { type: 'search', placeholder: 'Поиск: точка или работа', value: search, oninput: (e) => { search = e.target.value; fill(); } }),
    h('div', { style: { height: '10px' } }), box);
}
