// Оболочка: верхняя панель, нижняя панель из 5 экранов, меню, переключение экранов.
import { racksView } from './views/racks.js';
import { sheetsView } from './views/sheetslist.js';
import { projectWizard } from './views/wizard.js';
import { startPool } from './pool.js';
import { seedStarterPool } from './starter.js';
import { APP_NAME, connection, isLocal } from '../edition.js';
import { LANGS, lang, setLang, addTranslations } from '../i18n/index.js';
import { startManuals } from './manuals.js';
import { startDoorPool } from './doorpool.js';
import { h, openModal, toast, confirmDialog, setShortcutsProvider } from './ui.js';
import { currentShortcuts } from './views/latinfix.js';
setShortcutsProvider(() => currentShortcuts());
setSnapProvider((id, data) => entryLine({ ...(state.ctx?.entries.get(id) || {}), ...data, id }, state.ctx, 'ru'));
import { nav, demo, state, subscribe, currentProject, ready, getRepo, setCurrentProject, pendingCount } from './store.js';
import { projectsView, projectForm } from './views/projects.js';
import { settingsView, refView, REFS, auditModal, refreshApp } from './views/settings.js';
import { membersView } from './views/members.js';
import { PENDING } from './google.js';
import { onPendingChange, onReadChange, readStatus, readsResetAt, setSnapProvider, rejectedList, onRejectedChange, dropRejected, onWriteWarn, DAILY_WRITE_LIMIT } from './repo.js';
import { asText } from '../log.js';
import { entryLine, rejectReason } from '../domain/index.js';
import { makeWorker } from './views/tohnitview.js';
import { assignOnPlan } from './views/planassign.js';
// для проверок в браузере (как window.__pz)
if (typeof window !== 'undefined') window.__pzPlanTools = { assignOnPlan, makeWorker };
import { themeLabel, setTheme, nextTheme } from './theme.js';
import { projectView, updateManagerTable, updateTable, backupNow, organizeDrive } from './views/project.js';
import { meterView } from './views/points.js';
import { logView } from './views/log.js';
import { dohView } from './views/doh.js';
import { todosView } from './views/todos.js';
import { journalView } from './views/journal.js';
import { importView } from './views/import.js';
import { historyView } from './views/history.js';
import { monthView } from './views/month.js';
import { tablesView } from './views/tables.js';
import { maybeOfferTour, withCreatorGuide, startTour } from './tour/index.js';
import { guideView, guideTitle, openGuide, maybeWelcome } from './views/guide.js';
import { exportExcel } from './excel.js';
import { mainTable } from '../domain/index.js';

const TABS = [
  ['project', 'Проект', '🏗'], ['meter', 'Точки', '📏'], ['todos', 'Дела и заметки', '✅'], ['doh', 'Отчёты', '📝'], ['settings', 'Ещё', '⚙️'],
];
const SCREEN_TITLES = { projects: 'Все проекты', month: 'Отчёт за месяц', journal: 'История', history: 'Откат записей', import: 'Импорт', ref: 'Справочник', members: 'Участники', tables: 'Для руководства', racks: 'Шкафы и шильют', sheets: 'Таблицы', guide: 'Как пользоваться', log: 'Журнал событий' };

