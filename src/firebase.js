// Подключение к Firebase: вход через Google и база с постоянным офлайн-кэшем.
import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
} from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache } from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';
import { info, warn, error } from './log.js';

const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});

export let db; export let cacheMode = 'нет';
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    experimentalAutoDetectLongPolling: true, // WebKit иногда ломает WebChannel
  });
  cacheMode = 'постоянный (IndexedDB)';
} catch (e) {
  warn('Постоянный кэш Firestore недоступен, работаю с кэшем в памяти', e);
  db = initializeFirestore(app, { localCache: memoryLocalCache(), experimentalAutoDetectLongPolling: true });
  cacheMode = 'в памяти (офлайн не переживёт перезапуск)';
}
info(`Кэш Firestore: ${cacheMode}`);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export async function loginPopup() {
  info('Вход: popup…');
  const res = await signInWithPopup(auth, provider);
  info('Вход popup OK', res.user.email);
}
export async function loginRedirect() { info('Вход: redirect…'); await signInWithRedirect(auth, provider); }
export const logout = () => { info('Выход'); return signOut(auth); };

export function watchAuth(cb) {
  getRedirectResult(auth)
    .then((res) => {
      info(res ? `Redirect-результат: вход OK ${res.user.email}` : 'Redirect-результата нет');
      // Возврат после запроса доступа к Диску/Таблицам (iPhone): сохраняем токен для google.js
      const token = res && GoogleAuthProvider.credentialFromResult(res)?.accessToken;
      if (token) { try { localStorage.setItem('pz_gtoken', JSON.stringify({ token, exp: Date.now() + 50 * 60 * 1000 })); } catch { /* без хранилища */ } }
    })
    .catch((e) => error('Redirect-результат ошибка', `${e.code || ''} ${e.message || e}`));
  return onAuthStateChanged(auth, (user) => {
    info(user ? `Пользователь: ${user.displayName || ''} <${user.email}>` : 'Пользователь: не вошёл');
    cb(user);
  });
}
