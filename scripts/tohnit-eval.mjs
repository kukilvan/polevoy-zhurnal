// Проверка разбора тохнита в приложении (JS) на эталоне: node scripts/tohnit-eval.mjs ПАПКА [имя…]
// В папке: <имя>.pdf и <имя>.truth.json ({points:[{label,typeId,x,y}]}). Эталон не в репозитории (чертежи заказчиков).
import fs from 'fs';
import path from 'path';
import { extractPdf } from '../src/tohnit/extract.js';
import { autoParse } from '../src/tohnit/engine.js';

const dir = process.argv[2] || '/home/claude/tohnit_eval';
const catalog = JSON.parse(fs.readFileSync(new URL('../tools/tohnit/catalog.json', import.meta.url)));
const names = process.argv.slice(3).length ? process.argv.slice(3) : fs.readdirSync(dir).filter((f) => f.endsWith('.truth.json')).map((f) => f.replace('.truth.json', ''));
const answersFile = path.join(dir, 'answers.json'); const allAnswers = fs.existsSync(answersFile) ? JSON.parse(fs.readFileSync(answersFile)) : {};

for (const name of names) {
  const t0 = Date.now();
  const ex = await extractPdf(fs.readFileSync(path.join(dir, `${name}.pdf`)));
  const t1 = Date.now();
  const r = autoParse(ex, catalog, { floor: name, project: 'Mega Or', answers: allAnswers[name] || {}, sheet: `${name}.pdf` });
  const t2 = Date.now();
  const truth = JSON.parse(fs.readFileSync(path.join(dir, `${name}.truth.json`))).points;
  const got = r.data.points; const norm = (l) => l.replace(/#\d+$/, '');
  const by = new Map(); got.forEach((g, i) => { const k = norm(g.label); if (!by.has(k)) by.set(k, []); by.get(k).push(i); });
  const used = new Set(); let ok = 0; const wrong = []; const missing = [];
  for (const t of truth) {
    const c = (by.get(norm(t.label)) || []).filter((i) => !used.has(i)).sort((a, b) => Math.hypot(got[a].pos.x - t.x, got[a].pos.y - t.y) - Math.hypot(got[b].pos.x - t.x, got[b].pos.y - t.y));
    if (!c.length) { missing.push(t); continue; }
    used.add(c[0]); if (got[c[0]].typeId === t.typeId) ok++; else wrong.push(`${t.label}: ${t.typeId} → ${got[c[0]].typeId}`);
  }
  const extra = got.filter((_, i) => !used.has(i));
  console.log(`=== ${name}: чтение ${t1 - t0} мс, разбор ${t2 - t1} мс, масштаб ${r.scale.toFixed(2)}`);
  console.log(`эталон ${truth.length}, получено ${got.length} · верно ${ok} (${(100 * ok / truth.length).toFixed(1)}%) · не тот тип ${wrong.length} · пропущено ${missing.length} · лишних ${extra.length} · вопросов ${r.questions.length}`);
  wrong.slice(0, 8).forEach((x) => console.log('  тип:', x));
  missing.slice(0, 8).forEach((x) => console.log('  пропущено:', x.label, x.typeId));
  extra.slice(0, 8).forEach((x) => console.log('  лишнее:', x.label, x.typeId));
  r.questions.slice(0, 5).forEach((q) => console.log(`  вопрос ${q.cluster}: ${q.n} шт. ${q.samples.slice(0, 4).join(' | ')}  ${q.pattern}`));
}
