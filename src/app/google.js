// Доступ к Google Диску и Таблицам от имени пользователя (по кнопке, нужно отдельное согласие).
import { GoogleAuthProvider, reauthenticateWithPopup, reauthenticateWithRedirect } from 'firebase/auth';
import { auth } from '../firebase.js';

const SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'];
let cached = { token: '', exp: 0 };

const useRedirect = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  || window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
export const PENDING = 'pz_gsync_pending';

function stored() {
  try { const t = JSON.parse(localStorage.getItem('pz_gtoken') || 'null'); return t && Date.now() < t.exp ? t : null; } catch { return null; }
}

export async function getToken() {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const st = stored(); if (st) { cached = st; return st.token; }
  const provider = new GoogleAuthProvider();
  SCOPES.forEach((s) => provider.addScope(s));
  provider.setCustomParameters({ prompt: 'consent', login_hint: auth.currentUser?.email || '' });
  if (useRedirect()) { // на iPhone (Safari и экран «Домой») всплывающие окна закрываются сами — идём через переход
    try { localStorage.setItem(PENDING, '1'); } catch { /* ok */ }
    await reauthenticateWithRedirect(auth.currentUser, provider);
    return new Promise(() => {}); // страница уходит на Google; продолжение после возврата
  }
  const res = await reauthenticateWithPopup(auth.currentUser, provider);
  const token = GoogleAuthProvider.credentialFromResult(res)?.accessToken;
  if (!token) throw new Error('Google не выдал разрешение на Диск и Таблицы');
  cached = { token, exp: Date.now() + 50 * 60 * 1000 };
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
    copy: (templateId, name) => call(token, 'POST', `${D}/${templateId}/copy?fields=id,name`, { name }),
    rename: (id, name) => call(token, 'PATCH', `${D}/${id}?fields=id`, { name }),
    sheetsOf: async (id) => (await call(token, 'GET', `${S}/${id}?fields=sheets.properties(sheetId,title,gridProperties)`)).sheets.map((x) => x.properties),
    batch: (id, requests) => call(token, 'POST', `${S}/${id}:batchUpdate`, { requests }),
    clear: (id, ranges) => call(token, 'POST', `${S}/${id}/values:batchClear`, { ranges }),
    write: (id, data) => call(token, 'POST', `${S}/${id}/values:batchUpdate`, { valueInputOption: 'RAW', data }),
  };
}
