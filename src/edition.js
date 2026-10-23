// Подключение к базе. Один сайт для всех: настроек Firebase в коде нет — каждый подключает свой проект Firebase
// в мастере настройки при первом запуске, коллеги подключаются по ссылке-приглашению (в ней те же настройки).
export const APP_NAME = 'Менеджер проектов';

const KEY = 'pm.connection';
/** Подключение: { firebase: {...}, clientId?: '...' } */
export function connection() {
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c?.firebase?.projectId ? c : null; } catch { return null; }
}
export function saveConnection(c) { localStorage.setItem(KEY, JSON.stringify(c)); }
export function clearConnection() { try { localStorage.removeItem(KEY); } catch { /* ok */ } }
export const firebaseConfig = () => connection()?.firebase || null;
export const clientId = () => connection()?.clientId || '';

// Администратор базы (общий пул, список разрешённых почт) — тот, кто первым вошёл в новую базу (документ meta/admin)
let admin = '';
export const setAdminEmail = (e) => { admin = String(e || '').toLowerCase(); };
export const adminEmail = () => admin;
export const isAdminEmail = (e) => !!admin && String(e || '').toLowerCase() === admin;

// ---------- настройки Firebase из текста, который человек скопировал из консоли ----------
// Принимает и JSON, и кусок кода «const firebaseConfig = { apiKey: "...", ... };»
export function parseFirebaseConfig(text) {
  const s = String(text || '');
  const pick = (k) => { const m = s.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`)); return m ? m[1].trim() : ''; };
  const cfg = { apiKey: pick('apiKey'), authDomain: pick('authDomain'), projectId: pick('projectId'), storageBucket: pick('storageBucket'), messagingSenderId: pick('messagingSenderId'), appId: pick('appId') };
  const missing = ['apiKey', 'authDomain', 'projectId', 'appId'].filter((k) => !cfg[k]);
  if (missing.length) throw new Error(`Не нашёл в тексте: ${missing.join(', ')}. Скопируйте весь блок firebaseConfig целиком`);
  Object.keys(cfg).forEach((k) => { if (!cfg[k]) delete cfg[k]; });
  return cfg;
}

// ---------- ссылка-приглашение: подключение к той же базе без мастера ----------
const b64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
export function connectLink(c = connection(), base = `${location.origin}${location.pathname}`) {
  return `${base}?connect=${b64(JSON.stringify({ f: c.firebase, c: c.clientId || '' }))}`;
}
export function parseConnect(param) {
  const j = JSON.parse(unb64(param));
  if (!j?.f?.projectId || !j.f.apiKey) throw new Error('Ссылка повреждена');
  return { firebase: j.f, clientId: j.c || '' };
}
