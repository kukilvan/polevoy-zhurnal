// Оболочка: верхняя панель, нижняя панель из 5 экранов, меню, переключение экранов.
import { h, openModal } from './ui.js';
import { state, subscribe, currentProject, ready } from './store.js';
import { projectsView, projectForm } from './views/projects.js';
import { projectView } from './views/project.js';
import { meterView } from './views/points.js';
import { cabinetsView } from './views/cabinets.js';
import { logView } from './views/log.js';
import { dohView } from './views/doh.js';
import { todosView } from './views/todos.js';
import { journalView } from './views/journal.js';
import { soonView } from './views/soon.js';

const TABS = [
  ['project', 'Проект', '🏗'], ['meter', 'Метраж', '📏'], ['todos', 'Дела', '✅'], ['journal', 'Журнал', '📒'], ['doh', 'Дохот', '📝'],
];
const SCREEN_TITLES = { projects: 'Все проекты', cabinets: 'Настройки шкафа', log: 'Журнал событий' };

export function createShell({ user, onLogout, diag }) {
  const root = document.getElementById('app');
  const ui = { tab: 'project', screen: null, go, open, back: () => { ui.screen = null; render(); }, render };
  function go(tab) { ui.tab = tab; ui.screen = null; render(); window.scrollTo(0, 0); }
  function open(screen) { ui.screen = screen; render(); window.scrollTo(0, 0); }

  function menu() {
    const p = currentProject();
    const item = (label, fn) => h('button', { class: 'menu-item', onclick: () => { close(); fn(); } }, label);
    const close = openModal('Меню', h('div', {},
      item('📁 Все проекты', () => open('projects')),
      item('➕ Новый проект', () => projectForm(null, ui)),
      item('🗄 Настройки шкафа', () => open('cabinets')),
      p?.managerLink && item('📊 Таблица для руководства', () => window.open(p.managerLink, '_blank')),
      item('🧾 Журнал событий', () => open('log')),
      h('div', { class: 'mut', style: { padding: '10px 4px' } }, user.displayName || user.email),
      item('🚪 Выйти', onLogout)));
  }

  function content() {
    if (ui.screen === 'log') return logView(ui, diag);
    if (!state.projectsLoaded) return h('div', { class: 'empty' }, 'Загрузка…');
    if (ui.screen === 'projects') return projectsView(ui);
    if (!currentProject()) return projectView(ui); // «Создать проект»
    if (!ready()) return h('div', { class: 'empty' }, 'Загрузка данных проекта…');
    if (ui.screen === 'cabinets') return cabinetsView(ui);
    switch (ui.tab) {
      case 'project': return projectView(ui);
      case 'meter': return meterView(ui);
      case 'doh': return dohView(ui);
      case 'todos': return todosView();
      case 'journal': return journalView();
      default: return soonView(ui.tab);
    }
  }

  function render() {
    const p = currentProject();
    const title = ui.screen ? SCREEN_TITLES[ui.screen] : (p?.name || 'Полевой журнал');
    root.replaceChildren(
      h('div', { class: 'topbar' },
        ui.screen ? h('button', { class: 'sec', onclick: () => ui.back() }, '←') : h('button', { class: 'sec', onclick: menu }, '☰'),
        h('div', { class: 'title' }, title),
        h('span', { class: `pill ${state.online ? 'ok' : 'warn'}` }, state.online ? 'онлайн' : 'офлайн'),
        ui.screen ? null : h('button', { class: 'sec', onclick: menu }, '⋯')),
      h('div', { class: 'wrap' }, content()),
      h('nav', {}, TABS.map(([id, label, icon]) => h('button', { class: !ui.screen && ui.tab === id ? 'on' : '', onclick: () => go(id) }, icon, h('br'), h('small', {}, label)))));
  }

  window.addEventListener('online', () => { state.online = true; render(); });
  window.addEventListener('offline', () => { state.online = false; render(); });
  const unsub = subscribe(render);
  render();
  return { destroy: () => { unsub(); } };
}
