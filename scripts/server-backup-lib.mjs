// Серверная резервная копия: чистая логика (без обращения к сети), чтобы её можно было проверить тестом.
import { buildBackup } from '../src/app/backup.js';
import fs from 'node:fs';
import path from 'node:path';

const safe = (s) => String(s || 'проект').replace(/[\\/:*?"<>|]/g, '_').trim() || 'проект';

// Читает проект целиком: сам документ и все его подколлекции (списки подколлекций берутся из базы, ничего не пропустит)
export async function readProject(projectRef, only) {
  const snap = await projectRef.get();
  const project = { id: projectRef.id, ...snap.data() };
  const data = {};
  const cols = await projectRef.listCollections();
  for (const col of cols) {
    if (only && !only.includes(col.id)) continue;
    const docs = await col.get();
    data[col.id] = docs.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return { project, data };
}

// Экономный вариант: берём прошлую полную копию и читаем из базы только изменённое после неё (поле updatedAtServer
// ставит приложение при каждой записи). Раз в неделю — полное чтение (на случай окончательно удалённых записей).
export async function readProjectDelta(projectRef, prev, since, Timestamp) {
  const snap = await projectRef.get();
  const project = { id: projectRef.id, ...snap.data() };
  const data = {}; let reads = 1;
  const cols = await projectRef.listCollections();
  for (const col of cols) {
    const old = prev.data?.[col.id];
    if (!old) { const docs = await col.get(); reads += docs.size; data[col.id] = docs.docs.map((d) => ({ id: d.id, ...d.data() })); continue; }
    const map = new Map(old.map((d) => [d.id, d]));
    const docs = await col.where('updatedAtServer', '>', Timestamp.fromMillis(since)).get(); reads += docs.size;
    docs.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
    data[col.id] = [...map.values()];
  }
  return { project, data, reads };
}

// Прошлая полная копия каждого проекта (по id) из самой свежей папки копий
export function previousBackups(root) {
  if (!fs.existsSync(root)) return new Map();
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(d.name)).map((d) => d.name).sort();
  const out = new Map();
  for (const name of dirs.reverse()) {
    const dir = path.join(root, name);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('(полная).json'))) {
      try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (j.project?.id && !out.has(j.project.id)) out.set(j.project.id, j); } catch { /* битая — пропускаем */ }
    }
    if (out.size) break;
  }
  return out;
}

// Удалённые в приложении проекты (мягкое удаление) в копию не попадают
export const isDeleted = (project) => project?.deleted === true;

// Имя папки копии по времени: 2026-10-10_0000 (UTC), сортируется как дата
export const stamp = (now) => now.toISOString().slice(0, 16).replace('T', '_').replace(':', '');

// Записывает две копии проекта: «для импорта» (как кнопка «Резервная копия») и полную (всё, включая историю и участников)
export function writeProjectBackup(dir, { project, data, fullAt }, now) {
  const base = safe(project.name);
  const importable = buildBackup(project, data, now);
  const counts = {};
  Object.entries(data).forEach(([k, v]) => { counts[k] = v.length; });
  fs.writeFileSync(path.join(dir, `${base} (импорт).json`), JSON.stringify(importable));
  fs.writeFileSync(path.join(dir, `${base} (полная).json`), JSON.stringify({ format: 'polevoy-full-1', createdAt: now.toISOString(), fullAt: fullAt || now.toISOString(), project, data }));
  return { id: project.id, name: project.name, counts };
}

// Оставляет только последние keep папок копий (имена сортируются по времени)
export function pruneOld(root, keep) {
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(d.name)).map((d) => d.name).sort();
  const drop = dirs.slice(0, Math.max(0, dirs.length - keep));
  drop.forEach((n) => fs.rmSync(path.join(root, n), { recursive: true, force: true }));
  return drop;
}

// ---------- общее (не проекты): общий пул, список разрешённых почт, личные настройки пользователей ----------
// Читает все корневые коллекции, кроме projects, и документы users/{uid}/prefs/{id}
export async function readCommon(db) {
  const out = { format: 'polevoy-common-1', collections: {}, prefs: [] };
  for (const col of await db.listCollections()) {
    if (col.id === 'projects' || col.id === 'users') continue;
    const docs = await col.get();
    out.collections[col.id] = docs.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  const prefs = await db.collectionGroup('prefs').get();
  out.prefs = prefs.docs.filter((d) => d.ref.parent.parent?.parent?.id === 'users').map((d) => ({ uid: d.ref.parent.parent.id, id: d.id, data: d.data() }));
  return out;
}

// ---------- восстановление в пустую базу (новый проект Firebase) ----------
// В JSON копии метки времени Firestore записаны как { _seconds, _nanoseconds } — превращаем обратно в Timestamp
export function revive(v, Timestamp) {
  if (Array.isArray(v)) return v.map((x) => revive(x, Timestamp));
  if (v && typeof v === 'object') {
    const k = Object.keys(v);
    if (k.length === 2 && '_seconds' in v && '_nanoseconds' in v) return new Timestamp(v._seconds, v._nanoseconds);
    return Object.fromEntries(Object.entries(v).map(([a, b]) => [a, revive(b, Timestamp)]));
  }
  return v;
}

// Список записей для восстановления из папки копии: [{ path: 'projects/ID/points/X', data }]
export function restorePlan(dir) {
  const writes = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('(полная).json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (j.format !== 'polevoy-full-1' || !j.project?.id) continue;
    const { id, ...project } = j.project;
    writes.push({ path: `projects/${id}`, data: project });
    for (const [coll, docs] of Object.entries(j.data || {})) {
      for (const d of docs) { const { id: did, ...rest } = d; writes.push({ path: `projects/${id}/${coll}/${did}`, data: rest }); }
    }
  }
  const common = path.join(dir, COMMON_FILE);
  if (fs.existsSync(common)) {
    const c = JSON.parse(fs.readFileSync(common, 'utf8'));
    for (const [coll, docs] of Object.entries(c.collections || {})) for (const d of docs) { const { id, ...rest } = d; writes.push({ path: `${coll}/${id}`, data: rest }); }
    for (const p of c.prefs || []) writes.push({ path: `users/${p.uid}/prefs/${p.id}`, data: p.data });
  }
  return writes;
}
export const COMMON_FILE = 'ОБЩЕЕ (пул, разрешённые почты, настройки).json';
