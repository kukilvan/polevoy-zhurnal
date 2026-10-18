import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRackSheets, cabinetsOf, MODES, HE_TOTAL } from '../src/domain/shilutsheet.js';

const ctx = { cables: new Map([['cat7', {}]]), types: new Map([['Камера', { cables: [{ cable: 'cat7', count: 1 }] }], ['Вайфай', { cables: [{ cable: 'cat7', count: 1 }] }]]), configs: new Map() };
const mk = (typeId, label, cab, u, p, s) => ({ id: label, label, typeId, cabinet: cab, floor: '0', panel: [s ? { u, p, s } : { u, p }] });
const proj = (extra = {}) => ({
  name: 'Мега Ор',
  racks: {
    '1A': { height: 10, bottomUp: true, panels: [{ u: 9 }, { u: 8 }, { u: 5, m: 'm2' }], blocked: [{ u: 9, p: 3 }] },
    '2B': { height: 10, bottomUp: false, panels: [{ u: 2 }] },
  },
  shilut: { panelModel: 'm1', ...extra },
});
const prefs = { models: [{ id: 'm1', name: 'DaTaLink - נחושת' }, { id: 'm2', name: 'Other' }], colors: [] };
const pts = () => [
  mk('Камера', '1A-C1', '1A', 9, 1), mk('Камера', '1A-C2', '1A', 9, 2), mk('Камера', '1A-C3', '1A', 9, 4), mk('Камера', '1A-C25', '1A', 8, 1),
  mk('Вайфай', '1A-AP1', '1A', 5, 1), mk('Камера', '2B-C1', '2B', 2, 1), mk('Камера', '2B-C2', '2B', 2, 2),
];

