import './style.css';
import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence,
  browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup,
  signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  memoryLocalCache, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';
import { info, warn, error, getLines, clearLog, onLog, asText } from './log.js';

const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- устройство ----------
const standalone = !!(window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);
function deviceId() {
  try {
    let id = localStorage.getItem('pz.deviceId');
    if (!id) { id = Math.random().toString(36).slice(2, 8); localStorage.setItem('pz.deviceId', id); }
    return id;
  } catch { return 'noid'; }
}
function platformName() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  return 'Другое';
}
const DEVICE = `${platformName()}-${deviceId()}${standalone ? ' (на экране Домой)' : ''}`;

info(`Запуск, сборка ${BUILD}`);
info(`Устройство: ${DEVICE}`);
info(`standalone=${standalone}, online=${navigator.onLine}`);

// ---------- Firebase ----------
const fbApp = initializeApp(firebaseConfig);
const auth = initializeAuth(fbApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});

let db; let cacheMode = 'нет';
try {
  db = initializeFirestore(fbApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    experimentalAutoDetectLongPolling: true, // WebKit иногда ломает WebChannel
  });
  cacheMode = 'постоянный (IndexedDB)';
} catch (e) {
  warn('Постоянный кэш Firestore недоступен, работаю с кэшем в памяти', e);
  db = initializeFirestore(fbApp, { localCache: memoryLocalCache(), experimentalAutoDetectLongPolling: true });
  cacheMode = 'в памяти (офлайн не переживёт перезапуск)';
}
info(`Кэш Firestore: ${cacheMode}`);

// ---------- состояние ----------
const state = {
  tab: 'check', user: null, authReady: false, authBusy: false, authMsg: '',
  online: navigator.onLine, records: [], fromCache: null, pendingCount: 0, unsub: null,
};

window.addEventListener('online', () => { state.online = true; info('Сеть: online'); render(); });
window.addEventListener('offline', () => { state.online = false; warn('Сеть: offline'); render(); });

// ---------- вход ----------
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

async function loginPopup() {
  state.authBusy = true; state.authMsg = ''; render();
  info('Вход: popup…');
  try {
    const res = await signInWithPopup(auth, provider);
    info('Вход popup OK', res.user.email);
  } catch (e) {
    error('Вход popup ошибка', `${e.code || ''} ${e.message || e}`);
    state.authMsg = `Не удалось войти (popup): ${e.code || e.message}`;
  }
  state.authBusy = false; render();
}
async function loginRedirect() {
  state.authBusy = true; state.authMsg = ''; render();
  info('Вход: redirect…');
  try {
    await signInWithRedirect(auth, provider);
  } catch (e) {
    error('Вход redirect ошибка', `${e.code || ''} ${e.message || e}`);
    state.authMsg = `Не удалось войти (redirect): ${e.code || e.message}`;
    state.authBusy = false; render();
  }
}
async function logout() {
  info('Выход');
  if (state.unsub) { state.unsub(); state.unsub = null; }
  await signOut(auth);
}

getRedirectResult(auth)
  .then((res) => { if (res) info('Redirect-результат: вход OK', res.user.email); else info('Redirect-результата нет'); })
  .catch((e) => { error('Redirect-результат ошибка', `${e.code || ''} ${e.message || e}`); state.authMsg = `Ошибка redirect: ${e.code || e.message}`; render(); });

onAuthStateChanged(auth, (user) => {
  state.authReady = true; state.user = user;
  info(user ? `Пользователь: ${user.displayName || ''} <${user.email}>` : 'Пользователь: не вошёл');
  if (state.unsub) { state.unsub(); state.unsub = null; }
  state.records = [];
  if (user) subscribe(user);
  render();
});

// ---------- данные: users/{uid}/checks ----------
function subscribe(user) {
  const q = query(collection(db, 'users', user.uid, 'checks'), orderBy('createdAtClient', 'desc'), limit(50));
  state.unsub = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    state.fromCache = snap.metadata.fromCache;
    state.records = snap.docs.map((d) => ({ id: d.id, pending: d.metadata.hasPendingWrites, ...d.data() }));
    state.pendingCount = state.records.filter((r) => r.pending).length;
    info(`Снимок: ${snap.size} зап., из кэша=${snap.metadata.fromCache}, ждут отправки=${state.pendingCount}`);
    render();
  }, (e) => { error('onSnapshot ошибка', `${e.code || ''} ${e.message || e}`); state.authMsg = `Ошибка чтения: ${e.code || e.message}`; render(); });
}

function addCheck(text) {
  const u = state.user; if (!u) return;
  const payload = {
    text: text || `Тест с ${DEVICE}`,
    authorUid: u.uid, authorName: u.displayName || '', authorEmail: u.email || '',
    device: DEVICE, createdAtClient: Date.now(), createdAt: serverTimestamp(),
  };
  info(`Запись (online=${navigator.onLine}): ${payload.text}`);
  // НЕ ждём ответа сервера: офлайн промис не завершится, запись уже в локальном кэше
  addDoc(collection(db, 'users', u.uid, 'checks'), payload)
    .then((ref) => info('Сервер подтвердил запись', ref.id))
    .catch((e) => error('Запись отклонена сервером', `${e.code || ''} ${e.message || e}`));
}

// ---------- сервис-воркер ----------
let swInfo = 'неизвестно';
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(() => { swInfo = 'активен'; info('Service worker активен'); render(); }).catch(() => {});
  swInfo = 'регистрируется…';
} else { swInfo = 'не поддерживается'; warn('Service worker не поддерживается'); }

