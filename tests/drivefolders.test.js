import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFolder, moveInto } from '../src/app/drivefolders.js';

// маленький «Диск» в памяти: папки с appProperties, файлы с parents
function fakeDrive() {
  const files = new Map(); let n = 0; const log = [];
  const req = async (method, url, body) => {
    const u = new URL(url); log.push([method, u.pathname.split('/').pop()]);
    if (method === 'POST') { const id = `F${++n}`; files.set(id, { id, parents: [], appProperties: {}, ...body }); return { id }; }
    const id = u.pathname.split('/files/')[1];
    if (method === 'GET' && !id) {
      const q = u.searchParams.get('q'); const props = [...q.matchAll(/key='(\w+)' and value='([^']*)'/g)].map((m) => [m[1], m[2]]);
      return { files: [...files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder' && props.every(([k, v]) => f.appProperties?.[k] === v)).map((f) => ({ id: f.id, name: f.name })) };
    }
    if (method === 'GET') return { parents: files.get(id).parents };
    if (method === 'PATCH') { const f = files.get(id); if (body?.name) f.name = body.name; const add = u.searchParams.get('addParents'); if (add) f.parents = [add]; return { id }; }
    throw new Error(method);
  };
  return { req, files, log };
}

test('папки Диска: Менеджер проектов / проект / Чертежи; переименование проекта не плодит папки', async () => {
  const { req, files } = fakeDrive();
  const p = { id: 'P1', name: 'Mega Or' };
  const dr = await projectFolder(req, p, 'drawings'); const bk = await projectFolder(req, p, 'backups'); const pf = await projectFolder(req, p);
  const byName = (nm) => [...files.values()].filter((f) => f.name === nm);
  assert.equal(byName('Менеджер проектов').length, 1); assert.equal(byName('Mega Or').length, 1);
  assert.equal(files.get(dr).name, 'Чертежи'); assert.deepEqual(files.get(dr).parents, [pf]); assert.deepEqual(files.get(bk).parents, [pf]);
  const pf2 = await projectFolder(req, { id: 'P1', name: 'Mega Or Modiin' });
  assert.equal(pf2, pf); assert.equal(files.get(pf).name, 'Mega Or Modiin');
  files.set('X', { id: 'X', parents: ['OLD'] });
  assert.equal(await moveInto(req, 'X', dr), true); assert.deepEqual(files.get('X').parents, [dr]);
  assert.equal(await moveInto(req, 'X', dr), false);
});

test('параллельные запросы папок проектов не плодят второй корень «Менеджер проектов»', async () => {
  const { req, files } = fakeDrive();
  await Promise.all([projectFolder(req, { id: 'A', name: 'A' }, 'backups'), projectFolder(req, { id: 'B', name: 'B' }, 'managers'), projectFolder(req, { id: 'C', name: 'C' })]);
  assert.equal([...files.values()].filter((f) => f.name === 'Менеджер проектов').length, 1);
});
