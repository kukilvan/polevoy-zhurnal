// Копия данных вне GitHub: самая свежая папка автокопии упаковывается в zip и заменяет содержимое файла
// «Автокопия данных (обновляется каждые 2 дня).zip» на Google Диске владельца. Файл создан владельцем и открыт сервисному
// аккаунту на запись (сам сервисный аккаунт не может создавать файлы в чужом Диске — у него нет своего места).
// Прежние версии Диск хранит сам (около 30 дней): «Файл → Управление версиями».
// Запуск: FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/server-drive-backup.mjs <папка с копиями>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GoogleAuth } from 'google-auth-library';

export const DRIVE_FILE_NAME = 'Автокопия данных (обновляется каждые 2 дня).zip';
const root = process.argv[2];
const key = process.env.FIREBASE_SERVICE_ACCOUNT;
const fail = (m) => { console.log(`::error::Копия на Диск не сделана: ${m}`); process.exit(1); };
if (!root || !key) fail('нет папки копий или ключа FIREBASE_SERVICE_ACCOUNT');

const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(d.name)).map((d) => d.name).sort();
const last = dirs.at(-1); if (!last) fail('нет ни одной папки копии');
const zip = path.join(process.env.RUNNER_TEMP || '/tmp', `backup-${last}.zip`);
execFileSync('zip', ['-qr', zip, last], { cwd: root });
const bytes = fs.readFileSync(zip);

const auth = new GoogleAuth({ credentials: JSON.parse(key), scopes: ['https://www.googleapis.com/auth/drive'] });
const token = await auth.getAccessToken();
const H = { Authorization: `Bearer ${token}` };
const q = encodeURIComponent(`name = '${DRIVE_FILE_NAME}' and trashed = false`);
const list = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: H });
if (!list.ok) fail(`поиск файла: HTTP ${list.status} ${await list.text()}`);
const files = (await list.json()).files || [];
if (!files.length) fail(`на Диске нет файла «${DRIVE_FILE_NAME}», открытого сервисному аккаунту на запись. Создайте его в папке «Полевой журнал» и дайте доступ «Редактор» сервисному аккаунту`);
const id = files[0].id;
const up = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id,size`, { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/zip' }, body: bytes });
if (!up.ok) fail(`загрузка: HTTP ${up.status} ${await up.text()}`);
await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ description: `Копия ${last} (UTC). Внутри — папка автокопии, как в репозитории polevoy-backups. Как восстановить — ВОССТАНОВЛЕНИЕ.md` }) });
console.log(`::notice::Копия ${last} (${Math.round(bytes.length / 1024)} КБ) сохранена на Google Диск: «${DRIVE_FILE_NAME}»`);
