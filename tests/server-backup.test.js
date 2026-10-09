import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readProject, writeProjectBackup, pruneOld, stamp } from '../scripts/server-backup-lib.mjs';

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
