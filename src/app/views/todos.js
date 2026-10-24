// Вкладка «Дела»: чек-лист проекта и справочные заметки.
import { h, formModal, confirmDialog, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { newId } from '../repo.js';

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

// ---------- заметки ----------
// сворачивание заметок помнится на этом устройстве
const COLL_KEY = 'pm.notesCollapsed';
const loadCollapsed = () => { try { return new Set(JSON.parse(localStorage.getItem(COLL_KEY) || '[]')); } catch { return new Set(); } };
const saveCollapsed = (set) => { try { localStorage.setItem(COLL_KEY, JSON.stringify([...set])); } catch { /* нет доступа */ } };
const DONE_KEY = 'pm.todosDoneOpen';
let quickDraft = ''; let quickRefocus = false;
let doneOpen = false; try { doneOpen = localStorage.getItem(DONE_KEY) === '1'; } catch { /* ok */ }

// Заметка на весь экран. Пока набираете текст и клавиатура открыта, прячутся заголовок и кнопки — текст занимает всё место над клавиатурой.
// Сохраняется само (через пару секунд после набора и при выходе), кнопки «Сохранить» нет.
function noteEditor(note) {
  const repo = getRepo(); const pid = currentProject().id;
  const id = note?.id || newId();
  let saved = { title: note?.title || '', text: note?.text || '' };
  let removed = false; let timer = null;
  const title = h('input', { type: 'text', value: saved.title, placeholder: 'Заголовок', style: { flex: 1, minWidth: 0, fontWeight: 700 }, enterkeyhint: 'next' });
  const text = h('textarea', { placeholder: 'Текст заметки', style: { flex: 1, minHeight: 0, width: '100%', resize: 'none', boxSizing: 'border-box', fontSize: '16px', lineHeight: 1.45 } });
  text.value = saved.text;
  const firstLine = (t) => String(t || '').split('\n').map((x) => x.trim()).find(Boolean)?.slice(0, 40) || '';
  function save() {
    clearTimeout(timer); if (removed) return;
    const t = text.value; const ttl = title.value.trim() || saved.title || firstLine(t);
    if (!ttl && !t.trim()) return;
    if (ttl === saved.title && t === saved.text) return;
    repo.save(pid, [{ coll: 'notes', id, data: { title: ttl, text: t } }]);
    saved = { title: ttl, text: t };
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(save, 2000); };
  title.addEventListener('input', later); text.addEventListener('input', later);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.focus(); } });
  const root = document.getElementById('modal-root') || document.body;
  const ed = h('div', { class: 'noteed' });
  const close = () => { save(); ed.remove(); if (!root.children.length) document.body.classList.remove('noscroll'); };
  const head = h('div', { class: 'noteed-head' },
    h('button', { class: 'sec', type: 'button', onclick: close, 'aria-label': 'Назад' }, '←'), title,
    note ? h('button', { class: 'sec', type: 'button', 'aria-label': 'Удалить', onclick: async () => {
      if (!(await confirmDialog('Удалить заметку?', { yes: 'Удалить', danger: true }))) return;
      removed = true; clearTimeout(timer); repo.remove(pid, 'notes', note.id); ed.remove(); if (!root.children.length) document.body.classList.remove('noscroll');
    } }, '🗑') : null);
  const doneBar = h('div', { class: 'noteed-done' }, h('button', { type: 'button', onclick: () => { text.blur(); save(); } }, '✓ Готово'));
  // набор текста: прячем шапку; заголовок: шапка на месте
  text.addEventListener('focus', () => ed.classList.add('typing'));
  text.addEventListener('blur', () => { ed.classList.remove('typing'); save(); });
  title.addEventListener('blur', save);
  ed.append(head, doneBar, text);
  root.appendChild(ed); document.body.classList.add('noscroll');
  if (!note) title.focus();
}

