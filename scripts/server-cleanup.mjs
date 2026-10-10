// Ночная очистка: удаляет навсегда то, что помечено удалённым больше года (записи, проекты целиком) и записи журнала изменений старше года.
// Запускается ПОСЛЕ успешной резервной копии (в том же задании GitHub Actions). DRY_RUN=1 — только показать, что удалилось бы.
import admin from 'firebase-admin';
import { isExpiredDeleted, historyCutoff, RETENTION_DAYS } from '../src/domain/sync.js';

const key = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!key) { console.error('Нет секрета FIREBASE_SERVICE_ACCOUNT'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key)) });
const db = admin.firestore();
const dry = process.env.DRY_RUN === '1';
const now = Date.now();
const MAX_PER_COLLECTION = 5000; // страховка: за один запуск не больше столько документов из одной коллекции
const total = { projects: 0, records: 0, history: 0 };

async function removeAll(refs) {
  if (dry || !refs.length) return;
  const bw = db.bulkWriter();
  refs.forEach((r) => bw.delete(r));
  await bw.close();
}

for (const ref of await db.collection('projects').listDocuments()) {
  const snap = await ref.get();
  const project = snap.exists ? snap.data() : null;
  // проект, удалённый больше года назад, уходит целиком вместе со всеми данными
  if (project && isExpiredDeleted(project, now)) {
    console.log(`${dry ? '[проба] ' : ''}Проект «${project.name}» удалён навсегда (удалён ${new Date(project.deletedAt).toISOString().slice(0, 10)})`);
    if (!dry) await db.recursiveDelete(ref);
    total.projects += 1;
    continue;
  }
  for (const col of await ref.listCollections()) {
    let refs;
    if (col.id === 'history') {
      const q = await col.where('at', '<', historyCutoff(now)).limit(MAX_PER_COLLECTION).get();
      refs = q.docs.map((d) => d.ref); total.history += refs.length;
    } else {
      // в запросе только равенство (не нужен составной индекс); срок проверяем в коде
      const q = await col.where('deleted', '==', true).limit(MAX_PER_COLLECTION).get();
      refs = q.docs.filter((d) => isExpiredDeleted(d.data(), now)).map((d) => d.ref); total.records += refs.length;
    }
    if (refs.length) console.log(`${dry ? '[проба] ' : ''}${project?.name || ref.id}: ${col.id} — ${refs.length}`);
    await removeAll(refs);
  }
}
console.log(`${dry ? '[проба] ' : ''}Очистка (срок хранения ${RETENTION_DAYS} дн.): проектов ${total.projects}, записей ${total.records}, записей истории ${total.history}.`);
