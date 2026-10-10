// Доступ к Google Диску и Таблицам от имени пользователя (по кнопке, нужно отдельное согласие).
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { auth } from '../firebase.js';

export const CLIENT_ID = '473054171494-sin5sm8i45hi24oi23udnk13iduqtbrs.apps.googleusercontent.com'; // веб-клиент Firebase (публичный)
const SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'];
let cached = { token: '', exp: 0 };

const useRedirect = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  || window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
// Вызывается при запуске: если вернулись с Google с токеном в адресе — сохраняем его и чистим адрес
export function captureTokenFromUrl() {
  try {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (p.get('state') !== 'pz_gsync') return;
    const token = p.get('access_token');
    if (token) localStorage.setItem('pz_gtoken', JSON.stringify({ token, exp: Date.now() + (Number(p.get('expires_in')) || 3000) * 700 }));
    history.replaceState(null, '', location.pathname + location.search);
  } catch { /* ok */ }
}
export const PENDING = 'pz_gsync_pending';

function stored() {
  try { const t = JSON.parse(localStorage.getItem('pz_gtoken') || 'null'); return t && Date.now() < t.exp ? t : null; } catch { return null; }
}

export async function getToken(action = 'managers') {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const st = stored(); if (st) { cached = st; return st.token; }
  const provider = new GoogleAuthProvider();
  SCOPES.forEach((s) => provider.addScope(s));
  provider.setCustomParameters({ prompt: 'consent', login_hint: auth.currentUser?.email || '' });
  if (useRedirect()) { // iPhone: окна Google закрываются, а результат Firebase-перехода Safari теряет — идём напрямую в Google и читаем токен из адреса
    try { localStorage.setItem(PENDING, action); } catch { /* ok */ }
    const q = new URLSearchParams({
      client_id: CLIENT_ID, redirect_uri: location.origin + location.pathname, response_type: 'token', scope: SCOPES.join(' '),
      include_granted_scopes: 'true', state: 'pz_gsync', login_hint: auth.currentUser?.email || '',
    });
    location.href = `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    return new Promise(() => {}); // страница уходит на Google; продолжение после возврата
  }
  const res = await reauthenticateWithPopup(auth.currentUser, provider);
  const token = GoogleAuthProvider.credentialFromResult(res)?.accessToken;
  if (!token) throw new Error('Google не выдал разрешение на Диск и Таблицы');
  cached = { token, exp: Date.now() + 40 * 60 * 1000 };
  return token;
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
export function realApi(token) {
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
    write: (id, data) => call(token, 'POST', `${S}/${id}/values:batchUpdate`, { valueInputOption: 'RAW', data }),
  };
}

// Токен отвергнут Google (истёк или отозван): забываем его, следующий вызов запросит новый
export function clearToken() { cached = { token: '', exp: 0 }; try { localStorage.removeItem('pz_gtoken'); } catch { /* ok */ } }
export function storedTokenValid() { return !!stored(); }