export function todosView() {
  const repo = getRepo(); const pid = currentProject().id;
  const todos = [...state.ctx.todos.values()].sort((a, b) => todoOrder(a) - todoOrder(b));
  const notes = [...state.ctx.notes.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const toggle = (t) => repo.save(pid, [{ coll: 'todos', id: t.id, data: { done: !t.done, doneAt: t.done ? null : Date.now() } }]);
  const active = todos.filter((t) => !t.done); const done = todos.filter((t) => t.done);
  // быстрое добавление дела: написать и нажать Enter или «＋»
  // вкладка перерисовывается при любом изменении данных — недописанный текст и фокус сохраняем
  const quick = h('input', { type: 'text', placeholder: 'Новое дело…', enterkeyhint: 'done', value: quickDraft, style: { flex: 1, minWidth: 0 } });
  quick.addEventListener('input', () => { quickDraft = quick.value; });
  if (quickRefocus) { quickRefocus = false; setTimeout(() => quick.isConnected && quick.focus(), 0); }
  const addQuick = () => { const v = quick.value.trim(); if (!v) return; quickDraft = ''; quickRefocus = true; quick.value = ''; repo.save(pid, [{ coll: 'todos', data: { text: v, done: false, addedAt: Date.now() } }]); setTimeout(() => quick.isConnected && quick.focus(), 0); };
  quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addQuick(); } });
  const row = (t) => h('div', { class: 'todo-row' },
    h('input', { type: 'checkbox', class: 'todo-cb', checked: !!t.done, onchange: () => toggle(t), 'aria-label': 'Выполнено' }),
    h('div', { class: 'todo-text', style: { opacity: t.done ? 0.55 : 1, textDecoration: t.done ? 'line-through' : 'none' }, onclick: () => todoForm(t) }, t.text));
  const doneBox = h('div', {});
  const fillDone = () => {
    doneBox.replaceChildren(h('div', { class: 'group', style: { padding: '14px 4px 6px', cursor: 'pointer', userSelect: 'none' }, onclick: () => { doneOpen = !doneOpen; try { localStorage.setItem(DONE_KEY, doneOpen ? '1' : '0'); } catch { /* ok */ } fillDone(); } }, `${doneOpen ? '▾' : '▸'} Выполнено (${done.length})`),
      doneOpen ? h('div', { class: 'card', style: { padding: 0 } }, done.map(row)) : '');
  };
  if (done.length) fillDone();
  // заметки: свернуть (виден только заголовок) или развернуть; нажатие на заголовок/текст открывает заметку на весь экран
  const collapsed = loadCollapsed();
  const notesBox = h('div', {});
  const fillNotes = () => {
    if (!notes.length) { notesBox.replaceChildren(); return; }
    const allCol = notes.every((n) => collapsed.has(n.id));
    notesBox.replaceChildren(
      h('div', { class: 'group', style: { padding: '14px 4px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, h('span', {}, `Заметки (${notes.length})`),
        h('button', { class: 'sec', style: { padding: '2px 10px', fontSize: '13px' }, onclick: () => { if (allCol) collapsed.clear(); else notes.forEach((n) => collapsed.add(n.id)); saveCollapsed(collapsed); fillNotes(); } }, allCol ? 'Развернуть все' : 'Свернуть все')),
      h('div', { class: 'card', style: { padding: 0 } }, notes.map((n) => {
        const col = collapsed.has(n.id) || !n.text;
        return h('div', { class: 'note-row' },
          h('button', { class: 'note-chev', type: 'button', disabled: !n.text, 'aria-label': col ? 'Развернуть' : 'Свернуть', onclick: () => { collapsed.has(n.id) ? collapsed.delete(n.id) : collapsed.add(n.id); saveCollapsed(collapsed); fillNotes(); } }, n.text ? (col ? '▸' : '▾') : '·'),
          h('div', { class: 'name', onclick: () => noteEditor(n) }, n.title, !col && n.text ? h('div', { class: 'sub', style: { whiteSpace: 'pre-wrap' } }, n.text) : null));
      })));
  };
  fillNotes();
  return h('div', {},
    h('div', { class: 'quick-add' }, quick, h('button', { type: 'button', onclick: addQuick, 'aria-label': 'Добавить дело' }, '＋'), h('button', { class: 'sec', type: 'button', onclick: () => noteEditor(null) }, '📌 Заметка')),
    h('div', { class: 'mut', style: { margin: '10px 2px' } }, todos.length ? `Не выполнено: ${active.length} из ${todos.length}` : 'Дел пока нет. Напишите дело выше и нажмите Enter.'),
    active.length ? h('div', { class: 'card', style: { padding: 0 } }, active.map(row)) : null,
    done.length ? doneBox : null,
    notesBox);
}
