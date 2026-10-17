import test from 'node:test';
import assert from 'node:assert/strict';
import { generalize, mergeSpans, buildPoints, autoParse, learnInto, labelish } from '../src/tohnit/engine.js';

const sp = (t, x, y, extra = {}) => ({ t, x0: x, y0: y, x1: x + t.length * 4, y1: y + 7.8, color: 'ff0000', font: 'Arial', size: 7.8, page: 0, c: 'c01', ...extra });

test('тохнит: шаблон по примерам подписей', () => {
  assert.equal(generalize(['GA1/C-57', 'GC/C-15', 'GA2/C-100']), '^[A-Za-z]+\\d*\\/C\\-\\d+$');
  assert.equal(generalize(['GA1/07.In-03', 'GC/6.O-02']), '^[A-Za-z]+\\d*\\/\\d+\\.(?:In|O)\\-\\d+$');
  assert.ok(new RegExp(generalize(['GA1/D-07.1', 'GC/D-06.2'])).test('GB/D-21.1'));
  assert.equal(labelish('H=400'), false); assert.equal(labelish('GA1/C-57'), true);
});

test('тохнит: склейка — «TV» «140» в одно, две целые подписи — нет, «GD1/» над «D-15.2» — в одну', () => {
  const m = mergeSpans([sp('TV', 0, 0), sp('140', 10, 0), sp('D-15.2', 100, 0), sp('D-14.2', 126, 0), sp('GD1/', 200, 0), sp('D-15.2', 200, 8)]);
  const ts = m.map((s) => s.t).sort();
  assert.ok(ts.includes('TV 140')); assert.ok(ts.includes('D-15.2') && ts.includes('D-14.2')); assert.ok(ts.includes('GD1/D-15.2'));
});

test('тохнит: правила — развёртка диапазона, тип по значку и по тексту рядом, дубли, шкаф', () => {
  const spans = [
    sp('GD1/U01-03', 0, 0), sp('GA1/07.In-03', 100, 0), sp('GA1/07.In-04', 100, 40), sp('GA1/D-07.1', 300, 0), sp('טנגאורטקלא', 300, 10, { c: 'c02' }),
    sp('GA1/D-08.1', 500, 0), sp('GA1/C-1', 700, 0), sp('GA1/C-1', 900, 0),
    { t: 'tri', x0: 150, y0: 0, x1: 160, y1: 8, page: 0, c: 'sym:tri' }, { t: 'hex', x0: 150, y0: 40, x1: 160, y1: 48, page: 0, c: 'sym:hex' },
  ];
  const rules = [
    { match: '^[A-Za-z]+\\d*/(?:U|S|B)\\d+-\\d+$', type: 'Точка', expand: true },
    { match: '^[A-Za-z]+\\d*/\\d+\\.In-\\d+$', type: 'Магнит индикация', by_icon: { 'sym:tri': 'Магнит индикация', 'sym:hex': 'Галай' }, icon_dist: 60 },
    { match: '^[A-Za-z]+\\d*/D-\\d+\\.\\d$', type: 'Дверь МХ', near_text: [{ re: 'טנגאורטקלא', type: 'Дверь ЭМ', dist: 30 }] },
    { match: '^[A-Za-z]+\\d*/C-\\d+$', type: 'Камера' },
  ];
  const { points } = buildPoints(spans, rules, { cabinetRegex: '^([A-Za-z]+\\d*)/', floor: '0' });
  const by = Object.fromEntries(points.map((p) => [p.label, p]));
  assert.deepEqual(['GD1/U01', 'GD1/U02', 'GD1/U03'].map((l) => by[l]?.typeId), ['Точка', 'Точка', 'Точка']);
  assert.equal(by['GA1/07.In-04'].typeId, 'Галай'); assert.equal(by['GA1/07.In-03'].typeId, 'Магнит индикация');
  assert.equal(by['GA1/D-07.1'].typeId, 'Дверь ЭМ'); assert.equal(by['GA1/D-08.1'].typeId, 'Дверь МХ');
  assert.ok(by['GA1/C-1#2']); assert.equal(by['GD1/U02'].cabinet, 'GD1'); assert.equal(by['GA1/C-1'].floor, '0');
});

