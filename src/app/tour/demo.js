// Демо-проект для тура: отдельное хранилище в памяти. Настоящие данные не трогаются и на сервер ничего не уходит.
// Вход: подменяем репозиторий в store на демо; выход: возвращаем настоящий (данные подтянутся из кэша телефона).
import * as store from '../store.js';
import { createRepo, createMemoryBackend } from '../repo.js';
import { composedTypes, POINT_TYPES } from '../../domain/index.js';

let real = null; let savedKey = null;
export const inDemo = () => store.demo.on;
export const realRepo = () => real;

export function enterDemo() {
  if (store.demo.on) return;
  real = store.getRepo(); if (!real) return;
  const user = real.user;
  const key = `pz.currentProject.${user.uid}`;
  try { savedKey = localStorage.getItem(key); } catch { savedKey = null; }
  store.stop();
  store.demo.on = true;
  const repo = createRepo(createMemoryBackend(), user);
  store.start(repo);
  const pid = repo.createProject({ name: 'Демо-проект «Офис»', object: 'Учебный объект', helper: 'Помощник', helperHe: 'עוזר' }, null);
  const types = composedTypes(POINT_TYPES).map((t) => t.id);
  const t = (id) => (types.includes(id) ? id : types[0]);
  const ops = [];
  const add = (label, cabinet, floor, typeId, extra = {}) => ops.push({ coll: 'points', data: { label, cabinet, floor, typeId: t(typeId), ...extra } });
  for (let i = 1; i <= 8; i++) add(`1A-${String(i).padStart(2, '0')}`, '1A', '1', 'Камера', i <= 3 ? { length: 40 + i * 5 } : {});
  for (let i = 1; i <= 4; i++) add(`1B-${String(i).padStart(2, '0')}`, '1B', '1', 'Вайфай');
  for (let i = 1; i <= 3; i++) add(`1B-D${i}`, '1B', '1', 'Дверь');
  repo.save(pid, ops);
  store.setCurrentProject(pid, { pending: true });
}

export function exitDemo() {
  if (!store.demo.on) return;
  store.stop();
  store.demo.on = false;
  try { if (savedKey !== null) localStorage.setItem(`pz.currentProject.${real.user.uid}`, savedKey); } catch { /* нет доступа */ }
  store.start(real);
  real = null;
}
