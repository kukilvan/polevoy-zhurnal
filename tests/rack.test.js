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
