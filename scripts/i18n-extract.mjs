// Сбор всех русских строк интерфейса (строки и шаблоны `…${x}…` в src) — для словарей переводов.
// Запуск: node scripts/i18n-extract.mjs [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const CYR = /[А-Яа-яЁё]/;
const files = [];
(function scan(dir) { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) { if (!['tohnit', 'data', 'i18n'].includes(f.name)) scan(p); } else if (p.endsWith('.js')) files.push(p); } })('src');
const out = new Map(); // текст -> {files:Set, tpl:boolean}
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  let ast; try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' }); } catch (e) { console.error(file, e.message); continue; }
  const add = (text, tpl) => { if (!CYR.test(text)) return; const k = text; if (!out.has(k)) out.set(k, { files: new Set(), tpl }); out.get(k).files.add(path.relative('src', file)); };
  walk.full(ast, (n) => {
    if (n.type === 'Literal' && typeof n.value === 'string') add(n.value, false);
    if (n.type === 'TemplateLiteral') add(n.quasis.map((q) => q.value.cooked).join('{}'), n.expressions.length > 0);
  });
}
const list = [...out.entries()].map(([text, v]) => ({ text, tpl: v.tpl, files: [...v.files] }));
const arg = process.argv.indexOf('--json');
if (arg > 0) fs.writeFileSync(process.argv[arg + 1], JSON.stringify(list, null, 1));
const byFile = {}; list.forEach((x) => x.files.forEach((f) => { byFile[f] = (byFile[f] || 0) + 1; }));
console.log(`Строк: ${list.length}, шаблонов: ${list.filter((x) => x.tpl).length}, символов: ${list.reduce((n, x) => n + x.text.length, 0)}`);
Object.entries(byFile).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(`${String(n).padStart(5)}  ${f}`));
