// Чертежи проекта (PDF тохнитов) для плана в приложении: файл на Google Диске (папка «Менеджер проектов — чертежи», доступ участникам
// проекта на чтение) + копия на устройстве (IndexedDB), чтобы план открывался без интернета. В проекте — список project.drawings:
// [{ id, name, floor, pages:[{w,h}], fileId?, size, addedAt, addedBy }]. Точка привязана к чертежу по pos.sheet === name.
import { getRepo, currentProject } from './store.js';
import { getToken, clearToken, useRedirect, storedTokenValid } from './google.js';
import { newId } from './repo.js';
import { isLocal } from '../edition.js';
import { projectFolder, moveInto } from './drivefolders.js';

export const DRAWINGS_FOLDER = // старая папка (до папок проектов), только для поиска прежних файлов
  'Полевой журнал — чертежи';
const mem = () => new URLSearchParams(location.search).get('mem');

// ---- копия на устройстве ----
const DB = 'pz-drawings'; const STORE = 'files';
function idb() {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function tx(mode, fn) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const req = fn(t.objectStore(STORE)); t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error); }); }
export const cacheGet = (id) => tx('readonly', (s) => s.get(id)).catch(() => null);
export const cachePut = (id, buf) => tx('readwrite', (s) => s.put(buf, id)).catch(() => null);

// порядок — поле order (задаётся в «✏️ Названия и порядок»); без него — в порядке добавления
export const drawingsOf = (p = currentProject()) => (p?.drawings || []).filter((d) => !d.deleted).map((d, i) => [d, i]).sort((a, b) => (a[0].order ?? 1e6 + a[1]) - (b[0].order ?? 1e6 + b[1])).map(([d]) => d);
// название для человека: своё (title) или имя файла; имя файла (name) остаётся для связи точек и поиска дубликатов
export const drawingTitle = (d) => (d?.title || d?.name || '');
export const drawingFor = (point, p = currentProject()) => (point?.pos?.sheet ? drawingsOf(p).find((d) => d.name === point.pos.sheet || (d.aliases || []).includes(point.pos.sheet)) : null);

// ---- Google Диск ----
async function drive(method, url, { body, headers = {}, raw = false } = {}, retried = false) {
  const token = await getToken('drawing');
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...headers }, body });
  if (r.status === 401 && !retried) { clearToken(); return drive(method, url, { body, headers, raw }, true); }
  if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).error?.message || m; } catch { /* ok */ } const e = new Error(m); e.status = r.status; throw e; }
  return raw ? r : r.json();
}
const D = 'https://www.googleapis.com/drive/v3/files';
// Загрузка большого файла по частям не нужна: возобновляемая загрузка одним куском (до сотен МБ)
const dreq = (method, url, body) => drive(method, url, body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {});
export { drive as driveCall, dreq };
const qEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function uploadPdf(name, buf, p = currentProject()) {
  const parent = await projectFolder(dreq, p, 'drawings');
  // такой файл уже есть в папке проекта — заменяем его содержимое, а не создаём копию
  const old = (await drive('GET', `${D}?q=${encodeURIComponent(`name='${qEsc(name)}' and '${parent}' in parents and trashed=false`)}&fields=files(id)`)).files?.[0];
  const init = await drive(old ? 'PATCH' : 'POST', `https://www.googleapis.com/upload/drive/v3/files${old ? `/${old.id}` : ''}?uploadType=resumable&fields=id`, {
    body: JSON.stringify(old ? {} : { name, parents: [parent], mimeType: 'application/pdf' }), headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/pdf' }, raw: true });
  const loc = init.headers.get('Location'); if (!loc) throw new Error('Диск не дал адрес для загрузки');
  const r = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: buf });
  if (!r.ok) throw new Error(`Загрузка на Диск: HTTP ${r.status}`);
  return (await r.json()).id;
}
/** «PDF с номерами» на Диск: папка проекта «Чертежи с номерами», один файл на чертёж — каждый раз заменяется свежим */
export async function putNumbered(name, bytes, p = currentProject(), fileId = '', kind = 'numbered') {
  if (mem()) return null;
  if (useRedirect() && !storedTokenValid()) return null;  // iPhone без разрешения Google — не уводим со страницы
  const parent = await projectFolder(dreq, p, kind);
  let old = null;
  if (fileId) { try { const f = await drive('GET', `${D}/${fileId}?fields=id,trashed`); if (!f.trashed) old = f; } catch { /* удалён — создадим новый */ } }
  if (!old) {
    const q = encodeURIComponent(`name='${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and '${parent}' in parents and trashed=false`);
    old = (await drive('GET', `${D}?q=${q}&fields=files(id)`)).files?.[0];
  }
  const init = await drive(old ? 'PATCH' : 'POST', `https://www.googleapis.com/upload/drive/v3/files${old ? `/${old.id}` : ''}?uploadType=resumable&fields=id`, {
    body: JSON.stringify(old ? {} : { name, parents: [parent], mimeType: 'application/pdf' }), headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/pdf' }, raw: true });
  const loc = init.headers.get('Location'); if (!loc) throw new Error('Диск не дал адрес для загрузки');
  const r = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: bytes });
  if (!r.ok) throw new Error(`Загрузка на Диск: HTTP ${r.status}`);
  const id = (await r.json()).id;
  if (!old) await shareDrawing(id, p);
  return id;
}
// Доступ серверу (ночное обновление «PDF с номерами»): role — reader для исходного чертежа, writer для файла с номерами
export async function shareWithServer(fileId, email, role) {
  if (!fileId || !email || mem()) return;
  await drive('POST', `${D}/${fileId}/permissions?sendNotificationEmail=false&fields=id`, { body: JSON.stringify({ role, type: 'user', emailAddress: email }), headers: { 'Content-Type': 'application/json' } });
}
// Доступ «читатель» участникам проекта (без писем)
export async function shareDrawing(fileId, p = currentProject()) {
  const me = getRepo().user?.email?.toLowerCase();
  for (const email of (p.memberEmails || []).filter((e) => e && e.toLowerCase() !== me)) {
    try { await drive('POST', `${D}/${fileId}/permissions?sendNotificationEmail=false&fields=id`, { body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: email }), headers: { 'Content-Type': 'application/json' } }); } catch { /* участник без Google-аккаунта — пропускаем */ }
  }
}

