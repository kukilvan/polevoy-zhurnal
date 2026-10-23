import './style.css';
import './app/theme.js';
import { initKeyboard } from './app/keyboard.js';
initKeyboard();
import { info, warn, error } from './log.js';
import { h, toast } from './app/ui.js';
import { createRepo, createMemoryBackend, createFirestoreBackend } from './app/repo.js';
import * as store from './app/store.js';
import { createShell } from './app/shell.js';

import { captureTokenFromUrl } from './app/google.js';
import { APP_NAME, connection, saveConnection, parseConnect, setAdminEmail, mode, setLocalMode, localUser, isStandalone } from './edition.js';
document.title = APP_NAME;
const popupReturn = captureTokenFromUrl() === 'popup';   // окно входа Google: токен сохранён, само приложение здесь не запускаем
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';
const app = document.getElementById('app');
const standalone = !!(window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);
const memoryMode = new URLSearchParams(location.search).has('mem'); // тестовый режим без входа и сервера

function deviceId() {
  try { let id = localStorage.getItem('pz.deviceId'); if (!id) { id = Math.random().toString(36).slice(2, 8); localStorage.setItem('pz.deviceId', id); } return id; }
  catch { return 'noid'; }
}
const platform = (() => { const ua = navigator.userAgent; return /iPhone|iPad|iPod/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : 'Другое'; })();
const DEVICE = `${platform}-${deviceId()}${standalone ? ' (на экране Домой)' : ''}`;
info(`Запуск, версия ${typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev'}, сборка ${BUILD}`); info(`Устройство: ${DEVICE}`); info(`standalone=${standalone}, online=${navigator.onLine}${memoryMode ? ', ТЕСТОВЫЙ РЕЖИМ (память)' : ''}`);

if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(() => info('Service worker активен')).catch(() => {});
// Вышла новая версия, а приложение было открыто со старой: подгружаемые части (Протяжки, Точки, мастер…) прежних имён больше нет
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault(); warn('Часть приложения не загрузилась — вышла новая версия');
  let last = 0; try { last = Number(sessionStorage.getItem('pz.reloaded') || 0); } catch { /* ok */ }
  if (Date.now() - last < 15000) { toast('Не удалось загрузить раздел. Закройте приложение и откройте снова.'); return; }
  try { sessionStorage.setItem('pz.reloaded', String(Date.now())); } catch { /* ok */ }
  toast('Вышла новая версия — перезапускаю…'); setTimeout(() => location.reload(), 1500);
});
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) toast('Вышла новая версия приложения. Когда будет удобно — закройте и снова откройте его.'); });
}
else warn('Service worker не поддерживается');

let fb = null; let shell = null; let starting = false;

function showMessage(text) { app.replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'card mut' }, text))); }

function showLogin(message = '', busy = false) {
  shell?.destroy(); shell = null;
  const attempt = async (fn) => {
    showLogin('', true);
    try { await fn(); } catch (e) { error('Вход: ошибка', `${e.code || ''} ${e.message || e}`); showLogin(`Не удалось войти: ${e.code || e.message}`); }
  };
  app.replaceChildren(h('div', { class: 'wrap' },
    h('h1', {}, APP_NAME),
    h('div', { class: 'card' },
      h('div', { style: { marginBottom: '10px' } }, 'Войдите через Google, чтобы открыть свои проекты. Работает и без интернета: записи сохраняются на устройстве.'),
      h('button', { class: 'grow', style: { width: '100%' }, disabled: busy, onclick: () => attempt(() => fb.loginPopup()) }, 'Войти через Google'),
      h('div', { class: 'mut', style: { margin: '10px 0 6px' } }, 'Если кнопка выше не сработала на iPhone («Домой»), попробуйте запасной способ:'),
      h('button', { class: 'sec', disabled: busy, onclick: () => attempt(() => fb.loginRedirect()) }, 'Войти (запасной способ)'),
      message ? h('div', { style: { color: 'var(--err)', marginTop: '10px' } }, message) : null),
    h('div', { class: 'mut', style: { margin: '10px 2px' } }, `База: ${connection()?.firebase?.projectId || '—'}`,
      h('button', { class: 'sec', style: { marginLeft: '8px' }, onclick: async () => { if (!confirm('Открыть мастер настройки подключения?')) return; const { setupView } = await import('./app/setup.js'); app.replaceChildren(setupView({ onDone: () => location.reload(), onBack: () => location.reload() })); } }, '⚙ Подключение'))));
}

async function startSession(user) {
  const backend = memoryMode ? createMemoryBackend() : createFirestoreBackend(fb.db, user.uid);
  const repo = createRepo(backend, user);
  if (!memoryMode && !(await resolveAdmin(repo, user))) return;
  if (memoryMode) window.__pzRepo = repo;
  store.start(repo);
  shell = createShell({
    user,
    onLogout: async () => { if (memoryMode) location.reload(); else await fb.logout(); },
    diag: { build: BUILD, device: DEVICE, standalone, backend: memoryMode ? 'память (тест)' : 'Firestore', cacheMode: fb?.cacheMode ?? '—', userEmail: user.email },
  });
  if (!memoryMode) setTimeout(() => import('./app/migrate.js').then((m) => m.offerMigration(repo, user)).catch((e) => error('Перенос проектов', e)), 2500);
}

