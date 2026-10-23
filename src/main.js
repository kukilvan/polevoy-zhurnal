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
captureTokenFromUrl();
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
  if (memoryMode) window.__pzRepo = repo;
  store.start(repo);
  shell = createShell({
    user,
    onLogout: async () => { if (memoryMode) location.reload(); else await fb.logout(); },
    diag: { build: BUILD, device: DEVICE, standalone, backend: memoryMode ? 'память (тест)' : 'Firestore', cacheMode: fb?.cacheMode ?? '—', userEmail: user.email },
  });
}

async function boot() {
  if (memoryMode) { startSession({ uid: 'test-user', displayName: 'Тестовый пользователь', email: new URLSearchParams(location.search).get('memEmail') || 'test@example.com' }); window.__pz = { store, repo: window.__pzRepo }; return; }
  showMessage('Проверяю вход…');
  fb = await import('./firebase.js');
  fb.watchAuth((user) => {
    if (user) { if (!shell) startSession(user); } else { store.stop(); showLogin(); }
  });
}
boot().catch((e) => { error('Запуск', e); showMessage(`Ошибка запуска: ${e.message || e}`); });
