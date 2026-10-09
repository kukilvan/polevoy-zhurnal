// Вкладка «Дела»: чек-лист проекта и справочные заметки.
import { h, formModal, confirmDialog, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';

const todoOrder = (t) => (t.done ? 1 : 0) * 1e15 + (t.done ? (t.doneAt || 0) : (t.addedAt || t.createdAt || 0));

function todoForm(todo) {
  const repo = getRepo(); const pid = currentProject().id;
  formModal({
    title: todo ? 'Дело' : 'Новое дело', fields: [{ key: 'text', label: 'Задача', type: 'textarea', required: true }],
    values: { text: todo?.text },
    extra: todo ? [{ label: 'Удалить', kind: 'danger', onClick: async () => {
      if (!(await confirmDialog('Удалить дело?', { yes: 'Удалить', danger: true }))) return false;
      repo.remove(pid, 'todos', todo.id); return true;
    } }] : [],
    onSubmit: (v) => { repo.save(pid, [{ coll: 'todos', id: todo?.id, data: todo ? { text: v.text } : { text: v.text, done: false, addedAt: Date.now() } }]); },
  });
}

function noteForm(note) {
  const repo = getRepo(); const pid = currentProject().id;
  formModal({
    title: note ? 'Заметка' : 'Новая заметка',
    fields: [{ key: 'title', label: 'Заголовок', required: true }, { key: 'text', label: 'Текст', type: 'textarea' }],
    values: { title: note?.title, text: note?.text },
    extra: note ? [{ label: 'Удалить', kind: 'danger', onClick: async () => {
      if (!(await confirmDialog('Удалить заметку?', { yes: 'Удалить', danger: true }))) return false;
      repo.remove(pid, 'notes', note.id); return true;
    } }] : [],
    onSubmit: (v) => { repo.save(pid, [{ coll: 'notes', id: note?.id, data: { title: v.title, text: v.text } }]); },
  });
}

export function todosView() {
  const repo = getRepo(); const pid = currentProject().id;
  const todos = [...state.ctx.todos.values()].sort((a, b) => todoOrder(a) - todoOrder(b));
  const notes = [...state.ctx.notes.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const toggle = (t) => repo.save(pid, [{ coll: 'todos', id: t.id, data: { done: !t.done, doneAt: t.done ? null : Date.now() } }]);
  const open = todos.filter((t) => !t.done).length;
  return h('div', {},
    h('div', { class: 'btns', style: { marginTop: 0 } },
      h('button', { onclick: () => todoForm(null) }, '➕ Дело'),
      h('button', { class: 'sec', onclick: () => noteForm(null) }, '📌 Заметка')),
    h('div', { class: 'mut', style: { margin: '10px 2px' } }, todos.length ? `Не выполнено: ${open} из ${todos.length}` : 'Дел пока нет.'),
    todos.length ? h('div', { class: 'card', style: { padding: 0 } }, todos.map((t) =>
      h('div', { class: 'item' },
        h('button', { class: 'sec', style: { flex: 'none', padding: '8px 12px' }, onclick: () => toggle(t) }, t.done ? '☑' : '☐'),
        h('div', { class: 'name', style: { opacity: t.done ? 0.55 : 1, textDecoration: t.done ? 'line-through' : 'none' }, onclick: () => todoForm(t) }, t.text)))) : null,
    notes.length ? h('div', { class: 'group', style: { padding: '14px 4px 6px' } }, 'Заметки') : null,
    notes.length ? h('div', { class: 'card', style: { padding: 0 } }, notes.map((n) =>
      h('div', { class: 'item', onclick: () => noteForm(n) },
        h('div', { class: 'name' }, n.title, n.text ? h('div', { class: 'sub', style: { whiteSpace: 'pre-wrap' } }, n.text) : null)))) : null);
}