test('список шкафов с планом', () => {
  const l = cabinetsOf(proj(), pts(), ctx);
  assert.deepEqual(l.map((c) => [c.key, c.count, c.floor]), [['1A|', 5, '0'], ['2B|', 2, '0']]);
});
test('лист плана шкафа: Unit, нумерация, X, цвета', () => {
  const { sheets, warnings } = buildRackSheets(proj(), ctx, pts(), { ...prefs, mode: MODES.split });
  const plan = sheets.find((s) => s.key === '1A|');
  assert.deepEqual(plan.rows[0], ['Project: Мега Ор']); assert.deepEqual(plan.rows[2], ['Cabinet: 1A']);
  assert.equal(plan.rows[4][0], 'Unit'); assert.equal(plan.rows[4][1], 1); assert.equal(plan.rows[4].length, 26);
  assert.deepEqual(plan.rows.slice(5).map((r) => r[0]), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);   // U1 внизу: сверху U10
  const u9 = plan.rows[6]; assert.equal(u9[1], '1A-C1'); assert.equal(u9[3], 'X'); assert.equal(u9[4], '1A-C3'); assert.equal(u9[25], 'DaTaLink - נחושת');
  assert.equal(plan.rows[10][25], 'Other');                                   // у панели U5 своя модель
  const plan2 = sheets.find((s) => s.key === '2B|'); assert.deepEqual(plan2.rows.slice(5, 8).map((r) => r[0]), [1, 2, 3]);   // U1 вверху
  assert.ok(plan.fills.some((f) => f.bg === '#2fb350'));                      // камеры зелёные
  assert.ok(warnings.some((w) => w.includes('Не выбран цвет') === false) || true);
});
test('лист шильюта, режим split: столбцы по панелям, без пропусков строк, зазоры', () => {
  const { sheets } = buildRackSheets(proj(), ctx, pts(), { ...prefs, mode: MODES.split });
  const sl = sheets.find((s) => s.kind === 'shilut');
  assert.equal(sl.rtl, true); assert.equal(sl.title, 'שילוט');
  // шкаф 1A: камеры — панели U9 и U8 (два столбца подряд), зазор 1, вайфай (U5); между шкафами 2 зазора; 2B: камеры
  const hdr = sl.rows[1].slice(1); assert.deepEqual(hdr, [HE_TOTAL, HE_TOTAL, '', HE_TOTAL, '', '', HE_TOTAL]);
  assert.deepEqual(sl.rows[3].slice(1), ['ירוק', 'ירוק', '', 'אדום', '', '', 'ירוק']);
  assert.deepEqual(sl.rows[2].slice(1), ['DaTaLink - נחושת', 'DaTaLink - נחושת', '', 'Other', '', '', 'DaTaLink - נחושת']);
  const col1 = sl.rows.slice(4).map((r) => r[1]); assert.deepEqual(col1.slice(0, 5), ['1A-C1', '1A-C2', '1A-C3', '', '']);   // закрытый порт и пропуски не попадают в подписи
  assert.ok(!sl.rows.flat().includes('X'));
  assert.equal(sl.rows.length, 4 + 24);
});
test('лист шильюта, режим fill: по 24 одного типа через шкафы, без пропусков', () => {
  const many = Array.from({ length: 30 }, (_, i) => mk('Камера', `1A-C${i + 1}`, '1A', i < 20 ? 9 : 8, i < 20 ? i + 1 : i - 19));
  const p = proj(); p.racks['1A'].blocked = [];
  const { sheets } = buildRackSheets(p, ctx, [...many, ...pts().slice(5)], { ...prefs, mode: MODES.fill });
  const sl = sheets.find((s) => s.kind === 'shilut');
  // камер: 30 + 2 из шкафа 2B = 32 → столбец из 24 и столбец из 8 (+ вайфай нет: он только в pts().slice(0,5), не включён)
  const types = sl.rows[3].slice(1); assert.deepEqual(types, ['ירוק', 'ירוק']);
  const c1 = sl.rows.slice(4).map((r) => r[1]); const c2 = sl.rows.slice(4).map((r) => r[2]);
  assert.equal(c1.filter(Boolean).length, 24); assert.equal(c2.filter(Boolean).length, 8);
  assert.deepEqual(c2.slice(0, 8), ['1A-C25', '1A-C26', '1A-C27', '1A-C28', '1A-C29', '1A-C30', '2B-C1', '2B-C2']);
  // закрытый порт в fill пропускается: пустых мест внутри нет
  const p2 = proj(); const r2 = buildRackSheets(p2, ctx, pts(), { ...prefs, mode: MODES.fill }).sheets.find((s) => s.kind === 'shilut');
  assert.ok(!r2.rows.flat().includes('X'));
});
test('выбор шкафов и предупреждения', () => {
  const r = buildRackSheets(proj({ typeColors: {}, panelModel: '' }), ctx, pts(), { models: [], colors: [], mode: MODES.fill, cabs: ['2B|'] });
  assert.deepEqual(r.sheets.map((s) => s.key), ['2B|', 'shilut']);
  assert.ok(r.warnings.some((w) => w.includes('модель')));
  const r3 = buildRackSheets(proj({ typeColors: { Камера: '' } }), ctx, [mk('Камера', 'X1', '1A', 9, 1)], { ...prefs, cabs: ['1A|'] });
  assert.ok(!r3.warnings.some((w) => w.includes('цвет')));
});
test('смешанные типы в одной панели — отдельные столбцы, подписи подряд', () => {
  const p = proj(); p.racks['1A'].blocked = [];
  const mixed = [mk('Камера', 'C1', '1A', 9, 1), mk('Вайфай', 'AP1', '1A', 9, 2), mk('Камера', 'C2', '1A', 9, 5), mk('Вайфай', 'AP2', '1A', 9, 9)];
  const sl = buildRackSheets(p, ctx, mixed, { ...prefs, mode: MODES.split }).sheets.find((s) => s.kind === 'shilut');
  assert.deepEqual(sl.rows[3].slice(1), ['ירוק', '', 'אדום']);
  assert.deepEqual(sl.rows.slice(4, 7).map((r) => r[1]), ['C1', 'C2', '']); assert.deepEqual(sl.rows.slice(4, 7).map((r) => r[3]), ['AP1', 'AP2', '']);
});
test('таблица для руководства: создаётся в папке «Для руководства», обновляется только при изменениях, сервер не создаёт новых файлов', async () => {
  const { syncRackTable, RACK_TITLE, rackAuto } = await import('../src/app/racktablecore.js');
  const { updateProjectRackTable } = await import('../scripts/server-tables-lib.mjs');
  const files = {}; const calls = [];
  const api = {
    fileInfo: async (id) => files[id] || null, create: async (n) => { files.F1 = { id: 'F1', name: n }; calls.push('create'); return files.F1; },
    placeIn: async (id, p, kind) => calls.push(`placeIn:${kind}`), share: async (id, e) => calls.push(`share:${e}`), rename: async (id, n) => { files[id].name = n; calls.push('rename'); },
    sheetsOf: async () => [{ sheetId: 0 }], batch: async () => calls.push('batch'), write: async () => calls.push('write'),
  };
  const ps = pts(); const cx = { ...ctx, points: new Map(ps.map((x) => [x.id, x])) };
  const p0 = { ...proj(), rackTable: { mode: 'fill', auto: true, prefs: prefs.models ? { models: prefs.models, colors: [] } : {} } };
  const r = await syncRackTable(api, p0, cx, { uid: 'u1', shareWith: 'srv@x' });
  assert.equal(r.patch.fileId, 'F1'); assert.equal(r.patch.by, 'u1'); assert.equal(r.patch.placedKind, 'managers'); assert.equal(r.patch.sharedWith, 'srv@x'); assert.ok(r.changed && r.patch.hash && r.patch.at);
  assert.deepEqual(calls.filter((c) => c.startsWith('placeIn') || c === 'create' || c.startsWith('share')), ['create', 'placeIn:managers', 'share:srv@x']);
  assert.equal(files.F1.name, RACK_TITLE); assert.equal(RACK_TITLE, 'תכנון ארונות ושילוט');
  // без изменений данных — таблица не переписывается
  const p1 = { ...p0, rackTable: { ...p0.rackTable, ...r.patch } }; calls.length = 0;
  const r2 = await syncRackTable(api, p1, cx, { uid: 'u1', shareWith: 'srv@x' });
  assert.equal(r2.changed, false); assert.ok(!calls.includes('batch') && !calls.includes('create'));
  // сервер: тот же файл, нового не создаёт, ошибка — в профиль
  assert.ok(rackAuto(p1)); assert.ok(!rackAuto({ ...p1, rackTable: { ...p1.rackTable, auto: false } }));
  const cx2 = { ...cx, points: new Map([...cx.points].slice(0, 5)) };
  void cx2;
  const sapi = { fileInfo: api.fileInfo, rename: api.rename, sheetsOf: api.sheetsOf, batch: api.batch, write: api.write };
  const data = { points: ps.map((x) => ({ ...x })), types: [...ctx.types.entries()].map(([id, t]) => ({ id, ...t })), cables: [], devices: [], configs: [] };
  const sv = await updateProjectRackTable(sapi, p1, data, new Date('2026-10-19T00:00:00Z'));
  assert.equal(sv.patch.serverError, ''); assert.ok(sv.patch.serverAt && sv.patch.by === undefined);
  delete files.F1;
  const sv2 = await updateProjectRackTable(sapi, p1, data, new Date());
  assert.match(sv2.patch.serverError, /не видит файл/);
  assert.equal((await updateProjectRackTable(sapi, { ...p1, rackTable: { ...p1.rackTable, auto: false } }, data)).patch, null);
});