test('тохнит: вопросы по незнакомой группе, ответ «не точки» запоминается в каталог', () => {
  const span = (t, x, y, c) => ({ t, x0: x, y0: y, x1: x + 20, y1: y + 8, color: c === 'c1' ? 'ff0000' : '0000ff', font: 'Arial', size: c === 'c1' ? 7.8 : 5, page: 0 });
  const pages = [{ w: 1000, h: 1000, fills: [], annots: [], paths: [], layers: {},
    spans: [...[1, 2, 3, 4, 5, 6].map((i) => span(`GA1/C-${i}`, i * 50, 0, 'c1')), ...[1, 2, 3, 4].map((i) => span('32A', i * 50, 200, 'c2'))] }];
  const cat = { labels: [{ re: '^[A-Za-z]+\\d*/C-\\d+$', type: 'Камера' }], skip: [], symbols: [], cabinet_regex: '^([A-Za-z]+\\d*)/' };
  const r1 = autoParse({ pages }, cat, { floor: '1' });
  assert.equal(r1.data.points.length, 6); assert.equal(r1.questions.length, 1); assert.deepEqual(r1.questions[0].samples, ['32A']);
  const r2 = autoParse({ pages }, cat, { floor: '1', answers: { [r1.questions[0].cluster]: 'skip' } });
  assert.equal(r2.questions.length, 0);
  const { catalog, added } = learnInto(cat, r2.learned);
  assert.equal(added, 1); assert.equal(autoParse({ pages }, catalog, { floor: '1' }).questions.length, 0);
});

test('тохнит: ответ касается только незнакомых подписей группы; выученное даёт тот же результат', () => {
  const span = (t, x) => ({ t, x0: x, y0: 0, x1: x + 20, y1: 8, color: 'ff0000', font: 'Arial', size: 7.8, page: 0 });
  const pages = [{ w: 1000, h: 1000, fills: [], annots: [], paths: [], layers: {},
    spans: [span('GA1/C-1', 0), span('TV140', 100), span('TV141', 200), span('MM1', 300), span('TV150', 400)] }];
  const cat = { labels: [{ re: '^[A-Za-z]+\\d*/C-\\d+$', type: 'Камера' }], skip: [], symbols: [], cabinet_regex: '^([A-Za-z]+\\d*)/' };
  const q = autoParse({ pages }, cat, {}).questions[0];
  const r1 = autoParse({ pages }, cat, { answers: { [q.cluster]: 'TV' } });
  const types = (r) => r.data.points.map((p) => `${p.label}=${p.typeId}`).sort().join(',');
  assert.ok(types(r1).includes('GA1/C-1=Камера'));
  const { catalog } = learnInto(cat, r1.learned);
  assert.equal(types(autoParse({ pages }, catalog, {})), types(r1));
});

test('тохнит: проверка подписи по каталогу и шаблон по-человечески', async () => {
  const { matchLabel, prettyRule } = await import('../src/tohnit/engine.js');
  const cat = { skip: [{ re: '^H=\\d+$' }], labels: [{ re: '^[A-Za-z]+\\d*\\/C\\-\\d+$', type: 'Камера' }, { re: '^TV\\d+$', type: 'TV', project: 'Mega' }] };
  assert.equal(matchLabel('GA1/C-57', cat).rule.type, 'Камера');
  assert.equal(matchLabel('H=400', cat).kind, 'skip');
  assert.equal(matchLabel('TV140', cat, 'Другой'), null); assert.equal(matchLabel('TV140', cat, 'Mega Or').rule.type, 'TV');
  assert.equal(prettyRule('^[A-Za-z]+\\d*\\/C\\-\\d+$'), 'шкаф/C-№');
});