// ---------- интерфейс ----------
function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms); const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function viewCheck() {
  const net = state.online ? '<span class="pill ok">онлайн</span>' : '<span class="pill warn">офлайн</span>';
  let body = '';
  if (!state.authReady) {
    body = '<div class="card mut">Проверяю вход…</div>';
  } else if (!state.user) {
    body = `
      <div class="card">
        <div style="margin-bottom:10px">Войдите через Google, чтобы проверить запись и синхронизацию.</div>
        <div class="row">
          <button id="loginPopup" class="grow" ${state.authBusy ? 'disabled' : ''}>Войти через Google</button>
        </div>
        <div class="mut" style="margin:10px 0 6px">Если кнопка выше не сработала на iPhone («Домой»), попробуйте запасной способ:</div>
        <button id="loginRedirect" class="sec" ${state.authBusy ? 'disabled' : ''}>Войти (запасной способ)</button>
        ${state.authMsg ? `<div class="mut" style="color:var(--err);margin-top:10px">${esc(state.authMsg)}</div>` : ''}
      </div>`;
  } else {
    const u = state.user;
    body = `
      <div class="card">
        <div class="row"><div class="grow"><b>${esc(u.displayName || 'Без имени')}</b><div class="mut">${esc(u.email)}</div></div>
        <button id="logout" class="sec">Выйти</button></div>
      </div>
      <div class="card">
        <div class="row">
          <input id="txt" class="grow" placeholder="Текст тестовой записи" />
          <button id="add">Записать</button>
        </div>
        <div class="mut" style="margin-top:8px">Запись сохраняется на устройстве сразу, а на сервер уходит, когда есть интернет.</div>
        ${state.authMsg ? `<div class="mut" style="color:var(--err);margin-top:8px">${esc(state.authMsg)}</div>` : ''}
      </div>
      <h2>Записи ${state.pendingCount ? `<span class="pill warn">ждут отправки: ${state.pendingCount}</span>` : '<span class="pill ok">всё синхронизировано</span>'}</h2>
      <div class="card">
        ${state.records.length ? state.records.map((r) => `
          <div class="rec">
            <div class="t">${esc(r.text)}</div>
            <div class="mut">${esc(r.authorName || r.authorEmail)} · ${esc(fmtTime(r.createdAtClient))} · ${esc(r.device)}</div>
            <div>${r.pending ? '<span class="pill warn">ждёт отправки</span>' : '<span class="pill ok">на сервере</span>'}</div>
          </div>`).join('') : '<div class="mut">Записей пока нет.</div>'}
      </div>`;
  }
  return `<div class="wrap"><h1>Полевой журнал · проверка ${net}</h1>${body}</div>`;
}

function viewLog() {
  const rows = getLines().map((r) => `<div class="l-${r.level}">${esc(r.t)} ${esc(r.text)}</div>`).join('');
  const diag = [
    `Сборка: ${BUILD}`, `Устройство: ${DEVICE}`, `Экран «Домой» (standalone): ${standalone ? 'да' : 'нет'}`,
    `Сеть: ${state.online ? 'онлайн' : 'офлайн'}`, `Service worker: ${swInfo}`, `Кэш Firestore: ${cacheMode}`,
    `Пользователь: ${state.user ? state.user.email : 'не вошёл'}`, `User-Agent: ${navigator.userAgent}`,
  ].map(esc).join('<br>');
  return `<div class="wrap"><h1>Журнал событий</h1>
    <div class="card mut">${diag}</div>
    <div class="row" style="margin-bottom:10px">
      <button id="copyLog" class="grow">Скопировать журнал</button>
      <button id="clearLog" class="danger">Очистить</button>
    </div>
    <pre class="log" id="logBox">${rows || 'Пусто'}</pre></div>`;
}

function render() {
  // не сбрасываем текст в поле ввода при перерисовке
  const keep = document.getElementById('txt'); const keepVal = keep ? keep.value : '';
  $app.innerHTML = (state.tab === 'check' ? viewCheck() : viewLog()) + `
    <nav>
      <button data-tab="check" class="${state.tab === 'check' ? 'on' : ''}">Проверка</button>
      <button data-tab="log" class="${state.tab === 'log' ? 'on' : ''}">Журнал событий</button>
    </nav>`;
  const t = document.getElementById('txt'); if (t) t.value = keepVal;
  const box = document.getElementById('logBox'); if (box) box.scrollTop = box.scrollHeight;
}

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('button'); if (!el) return;
  if (el.dataset.tab) { state.tab = el.dataset.tab; render(); return; }
  switch (el.id) {
    case 'loginPopup': loginPopup(); break;
    case 'loginRedirect': loginRedirect(); break;
    case 'logout': logout(); break;
    case 'add': { const t = document.getElementById('txt'); addCheck(t.value.trim()); t.value = ''; break; }
    case 'clearLog': clearLog(); render(); break;
    case 'copyLog': {
      const text = asText();
      try { await navigator.clipboard.writeText(text); info('Журнал скопирован в буфер'); el.textContent = 'Скопировано ✓'; }
      catch (e) {
        warn('Буфер недоступен, выделяю текст', e);
        const r = document.createRange(); r.selectNodeContents(document.getElementById('logBox'));
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); el.textContent = 'Текст выделен: нажмите «Скопировать»';
      }
      break;
    }
  }
});

onLog(() => { if (state.tab === 'log') render(); });
render();
