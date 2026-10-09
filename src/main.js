import './style.css';
import { info, warn, error } from './log.js';
import { h } from './app/ui.js';
import { createRepo, createMemoryBackend, createFirestoreBackend } from './app/repo.js';
import * as store from './app/store.js';
import { createShell } from './app/shell.js';

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
info(`Запуск, сборка ${BUILD}`); info(`Устройство: ${DEVICE}`); info(`standalone=${standalone}, online=${navigator.onLine}${memoryMode ? ', ТЕСТОВЫЙ РЕЖИМ (память)' : ''}`);

if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(() => info('Service worker активен')).catch(() => {});
else warn('Service worker не поддерживается');

let fb = null; let shell = null;

function showMessage(text) { app.replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'card mut' }, text))); }

function showLogin(message = '', busy = false) {
  shell?.destroy(); shell = null;
  const attempt = async (fn) => {
    showLogin('', true);
    try { await fn(); } catch (e) { error('Вход: ошибка', `${e.code || ''} ${e.message || e}`); showLogin(`Не удалось войти: ${e.code || e.message}`); }
  };
  app.replaceChildren(h('div', { class: 'wrap' },
    h('h1', {}, 'Полевой журнал'),
    h('div', { class: 'card' },
      h('div', { style: { marginBottom: '10px' } }, 'Войдите через Google, чтобы открыть свои проекты. Работает и без интернета: записи сохраняются на устройстве.'),
      h('button', { class: 'grow', style: { width: '100%' }, disabled: busy, onclick: () => attempt(() => fb.loginPopup()) }, 'Войти через Google'),
      h('div', { class: 'mut', style: { margin: '10px 0 6px' } }, 'Если кнопка выше не сработала на iPhone («Домой»), попробуйте запасной способ:'),
      h('button', { class: 'sec', disabled: busy, onclick: () => attempt(() => fb.loginRedirect()) }, 'Войти (запасной способ)'),
      message ? h('div', { style: { color: 'var(--err)', marginTop: '10px' } }, message) : null)));
}

function startSession(user) {
  const backend = memoryMode ? createMemoryBackend() : createFirestoreBackend(fb.db, user.uid);
  const repo = createRepo(backend, user);
  store.start(repo);
  shell = createShell({
    user,
    onLogout: async () => { if (memoryMode) location.reload(); else await fb.logout(); },
    diag: { build: BUILD, device: DEVICE, standalone, backend: memoryMode ? 'память (тест)' : 'Firestore', cacheMode: fb?.cacheMode ?? '—', userEmail: user.email },
  });
}

async function boot() {
  if (memoryMode) { startSession({ uid: 'test-user', displayName: 'Тестовый пользователь', email: 'test@example.com' }); window.__pz = { store }; return; }
  showMessage('Проверяю вход…');
  fb = await import('./firebase.js');
  fb.watchAuth((user) => {
    if (user) { if (!shell) startSession(user); } else { store.stop(); showLogin(); }
  });
}
boot().catch((e) => { error('Запуск', e); showMessage(`Ошибка запуска: ${e.message || e}`); });
