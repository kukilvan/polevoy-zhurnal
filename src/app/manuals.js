// Инструкции в руководстве (схемы, фото подключений, таблицы, PDF). Общие для всех проектов:
// запись — в общей коллекции pool_manuals (видят и добавляют все участники), файл — на Google Диске владельца записи
// в папке «Менеджер проектов / Инструкции» (доступ «у кого есть ссылка — читатель»), копия — на устройстве (работает офлайн).
import { getRepo } from './store.js';
import { isAdminEmail } from '../edition.js';
import { newId } from './repo.js';
import { driveCall, dreq, cacheGet, cachePut } from './drawings.js';
import { manualsFolder } from './drivefolders.js';
import { useRedirect, storedTokenValid } from './google.js';
import { visibleManuals } from '../domain/index.js';

const D = 'https://www.googleapis.com/drive/v3/files';
const mem = () => new URLSearchParams(location.search).get('mem');
let list = []; let started = false; const subs = new Set();
export const onManuals = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export function startManuals() {
  if (started || !getRepo()) return; started = true;
  getRepo().listenPool('manuals', (docs) => { list = docs.filter((x) => !x.deleted); subs.forEach((f) => { try { f(); } catch { /* ok */ } }); });
}
export const myManuals = () => visibleManuals(list, getRepo()?.user?.email);
export const canEditManual = (m) => {
  const me = String(getRepo()?.user?.email || '').toLowerCase();
  return isAdminEmail(me) || String(m.addedBy || '').toLowerCase() === me;
};

/** Большие фото ужимаем (длинная сторона до 2400, JPEG) — иначе на телефоне тяжело и долго */
export async function shrinkImage(file) {
  if (!/^image\//.test(file.type) || file.size < 1_200_000) return { buf: await file.arrayBuffer(), mime: file.type, name: file.name };
  try {
    const bmp = await createImageBitmap(file); const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (blob && blob.size < file.size) return { buf: await blob.arrayBuffer(), mime: 'image/jpeg', name: file.name.replace(/\.\w+$/, '') + '.jpg' };
  } catch { /* не вышло — берём как есть */ }
  return { buf: await file.arrayBuffer(), mime: file.type, name: file.name };
}

/** Добавить инструкцию: сразу на устройство и в общий список, потом на Диск (на iPhone без разрешения Google — позже кнопкой) */
export async function addManual({ title, section, file }) {
  const repo = getRepo(); const { buf, mime, name } = await shrinkImage(file);
  const id = `MN_${newId(6)}`; await cachePut(id, buf);
  const entry = { id, title, section: section || 'Другое', fileName: name, mime: mime || 'application/octet-stream', size: buf.byteLength, addedBy: repo.user?.email || '', addedAt: new Date().toISOString(), fileId: mem() ? `mem-${id}` : null };
  repo.savePool([{ coll: 'manuals', id, data: entry }]);
  if (!entry.fileId && (!useRedirect() || storedTokenValid())) { try { return await pushManual(entry, buf); } catch (e) { return { ...entry, error: e.message }; } }
  return entry;
}
/** Отправить файл на Диск и дать доступ по ссылке */
export async function pushManual(entry, buf = null) {
  if (mem()) return entry;
  const data = buf || await cacheGet(entry.id); if (!data) throw new Error('Файла нет на этом устройстве');
  const parent = await manualsFolder(dreq);
  const init = await driveCall('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    body: JSON.stringify({ name: entry.fileName, parents: [parent], mimeType: entry.mime, appProperties: { pzManual: entry.id } }),
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': entry.mime }, raw: true });
  const loc = init.headers.get('Location'); if (!loc) throw new Error('Диск не дал адрес для загрузки');
  const r = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': entry.mime }, body: data });
  if (!r.ok) throw new Error(`Загрузка на Диск: HTTP ${r.status}`);
  const fileId = (await r.json()).id;
  await driveCall('POST', `${D}/${fileId}/permissions?fields=id`, { body: JSON.stringify({ role: 'reader', type: 'anyone' }), headers: { 'Content-Type': 'application/json' } });
  getRepo().savePool([{ coll: 'manuals', id: entry.id, data: { fileId } }]);   // только ссылка на файл: остальное не трогаем (его могли изменить на другом устройстве)
  return { ...entry, fileId };
}
/** Файл инструкции: с устройства, иначе с Диска (и сохранить на устройстве) */
export async function loadManual(entry) {
  const local = await cacheGet(entry.id); if (local) return local;
  if (!entry.fileId || mem()) throw new Error('Файл ещё не отправлен на Диск — откройте на телефоне, где его добавили, и нажмите «⬆ На Диск»');
  const r = await driveCall('GET', `${D}/${entry.fileId}?alt=media`, { raw: true });
  const buf = await r.arrayBuffer(); await cachePut(entry.id, buf); return buf;
}
export function updateManual(entry, patch) { getRepo().savePool([{ coll: 'manuals', id: entry.id, data: { ...patch } }]); }   // только изменённые поля
export function removeManual(entry) { getRepo().savePool([{ coll: 'manuals', id: entry.id, remove: true }]); }  // файл на Диске остаётся (удаляется только вручную)