test('тохнит: конструктор шаблона по частям подписи (C2/04: камера, этаж не важен, номер 2 цифры)', async () => {
  const { segment, defaultRoles, buildPattern, describeParts } = await import('../src/tohnit/pattern.js');
  const sg = segment(['C2/04', 'C2/05', 'C2/12']);
  assert.ok(sg.ok); assert.deepEqual(sg.segs.map((s) => s.kind), ['L', 'D', 'P', 'D']);
  assert.deepEqual(defaultRoles(sg.segs), ['const', 'const', 'const', 'num']);
  const { re, cab } = buildPattern(sg.segs, ['const', 'any', 'const', 'num']);
  assert.equal(re, '^C\\d+\\/\\d{2}$'); assert.equal(cab, '');
  const rx = new RegExp(re); assert.ok(rx.test('C3/77')); assert.ok(!rx.test('C2/123')); assert.ok(!rx.test('D2/04'));
  assert.equal(describeParts(sg.segs, ['const', 'any', 'const', 'num']), 'C (любое) / №(2 цифры)');
  const g = segment(['GA1/C-57', 'GB/C-1']); assert.ok(g.ok);  // у GB нет цифры — часть необязательная
  const gb = buildPattern(g.segs, ['cab', 'cab', 'const', 'const', 'const', 'numAny']);
  assert.equal('GB/C-1'.match(new RegExp(gb.cab))[1], 'GB'); assert.equal('GA1/C-57'.match(new RegExp(gb.cab))[1], 'GA1');
  assert.equal(segment(['C2/04', 'TV140']).ok, false);
  const s2 = segment(['GA1/C-57', 'GA2/C-1']); const b2 = buildPattern(s2.segs, ['cab', 'cab', 'const', 'const', 'const', 'numAny']);
  assert.equal('GA2/C-1'.match(new RegExp(b2.cab))[1], 'GA2');
  const { buildPoints } = await import('../src/tohnit/engine.js');
  const sp = { t: 'C2/04', x0: 0, y0: 0, x1: 20, y1: 8, page: 0, c: 'c1' };
  const { points } = buildPoints([sp], [{ match: re, type: 'Камера', cab }], { cabinetRegex: '^([A-Za-z]+\\d*)/' });
  assert.equal(points[0].cabinet, '');  // «C2» — не шкаф
});

test('тохнит: ответ с кабелями (RJ45 X2 → Точка, 2 кабеля) — у точек и в выученном правиле', () => {
  const span = (t, x) => ({ t, x0: x, y0: 0, x1: x + 20, y1: 8, color: 'ff0000', font: 'Arial', size: 7.8, page: 0 });
  const pages = [{ w: 1000, h: 1000, fills: [], annots: [], paths: [], layers: {}, spans: ['RJ45-1', 'RJ45-2', 'RJ45-3'].map((t, i) => span(t, i * 100)) }];
  const cat = { labels: [], skip: [], symbols: [] };
  const q = autoParse({ pages }, cat, {}).questions[0];
  const r = autoParse({ pages }, cat, { answers: { [q.cluster]: { type: 'Точка', cables: [{ cable: 'cat7', count: 2 }] } } });
  assert.ok(r.data.points.length >= 2 && r.data.points.every((p) => p.cableOverride?.[0]?.count === 2));
  assert.deepEqual(r.learned[0].cables, [{ cable: 'cat7', count: 2 }]);
});

