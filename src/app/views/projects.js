// Все проекты, создание и правка проекта.
import { h, formModal, confirmDialog, toast } from '../ui.js';
import { state, liveProjects, archivedProjects, deletedProjects, currentProject, setCurrentProject, getRepo } from '../store.js';
import { purgeDate } from '../../domain/index.js';

const PROJECT_FIELDS = (configs) => [
  { key: 'name', label: 'Название проекта', required: true, hint: 'Например: Mega Or' },
  { key: 'contractor', label: 'Подрядчик', hint: 'Попадает в шапку доха' },
  { key: 'object', label: 'Объект' },
  { key: 'helper', label: 'Помощник по умолчанию', hint: 'Пусто или «сам» — в доху будет «сам»' },
  { key: 'nameHe', label: 'Название (иврит)' },
  { key: 'objectHe', label: 'Объект (иврит)' },
  { key: 'helperHe', label: 'Помощник (иврит)' },
  ...(configs?.length ? [{ key: 'defaultConfigId', label: 'Конфигурация дверей по умолчанию', type: 'select', options: configs.map((c) => ({ value: c.id, label: c.name })) }] : []),
  { key: 'oneOff', label: 'Разовый выезд (объект указывается в каждом дне)', type: 'checkbox' },
  { key: 'note', label: 'Примечание', type: 'textarea' },
];

export function projectForm(existing, ui) {
  const repo = getRepo();
  const isNew = !existing;
  const configs = isNew ? [] : state.ctx ? [...state.ctx.configs.values()] : [];
  const fields = PROJECT_FIELDS(configs);
  if (!isNew) fields.push({ key: 'active', label: 'Проект активен', type: 'checkbox' });
  formModal({
    title: isNew ? 'Новый проект' : 'Проект',
    fields, values: isNew ? { helper: 'Марина', helperHe: 'מרינה' } : existing,
    submitLabel: isNew ? 'Создать' : 'Сохранить',
    extra: isNew ? [] : [{ label: '📦 В архив', onClick: async () => {
      if (!(await confirmDialog(`Убрать проект «${existing.name}» в архив? Он пропадёт из списка, все данные сохранятся. Вернуть можно в «Все проекты» → «Архив».`, { yes: 'В архив' }))) return false;
      repo.saveProject(existing.id, { archived: true, archivedAt: Date.now(), archivedBy: repo.by.uid });
      toast('Проект в архиве'); return true;
    } }, { label: 'Удалить', kind: 'danger', onClick: async () => {
      if (!(await confirmDialog(`Удалить проект «${existing.name}»? Данные хранятся ещё год, до этого проект можно вернуть («Все проекты» → «Удалённые»). Если проект просто не нужен сейчас, лучше «В архив».`, { yes: 'Удалить', danger: true }))) return false;
      repo.saveProject(existing.id, { deleted: true, deletedAt: Date.now(), deletedBy: repo.by.uid });
      toast('Проект удалён'); return true;
    } }],
    onSubmit: (v) => {
      if (isNew) {
        const pid = repo.createProject({ ...v, oneOff: !!v.oneOff, defaultConfigId: undefined });
        setCurrentProject(pid, { pending: true });
        ui.go('project'); toast('Проект создан');
      } else {
        repo.saveProject(existing.id, { ...v, oneOff: !!v.oneOff });
        toast('Сохранено');
      }
    },
  });
}

export function projectsView(ui) {
  const list = liveProjects().sort((a, b) => (b.lastWorkDate || b.createdAt || 0) - (a.lastWorkDate || a.createdAt || 0));
  const cur = currentProject();
  return h('div', {},
    h('div', { class: 'btns' }, h('button', { onclick: () => projectForm(null, ui) }, '➕ Новый проект')),
    list.length ? h('div', { class: 'card', style: { marginTop: '12px', padding: 0 } },
      list.map((p) => h('div', { class: 'item', onclick: () => { setCurrentProject(p.id); ui.go('project'); } },
        h('div', { class: 'name' }, p.name, h('div', { class: 'sub' }, [p.contractor, p.object].filter(Boolean).join(' · ') || '—')),
        p.active === false ? h('span', { class: 'pill' }, 'не активен') : null,
        cur?.id === p.id ? h('span', { class: 'pill ok' }, 'текущий') : null)))
      : h('div', { class: 'empty' }, 'Проектов пока нет. Создайте первый.'),
    sideList(`📦 Архив`, archivedProjects(), (p) => `В архиве с ${dateOf(p.archivedAt)}`, (p) => repo().saveProject(p.id, { archived: false, archivedAt: null, archivedBy: null }), 'Проект возвращён из архива'),
    sideList('🗑 Удалённые проекты', deletedProjects(), (p) => (p.deletedAt ? `Удалится навсегда ${dateOf(purgeDate(p.deletedAt))}` : 'Удалён'), (p) => repo().saveProject(p.id, { deleted: false, deletedAt: null, deletedBy: null }), 'Проект возвращён'));
}

const repo = () => getRepo();
const dateOf = (ms) => (ms ? new Date(ms).toLocaleDateString('ru-RU') : '—');
// Свёрнутый список проектов не из основного списка (архив, удалённые) с кнопкой «Вернуть»
function sideList(title, list, subOf, restore, doneText) {
  if (!list.length) return null;
  return h('details', { class: 'card', style: { marginTop: '12px', padding: '10px 14px' } },
    h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, `${title} (${list.length})`),
    list.map((p) => h('div', { class: 'item', style: { padding: '8px 0' } },
      h('div', { class: 'name' }, p.name, h('div', { class: 'sub' }, subOf(p))),
      h('button', { class: 'sec', onclick: () => { restore(p); toast(doneText); } }, 'Вернуть'))));
}
