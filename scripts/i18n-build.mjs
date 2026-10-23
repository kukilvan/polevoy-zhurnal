// Сборка словарей: src/i18n/src/*.json ({ "русский": ["English", "עברית"] }) → src/i18n/en.json и he.json
// и отчёт: сколько строк интерфейса ещё без перевода.
import fs from 'node:fs';
import path from 'node:path';
const dir = 'src/i18n/src'; const en = {}; const he = {};
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const [ru, [e, h]] of Object.entries(j)) { if (e) en[ru] = e; if (h) he[ru] = h; }
}
fs.writeFileSync('src/i18n/en.json', JSON.stringify(en, null, 0));
fs.writeFileSync('src/i18n/he.json', JSON.stringify(he, null, 0));
console.log(`Переводов: en ${Object.keys(en).length}, he ${Object.keys(he).length}`);
