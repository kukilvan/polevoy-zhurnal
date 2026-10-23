import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG, POINT_TYPES, CABLES, UNITS, CULPRITS, DELAY_REASONS, DEVICES, composedTypes, buildContext, pointInfo,
  applyDoorRules, autoDoorCables, makeDoorCfg, standardDoorCfgs, doorCfgShort, doorDevices, doorCfgId,
} from '../src/domain/index.js';

const project = { id: 'P1', name: 'X' };
const tsofar = { id: 'DV_TS', name: 'Цофар', nameHe: 'צופר', cables: [{ cable: '6005', count: 1 }], workIds: [] };
function make(extra = {}) {
  return buildContext({ projects: [project], points: [], days: [], entries: [], journal: [], cabinetSettings: [],
    catalog: CATALOG, types: composedTypes(POINT_TYPES), cables: CABLES, devices: [...DEVICES, tsofar], units: UNITS, culprits: CULPRITS, delayReasons: DELAY_REASONS, ...extra });
}

test('двери: части по устройствам', () => {
  const p = doorDevices(make());
  assert.deepEqual(p.lock.map((d) => d.id), ['DV_EMAG', 'DV_MANUL']);
  assert.ok(p.reader.some((d) => d.id === 'DV_BIO'));
  assert.ok(p.extra.some((d) => d.id === 'DV_TS'));
  assert.ok(!Object.values(p).flat().some((d) => d.id === 'DV_CAM'));
});

test('двери: правила и автокабели', () => {
  const ctx = make();
  let s = applyDoorRules(ctx, new Map([['DV_MANUL', 1]]), 'DV_EMAG', 1);
  assert.equal(s.get('DV_MANUL'), undefined, 'запирание только одно');
  assert.equal(s.get('DV_LPTIHA'), 1); assert.equal(s.get('DV_LNIPUTZ'), 1); assert.equal(s.get('DV_KORE'), 1);
  s = applyDoorRules(ctx, s, 'DV_KORE', 2);
  assert.equal(s.get('DV_LPTIHA'), undefined, '2 коре — без птихи');
  const devs = (m) => [...m].map(([deviceId, count]) => ({ deviceId, count }));
  assert.deepEqual(autoDoorCables(ctx, devs(new Map([['DV_EMAG', 1]]))), [{ cable: '6005', count: 2 }]);
  assert.deepEqual(autoDoorCables(ctx, devs(new Map([['DV_MANUL', 1], ['DV_BIO', 1]]))), [{ cable: '6005', count: 3 }, { cable: 'cat7', count: 1 }]);
  assert.deepEqual(autoDoorCables(ctx, devs(new Map([['DV_EMAG', 1], ['DV_INT', 1], ['DV_TS', 1]]))), [{ cable: '6005', count: 3 }, { cable: 'cat7', count: 1 }]);
});

test('двери: название, id, стандартные', () => {
  const ctx = make();
  const [em, mh] = standardDoorCfgs(ctx);
  assert.equal(em.name, 'ЭМ · коре · птиха · нипуц · магнит · 6005×2');
  assert.equal(mh.name, 'МХ · коре · магнит · 6005×3');
  const two = makeDoorCfg(ctx, [{ deviceId: 'DV_MAGNIT', count: 2 }, { deviceId: 'DV_BIO', count: 2 }, { deviceId: 'DV_MANUL', count: 1 }], [{ cable: 'cat7', count: 2 }, { cable: '6005', count: 3 }]);
  assert.equal(two.name, 'МХ · 2 коре биометри · 2 магнита · 6005×3 + cat7×2');
  assert.equal(doorCfgShort(ctx, two), 'МХ');
  assert.equal(doorCfgId([{ deviceId: 'A', count: 1 }, { deviceId: 'B', count: 2 }], [{ cable: 'x', count: 1 }]), doorCfgId([{ deviceId: 'B', count: 2 }, { deviceId: 'A', count: 1 }], [{ cable: 'x', count: 1 }]));
});

test('двери: точка с конфигурацией — состав и кабели из неё', () => {
  const base = make(); const [em] = standardDoorCfgs(base);
  const ctx = make({ configs: [em], points: [{ id: 'd1', projectId: 'P1', label: 'D1', typeId: 'Дверь', configId: em.id }] });
  const info = pointInfo(ctx.points.get('d1'), ctx);
  assert.deepEqual(info.cableList, [{ cable: '6005', count: 2 }]);
  const ins = info.tasks.filter((t) => t.stage === 'Установка').map((t) => t.workId).sort();
  assert.deepEqual(ins, ['INS_EMAG', 'INS_KORE', 'INS_LNIPUTZ', 'INS_LPTIHA', 'INS_MAGNIT']);
  assert.equal(info.tasks.filter((t) => t.stage === 'Протяжка').reduce((n, t) => n + t.qty, 0), 2);
  assert.ok(info.tasks.some((t) => t.workId === 'CHK_DOOR'));
});

test('двери: плашки названия и цвета', async () => {
  const { doorTokens, doorShortColor } = await import('../src/domain/index.js');
  const ctx = make({ devices: [...DEVICES.map((d) => (d.id === 'DV_BIO' ? { ...d, color: '#123456' } : d)), tsofar] });
  const cfg = makeDoorCfg(ctx, [{ deviceId: 'DV_MANUL', count: 1 }, { deviceId: 'DV_BIO', count: 2 }, { deviceId: 'DV_TS', count: 1 }], [{ cable: '6005', count: 4 }]);
  const t = doorTokens(ctx, cfg);
  assert.deepEqual(t.items.map((x) => [x.text, x.count, x.lock]), [['МХ', 1, true], ['коре биометри', 2, false], ['цофар', 1, false]]);
  assert.equal(t.items[1].color, '#123456');
  assert.equal(t.items[0].color, '#2f7cf6');
  assert.equal(doorShortColor(ctx, cfg), '#2f7cf6');
});