/** Сохранить чертёж в проект: сразу копия на устройстве и запись в проекте, потом — на Диск (если не вышло, можно повторить) */
export async function addDrawing(buf, { name, floor = '', pages = [], push = true, fileId = null }) {
  const p = currentProject(); const repo = getRepo();
  const old = drawingsOf(p).find((d) => d.name === name);
  const id = old?.id || `DR_${newId(6)}`;
  await cachePut(id, buf);
  // fileId — чертёж взят с Google Диска: новую копию не загружаем
  const entry = { ...(old || {}), id, name, floor: floor || old?.floor || '', pages, size: buf.byteLength, addedAt: new Date().toISOString(), addedBy: repo.user?.email || '', fileId: fileId || old?.fileId || null };
  if (fileId && !mem()) shareDrawing(fileId, p).catch(() => {});
  const list = [...(p.drawings || []).filter((d) => d.id !== id), entry];
  repo.saveProject(p.id, { drawings: list });
  // на iPhone вход в Google уводит со страницы — отправим на Диск позже (кнопка «⬆ На Диск» в плане), если доступа ещё нет
  // на устройстве (без базы) чертёж хранится в телефоне, на Диск — только кнопкой «⬆ На Диск»
  if (!entry.fileId && push && !isLocal() && (!useRedirect() || storedTokenValid())) return pushDrawing(entry, buf);
  return entry;
}
/** Отправить на Диск чертёж, который пока только на этом устройстве */
export async function pushDrawing(entry, buf = null, proj = currentProject()) {
  if (mem()) return entry;
  const data = buf || await cacheGet(entry.id); if (!data) throw new Error('Файла чертежа нет на этом устройстве');
  const fileId = await uploadPdf(entry.name, data, proj);
  await shareDrawing(fileId, proj);
  const p = proj;
  getRepo().saveProject(p.id, { drawings: (p.drawings || []).map((d) => (d.id === entry.id ? { ...d, fileId } : d)) });
  return { ...entry, fileId };
}
/** PDF чертежа: с устройства, иначе с Диска (и сохранить на устройстве) */
export async function loadDrawing(entry) {
  const local = await cacheGet(entry.id); if (local) return local;
  if (!entry.fileId) throw new Error('Чертёж загружен с другого устройства и ещё не отправлен на Диск — откройте его там и нажмите «⬆ На Диск»');
  const r = await drive('GET', `${D}/${entry.fileId}?alt=media`, { raw: true });
  const buf = await r.arrayBuffer(); await cachePut(entry.id, buf); return buf;
}
export function removeDrawing(entry) {
  const p = currentProject();
  getRepo().saveProject(p.id, { drawings: (p.drawings || []).filter((d) => d.id !== entry.id) });
}

/** Поменять запись чертежа в проекте (patch — объект или функция от старой записи) */
export function updateDrawing(id, patch) {
  const p = currentProject();
  getRepo().saveProject(p.id, { drawings: (p.drawings || []).map((d) => (d.id === id ? { ...d, ...(typeof patch === 'function' ? patch(d) : patch) } : d)) });
}
// Подписи на чертеже, которые не связаны с точками проекта («Не размеченые») и скрытые человеком — хранятся в записи чертежа
export const posKey = (pos) => `${pos.page || 0}|${Math.round(pos.x)}|${Math.round(pos.y)}`;

/** Переложить файлы чертежей проекта в папку проекта на Диске (свои файлы; чужие Диск не даст) */
export async function placeDrawings(p = currentProject()) {
  const list = drawingsOf(p).filter((d) => d.fileId); if (!list.length) return 0;
  const parent = await projectFolder(dreq, p, 'drawings'); let n = 0;
  for (const d of list) if (await moveInto(dreq, d.fileId, parent)) n++;
  return n;
}

/** PDF тохнитов, которые уже лежат на Google Диске в папках «Чертежи» проектов приложения: [{ id, name, project }] */
export async function listDrivePdfs() {
  if (mem()) return [];
  const fq = `mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='pzKind' and value='drawings' }`;
  const folders = (await drive('GET', `${D}?q=${encodeURIComponent(fq)}&fields=files(id,parents)&pageSize=100`)).files || [];
  const out = [];
  for (const f of folders) {
    let project = '';
    try { const par = f.parents?.[0]; if (par) project = (await drive('GET', `${D}/${par}?fields=name`)).name || ''; } catch { /* ok */ }
    const q = `'${f.id}' in parents and trashed=false and mimeType='application/pdf'`;
    ((await drive('GET', `${D}?q=${encodeURIComponent(q)}&fields=files(id,name,size,modifiedTime)&pageSize=200`)).files || []).forEach((x) => out.push({ ...x, project }));
  }
  return out.sort((a, b) => a.project.localeCompare(b.project, 'ru') || a.name.localeCompare(b.name, 'ru', { numeric: true }));
}
/** Скачать файл с Диска */
export async function downloadDriveFile(id) { const r = await drive('GET', `${D}/${id}?alt=media`, { raw: true }); return r.arrayBuffer(); }
