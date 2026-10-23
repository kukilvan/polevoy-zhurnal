// Восстановление базы из серверной копии (папка вида 2026-10-23_0830 из репозитория polevoy-backups) в ПУСТОЙ проект Firebase.
// Нужен только, если старый проект Firebase потерян. Обычный откат одного проекта — в приложении («Импорт данных»).
// Запуск:
//   npm i --no-save firebase-admin@13
//   FIREBASE_SERVICE_ACCOUNT="$(cat ключ.json)" node scripts/server-restore.mjs <папка копии>          — только показать, что будет записано
//   FIREBASE_SERVICE_ACCOUNT="$(cat ключ.json)" node scripts/server-restore.mjs <папка копии> --write  — записать
import admin from 'firebase-admin';
import { restorePlan, revive } from './server-backup-lib.mjs';

const dir = process.argv[2]; const write = process.argv.includes('--write'); const force = process.argv.includes('--force');
if (!dir) { console.error('Укажите папку копии'); process.exit(1); }
const key = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!key) { console.error('Нет FIREBASE_SERVICE_ACCOUNT (содержимое JSON-ключа сервисного аккаунта)'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key)) });
const db = admin.firestore();

const plan = restorePlan(dir);
const byTop = {}; plan.forEach((w) => { const k = w.path.split('/').length === 2 ? w.path.split('/')[0] : w.path.split('/').slice(0, 1).join('/') + '/…/' + w.path.split('/').slice(-2, -1)[0]; byTop[k] = (byTop[k] || 0) + 1; });
console.log(`Записей к восстановлению: ${plan.length}`); Object.entries(byTop).forEach(([k, n]) => console.log(`  ${k}: ${n}`));
if (!write) { console.log('Это проверка. Чтобы записать, добавьте --write'); process.exit(0); }
const existing = await db.collection('projects').limit(1).get();
if (!existing.empty && !force) { console.error('В базе уже есть проекты. Восстановление пишется только в пустую базу (или добавьте --force, если понимаете, что делаете)'); process.exit(1); }
for (let i = 0; i < plan.length; i += 400) {
  const batch = db.batch();
  plan.slice(i, i + 400).forEach((w) => batch.set(db.doc(w.path), revive(w.data, admin.firestore.Timestamp)));
  await batch.commit();
  console.log(`Записано: ${Math.min(i + 400, plan.length)} из ${plan.length}`);
}
console.log('Готово. Залейте правила firestore.rules и войдите в приложение.');
