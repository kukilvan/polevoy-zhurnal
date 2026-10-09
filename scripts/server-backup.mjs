// Ночная копия всех проектов из Firestore в папку (её затем коммитит GitHub Actions в закрытый репозиторий).
// Запуск: FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/server-backup.mjs <папка-для-копий>
import fs from 'node:fs';
import path from 'node:path';
import admin from 'firebase-admin';
import { isDeleted, readProject, writeProjectBackup, pruneOld, stamp } from './server-backup-lib.mjs';

const KEEP = 15;
const root = process.argv[2];
if (!root) { console.error('Укажите папку для копий'); process.exit(1); }
const key = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!key) { console.error('Нет секрета FIREBASE_SERVICE_ACCOUNT'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key)) });
const db = admin.firestore();
const now = new Date();
const dir = path.join(root, stamp(now));
fs.mkdirSync(dir, { recursive: true });

const refs = await db.collection('projects').listDocuments();
if (!refs.length) { console.error('В базе нет проектов: копия не создана'); process.exit(1); }
const done = [];
for (const ref of refs) {
  const p = await readProject(ref);
  if (isDeleted(p.project)) { console.log(`Пропущен удалённый проект: ${p.project.name}`); continue; }
  done.push(writeProjectBackup(dir, p, now));
  // отметка в проекте, чтобы приложение показывало дату последней автокопии
  await ref.set({ serverBackupAt: now.toISOString() }, { merge: true });
}
fs.writeFileSync(path.join(dir, 'ИТОГ.json'), JSON.stringify({ at: now.toISOString(), projects: done }, null, 2));
const dropped = pruneOld(root, KEEP);
console.log(`Скопировано проектов: ${done.length}. Удалено старых копий: ${dropped.length}.`);
done.forEach((d) => console.log(`- ${d.name}: ${Object.entries(d.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`));
