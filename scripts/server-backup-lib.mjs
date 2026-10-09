// Серверная резервная копия: чистая логика (без обращения к сети), чтобы её можно было проверить тестом.
import { buildBackup } from '../src/app/backup.js';
import fs from 'node:fs';
import path from 'node:path';

const safe = (s) => String(s || 'проект').replace(/[\\/:*?"<>|]/g, '_').trim() || 'проект';

// Читает проект целиком: сам документ и все его подколлекции (списки подколлекций берутся из базы, ничего не пропустит)
export async function readProject(projectRef) {
  const snap = await projectRef.get();
  const project = { id: projectRef.id, ...snap.data() };
  const data = {};
  const cols = await projectRef.listCollections();
  for (const col of cols) {
    const docs = await col.get();
    data[col.id] = docs.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return { project, data };
}

// Имя папки копии по времени: 2026-10-10_0000 (UTC), сортируется как дата
export const stamp = (now) => now.toISOString().slice(0, 16).replace('T', '_').replace(':', '');

// Записывает две копии проекта: «для импорта» (как кнопка «Резервная копия») и полную (всё, включая историю и участников)
export function writeProjectBackup(dir, { project, data }, now) {
  const base = safe(project.name);
  const importable = buildBackup(project, data, now);
  const counts = {};
  Object.entries(data).forEach(([k, v]) => { counts[k] = v.length; });
  fs.writeFileSync(path.join(dir, `${base} (импорт).json`), JSON.stringify(importable));
  fs.writeFileSync(path.join(dir, `${base} (полная).json`), JSON.stringify({ format: 'polevoy-full-1', createdAt: now.toISOString(), project, data }));
  return { id: project.id, name: project.name, counts };
}

// Оставляет только последние keep папок копий (имена сортируются по времени)
export function pruneOld(root, keep) {
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(d.name)).map((d) => d.name).sort();
  const drop = dirs.slice(0, Math.max(0, dirs.length - keep));
  drop.forEach((n) => fs.rmSync(path.join(root, n), { recursive: true, force: true }));
  return drop;
}