export function createShell({ user, onLogout, diag }) {
  const root = document.getElementById('app');
  const ui = { tab: 'project', screen: null, go, open, back: () => { ui.screen = null; render(); }, render };
  nav.ui = ui;
  function go(tab) { ui.tab = tab; ui.screen = null; render(); window.scrollTo(0, 0); }
  function open(screen) { ui.screen = screen; render(); window.scrollTo(0, 0); }

  function menu() {
    const p = currentProject();
    const item = (label, fn) => h('button', { class: 'menu-item', onclick: () => { close(); fn(); } }, label);
    // разделы свёрнуты по умолчанию; нажатие на заголовок раскрывает / сворачивает
    const section = (title, items) => {
      const list = h('div', { style: { display: 'none' } }, ...items.filter(Boolean));
      const mark = h('span', {}, '▸ ');
      const head = h('div', { class: 'group', style: { position: 'static', paddingInlineStart: '4px', cursor: 'pointer', userSelect: 'none' },
        onclick: () => { const on = list.style.display === 'none'; list.style.display = on ? '' : 'none'; mark.textContent = on ? '▾ ' : '▸ '; } }, mark, title);
      return h('div', {}, head, list);
    };
    const close = openModal('Меню', h('div', {},
      section('Проект', [
      item('📁 Все проекты', () => open('projects')),
      p ? item('✏️ Редактировать проект', () => projectForm(p, ui)) : null,
      p ? item('👥 Участники', () => open('members')) : null,
      item('➕ Новый проект', () => withCreatorGuide(() => projectWizard(ui))),
      p ? item('📒 История', () => open('journal')) : null,
      p ? item('🕘 Откат записей', () => open('history')) : null,
      p ? item('📅 Отчёт за месяц', () => open('month')) : null]),
      section('Руководства', [
      item('🎓 Тур по приложению', () => startTour(ui, 'all')),
      item('📖 Как пользоваться приложением', () => openGuide(ui)),
      item('📚 Шпаргалка (инструкции)', () => openGuide(ui, null, 'manuals')),
      item('🔤 Словарик', () => openGuide(ui, null, 'dict'))]),
      section('Настройки', [
      item(`🎨 Тема: ${themeLabel()} → ${themeLabel(nextTheme())}`, () => { setTheme(nextTheme()); render(); }),
      item(`🌐 Язык: ${LANGS.find(([k]) => k === lang())[1]}`, langModal),
      item(`🔄 Обновить приложение (версия ${typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev'}, сборка ${typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev'})`, refreshApp)]),
      section('Данные', [
      isLocal() ? item('☁️ Своя база: работа с коллегами', () => import('./setup.js').then((m) => m.openWizardScreen())) : null,
      connection() ? item('🔌 Подключение к базе', () => import('./setup.js').then((m) => m.connectionModal(onLogout))) : null,
      item('🧾 Журнал событий', () => open('log')),
      p ? item('🔄 Обновить таблицу для руководства', updateManagerTable) : null,
      p && mainTable(p).link ? item('📊 Открыть таблицу руководства', () => window.open(mainTable(p).link, '_blank')) : null,
      p ? item(p.backupAt ? `💾 Резервная копия на Диск (последняя: ${new Date(p.backupAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })})` : '💾 Резервная копия на Диск', backupNow) : null,
      p ? item('📁 Разложить файлы на Диске по папкам', organizeDrive) : null,
      p ? item('📊 Выгрузить всё в Excel', exportExcel) : null,
      p ? item('🩺 Проверка справочников', auditModal) : null,
      p ? item('📥 Импорт данных (замена всего проекта)', () => open('import')) : null]),
      h('div', { class: 'mut', style: { padding: '10px 4px' } }, user.displayName || user.email),
      item(isLocal() ? '🔄 Сменить режим работы' : '🚪 Выйти', onLogout)));
  }

  function langModal() {
    const close = openModal('Язык', h('div', {}, ...LANGS.map(([k, name]) => h('button', { class: k === lang() ? '' : 'sec', style: { display: 'block', width: '100%', marginBottom: '8px' }, onclick: () => { close(); if (k !== lang()) setLang(k); } }, name))));
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
    if (ui.screen === 'sheets') return sheetsView(ui);
    if (ui.screen === 'ref') return refView();
    if (ui.screen === 'members') return membersView(ui);
    if (ui.screen === 'tables') return tablesView(ui);
    if (ui.screen === 'racks') return racksView(ui);
    if (ui.screen === 'guide') return guideView(ui);
    if (ui.screen === 'month') return monthView(ui);
    if (ui.screen === 'history') return historyView(ui);
    if (ui.screen === 'journal') return journalView(ui);
    if (ui.screen === 'import') return importView();
    switch (ui.tab) {
      case 'project': return projectView(ui);
      case 'meter': return meterView(ui);
      case 'doh': return dohView(ui);
      case 'settings': return settingsView(ui);
      case 'todos': return todosView();
      case 'journal': return journalView(ui);
      default: return h('div', {});
    }
  }

  // «⏳ N ждут отправки»: записи, ещё не дошедшие до сервера. Если онлайн, а они висят дольше полутора минут — красный
  let pendingSince = 0; let badge = null;
  const paintBadge = () => {
    const n = pendingCount();
    if (!n) { pendingSince = 0; if (badge) badge.style.display = 'none'; return n; }
    if (!pendingSince) pendingSince = Date.now();
    if (badge) {
      badge.style.display = ''; badge.textContent = `⬆ ${n}`; badge.title = `Ждут отправки на сервер: ${n}`;
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
  // «⬇ N»: сколько разделов ещё ждут ответа сервера (чтение). Красный — ошибка (например, лимит) или ждём дольше 30 секунд онлайн
  let rbadge = null;
  const LIMIT_CODES = ['resource-exhausted'];
  const paintRead = () => {
    if (!rbadge) return;
    const r = readStatus(); const n = r.waiting + r.failed.length;
    if (!n) { rbadge.style.display = 'none'; return; }
    const slow = state.online && r.waiting && Date.now() - r.since > 30000;
    const limit = r.failed.some((x) => LIMIT_CODES.includes(x.code));
    rbadge.style.display = ''; rbadge.textContent = limit ? '⬇ лимит' : r.failed.length ? `⬇ ошибка` : `⬇ ${r.waiting}`;
    rbadge.className = `pill ${r.failed.length || slow ? 'err' : 'warn'}`;
  };
  function readBadge() {
    rbadge = h('span', { class: 'pill warn', style: { display: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }, onclick: () => {
      const r = readStatus(); const hhmm = readsResetAt().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      if (r.failed.some((x) => LIMIT_CODES.includes(x.code))) { toast(`Исчерпан суточный лимит чтения базы. Новые данные с сервера не приходят до ${hhmm}; приложение работает на том, что уже есть на устройстве, записи копятся и уйдут позже`); return; }
      if (r.failed.length) { toast(`Не удалось прочитать с сервера: ${r.failed.map((x) => `${x.label} (${x.code})`).join(', ')}`); return; }
      if (!r.waiting) { toast('Всё получено с сервера'); return; }
      toast(state.online ? `Ждём данные с сервера: ${r.waiting} разд. Пока показано то, что есть на устройстве. Если долго не уходит — слабая связь или лимит базы (сбросится в ${hhmm})` : `Ждём данные с сервера: ${r.waiting} разд. Придут, когда появится интернет`);
    } });
    paintRead();
    return rbadge;
  }
  // «⚠ N»: записи, которые сервер не принял. Хранятся на телефоне — можно разобраться в причине и повторить
  let xbadge = null;
  const paintRej = () => { if (!xbadge) return; const n = rejectedList().length; xbadge.style.display = n ? '' : 'none'; xbadge.textContent = `⚠ ${n}`; xbadge.title = `Сервер не принял записей: ${n}`; };
  function rejectedModal() {
    const box = h('div', {}); const repo = getRepo();
    const when = (t) => new Date(t).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
    const colls = (it) => [...new Set(it.writes.map((w) => w.coll).filter((c) => c !== 'history'))].join(', ');
    const draw = () => {
      const list = rejectedList();
      if (!list.length) { box.replaceChildren(h('div', { class: 'empty' }, 'Всё принято сервером.')); return; }
      box.replaceChildren(
        h('div', { class: 'mut' }, 'Эти записи сервер не принял: на телефоне они сохранены, но другие их не видят. Устраните причину и нажмите «Повторить».'),
        ...list.map((it) => { const r = rejectReason(it.code); return h('div', { class: 'card', style: { margin: '8px 0' } },
          h('b', {}, r.title), h('div', { class: 'mut', style: { fontSize: '13px' } }, `${when(it.at)} · разделы: ${colls(it) || '—'} · код: ${it.code || '—'}`),
          h('div', { style: { margin: '6px 0' } }, r.fix),
          h('button', { class: 'sec', onclick: async () => { if (await confirmDialog('Удалить эту запись из списка? Она не попадёт на сервер никогда.', { yes: 'Удалить', danger: true })) { dropRejected(it.id); draw(); } } }, 'Не нужна — удалить')); }),
        h('div', { class: 'btns' },
          h('button', { onclick: () => { const n = repo.retryRejected(); toast(`Отправляю повторно: ${n}`); setTimeout(draw, 1500); } }, '🔁 Повторить все'),
          h('button', { class: 'sec', onclick: async () => { try { await navigator.clipboard.writeText(asText()); toast('Журнал скопирован — пришлите его'); } catch { toast('Не удалось скопировать — «Меню → Журнал событий»'); } } }, '📋 Скопировать журнал')));
    };
    draw(); const off = onRejectedChange(() => draw());
    openModal('⚠ Не принято сервером', box, { onClose: () => off() });
  }
  function rejectedBadge() {
    xbadge = h('span', { class: 'pill err', style: { display: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }, onclick: rejectedModal });
    paintRej(); return xbadge;
  }
  onRejectedChange(paintRej);
  onWriteWarn((lvl, n) => toast(lvl >= 0.95 ? `⚠ Записей за сутки: ${n.toLocaleString('ru-RU')} из ${DAILY_WRITE_LIMIT.toLocaleString('ru-RU')} — лимит почти исчерпан. Дальше записи могут не приниматься до 10:00.` : `Записей за сутки: ${n.toLocaleString('ru-RU')} из ${DAILY_WRITE_LIMIT.toLocaleString('ru-RU')} (80% лимита). Большие операции лучше отложить до 10:00.`));
  setInterval(() => { paintBadge(); paintRead(); }, 5000);
  onPendingChange(paintBadge); onReadChange(paintRead);

  function render() {
    const p = currentProject();
    const title = ui.screen === 'ref' ? REFS[state.settingsRef]?.title : ui.screen === 'guide' ? guideTitle() : ui.screen ? SCREEN_TITLES[ui.screen] : (p?.name || APP_NAME);
    root.replaceChildren(
      h('div', { class: 'topbar' },
        ui.screen ? h('button', { class: 'sec', onclick: () => ui.back() }, '←') : h('button', { class: 'sec', onclick: menu }, '☰'),
        h('div', { class: 'title' }, title),
        rejectedBadge(),
        readBadge(),
        pendingBadge(),
        h('span', { class: `pill ${state.online ? 'ok' : 'warn'}` }, state.online ? 'онлайн' : 'офлайн'),
        ui.screen ? null : h('button', { class: 'sec', onclick: menu }, '⋯')),
      h('div', { class: ui.screen === 'racks' ? 'wrap wide' : 'wrap' }, invitesBanner(), content()),
      h('nav', {}, TABS.map(([id, label, icon]) => h('button', { class: !ui.screen && ui.tab === id ? 'on' : '', onclick: () => go(id) }, icon, h('br'), h('small', {}, label)))));
  }

  window.addEventListener('online', () => { state.online = true; render(); });
  window.addEventListener('offline', () => { state.online = false; render(); });
  // иврит: названия из справочников проекта (в т. ч. добавленные вручную) берутся из их ивритских полей
  let lastCtx = null;
  const ctxNames = () => {
    const c = state.ctx; if (!c || c === lastCtx || lang() !== 'he') return; lastCtx = c;
    const m = {};
    c.catalog?.forEach((x) => { if (x.name && x.nameHe) m[x.name] = x.nameHe; });
    c.types?.forEach((x) => { if (x.nameHe) m[x.id] = x.nameHe; });
    c.devices?.forEach((x) => { if (x.name && x.nameHe) m[x.name] = x.nameHe; });
    c.cables?.forEach((x) => { if (x.nameHe) m[x.id] = x.nameHe; });
    [c.units, c.culprits, c.delayReasons].forEach((l) => l?.forEach((x) => { if (x.he) m[x.id] = x.he; }));
    addTranslations(m);
  };
  const unsub = subscribe(() => { ctxNames(); render(); if (ready() && !demo.on) { maybeWelcome(ui, user); maybeOfferTour(ui); if (currentProject()?.serverEmail) import('./views/managersfolder.js').then((m) => m.ensureServerAccess()).catch(() => {}); } });
  startPool(); startDoorPool(); startManuals(); seedStarterPool();  // общий пул: слушать, входящие администратора, отправка нового из проекта
  render();

  // Возврат с Google после выдачи доступа (iPhone): дожидаемся загрузки проекта и запускаем обновление таблицы руководства
  try {
    if (localStorage.getItem(PENDING)) {
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        let ok = false; try { ok = !!JSON.parse(localStorage.getItem('pz_gtoken') || 'null'); } catch { /* ok */ }
        if (ok && state.projectsLoaded && currentProject() && ready()) { clearInterval(timer); const what = localStorage.getItem(PENDING); localStorage.removeItem(PENDING); (what === 'backup' ? backupNow : what === 'folders' ? organizeDrive : what === 'mfolder' ? () => import('./views/managersfolder.js').then((m) => m.updateManagersFolder()) : what === 'drawing' ? () => {} : what === 'racks' ? () => import('./views/racktable.js').then((m) => m.generateRackTable()) : what === 'sheets' ? () => import('./views/sheetslist.js').then((m) => m.addSheetsFlow()) : what.startsWith('table:') ? () => updateTable(what.slice(6)) : updateManagerTable)(); }
        else if (tries > 60) { clearInterval(timer); localStorage.removeItem(PENDING); }
      }, 500);
    }
  } catch { /* без хранилища */ }
  return { destroy: () => { unsub(); } };
}