// Что показать при запуске: ссылка-приглашение (?connect=…) → база Firebase; ?setup=1 → мастер своей базы;
// режим «на устройстве» → локальные данные (на телефоне — только со значка); иначе — экран первого запуска.
async function gate() {
  const q = new URLSearchParams(location.search);
  const { needsInstallGate, startView } = await import('./app/start.js');
  const p = q.get('connect');
  if (p) {
    try { saveConnection(parseConnect(p)); setLocalMode(false); info('Подключение из ссылки-приглашения сохранено'); } catch (e) { error('Ссылка-приглашение', e); toast(`Ссылка-приглашение повреждена: ${e.message}`); }
    history.replaceState(null, '', location.pathname);
  }
  const wizard = async () => {
    const { setupView } = await import('./app/setup.js');
    app.replaceChildren(setupView({ onDone: () => location.replace(location.pathname), onBack: () => location.replace(location.pathname) }));
  };
  if (q.has('setup') && !connection()) { await wizard(); return null; }
  const m = mode();
  if (m === 'firebase') return 'firebase';
  const sv = startView({ onLocal: () => location.reload(), onFirebase: wizard, onConnected: () => location.reload() });
  if (m === 'local') {
    if (!needsInstallGate()) return 'local';
    app.replaceChildren(sv.el); sv.install(); return null;
  }
  app.replaceChildren(sv.el);
  if (isStandalone()) sv.how();
  return null;
}

async function startLocal() {
  const { createLocalBackend } = await import('./app/localdb.js');
  const backend = await createLocalBackend();
  const user = localUser();
  const repo = createRepo(backend, user);
  store.start(repo);
  shell = createShell({
    user,
    onLogout: async () => {
      if (!confirm('Выйти из режима «на устройстве»? Данные останутся в этом устройстве и вернутся, если снова выбрать этот режим.')) return;
      setLocalMode(false); location.reload();
    },
    diag: { build: BUILD, device: DEVICE, standalone, backend: 'на устройстве (IndexedDB)', cacheMode: '—', userEmail: '' },
  });
}

// Открытая версия: кто администратор базы (первый вошедший становится им сам)
async function resolveAdmin(repo, user) {
  try {
    const email = String(user.email || '').toLowerCase();
    setAdminEmail(await repo.claimAdmin(email));
    return true;
  } catch (e) {
    error('Администратор базы', `${e.code || ''} ${e.message || e}`);
    if (e.code === 'permission-denied') {
      const { OPEN_RULES, copy } = await import('./app/setup.js');
      app.replaceChildren(h('div', { class: 'wrap' }, h('h1', {}, APP_NAME), h('div', { class: 'card' },
        h('b', {}, 'База не пускает приложение'),
        h('div', { style: { margin: '6px 0' } }, 'Скорее всего, не вставлены правила базы (шаг 4 настройки): Firebase Console → Firestore Database → «Правила» (Rules) → вставить → «Опубликовать» (Publish). Потом обновите страницу.'),
        h('div', { class: 'btns' },
          h('button', { onclick: () => copy(OPEN_RULES, 'Правила скопированы') }, '📋 Скопировать правила'),
          h('button', { class: 'sec', onclick: () => location.reload() }, '🔄 Обновить'),
          h('button', { class: 'sec', onclick: async () => { const { clearConnection } = await import('./edition.js'); if (confirm('Забыть подключение и открыть мастер настройки?')) { clearConnection(); await fb?.logout().catch(() => {}); location.reload(); } } }, 'Сменить подключение')))));
      return false;
    }
    return true;   // нет связи и т. п. — работаем, администратор определится при следующем запуске
  }
}

async function boot() {
  if (!memoryMode) {
    const g = await gate();
    if (!g) return;
    if (g === 'local') { await startLocal(); return; }
  }
  if (memoryMode) { startSession({ uid: 'test-user', displayName: 'Тестовый пользователь', email: new URLSearchParams(location.search).get('memEmail') || 'test@example.com' }); window.__pz = { store, repo: window.__pzRepo }; return; }
  showMessage('Проверяю вход…');
  fb = await import('./firebase.js');
  fb.initFirebase();
  fb.watchAuth((user) => {
    if (user) { if (!shell && !starting) { starting = true; startSession(user).finally(() => { starting = false; }); } } else { store.stop(); showLogin(); }
  });
}
if (popupReturn) app.replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'card' }, '✅ Доступ к Google Диску получен. Это окно можно закрыть.')));
else boot().catch((e) => { error('Запуск', e); showMessage(`Ошибка запуска: ${e.message || e}`); });
