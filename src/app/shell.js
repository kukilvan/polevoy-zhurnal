// Оболочка: верхняя панель, нижняя панель из 5 экранов, меню, переключение экранов.
import { h, openModal, toast } from './ui.js';
import { state, subscribe, currentProject, ready, getRepo, setCurrentProject, pendingCount } from './store.js';
import { projectsView, projectForm } from './views/projects.js';
import { settingsView, refView, REFS } from './views/settings.js';
import { membersView } from './views/members.js';
import { installView } from './views/install.js';
import { PENDING } from './google.js';
import { onPendingChange } from './repo.js';
import { themeLabel, setTheme, nextTheme } from './theme.js';
import { projectView, updateManagerTable, updateTable, backupNow } from './views/project.js';
import { meterView } from './views/points.js';
import { cabinetsView } from './views/cabinets.js';
import { logView } from './views/log.js';
import { dohView } from './views/doh.js';
import { todosView } from './views/todos.js';
import { journalView } from './views/journal.js';
import { importView } from './views/import.js';
import { historyView } from './views/history.js';
import { monthView } from './views/month.js';
import { tablesView } from './views/tables.js';
import { guideView, maybeWelcome } from './views/guide.js';
import { soonView } from './views/soon.js';

const TABS = [
  ['project', 'Проект', '🏗'], ['meter', 'Точки', '📏'], ['todos', 'Дела', '✅'], ['journal', 'Журнал', '📒'], ['doh', 'Дохот', '📝'], ['settings', 'Настройки', '⚙️'],
];
const SCREEN_TITLES = { projects: 'Все проекты', cabinets: 'Настройки шкафа', month: 'Месяц', history: 'История', import: 'Импорт', install: 'Привязка установки', ref: 'Справочник', members: 'Участники', tables: 'Таблицы для руководства', guide: 'Как пользоваться', log: 'Журнал событий' };

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
      item('📅 Месяц (отчёт начальнику)', () => open('month')),
      item('🕘 История и откат', () => open('history')),
      item('📖 Как пользоваться', () => open('guide')),
      item(`🎨 Тема: ${themeLabel()} → ${themeLabel(nextTheme())}`, () => { setTheme(nextTheme()); render(); }),
      item('⚙️ Настройки', () => go('settings')),
      item('🧾 Журнал событий', () => open('log')),
      h('div', { class: 'mut', style: { padding: '10px 4px' } }, user.displayName || user.email),
      item('🚪 Выйти', onLogout)));
  }

  function invitesBanner() {
    if (!state.invitations.length) return null;
    return h('div', {}, state.invitations.map((p) => h('div', { class: 'card', style: { borderColor: 'var(--accent, #0ea5e9)' } },
      h('b', {}, `Вас приглашают в проект «${p.name}»`),
      h('div', { class: 'mut' }, `От: ${p.memberEmails?.[0] || '—'}${p.object ? ` · ${p.object}` : ''}`),
      h('div', { class: 'btns' },
        h('button', { onclick: () => { getRepo().acceptInvite(p); setCurrentProject(p.id, { pending: true }); ui.go('project'); } }, 'Принять'),
        h('button', { class: 'sec', onclick: () => getRepo().declineInvite(p) }, 'Отклонить')))));
  }

  function content() {
    if (ui.screen === 'log') return logView(ui, diag);
    if (!state.projectsLoaded) return h('div', { class: 'empty' }, 'Загрузка…');
    if (ui.screen === 'projects') return projectsView(ui);
    if (!currentProject()) return projectView(ui); // «Создать проект»
    if (!ready()) return h('div', { class: 'empty' }, 'Загрузка данных проекта…');
    if (ui.screen === 'cabinets') return cabinetsView(ui);
    if (ui.screen === 'install') return installView();
    if (ui.screen === 'ref') return refView();
    if (ui.screen === 'members') return membersView(ui);
    if (ui.screen === 'tables') return tablesView(ui);
    if (ui.screen === 'guide') return guideView(ui);
    if (ui.screen === 'month') return monthView(ui);
    if (ui.screen === 'history') return historyView(ui);
    if (ui.screen === 'import') return importView();
    switch (ui.tab) {
      case 'project': return projectView(ui);
      case 'meter': return meterView(ui);
      case 'doh': return dohView(ui);
      case 'settings': return settingsView(ui);
      case 'todos': return todosView();
      case 'journal': return journalView(ui);
      default: return soonView(ui.tab);
    }
  }

  // «⏳ N ждут отправки»: записи, ещё не дошедшие до сервера. Если онлайн, а они висят дольше полутора минут — красный
  let pendingSince = 0; let badge = null;
  const paintBadge = () => {
    const n = pendingCount();
    if (!n) { pendingSince = 0; if (badge) badge.style.display = 'none'; return n; }
    if (!pendingSince) pendingSince = Date.now();
    if (badge) {
      badge.style.display = ''; badge.textContent = `⏳ ${n} ждут отправки`;
      badge.className = `pill ${state.online && Date.now() - pendingSince > 90000 ? 'err' : 'warn'}`;
    }
    return n;
  };
  function pendingBadge() {
    badge = h('span', { class: 'pill warn', style: { display: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }, onclick: () => {
      const n = pendingCount();
      toast(!n ? 'Всё отправлено на сервер' : state.online ? `Ждут отправки: ${n}. Если число не уменьшается — проверьте связь или лимит базы (Проект → «Чтений базы»)` : `Ждут отправки: ${n}. Они уйдут на сервер сами, когда появится интернет`);
    } });
    paintBadge();
    return badge;
  }
  setInterval(paintBadge, 5000);
  onPendingChange(paintBadge);

  function render() {
    const p = currentProject();
    const title = ui.screen === 'ref' ? REFS[state.settingsRef]?.title : ui.screen ? SCREEN_TITLES[ui.screen] : (p?.name || 'Полевой журнал');
    root.replaceChildren(
      h('div', { class: 'topbar' },
        ui.screen ? h('button', { class: 'sec', onclick: () => ui.back() }, '←') : h('button', { class: 'sec', onclick: menu }, '☰'),
        h('div', { class: 'title' }, title),
        pendingBadge(),
        h('span', { class: `pill ${state.online ? 'ok' : 'warn'}` }, state.online ? 'онлайн' : 'офлайн'),
        ui.screen ? null : h('button', { class: 'sec', onclick: menu }, '⋯')),
      h('div', { class: 'wrap' }, invitesBanner(), content()),
      h('nav', {}, TABS.map(([id, label, icon]) => h('button', { class: !ui.screen && ui.tab === id ? 'on' : '', onclick: () => go(id) }, icon, h('br'), h('small', {}, label)))));
  }

  window.addEventListener('online', () => { state.online = true; render(); });
  window.addEventListener('offline', () => { state.online = false; render(); });
  const unsub = subscribe(() => { render(); if (ready()) maybeWelcome(ui, user); });
  render();

  // Возврат с Google после выдачи доступа (iPhone): дожидаемся загрузки проекта и запускаем обновление таблицы руководства
  try {
    if (localStorage.getItem(PENDING)) {
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        let ok = false; try { ok = !!JSON.parse(localStorage.getItem('pz_gtoken') || 'null'); } catch { /* ok */ }
        if (ok && state.projectsLoaded && currentProject() && ready()) { clearInterval(timer); const what = localStorage.getItem(PENDING); localStorage.removeItem(PENDING); (what === 'backup' ? backupNow : what.startsWith('table:') ? () => updateTable(what.slice(6)) : updateManagerTable)(); }
        else if (tries > 60) { clearInterval(timer); localStorage.removeItem(PENDING); }
      }, 500);
    }
  } catch { /* без хранилища */ }
  return { destroy: () => { unsub(); } };
}
