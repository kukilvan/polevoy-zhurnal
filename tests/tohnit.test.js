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
