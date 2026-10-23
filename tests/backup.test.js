import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, backupCount } from '../src/app/backup.js';

test('копия содержит протяжки, справочники и настройки проекта', () => {
  const project = { id: 'P', name: 'X', racks: { A: { n: 1 } }, shilut: { colors: ['red'] }, doorPins: ['d1'], drawings: [{ id: 'dr' }] };
  const data = { points: [{ id: 'p1' }, { id: 'p2', deleted: true }], pulls: [{ id: 'pl1' }], cables: [{ id: 'c1' }] };
  const b = buildBackup(project, data);
  assert.equal(b.pulls.length, 1); assert.equal(b.points.length, 1);
  assert.deepEqual(b.projectData.racks, { A: { n: 1 } }); assert.deepEqual(b.projectData.doorPins, ['d1']);
  assert.equal(b.reference.cables.length, 1);
  assert.equal(backupCount(data), 2);
});
