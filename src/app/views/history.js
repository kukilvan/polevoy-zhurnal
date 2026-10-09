// История изменений: кто, когда и что менял; откат одной записи и откат всех правок пользователя за период.
import { h, confirmDialog, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { dateText, entryLine } from '../../domain/index.js';
import { todayIso } from './doh.js';

const COLL_NAMES = {
  points: 'Точка', days: 'День', entries: 'Запись дня', journal: 'Журнал', catalog: 'Каталог', types: 'Тип точек', cables: 'Кабель',
  configs: 'Конфигурация', units: 'Единица', culprits: 'Виновник', delayReasons: 'Причина задержки', cabinetSettings: 'Настройка шкафа',
  todos: 'Дело', notes: 'Заметка',
};
const ACTIONS = { create: 'создал', update: 'изменил', delete: 'удалил', restore: 'вернул', rollback: 'откатил' };

let filter = { uid: '', from: null, to: null };
let cache = null; // { key, rows }

export function describe(coll, data) {
  if (!data) return '—';
  const ctx = state.ctx;
  try {
    switch (coll) {
      case 'points': return data.label;
      case 'days': return dateText(data.date);
      case 'entries': return entryLine(data, ctx, 'ru') || data.workType;
      case 'journal': return `${ctx.points.get(data.pointId)?.label ?? data.pointId ?? ''} · ${ctx.catalog.get(data.editWorkId)?.name ?? (data.entryId ? 'отметка из дня' : '')}`;
      case 'todos': return data.text;
      case 'notes': return data.title;
      case 'cabinetSettings': return `шкаф ${data.cabinet} · ${data.typeId}`;
      default: return data.name || data.id;
    }
  } catch { return data.id || ''; }
}

const startOfDay = (iso) => new Date(`${iso}T00:00:00`).getTime();
const endOfDay = (iso) => new Date(`${iso}T23:59:59.999`).getTime();

async function load() {
  const pid = currentProject().id;
  const since = startOfDay(filter.from);
  const rows = (await getRepo().loadHistory(pid, since)).filter((r) => r.at <= endOfDay(filter.to) && r.coll !== 'history');
  return rows;
}

// Для отката пользователя за период: для каждой записи берём состояние до его ПЕРВОГО изменения в периоде.
function planUserRollback(rows, uid) {
  const mine = rows.filter((r) => r.by === uid).sort((a, b) => a.at - b.at);
  const plan = new Map();
  mine.forEach((r) => { const k = `${r.coll}/${r.docId}`; if (!plan.has(k)) plan.set(k, { coll: r.coll, docId: r.docId, before: r.before, at: r.at }); });
  // записи, которые после этого менял кто-то другой — отмечаем как «конфликт»
  plan.forEach((v, k) => { v.conflict = rows.some((r) => `${r.coll}/${r.docId}` === k && r.by !== uid && r.at > v.at); });
  return [...plan.values()];
}

export function historyView(ui) {
  const p = currentProject();
  if (!filter.from) { const d = new Date(); d.setDate(d.getDate() - 7); filter.from = d.toLocaleDateString('sv'); filter.to = todayIso(); }
  const box = h('div', {}, h('div', { class: 'empty' }, 'Загрузка…'));
  const names = new Map((p.memberUids || []).map((u, i) => [u, p.memberEmails?.[i] || u]));
  Object.entries(p.removedMembers || {}).forEach(([u, e]) => { if (!names.has(u)) names.set(u, `${e} (убран)`); });
  if (state.historyPreselect) { // переход из «Участники → убрать»: выбрать участника и смотреть месяц
    filter.uid = state.historyPreselect; state.historyPreselect = null;
    const d = new Date(); d.setDate(d.getDate() - 30); filter.from = d.toLocaleDateString('sv'); filter.to = todayIso();
  }

  const users = h('select', { onchange: (e) => { filter.uid = e.target.value; fill(); } },
    h('option', { value: '' }, 'Все участники'),
    [...names.entries()].map(([u, e]) => h('option', { value: u, selected: filter.uid === u }, e)));
  const from = h('input', { type: 'date', value: filter.from, onchange: (e) => { filter.from = e.target.value; reload(); } });
  const to = h('input', { type: 'date', value: filter.to, onchange: (e) => { filter.to = e.target.value; reload(); } });
  let rows = [];

  async function reload() { box.replaceChildren(h('div', { class: 'empty' }, 'Загрузка…')); try { rows = await load(); } catch (e) { box.replaceChildren(h('div', { class: 'empty' }, `Не удалось загрузить историю: ${e.message}`)); return; } fill(); }

  function fill() {
    const shown = rows.filter((r) => !filter.uid || r.by === filter.uid);
    const repo = getRepo(); const pid = p.id;
    const items = shown.slice(0, 300).map((r) => {
      const d = new Date(r.at);
      const when = `${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
      return h('div', { class: 'item' },
        h('div', { class: 'name' }, `${ACTIONS[r.action] || r.action}: ${COLL_NAMES[r.coll] || r.coll} — ${describe(r.coll, r.after || r.before)}`,
          h('div', { class: 'sub' }, `${when} · ${r.byName || names.get(r.by) || r.by}`)),
        h('button', { class: 'sec', style: { flex: 'none' }, onclick: async () => {
          if (!(await confirmDialog(`Отменить это изменение (${COLL_NAMES[r.coll] || r.coll})? Запись вернётся к состоянию до него.`, { yes: 'Откатить' }))) return;
          repo.revertTo(pid, r.coll, r.docId, r.before); toast('Откат выполнен'); setTimeout(reload, 400);
        } }, '↩'));
    });
    const bulk = filter.uid ? h('div', { class: 'btns' }, h('button', { class: 'danger', onclick: async () => {
      const plan = planUserRollback(rows, filter.uid);
      if (!plan.length) { toast('У этого участника нет изменений за период'); return; }
      const conflicts = plan.filter((x) => x.conflict).length;
      const withConf = conflicts ? await confirmDialog(`Записей к откату: ${plan.length}. Из них ${conflicts} позже менял кто-то другой. Откатить и их тоже? («Нет» — только остальные ${plan.length - conflicts})`, { yes: 'Да, и их', no: 'Только остальные' }) : true;
      const todo = plan.filter((x) => withConf || !x.conflict);
      if (!(await confirmDialog(`Откатить ${todo.length} записей участника ${names.get(filter.uid) || ''} за период ${dateText(filter.from)} – ${dateText(filter.to)}?`, { yes: 'Откатить', danger: true }))) return;
      todo.forEach((x) => repo.revertTo(pid, x.coll, x.docId, x.before));
      toast(`Откачено записей: ${todo.length}`); setTimeout(reload, 600);
    } }, '↩ Откатить все правки участника за период')) : null;
    box.replaceChildren(bulk, h('div', { class: 'mut', style: { margin: '8px 2px' } }, `Событий: ${shown.length}${shown.length > 300 ? ' · показаны первые 300' : ''}`),
      shown.length ? h('div', { class: 'card', style: { padding: 0 } }, items) : h('div', { class: 'empty' }, 'За этот период изменений нет.'));
  }

  reload();
  return h('div', {},
    h('div', { class: 'mut', style: { marginBottom: '8px' } }, 'Любое изменение можно отменить кнопкой ↩. Сам откат тоже записывается в историю.'),
    h('label', { class: 'field' }, h('span', {}, 'Участник'), users),
    h('div', { class: 'row' }, h('label', { class: 'field grow' }, h('span', {}, 'С'), from), h('label', { class: 'field grow' }, h('span', {}, 'По'), to)),
    box);
}
