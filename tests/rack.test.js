import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePanelPorts, fmtPanelPort, defaultPortLabels, panelConflicts, matchesPanelQuery, isRackCable } from '../src/domain/rack.js';

test('порт в панели: разбор и показ', () => {
  assert.deepEqual(parsePanelPorts('U38-05, 38-6 38/7').list, [{ u: 38, p: 5 }, { u: 38, p: 6 }, { u: 38, p: 7 }]);
  assert.equal(parsePanelPorts('U38-25').errors.length, 1);
  assert.equal(parsePanelPorts('U0-5').errors.length, 1);
  assert.equal(parsePanelPorts('abc').errors.length, 1);
  assert.equal(fmtPanelPort({ u: 5, p: 3 }), 'U05-03');
  assert.ok(isRackCable('cat7') && isRackCable('CAT 7') && !isRackCable('6005'));
});
test('подписи портов по умолчанию', () => {
  assert.deepEqual(defaultPortLabels('1A-C34', 1), ['1A-C34']);
  assert.deepEqual(defaultPortLabels('2B-25-26', 2), ['2B-25', '2B-26']);
  assert.deepEqual(defaultPortLabels('CCTV1-TV01-02', 2), ['CCTV1-TV01', 'CCTV1-TV02']);
  assert.deepEqual(defaultPortLabels('1A-AP-03', 2), ['1A-AP-03.1', '1A-AP-03.2']);
});
test('дубликаты портов и поиск', () => {
  const a = { id: 'a', label: 'A', cabinet: '1A', panel: [{ u: 38, p: 1 }] };
  const b = { id: 'b', label: 'B', cabinet: '1A', panel: [{ u: 38, p: 1 }] };
  const c = { id: 'c', label: 'C', cabinet: '2B', panel: [{ u: 38, p: 1 }] };
  const cf = panelConflicts([a, b, c]);
  assert.equal(cf.length, 1); assert.equal(cf[0].points.length, 2);
  assert.ok(matchesPanelQuery(a, 'U38-01') && matchesPanelQuery(a, '38-1') && !matchesPanelQuery(a, '38-2'));
});
import { autoFill, uOrder, panelsInOrder, rackProblems } from '../src/domain/rack.js';
const ctx1 = { types: new Map([['Cam', { id: 'Cam', defaultCable: 'cat7', defaultCables: 1 }], ['AP2', { id: 'AP2', defaultCable: 'cat7', defaultCables: 2 }]]), cabinetSettings: [], devices: new Map(), cables: new Map() };
test('авторазкладка по панелям', () => {
  const pts = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, typeId: 'Cam' }));
  const r = autoFill(pts, ctx1, [{ u: 38 }, { u: 37 }], new Set(['|38|2']));
  assert.deepEqual(r.assign.get('c0'), [{ u: 38, p: 1 }]);
  assert.deepEqual(r.assign.get('c1'), [{ u: 38, p: 3 }]);
  assert.deepEqual(r.assign.get('c23'), [{ u: 37, p: 1 }]);
  assert.equal(r.left.length, 0);
  const ap = [{ id: 'a', label: 'AP1', typeId: 'AP2' }];
  const r2 = autoFill(ap, ctx1, [{ u: 5 }, { u: 4 }], new Set(), { start: 24 });
  assert.deepEqual(r2.assign.get('a'), [{ u: 4, p: 1 }, { u: 4, p: 2 }]);
  const r3 = autoFill(ap, ctx1, [{ u: 5 }], new Set(), { start: 24 });
  assert.equal(r3.left.length, 1);
});
test('порядок U и проверки', () => {
  assert.deepEqual(uOrder({ height: 3, bottomUp: true }), [3, 2, 1]);
  assert.deepEqual(uOrder({ height: 3, bottomUp: false }), [1, 2, 3]);
  assert.deepEqual(panelsInOrder({ height: 42, bottomUp: true, panels: [{ u: 10 }, { u: 38 }] }).map((x) => x.u), [38, 10]);
  const pr = rackProblems({ height: 42, panels: [{ u: 38 }, { u: 38 }] }, [{ id: 'x', label: 'X', typeId: 'Cam', cabinet: '1A', panel: [{ u: 30, p: 1 }] }], ctx1);
  assert.ok(pr.some((t) => t.includes('Две панели')) && pr.some((t) => t.includes('такой панели')));
});
import { defaultTypeColor, typeColorOf } from '../src/domain/rack.js';
test('цвета шильюта по умолчанию', () => {
  assert.equal(defaultTypeColor('Камера'), 'green'); assert.equal(defaultTypeColor('Коре биометри'), 'blue');
  assert.equal(defaultTypeColor('Бакар'), 'yellow'); assert.equal(defaultTypeColor('Вайфай'), 'red'); assert.equal(defaultTypeColor('Точка'), 'black');
  assert.equal(defaultTypeColor('Дверь'), 'blue'); assert.equal(defaultTypeColor('TV'), '');
  assert.equal(typeColorOf({ shilut: { typeColors: { Камера: 'red' } } }, 'Камера').he, 'אדום');
});
import { compareLabels } from '../src/domain/points.js';
test('умная сортировка обозначений', () => {
  const l = ['1A-09-10', '1A/01-02', '1A-11-12', '1A/03-04', '1A-AP-03', '1A-AP01', '1A-AP-2', '1A-6.2', '1A-6.10', '1A-6.1', '2B-C200', '2B-C117'];
  assert.deepEqual([...l].sort(compareLabels), ['1A/01-02', '1A/03-04', '1A-6.1', '1A-6.2', '1A-6.10', '1A-09-10', '1A-11-12', '1A-AP01', '1A-AP-2', '1A-AP-03', '2B-C117', '2B-C200']);
});
import { subsOf, parsePanelPorts as ppp, panelText as ptext, autoFill as af2, panelsInOrder as pio } from '../src/domain/rack.js';
test('секции шкафа', () => {
  assert.deepEqual(ppp('CCTV1-A U38-05, CCTV1-B: 7-1').list, [{ u: 38, p: 5, sub: 'CCTV1-A' }, { u: 7, p: 1, sub: 'CCTV1-B' }]);
  assert.deepEqual(ppp('38-5 38-6').list, [{ u: 38, p: 5 }, { u: 38, p: 6 }]);
  const rack = { height: 42, bottomUp: true, subs: [{ id: '', name: 'CCTV1-A', height: 42, bottomUp: true }, { id: 's2', name: 'CCTV1-B', height: 20, bottomUp: false }], panels: [{ u: 10 }, { u: 10, s: 's2' }] };
  assert.equal(subsOf(rack, 'CCTV1').length, 2); assert.equal(subsOf({ height: 42 }, 'X')[0].name, 'X');
  assert.deepEqual(pio(rack, subsOf(rack)[1]).map((x) => x.u), [10]);
  const pt = { cabinet: 'CCTV1', panel: [{ u: 10, p: 3, s: 's2' }] };
  assert.equal(ptext(pt, { racks: { CCTV1: rack } }), 'CCTV1-B U10-03');
  const r = af2([{ id: 'c', label: 'C', typeId: 'Cam' }], ctx1, [{ u: 10, s: 's2' }], new Set(['s2|10|1']));
  assert.deepEqual(r.assign.get('c'), [{ s: 's2', u: 10, p: 2 }]);
});
import { blockPort, unblockPort, blockedOf, autoFill as af3, rackProblems as rp3 } from '../src/domain/rack.js';
test('закрытые порты: точки сдвигаются, лишние становятся нерасставленными', () => {
  const mk = (n, ps) => ({ id: `c${n}`, label: `C${n}`, typeId: 'Cam', cabinet: 'X', panel: ps.map((p) => ({ u: 5, p })) });
  const rack = { height: 42, panels: [{ u: 5 }] };
  // порты 1..3 заняты, порт 24 тоже; закрываем 2
  const pts = [mk(1, [1]), mk(2, [2]), mk(3, [3]), mk(4, [24])];
  const r = blockPort(rack, pts, 'X', { u: 5, p: 2 });
  assert.deepEqual(r.rack.blocked, [{ u: 5, p: 2 }]);
  assert.deepEqual(r.writes.get('c2'), [{ u: 5, p: 3 }]); assert.deepEqual(r.writes.get('c3'), [{ u: 5, p: 4 }]);
  assert.ok(!r.writes.has('c1') && !r.writes.has('c4')); assert.equal(r.dropped.length, 0);
  // панель забита целиком — последняя точка не помещается
  const full = Array.from({ length: 24 }, (_, i) => mk(i + 1, [i + 1]));
  const r2 = blockPort(rack, full, 'X', { u: 5, p: 10 });
  assert.deepEqual(r2.dropped.map((x) => x.id), ['c24']); assert.deepEqual(r2.writes.get('c24'), []);
  assert.deepEqual(r2.writes.get('c10'), [{ u: 5, p: 11 }]);
  // точка на 2 порта (5,6): закрыли 6 → переезжает на 7-8
  const two = { id: 'w', label: 'W', typeId: 'AP2', cabinet: 'X', panel: [{ u: 5, p: 5 }, { u: 5, p: 6 }] };
  assert.deepEqual(blockPort(rack, [two], 'X', { u: 5, p: 6 }).writes.get('w'), [{ u: 5, p: 7 }, { u: 5, p: 8 }]);
  // секции: тот же U в другой секции не затрагивается
  const sx = { id: 's', label: 'S', typeId: 'Cam', cabinet: 'X', panel: [{ u: 5, p: 2, s: 'b' }] };
  assert.equal(blockPort(rack, [sx], 'X', { u: 5, p: 2 }).writes.size, 0);
  assert.deepEqual(blockPort(rack, [sx], 'X', { u: 5, p: 2, s: 'b' }).writes.get('s'), [{ u: 5, p: 3, s: 'b' }]);
  // автораскладка и проверки учитывают крестики
  const ctx = { cables: new Map([['cat7', {}]]), types: new Map([['Cam', { cables: [{ cable: 'cat7', count: 1 }] }]]), configs: new Map() };
  const a = af3([{ id: 'n', label: 'N', typeId: 'Cam' }], ctx, [{ u: 5 }], new Set(), { blocked: blockedOf({ blocked: [{ u: 5, p: 1 }, { u: 5, p: 2 }] }) });
  assert.deepEqual(a.assign.get('n'), [{ u: 5, p: 3 }]);
  assert.ok(rp3({ height: 42, panels: [{ u: 5 }], blocked: [{ u: 5, p: 1 }] }, [mk(9, [1])], ctx).some((t) => t.includes('закрыт')));
  assert.equal(unblockPort(r.rack, { u: 5, p: 2 }).blocked.length, 0);
});
import { shilutLabel, shilutCabName, contrastFg, numPart } from '../src/domain/rack.js';
test('подписи шильюта: шаблоны, убрать шкаф, ручная подпись, цвета', () => {
  const pt = { id: 'a', label: '1A-C5', typeId: 'Cam', cabinet: '1A', panel: [{ u: 38, p: 5 }] };
  const ctx = { cables: new Map([['cat7', {}]]), types: new Map([['Cam', { cables: [{ cable: 'cat7', count: 1 }] }]]), configs: new Map() };
  assert.equal(shilutLabel(pt, 0, {}, ctx), '1A-C5');
  assert.equal(shilutLabel(pt, 0, { shilut: { dropCab: true } }, ctx), 'C5');
  assert.equal(shilutLabel(pt, 0, { shilut: { tpl: { Cam: 'CAM {номер} ({шкаф} U{U}-{порт})' } } }, ctx), 'CAM C5 (1A U38-5)');
  assert.equal(shilutLabel({ ...pt, panel: [{ u: 38, p: 5, label: 'свой' }] }, 0, { shilut: { dropCab: true } }, ctx), 'свой');
  assert.equal(shilutCabName({ shilut: { cabNames: { '1A|': 'Шкаф A' } } }, '1A'), 'Шкаф A'); assert.equal(shilutCabName({}, '1A'), '1A');
  assert.equal(contrastFg('#ffd60a'), '#000'); assert.equal(contrastFg('#111111'), '#fff');
  assert.equal(typeColorOf({ shilut: { typeColors: { Камера: '' } } }, 'Камера').id, 'green');
});
test('убрать название шкафа — у каждого шкафа отдельно', () => {
  const ctx = { cables: new Map([['cat7', {}]]), types: new Map([['Cam', { cables: [{ cable: 'cat7', count: 1 }] }]]), configs: new Map() };
  const mk = (cab) => ({ id: cab, label: `${cab}-C5`, typeId: 'Cam', cabinet: cab, panel: [{ u: 1, p: 1 }] });
  const proj = { shilut: { dropCabs: { '1A': true, '2B': false } } };
  assert.equal(shilutLabel(mk('1A'), 0, proj, ctx), 'C5'); assert.equal(shilutLabel(mk('2B'), 0, proj, ctx), '2B-C5');
  assert.equal(shilutLabel(mk('3C'), 0, { shilut: { dropCab: true } }, ctx), 'C5');
});
test('закрытый порт: лишние точки уходят в следующую панель такого же типа', () => {
  const mk = (n, u, p, typeId = 'Cam') => ({ id: `${typeId}${n}`, label: `${typeId}${n}`, typeId, cabinet: 'X', panel: [{ u, p }] });
  const rack = { height: 42, bottomUp: true, panels: [{ u: 38 }, { u: 37 }, { u: 36 }, { u: 30 }] };
  const a = Array.from({ length: 24 }, (_, i) => mk(i + 1, 38, i + 1));
  const b = [mk(25, 36, 1), mk(26, 36, 2)];
  const wifi = [mk(1, 37, 1, 'AP')];
  const r = blockPort(rack, [...a, ...b, ...wifi], 'X', { u: 38, p: 10 });
  assert.equal(r.dropped.length, 0);
  assert.deepEqual(r.writes.get('Cam24'), [{ u: 36, p: 1 }]);          // ушла в U36 (U37 — другой тип, пропущена), встала первой
  assert.deepEqual(r.writes.get('Cam25'), [{ u: 36, p: 2 }]); assert.deepEqual(r.writes.get('Cam26'), [{ u: 36, p: 3 }]);
  assert.deepEqual(r.writes.get('Cam10'), [{ u: 38, p: 11 }]);
  assert.ok(!r.writes.has('AP1')); assert.deepEqual(r.moved.map((x) => x.id), ['Cam24']);
  // следующая панель тоже забита — каскад дальше, а когда панелей больше нет — не расставлены
  const full36 = Array.from({ length: 24 }, (_, i) => mk(100 + i, 36, i + 1));
  const r2 = blockPort(rack, [...a, ...full36], 'X', { u: 38, p: 10 });
  assert.deepEqual(r2.dropped.map((x) => x.id), ['Cam123']); assert.deepEqual(r2.writes.get('Cam123'), []);
  assert.deepEqual(r2.writes.get('Cam24'), [{ u: 36, p: 1 }]); assert.deepEqual(r2.writes.get('Cam100'), [{ u: 36, p: 2 }]);
  // в точку на 2 порта: переезжает целиком
  const ap = (n, p) => ({ id: `W${n}`, label: `W${n}`, typeId: 'AP2', cabinet: 'X', panel: [{ u: 38, p }, { u: 38, p: p + 1 }] });
  const wp = Array.from({ length: 12 }, (_, i) => ap(i, 1 + i * 2));
  const r3 = blockPort({ ...rack, panels: [{ u: 38 }, { u: 36 }] }, [...wp, { id: 'W99', label: 'W99', typeId: 'AP2', cabinet: 'X', panel: [{ u: 36, p: 1 }, { u: 36, p: 2 }] }], 'X', { u: 38, p: 4 });
  assert.deepEqual(r3.writes.get('W11'), [{ u: 36, p: 1 }, { u: 36, p: 2 }]); assert.deepEqual(r3.writes.get('W99'), [{ u: 36, p: 3 }, { u: 36, p: 4 }]);
});
test('подпись шильюта: название шкафа добавляется, если его нет; шаблоны не дублируют', () => {
  const ctx = { cables: new Map([['cat7', {}]]), types: new Map([['T', { cables: [{ cable: 'cat7', count: 1 }] }]]), configs: new Map() };
  const mk = (label, cab = 'CCTV1', s) => ({ id: label, label, typeId: 'T', cabinet: cab, panel: [s ? { u: 1, p: 1, s } : { u: 1, p: 1 }] });
  const proj = (sh = {}, subs = null) => ({ racks: { CCTV1: { height: 42, subs, panels: [] } }, shilut: sh });
  // есть шкаф — как записано; нет — добавляется
  assert.equal(shilutLabel(mk('CCTV1-TV01'), 0, proj(), ctx), 'CCTV1-TV01');
  assert.equal(shilutLabel(mk('TV01'), 0, proj(), ctx), 'CCTV1-TV01');
  assert.equal(shilutLabel(mk('INT DESK', '1A'), 0, { racks: {} }, ctx), '1A-INT DESK');
  // шаблон с {шкаф} — не дублируется; шаблон без {шкаф} — шкаф добавляется
  assert.equal(shilutLabel(mk('TV01'), 0, proj({ tpl: { T: '{шкаф}-{имя}' } }), ctx), 'CCTV1-TV01');
  assert.equal(shilutLabel(mk('1'), 0, proj({ tpl: { T: 'B{номер}' } }), ctx), 'CCTV1-B1');
  // галка «убрать» — без шкафа, приставка не добавляется
  assert.equal(shilutLabel(mk('TV01'), 0, proj({ dropCabs: { CCTV1: true } }), ctx), 'TV01');
  assert.equal(shilutLabel(mk('CCTV1-TV01'), 0, proj({ dropCabs: { CCTV1: true } }), ctx), 'TV01');
  // своё название шкафа в настройках: подменяет и приставку у обозначений
  assert.equal(shilutLabel(mk('CCTV1-TV01'), 0, proj({ cabNames: { 'CCTV1|': 'C1' } }), ctx), 'C1-TV01');
  assert.equal(shilutLabel(mk('TV01'), 0, proj({ cabNames: { 'CCTV1|': 'C1' } }), ctx), 'C1-TV01');
  // несколько шкафов в одном: название секции
  const subs = [{ id: '', name: 'CCTV1-BMS', height: 42 }, { id: 's2', name: 'CCTV1', height: 42 }];
  assert.equal(shilutLabel(mk('B01'), 0, proj({}, subs), ctx), 'CCTV1-BMS-B01');
  assert.equal(shilutLabel(mk('TV01', 'CCTV1', 's2'), 0, proj({}, subs), ctx), 'CCTV1-TV01');
  assert.equal(shilutLabel(mk('CCTV1-TV02', 'CCTV1', 's2'), 0, proj({}, subs), ctx), 'CCTV1-TV02');
  // ручная подпись важнее всего
  assert.equal(shilutLabel({ ...mk('TV01'), panel: [{ u: 1, p: 1, label: 'моя' }] }, 0, proj(), ctx), 'моя');
});

