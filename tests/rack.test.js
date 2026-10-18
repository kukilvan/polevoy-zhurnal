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
  const r = autoFill(pts, ctx1, [{ u: 38 }, { u: 37 }], new Set(['38|2']));
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
