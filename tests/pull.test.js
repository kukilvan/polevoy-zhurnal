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

import { entryLine, delayLine, downtimeByCulprit } from '../src/domain/index.js';
test('задержка в дохе', () => {
  const ctx = { catalog: new Map([['W', { id: 'W', name: 'Хивут', nameHe: 'חיווט', unit: 'шт' }]]), units: new Map(), cables: new Map(), points: new Map(),
    culprits: new Map([['Электрики', { id: 'Электрики', he: 'חשמלאים' }]]), delayReasons: new Map([['Нет доступа', { id: 'Нет доступа', he: 'אין גישה' }]]) };
  const e = { workType: 'Хивут', workId: 'W', quantity: 5, delayReason: 'Нет доступа', delayCulprit: 'Электрики', delayNote: 'ждали ключ', delayMinutes: 40 };
  assert.equal(delayLine(e, ctx), 'Задержка: Нет доступа, Электрики, ждали ключ — 40 мин');
  assert.equal(delayLine(e, ctx, 'he'), 'עיכוב: אין גישה, חשמלאים, ждали ключ — 40 דקות');
  assert.equal(delayLine({ workType: 'Хивут', delayMinutes: 15 }, ctx), 'Задержка: 15 мин');
  assert.equal(delayLine({ workType: 'Хивут' }, ctx), ''); assert.equal(delayLine({ workType: 'Текст', delayMinutes: 5 }, ctx), '');
  assert.ok(entryLine(e, ctx).split('\n')[1].startsWith('Задержка:'));
  const pull = { workType: 'Протяжка', cableId: 'cat7', quantity: 2, minutes: 40, culprit: 'Электрики' };
  assert.ok(entryLine(pull, ctx).includes('(Электрики)'));
});

import { manualKind, visibleManuals, groupManuals } from '../src/domain/manuals.js';
test('инструкции: тип файла, видимость, группы и поиск', () => {
  assert.equal(manualKind({ mime: 'image/jpeg' }), 'image'); assert.equal(manualKind({ fileName: 'a.PDF' }), 'pdf'); assert.equal(manualKind({ fileName: 'a.xlsx' }), 'other');
  const l = [{ id: 1, title: 'Б', section: 'Хивут', fileId: 'f' }, { id: 2, title: 'А', section: 'Замки и двери', fileId: 'f' }, { id: 3, title: 'В', section: 'Моё', addedBy: 'Me@x.com' }, { id: 4, title: 'Г', fileId: 'f', deleted: true }];
  assert.deepEqual(visibleManuals(l, 'other@x.com').map((m) => m.id), [1, 2]);
  assert.deepEqual(visibleManuals(l, 'me@x.com').map((m) => m.id), [1, 2, 3]);
  assert.deepEqual(groupManuals(visibleManuals(l, 'me@x.com')).map((g) => g.section), ['Замки и двери', 'Хивут', 'Моё']);
  assert.deepEqual(groupManuals(visibleManuals(l, 'me@x.com'), 'хив').map((g) => g.items[0].id), [1]);
});

import { generateLabels, generatedTotal, parseSuffixes, renameLabel, renameIssue, buildContext, missingStages, CATALOG, POINT_TYPES, CABLES, CONFIGS, UNITS, CULPRITS, DELAY_REASONS } from '../src/domain/index.js';
test('пачка: пара сама берёт шаг 2, повторы суффиксов убираются, обрезка считается', () => {
  assert.deepEqual(generateLabels({ prefix: 'A-', from: 1, to: 6, step: 1, digits: 2, pair: true }), ['A-01-02', 'A-03-04', 'A-05-06']);
  assert.deepEqual(generateLabels({ prefix: 'A-', from: 1, to: 2, suffixes: parseSuffixes('A, b, A') }), ['A-1A', 'A-1b', 'A-2A', 'A-2b']);
  assert.equal(generatedTotal({ from: 1, to: 5000 }), 5000);
  assert.equal(generateLabels({ from: 1, to: 5000 }).length, 2000);
});
test('переименование: отрицательный номер запрещён, нулевой — предупреждение', () => {
  assert.equal(renameIssue('AP-5', { shift: -9 }), 'negative'); assert.equal(renameIssue('AP-09', { shift: -9 }), 'zero');
  assert.equal(renameIssue('AP-5', { shift: -2 }), ''); assert.equal(renameIssue('A-17-18', { shift: -17 }), 'zero'); assert.equal(renameIssue('A-17-18', { shift: -18 }), 'negative');
  assert.equal(renameLabel('AP-09', { shift: 2, prefix: 'X' }), 'XAP-11');
});
test('что осталось: неисправная точка требует повторной проверки', () => {
  const pt = { id: 'c1', projectId: 'P1', label: 'C1', cabinet: '1A', typeId: 'Камера' };
  const mk = (result) => buildContext({ projects: [{ id: 'P1' }], points: [pt], days: [{ id: 'D1', projectId: 'P1', date: '2026-10-05' }], entries: [{ id: 'e1', dayId: 'D1', workType: 'Проверка', workId: 'CHK_FLUKE', pointIds: ['c1'], result }],
    journal: [{ id: 'j', entryId: 'e1', pointId: 'c1' }], cabinetSettings: [], catalog: CATALOG, types: POINT_TYPES, cables: CABLES, configs: CONFIGS, units: UNITS, culprits: CULPRITS, delayReasons: DELAY_REASONS });
  assert.ok(missingStages(pt, mk('Не работает')).includes('Проверка')); assert.ok(!missingStages(pt, mk('Работает')).includes('Проверка'));
});