test('{№}: только номер из любого вида обозначения бакара', () => {
  const ctx = { cables: new Map([['cat7', {}]]), types: new Map([['Бакар', { cables: [{ cable: 'cat7', count: 1 }] }], ['Бакар2', { cables: [{ cable: 'cat7', count: 2 }] }]]), configs: new Map() };
  const L = (label, cab, typeId = 'Бакар') => shilutLabel({ id: label, label, typeId, cabinet: cab, panel: typeId === 'Бакар2' ? [{ u: 1, p: 1 }, { u: 1, p: 2 }] : [{ u: 1, p: 1 }] }, 0, { racks: {}, shilut: { tpl: { Бакар: 'B-{№}', Бакар2: 'B-{№}' } } }, ctx);
  assert.equal(L('B16', 'CCTV1'), 'CCTV1-B-16');
  assert.equal(L('1A-25', '1A'), '1A-B-25');
  assert.equal(L('2B/27', '2B'), '2B-B-27');
  assert.equal(L('05', 'Solar'), 'Solar-B-05');
  assert.equal(L('1A-1A/01', '1A'), '1A-B-01');
  assert.equal(L('1-25', '1'), '1-B-25');                  // шкаф «1» не принимается за номер
  assert.equal(L('1A-25-26', '1A', 'Бакар2'), '1A-B-25');  // пара на 2 порта — по номеру порта
  assert.equal(numPart('NoDigits'), 'NoDigits');
  assert.equal(numPart('A-12-13'), '12-13');
});
test('одинаковые названия: занято только в том же шкафу', async () => {
  const { sameLabelClash } = await import('../src/domain/points.js');
  assert.equal(sameLabelClash({ label: 'A5', cabinet: '1A' }, { label: 'A5', cabinet: '1A' }), true);
  assert.equal(sameLabelClash({ label: 'A5', cabinet: '1A' }, { label: 'A5', cabinet: '2B' }), false);
  assert.equal(sameLabelClash({ label: 'A5', cabinet: '' }, { label: 'A5', cabinet: '1A' }), false);
  assert.equal(sameLabelClash({ label: 'A5' }, { label: 'A5' }), true);       // два без шкафа — одно место
  assert.equal(sameLabelClash({ label: 'A5', cabinet: '1A' }, { label: 'A6', cabinet: '1A' }), false);
});