test('тохнит: значки без номеров — такие же по надписи, нумерация цепочкой по соседям', async () => {
  const { pickSimilar, chainOrder, numberLabels } = await import('../src/tohnit/icons.js');
  const sp = (t, x, y, bg = 'ff0000') => ({ t, x0: x, y0: y, x1: x + 6, y1: y + 8, color: '', font: 'аннотация Square', size: 8, bg, page: 0 });
  const spans = [sp('A', 0, 0), sp('A', 100, 0), sp('A', 10, 50), sp('A', 500, 500, ''), sp('B', 20, 20)];
  const r = pickSimilar(spans, [{ paths: [] }], 0, 3, 4);
  assert.equal(r.kind, 'text'); assert.equal(r.items.length, 3);  // «A» без фона — другой вид
  const o = chainOrder(r.items);
  assert.deepEqual(o.map((i) => [i.x, i.y]), [[3, 4], [13, 54], [103, 4]]);
  assert.deepEqual(numberLabels('W', 3), ['W01', 'W02', 'W03']);
});

test('тохнит: PDF с номерами — пометки у точек и страница-легенда', async () => {
  const mupdf = await import('mupdf');
  const src = new mupdf.PDFDocument(); src.insertPage(-1, src.addPage([0, 0, 400, 300], 0, src.addObject(src.newDictionary()), '')); const data = src.saveToBuffer('').asUint8Array();
  const { numberedPdf } = await import('../src/tohnit/numbered.js');
  const out = numberedPdf(mupdf, data, [{ label: 'W01', typeId: 'Вайфай', pos: { page: 0, x: 50, y: 50, w: 10, h: 10 } }, { label: 'C01', typeId: 'Камера', pos: { page: 0, x: 100, y: 80, w: 10, h: 10 } }]);
  const doc = mupdf.Document.openDocument(out, 'application/pdf').asPDF();
  assert.equal(doc.countPages(), 2); assert.equal(doc.loadPage(0).getAnnotations().length, 6);  // у каждой: кружок + рамка подписи + текст
  assert.ok(doc.loadPage(1).getAnnotations().some((a) => /Камера: 1/.test(a.getContents())));
  // точка на надписи чертежа: только рамка вокруг надписи; две точки на одной отметке — одна подпись «TV13-14»
  const out2 = numberedPdf(mupdf, data, [{ label: 'A1', typeId: 'T', pos: { page: 0, x: 50, y: 50, w: 30, h: 8 } }, { label: 'TV13', typeId: 'TV', pos: { page: 0, x: 200, y: 150, w: 10, h: 10 } }, { label: 'TV14', typeId: 'TV', pos: { page: 0, x: 200, y: 150, w: 10, h: 10 } }]);
  const an = mupdf.Document.openDocument(out2, 'application/pdf').asPDF().loadPage(0).getAnnotations();
  assert.equal(an.length, 4); assert.ok(an.some((a) => a.getType() === 'FreeText' && a.getContents() === 'TV13-14'));
});

test('тохнит: нумерация по областям — сначала одна кучка строками, потом следующая', async () => {
  const { regionOrder } = await import('../src/tohnit/icons.js');
  const it = (x, y) => ({ page: 0, x, y });
  // левая кучка 2×2 и правая кучка 2×2 далеко
  const items = [it(510, 10), it(10, 30), it(30, 10), it(530, 30), it(10, 10), it(30, 30), it(510, 30), it(530, 10)];
  assert.deepEqual(regionOrder(items).map((i) => `${i.x},${i.y}`), ['10,10', '30,10', '10,30', '30,30', '510,10', '530,10', '510,30', '530,30']);
});

test('тохнит: подписи разного вида (Z7, M24, 30x20(h)) не запоминаются общим правилом', () => {
  const span = (t, x) => ({ t, x0: x, y0: 0, x1: x + 20, y1: 8, color: 'ff0000', font: 'Arial', size: 7.8, page: 0 });
  const pages = [{ w: 1000, h: 1000, fills: [], annots: [], paths: [], layers: {}, spans: ['Z7', 'M24', '30x20(h)', 'Z8', 'Z9'].map((t, i) => span(t, i * 100)) }];
  const cat = { labels: [], skip: [], symbols: [] };
  const q = autoParse({ pages }, cat, {}).questions[0];
  if (!q) return;  // группа не похожа на обозначения — вопроса нет, запоминать нечего
  const r = autoParse({ pages }, cat, { answers: { [q.cluster]: 'skip' } });
  assert.equal(r.learned.length, 0);
});

