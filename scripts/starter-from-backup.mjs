// Стартовый набор из последней серверной копии (без чтения базы — не тратит суточный лимит Firestore).
// Запуск: node scripts/starter-from-backup.mjs <папка репозитория копий> src/data/starter-pool.json
import fs from 'node:fs';
import path from 'node:path';
import { COMMON_FILE } from './server-backup-lib.mjs';

const [root, out = 'src/data/starter-pool.json'] = process.argv.slice(2);
const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(d.name)).map((d) => d.name).sort().reverse();
const dir = dirs.find((d) => fs.existsSync(path.join(root, d, COMMON_FILE)));
if (!dir) { console.log('::error::В копиях нет файла с общим пулом'); process.exit(1); }
const common = JSON.parse(fs.readFileSync(path.join(root, dir, COMMON_FILE), 'utf8'));
const DROP = /^(createdBy|createdByName|createdAt|updatedBy|updatedByName|updatedAt|updatedAtServer|owner|addedBy|addedByName|projectId)$/;
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !DROP.test(k)));
const pool = {};
for (const kind of ['types', 'devices', 'cables', 'catalog', 'doorcfg']) {
  pool[kind] = (common.collections[`pool_${kind}`] || []).map(clean).filter((x) => !x.deleted).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
const text = JSON.stringify({ format: 'polevoy-starter-pool-1', createdAt: new Date().toISOString(), from: dir, pool }, null, 1);
if (/@gmail\.com/i.test(text)) console.log('::warning::В наборе встречается почта — проверьте файл');
fs.writeFileSync(out, text);
console.log(`::notice::Стартовый набор из копии ${dir}: ${Object.entries(pool).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
