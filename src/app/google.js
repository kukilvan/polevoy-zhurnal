// Доступ к Google Диску и Таблицам от имени пользователя (по кнопке, нужно отдельное согласие).
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import * as fbm from '../firebase.js';
const auth = { get currentUser() { return fbm.auth?.currentUser || null; } };

import { clientId, connection, DEFAULT_CLIENT_ID } from '../edition.js';
// Два способа получить доступ к Диску:
//  - база со своим OAuth-клиентом (в подключении есть clientId, например база Ивана): вход Firebase + полный доступ к Диску и Таблицам;
//  - всё остальное (режим «на устройстве», новые базы): общий клиент приложения и узкое разрешение drive.file —
//    только файлы, созданные приложением. Для него Google не требует проверки приложения и не показывает предупреждений.
const FULL = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'];
const NARROW = ['https://www.googleapis.com/auth/drive.file'];
const viaFirebase = () => !!connection()?.clientId && !!auth.currentUser;
const scopes = () => (connection()?.clientId ? FULL : NARROW);
const oauthClient = () => clientId() || DEFAULT_CLIENT_ID;
let cached = { token: '', exp: 0 };

export const useRedirect = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  || window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
// Вызывается при запуске: если вернулись с Google с токеном в адресе — сохраняем его и чистим адрес.
// Окно входа (popup) после этого закрывается само: токен уже лежит в общем хранилище, основное окно его подхватит.
export function captureTokenFromUrl() {
  try {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    const state = p.get('state');
    if (state !== 'pz_gsync' && state !== 'pz_gpopup') return;
    const token = p.get('access_token');
    if (token) localStorage.setItem('pz_gtoken', JSON.stringify({ token, exp: Date.now() + (Number(p.get('expires_in')) || 3000) * 920 }));
    else if (p.get('error')) localStorage.setItem('pz_gtoken_err', p.get('error'));
    history.replaceState(null, '', location.pathname + location.search);
    if (state === 'pz_gpopup') { try { window.close(); } catch { /* ok */ } return 'popup'; }
  } catch { /* ok */ }
  return null;
}
export const PENDING = 'pz_gsync_pending';

function stored() {
  try { const t = JSON.parse(localStorage.getItem('pz_gtoken') || 'null'); return t && Date.now() < t.exp ? t : null; } catch { return null; }
}