test('план: связывание — точные, похожие (разделители, лишнее начало) и не размеченые', async () => {
  const { matchLabels } = await import('../src/tohnit/linking.js');
  const P = (id, label) => ({ id, label });
  const f = (label) => ({ label, pos: { page: 0, x: 1, y: 1, w: 10, h: 5 } });
  const r = matchLabels([P('a', 'GA1/C-57'), P('b', '1A-01-02'), P('c', 'Solar-B3-4'), P('d', 'X-1')], [f('GA1/C-57'), f('1A/01-02'), f('B/03-04'), f('Z9-9')]);
  assert.deepEqual(r.exact.map((x) => x.p.id), ['a']);
  assert.deepEqual(r.similar.map((x) => `${x.p.id}:${x.kind}`), ['b:same', 'c:tail']);
  assert.deepEqual(r.unlinked.map((x) => x.label), ['Z9-9']);
});

test('сервер: PDF с номерами пересобирается только при изменениях', async () => {
  const mupdf = await import('mupdf');
  const src = new mupdf.PDFDocument(); src.insertPage(-1, src.addPage([0, 0, 400, 300], 0, src.addObject(src.newDictionary()), '')); const pdf = src.saveToBuffer('').asUint8Array();
  const { updateProjectNumbered } = await import('../scripts/server-tables-lib.mjs');
  const d = { id: 'D1', name: 'a.pdf', fileId: 'SRC', numberedFileId: 'NUM' };
  const project = { id: 'P', name: 'P', drawings: [d] };
  const data = { points: [{ id: 'p1', label: 'C01', typeId: 'Камера', pos: { page: 0, x: 50, y: 50, w: 10, h: 10, sheet: 'a.pdf' } }], types: [{ id: 'Камера' }] };
  const up = []; const api = { download: async () => pdf, upload: async (id, b) => up.push([id, b.length]) };
  const r1 = await updateProjectNumbered(api, mupdf, project, data);
  assert.equal(up.length, 1); assert.equal(up[0][0], 'NUM'); assert.ok(r1.patches.D1.numberedHash);
  d.numberedHash = r1.patches.D1.numberedHash;
  await updateProjectNumbered(api, mupdf, project, data); assert.equal(up.length, 1);  // без изменений — не трогаем
  data.points[0].label = 'C02';
  await updateProjectNumbered(api, mupdf, project, data); assert.equal(up.length, 2);
});

test('сервер: копия тохнита для руководства — своё название, обновляется отдельно', async () => {
  const mupdf = await import('mupdf');
  const src = new mupdf.PDFDocument(); src.insertPage(-1, src.addPage([0, 0, 400, 300], 0, src.addObject(src.newDictionary()), '')); const pdf = src.saveToBuffer('').asUint8Array();
  const { updateProjectNumbered, applyManagerPatches } = await import('../scripts/server-tables-lib.mjs');
  const d = { id: 'D1', name: 'a.pdf', fileId: 'SRC' };
  const project = { id: 'P', name: 'P', drawings: [d], managers: { drawings: { D1: { on: true, fileId: 'MGR', name: 'קומה 0', lang: 'he' } } } };
  const data = { points: [{ id: 'p1', label: 'C01', typeId: 'Камера', pos: { page: 0, x: 50, y: 50, w: 10, h: 10, sheet: 'a.pdf' } }], types: [{ id: 'Камера', nameHe: 'מצלמה' }] };
  const up = []; const api = { download: async () => pdf, upload: async (id) => up.push(id) };
  const r = await updateProjectNumbered(api, mupdf, project, data);
  assert.deepEqual(up, ['MGR']); assert.ok(r.mgrPatches.D1.hash);
  assert.equal(applyManagerPatches(project, r.mgrPatches).drawings.D1.name, 'קומה 0');
});
