import test from 'node:test';
import assert from 'node:assert/strict';
import { pullStatus, pullTotal, nearestPoint, canDeletePull, isMeasured } from '../src/domain/pull.js';

test('протяжка: статусы и метраж', () => {
  const p = { pointIds: [], meters: [], kept: [] };
  assert.equal(pullStatus(p), 'Заготовка');
  p.pointIds = ['a', 'b', 'c']; assert.equal(pullStatus(p), 'Точки выбраны');
  p.base = 12; p.meters = [{ id: 'a', v: 5 }]; assert.equal(pullStatus(p), 'Частично есть метраж');
  assert.equal(pullTotal(p, 'a'), 17); assert.equal(pullTotal(p, 'b'), null);
  p.kept = [{ id: 'b', v: 40 }]; p.meters.push({ id: 'c', v: 0 });
  assert.ok(isMeasured(p, 'c')); assert.equal(pullTotal(p, 'b'), 40); assert.equal(pullStatus(p), 'Есть метраж');
  p.finished = ['a']; assert.equal(pullStatus(p), 'Завершена частично'); assert.ok(canDeletePull(p));
  p.finished = ['a', 'b', 'c']; assert.equal(pullStatus(p), 'Завершена'); assert.ok(!canDeletePull(p));
});
test('протяжка: ближайшая точка', () => {
  const from = { pos: { x: 0, y: 0, page: 0 } };
  const a = { id: 'a', pos: { x: 100, y: 0, page: 0 } }; const b = { id: 'b', pos: { x: 10, y: 10, page: 0 } }; const c = { id: 'c', pos: { x: 1, y: 1, page: 1 } };
  assert.equal(nearestPoint(from, [a, b, c]).id, 'b');
  assert.equal(nearestPoint(null, [a]).id, 'a'); assert.equal(nearestPoint(from, []), null);
});

import { fixLatin, latinKey, fixCabinet, expandShortcut, DEFAULT_SHORTCUTS } from '../src/domain/latin.js';
test('латиница: двойники', () => {
  assert.equal(fixLatin('С108'), 'C108'); assert.equal(fixLatin('ТВ-12'), 'TB-12'); assert.equal(fixLatin('Щит 1'), 'Щит 1');
  assert.equal(fixLatin('GA1/07'), 'GA1/07'); assert.equal(fixLatin('сас1'), 'cac1');
  assert.equal(latinKey('С108'), latinKey('c108')); assert.ok(latinKey('Нс-4').includes(latinKey('hc')));
  assert.equal(fixCabinet('С1', new Set(['C1'])), 'C1'); assert.equal(fixCabinet('Х', new Set()), 'X');
});
test('латиница: быстрый ввод', () => {
  const t = (s) => { const r = expandShortcut(s, s.length, DEFAULT_SHORTCUTS); return r && r.text; };
  assert.equal(t('тв '), 'TV '); assert.equal(t('кам1'), 'CAM1'); assert.equal(t('A-ап-'), 'A-AP-'); assert.equal(t('г '), 'G ');
  assert.equal(t('тв'), null); assert.equal(t('тва '), null); assert.equal(t('X тв '), 'X TV ');
});
