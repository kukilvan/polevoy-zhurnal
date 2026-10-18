// Запуск: FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/server-tables.mjs
import admin from 'firebase-admin';
import { GoogleAuth } from 'google-auth-library';
import { readProject, isDeleted } from './server-backup-lib.mjs';
import { updateProjectTables, applyPatches, autoTables, updateProjectNumbered, applyDrawingPatches, applyManagerPatches, updateProjectRackTable } from './server-tables-lib.mjs';

const note = (m, e) => console.log(`::error::${m}: ${String(e?.stack || e).replace(/\n/g, ' | ').slice(0, 900)}`);
process.on('uncaughtException', (e) => { note('Необработанная ошибка', e); process.exit(1); });
process.on('unhandledRejection', (e) => { note('Необработанный отказ', e); process.exit(1); });
const key = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!key) { console.error('Нет секрета FIREBASE_SERVICE_ACCOUNT'); process.exit(1); }
const cred = JSON.parse(key);
admin.initializeApp({ credential: admin.credential.cert(cred) });
const db = admin.firestore();
const auth = new GoogleAuth({ credentials: cred, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });

const D = 'https://www.googleapis.com/drive/v3/files';
const S = 'https://sheets.googleapis.com/v4/spreadsheets';
async function call(method, url, body) {
  const token = (await auth.getAccessToken());
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!r.ok) { const e = new Error(json?.error?.message || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return json;
}
const api = {
  async fileInfo(id) { try { const f = await call('GET', `${D}/${id}?fields=id,name,trashed`); return f.trashed ? null : f; } catch (e) { if (e.status === 404 || e.status === 403) return null; throw e; } },
  rename: (id, name) => call('PATCH', `${D}/${id}?fields=id`, { name }),
  sheetsOf: async (id) => (await call('GET', `${S}/${id}?fields=sheets.properties(sheetId,title,gridProperties)`)).sheets.map((x) => x.properties),
  batch: (id, requests) => call('POST', `${S}/${id}:batchUpdate`, { requests }),
  write: (id, data) => call('POST', `${S}/${id}/values:batchUpdate`, { valueInputOption: 'RAW', data }),
  // для «PDF с номерами»
  async download(id) { const token = await auth.getAccessToken(); const r = await fetch(`${D}/${id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error(`Чертёж не скачать: HTTP ${r.status} (откройте его серверу кнопкой «☁️ … на Диск» в плане)`); return new Uint8Array(await r.arrayBuffer()); },
  async upload(id, bytes) { const token = await auth.getAccessToken(); const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' }, body: bytes }); if (!r.ok) throw new Error(`Не записать на Диск: HTTP ${r.status}`); },
};
let mupdf = null;

// для сборки таблиц журнал изменений (history), дела и заметки не нужны — не читаем их, чтобы экономить лимит чтений
const NEED = ['points', 'days', 'entries', 'journal', 'catalog', 'types', 'cables', 'devices', 'configs', 'units', 'culprits', 'delayReasons', 'cabinetSettings'];
const now = new Date();
let failed = 0;
// ошибки выводим как аннотации GitHub (видны в сводке запуска и через API)
const fail = (m, e) => { console.log(`::error::${m}: ${String(e?.stack || e).replace(/\n/g, ' | ')}`); failed += 1; };
try {
for (const ref of await db.collection('projects').listDocuments()) {
  const { project, data } = await readProject(ref, NEED);
  if (isDeleted(project) || project.archived) continue; // архивные проекты не обновляем
  // адрес сервера записываем в проект: приложение откроет ему доступ к файлам таблиц
  await ref.set({ serverEmail: cred.client_email }, { merge: true });
  // «PDF с номерами» на Диске
  if ((project.drawings || []).some((d) => (d.numberedFileId || project.managers?.drawings?.[d.id]?.fileId) && !d.deleted)) {
    mupdf ??= await import('mupdf');
    const { patches, mgrPatches, report } = await updateProjectNumbered(api, mupdf, project, data, now);
    if (Object.keys(patches).length || Object.keys(mgrPatches).length) await db.runTransaction(async (tx) => { const fresh = { id: ref.id, ...(await tx.get(ref)).data() }; tx.set(ref, { drawings: applyDrawingPatches(fresh, patches), managers: applyManagerPatches(fresh, mgrPatches) }, { merge: true }); });
    report.forEach((l) => console.log(l.includes('ОШИБКА') ? `::warning::${project.name}: ${l}` : `  - ${l}`));
  }
  // таблица шкафов и шильюта для руководства
  {
    const { patch, report } = await updateProjectRackTable(api, project, data, now);
    if (patch) await db.runTransaction(async (tx) => { const fresh = { id: ref.id, ...(await tx.get(ref)).data() }; tx.set(ref, { rackTable: { ...(fresh.rackTable || {}), ...patch } }, { merge: true }); });
    report.forEach((l) => console.log(l.includes('ОШИБКА') ? `::warning::${project.name}: ${l}` : `  - ${l}`));
  }
  if (!autoTables(project).length) { console.log(`${project.name}: нет таблиц для автообновления`); continue; }
  const { patches, report } = await updateProjectTables(api, project, data, now);
  await db.runTransaction(async (tx) => {
    const fresh = { id: ref.id, ...(await tx.get(ref)).data() };
    tx.set(ref, { tables: applyPatches(fresh, patches) }, { merge: true });
  });
  console.log(`${project.name}:`);
  report.forEach((l) => console.log(l.includes('ОШИБКА') ? `::warning::${project.name}: ${l}` : `  - ${l}`));
}
} catch (e) { fail('Общий сбой', e); }
if (failed) console.log(`Проектов с ошибками: ${failed} (смотрите сообщения выше; в приложении тоже видно)`);

if (failed) process.exit(1);