function authUrl(state) {
  const q = new URLSearchParams({
    client_id: oauthClient(), redirect_uri: location.origin + location.pathname, response_type: 'token', scope: scopes().join(' '),
    include_granted_scopes: 'true', state, ...(auth.currentUser?.email ? { login_hint: auth.currentUser.email } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function getToken(action = 'managers') {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const st = stored(); if (st) { cached = st; return st.token; }
  if (useRedirect()) { // iPhone и приложение со значка: окна Google закрываются — уходим на Google и читаем токен из адреса при возврате
    try { localStorage.setItem(PENDING, action); } catch { /* ok */ }
    location.href = authUrl('pz_gsync');
    return new Promise(() => {}); // страница уходит на Google; продолжение после возврата
  }
  if (!viaFirebase()) return popupToken();
  const provider = new GoogleAuthProvider();
  FULL.forEach((s) => provider.addScope(s));
  // без prompt: 'consent' — если доступ уже дан, Google не показывает экран согласия, окно закрывается само
  provider.setCustomParameters({ login_hint: auth.currentUser?.email || '' });
  const res = await reauthenticateWithPopup(auth.currentUser, provider);
  const token = GoogleAuthProvider.credentialFromResult(res)?.accessToken;
  if (!token) throw new Error('Google не выдал разрешение на Диск и Таблицы');
  cached = { token, exp: Date.now() + 55 * 60 * 1000 };  // токен Google живёт час
  try { localStorage.setItem('pz_gtoken', JSON.stringify(cached)); } catch { /* ok */ }  // и после перезагрузки страницы не спрашивать снова
  return token;
}

// Окно входа Google без Firebase: возвращается на сайт с токеном в адресе, captureTokenFromUrl кладёт его в хранилище
function popupToken() {
  try { localStorage.removeItem('pz_gtoken_err'); } catch { /* ok */ }
  const w = window.open(authUrl('pz_gpopup'), 'pz_google', 'width=520,height=640');
  if (!w) { location.href = authUrl('pz_gsync'); return new Promise(() => {}); }  // всплывающие окна запрещены — переходом
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const t = setInterval(() => {
      const st = stored();
      if (st) { clearInterval(t); cached = st; resolve(st.token); return; }
      let err = null; try { err = localStorage.getItem('pz_gtoken_err'); } catch { /* ok */ }
      if (err) { clearInterval(t); reject(new Error(err === 'access_denied' ? 'Доступ к Google Диску не дан' : `Google: ${err}`)); return; }
      // w.closed после страниц Google ненадёжен (окно «отвязывается»), поэтому просто ждём до 3 минут
      if (Date.now() - started > 180000) { clearInterval(t); reject(new Error('Разрешение Google не получено — попробуйте ещё раз')); }
    }, 400);
  });
}

async function call(token, method, url, body) {
  const r = await fetch(url, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!r.ok) {
    const e = new Error(json?.error?.message || `HTTP ${r.status}`); e.status = r.status; e.reason = json?.error?.errors?.[0]?.reason; throw e;
  }
  return json;
}

// Тот же набор операций, что нужен синхронизации; в тестах подменяется заглушкой.
import { projectFolder, moveInto } from './drivefolders.js';

export function realApi(token) {
  const req = (m, u, b) => call(token, m, u, b);
  const D = 'https://www.googleapis.com/drive/v3/files';
  const S = 'https://sheets.googleapis.com/v4/spreadsheets';
  return {
    async fileInfo(id) {
      try { const f = await call(token, 'GET', `${D}/${id}?fields=id,name,trashed`); return f.trashed ? null : f; } catch (e) { if (e.status === 404) return null; throw e; }
    },
    // Новая пустая таблица (без шаблона); листы создаёт приложение
    create: async (title) => { const r = await call(token, 'POST', S, { properties: { title } }); return { id: r.spreadsheetId, name: title }; },
    // Доступ на редактирование для сервисного аккаунта (без письма-уведомления)
    share: (id, email) => call(token, 'POST', `${D}/${id}/permissions?sendNotificationEmail=false&fields=id`, { role: 'writer', type: 'user', emailAddress: email }),
    rename: (id, name) => call(token, 'PATCH', `${D}/${id}?fields=id`, { name }),
    sheetsOf: async (id) => (await call(token, 'GET', `${S}/${id}?fields=sheets.properties(sheetId,title,gridProperties)`)).sheets.map((x) => x.properties),
    batch: (id, requests) => call(token, 'POST', `${S}/${id}:batchUpdate`, { requests }),
    async folder(name) {
      const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const f = (await call(token, 'GET', `${D}?q=${q}&fields=files(id)`)).files?.[0];
      if (f) return f.id;
      return (await call(token, 'POST', `${D}?fields=id`, { name, mimeType: 'application/vnd.google-apps.folder' })).id;
    },
    // Создаёт или перезаписывает JSON-файл в папке (по имени)
    async putJson(folderId, name, text) {
      const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`);
      const old = (await call(token, 'GET', `${D}?q=${q}&fields=files(id)`)).files?.[0];
      const boundary = 'pzb' + Math.random().toString(36).slice(2);
      const meta = old ? { name } : { name, parents: [folderId], mimeType: 'application/json' };
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
      const url = `https://www.googleapis.com/upload/drive/v3/files${old ? `/${old.id}` : ''}?uploadType=multipart&fields=id`;
      const r = await fetch(url, { method: old ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
      if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
      return (await r.json()).id;
    },
    // папки проекта на Диске (см. drivefolders.js)
    projectFolder: (project, kind) => projectFolder(req, project, kind),
    placeIn: async (fileId, project, kind) => moveInto(req, fileId, await projectFolder(req, project, kind)),
    req,
    write: (id, data) => call(token, 'POST', `${S}/${id}/values:batchUpdate`, { valueInputOption: 'RAW', data }),
  };
}

// Токен отвергнут Google (истёк или отозван): забываем его, следующий вызов запросит новый
export function clearToken() { cached = { token: '', exp: 0 }; try { localStorage.removeItem('pz_gtoken'); } catch { /* ok */ } }
export function storedTokenValid() { return !!stored(); }
