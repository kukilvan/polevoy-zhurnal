// Стартовый набор для открытой версии: копия общего пула (типы, устройства, кабели, работы, конфигурации дверей) без служебных полей.
// Запускается вручную (Actions → «Export starter pool»), результат коммитится в src/data/starter-pool.json.
import fs from 'node:fs';
import admin from 'firebase-admin';

const key = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!key) { console.error('Нет FIREBASE_SERVICE_ACCOUNT'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key)) });
const db = admin.firestore();
const DROP = /^(createdBy|createdByName|createdAt|updatedBy|updatedByName|updatedAt|updatedAtServer|owner|addedBy|addedByName|projectId)$/;
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !DROP.test(k)));
const out = { format: 'polevoy-starter-pool-1', createdAt: new Date().toISOString(), pool: {} };
for (const kind of ['types', 'devices', 'cables', 'catalog', 'doorcfg']) {
  const snap = await db.collection(`pool_${kind}`).get();
  out.pool[kind] = snap.docs.map((d) => ({ id: d.id, ...clean(d.data()) })).filter((x) => !x.deleted).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
const text = JSON.stringify(out, null, 1);
if (/@gmail\.com|@[a-z0-9-]+\.[a-z]{2,}/i.test(text)) console.log('::warning::В наборе встречается почта — проверьте файл');
fs.writeFileSync(process.argv[2] || 'src/data/starter-pool.json', text);
console.log(`::notice::Стартовый набор: ${Object.entries(out.pool).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
