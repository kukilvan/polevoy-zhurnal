import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeleted, readProject, writeProjectBackup, pruneOld, stamp } from '../scripts/server-backup-lib.mjs';

// Минимальная подделка Firestore: документ с данными и подколлекциями
const doc = (id, data, subs = {}) => ({ id, get: async () => ({ data: () => data }), listCollections: async () => Object.entries(subs).map(([n, items]) => ({ id: n, get: async () => ({ docs: items.map((x) => ({ id: x.id, data: () => { const { id: _i, ...rest } = x; return rest; } })) }) })) });

test('копия проекта читает все подколлекции и пишет два файла', async () => {
  const ref = doc('p1', { name: 'Mega Or / тест', memberEmails: ['a@x.com'] }, {
    points: [{ id: 'a', label: '1A-01' }, { id: 'b', label: '1A-02', deleted: true }],
    history: [{ id: 'h', action: 'create' }],
    catalog: [{ id: 'PR_PTS', name: 'Протяжка' }],
  });
  const p = await readProject(ref);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  const now = new Date('2026-10-10T00:00:00Z');
  const res = writeProjectBackup(dir, p, now);
  assert.equal(res.counts.points, 2); assert.equal(res.counts.history, 1);
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['Mega Or _ тест (импорт).json', 'Mega Or _ тест (полная).json']);
  const imp = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
  assert.equal(imp.format, 'polevoy-import-1'); assert.equal(imp.points.length, 1); // удалённые не попадают в «импорт»
  const full = JSON.parse(fs.readFileSync(path.join(dir, files[1]), 'utf8'));
  assert.equal(full.data.points.length, 2); assert.equal(full.data.history.length, 1); assert.deepEqual(full.project.memberEmails, ['a@x.com']);
});

test('хранятся только последние 15 копий', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  for (let i = 1; i <= 18; i += 1) fs.mkdirSync(path.join(root, stamp(new Date(Date.UTC(2026, 9, i, 0, 0)))));
  fs.mkdirSync(path.join(root, 'README')); // посторонняя папка не трогается
  const dropped = pruneOld(root, 15);
  assert.equal(dropped.length, 3); assert.equal(dropped[0], '2026-10-01_0000');
  assert.equal(fs.readdirSync(root).length, 16);
});

test('удалённый проект распознаётся и в копию не идёт', () => {
  assert.equal(isDeleted({ name: 'x', deleted: true }), true);
  assert.equal(isDeleted({ name: 'x' }), false);
  assert.equal(isDeleted(undefined), false);
});

test('восстановление: план записей из полной копии и общего файла, метки времени оживают', async () => {
  const { restorePlan, revive, COMMON_FILE } = await import('../scripts/server-backup-lib.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-'));
  fs.writeFileSync(path.join(dir, 'X (полная).json'), JSON.stringify({ format: 'polevoy-full-1', project: { id: 'p1', name: 'X', updatedAtServer: { _seconds: 5, _nanoseconds: 0 } }, data: { points: [{ id: 'a', label: '1A-01' }], history: [{ id: 'h', at: 1 }] } }));
  fs.writeFileSync(path.join(dir, 'X (импорт).json'), '{}');
  fs.writeFileSync(path.join(dir, COMMON_FILE), JSON.stringify({ format: 'polevoy-common-1', collections: { pool_types: [{ id: 'Камера', nameHe: 'מצלמה' }], allowed: [{ id: 'a@x.com' }] }, prefs: [{ uid: 'u1', id: 'main', data: { dictWords: [] } }] }));
  const plan = restorePlan(dir);
  assert.deepEqual(plan.map((w) => w.path).sort(), ['allowed/a@x.com', 'pool_types/Камера', 'projects/p1', 'projects/p1/history/h', 'projects/p1/points/a', 'users/u1/prefs/main']);
  assert.equal(plan.find((w) => w.path === 'projects/p1/points/a').data.id, undefined);
  class TS { constructor(s, n) { this.s = s; this.n = n; } }
  const r = revive(plan.find((w) => w.path === 'projects/p1').data, TS);
  assert.ok(r.updatedAtServer instanceof TS); assert.equal(r.updatedAtServer.s, 5);
});

test('общее: читает корневые коллекции кроме projects и личные настройки', async () => {
  const { readCommon } = await import('../scripts/server-backup-lib.mjs');
  const col = (id, docs) => ({ id, get: async () => ({ docs: docs.map((d) => ({ id: d.id, data: () => ({ v: d.v }) })) }) });
  const db = {
    listCollections: async () => [col('projects', [{ id: 'p' }]), col('pool_types', [{ id: 'Камера', v: 1 }]), col('users', [])],
    collectionGroup: () => ({ get: async () => ({ docs: [{ id: 'main', data: () => ({ dictWords: [1] }), ref: { parent: { parent: { id: 'u1', parent: { id: 'users' } } } } }] }) }),
  };
  const c = await readCommon(db);
  assert.deepEqual(Object.keys(c.collections), ['pool_types']);
  assert.deepEqual(c.prefs, [{ uid: 'u1', id: 'main', data: { dictWords: [1] } }]);
});