test('протяжки: удалённая точка не мешает «Завершена», итог зафиксирован, слияние с чужой копией', async () => {
  const { pullStatus, pullTotal, mergeRemote } = await import('../src/domain/pull.js');
  const p = { pointIds: ['a', 'b'], finished: ['a'], base: 10, meters: [{ id: 'a', v: 5 }], fixed: [{ id: 'a', v: 15 }] };
  assert.equal(pullStatus(p), 'Завершена частично');
  assert.equal(pullStatus(p, (id) => id === 'a'), 'Завершена');
  assert.equal(pullTotal({ ...p, base: 99 }, 'a'), 15);
  const mine = { pointIds: ['a', 'b', 'c'], base: 0, meters: [{ id: 'b', v: 3 }], kept: [], finished: [], checked: [] };
  const remote = { pointIds: ['a', 'b', 'c'], base: 0, meters: [{ id: 'c', v: 7 }, { id: 'b', v: 9 }], kept: [], finished: ['c'], checked: ['c'] };
  const m = mergeRemote(mine, remote);
  assert.deepEqual(m.meters.map((x) => `${x.id}:${x.v}`).sort(), ['b:3', 'c:7']);
  assert.deepEqual(m.finished, ['c']);
});

test('двери: правила замка, кабели по количеству, где используется', async () => {
  const { applyDoorRules, autoDoorCables, usesOf } = await import('../src/domain/index.js');
  const dev = (id, doorRole) => [id, { id, name: id, doorRole }];
  const ctx = { devices: new Map([dev('em', 'em'), dev('pt', 'ptiha'), dev('nip', 'niputz'), dev('kore', 'kore'), dev('mg', 'magnit')]),
    cables: new Map([['6005', { id: '6005', workIds: [] }]]), types: new Map(), points: new Map(), entries: new Map(), catalog: new Map(),
    configs: new Map([['c1', { id: 'c1', devices: [{ deviceId: 'em', count: 1 }], cables: [{ cable: '6005', count: 2 }] }]]) };
  const first = applyDoorRules(ctx, new Map(), 'em', 1);
  assert.ok(first.get('pt') && first.get('kore'));
  const trimmed = new Map(first); trimmed.delete('pt');
  const again = applyDoorRules(ctx, trimmed, 'em', 2);
  assert.equal(again.get('pt'), undefined);   // убранное заново не добавляется
  assert.equal(autoDoorCables(ctx, [{ deviceId: 'em', count: 2 }])[0].count, 4);
  assert.equal(autoDoorCables(ctx, [{ deviceId: 'em', count: 1 }])[0].count, 2);
  assert.deepEqual(usesOf(ctx, 'devices', 'em'), [{ label: 'Конфигурации дверей', n: 1 }]);
  assert.deepEqual(usesOf(ctx, 'cables', '6005'), [{ label: 'Конфигурации дверей', n: 1 }]);
});

test('шилют по портам: точка закрывается, когда набрались все порты; в дох идёт число портов', async () => {
  const { pointInfo, itogShtuk, stuckPortsOf } = await import('../src/domain/index.js');
  const pt = { id: 'c1', projectId: 'P1', label: 'C1', cabinet: '1A', typeId: 'Камера', cableOverride: [{ cable: 'cat7', count: 2 }], shStuck: [0] };
  const mk = (entries) => buildContext({ projects: [{ id: 'P1' }], points: [pt], days: [{ id: 'D1', projectId: 'P1', date: '2026-10-05' }],
    entries: entries.map((e, i) => ({ id: `e${i}`, dayId: 'D1', workType: 'Шилют', workId: 'SHL', pointIds: ['c1'], ...e })),
    journal: entries.map((_, i) => ({ id: `j${i}`, entryId: `e${i}`, pointId: 'c1' })), cabinetSettings: [], catalog: CATALOG, types: POINT_TYPES, cables: CABLES, configs: CONFIGS, units: UNITS, culprits: CULPRITS, delayReasons: DELAY_REASONS });
  const half = mk([{ portQty: [{ id: 'c1', v: 1 }] }]);
  assert.ok(!pointInfo(pt, half).shilut);
  assert.deepEqual([...stuckPortsOf(pt, half)], [0]);
  assert.ok(pointInfo(pt, mk([{ portQty: [{ id: 'c1', v: 1 }] }, { portQty: [{ id: 'c1', v: 1 }] }])).shilut);
  const whole = mk([{}]);
  assert.ok(pointInfo(pt, whole).shilut);
  assert.equal([...stuckPortsOf(pt, whole)].length, 2);
  assert.equal(itogShtuk({ workId: 'CHK_FLUKE', workType: 'Проверка', pointIds: ['c1'], portQty: [{ id: 'c1', v: 1 }] }, half), 1);
});

test('синхронизация: причины отказа сервера и пороги лимита записей', async () => {
  const { rejectReason, writeWarnLevel } = await import('../src/domain/sync.js');
  assert.match(rejectReason('permission-denied').title, /прав/);
  assert.match(rejectReason('resource-exhausted').fix, /10:00/);
  assert.match(rejectReason('invalid-argument').fix, /журнал/);
  assert.equal(writeWarnLevel(15000, 16100), 0.8);
  assert.equal(writeWarnLevel(16100, 16200), 0);
  assert.equal(writeWarnLevel(18000, 19100), 0.95);
});
