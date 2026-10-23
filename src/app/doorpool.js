// Общий пул конфигураций дверей (pool_doorcfg): новая разновидность двери попадает туда сама (пишет любой участник),
// удаляет только администратор пула. Проект держит копии используемых и закреплённых (коллекция configs) —
// удалённая из пула конфигурация у дверей проекта продолжает работать.
import { state, getRepo, currentProject } from './store.js';
import { toast } from './ui.js';
import { isPoolAdmin, pool } from './pool.js';
import { poolMaps, takeFromPoolOps, isDoorCfg, doorCfgName, standardDoorCfgs, doorPinsOf, makeDoorCfg } from '../domain/index.js';

export const doorPool = new Map();
const subs = new Set();
export const onDoorPool = (fn) => { subs.add(fn); return () => subs.delete(fn); };
let started = false;
export function startDoorPool() {
  if (started || !getRepo()) return; started = true;
  getRepo().listenPool('doorcfg', (docs) => {
    doorPool.clear(); docs.filter((x) => !x.deleted && isDoorCfg(x)).forEach((x) => doorPool.set(x.id, x));
    subs.forEach((f) => { try { f(); } catch { /* ok */ } });
  });
}

const bare = (c) => ({ name: c.name, devices: c.devices, cables: c.cables, kind: 'door' });
// запись с актуальным названием (по коротким именам устройств проекта)
const named = (c) => ({ ...c, name: doorCfgName(state.ctx, c.devices, c.cables) });

/** Все известные конфигурации дверей: стандартные, проекта, пула → Map id → cfg */
export function allDoorCfgs() {
  const m = new Map();
  standardDoorCfgs(state.ctx).forEach((c) => m.set(c.id, c));
  doorPool.forEach((c, id) => { if (!m.has(id)) m.set(id, named(c)); });
  state.ctx.configs.forEach((c, id) => { if (isDoorCfg(c)) m.set(id, { ...named(c), standard: m.get(id)?.standard }); });
  return m;
}
export const pinsOf = () => doorPinsOf(currentProject(), state.ctx);

/** Конфигурация пошла в дело (выбрана для двери или закреплена): копия в проект + в общий пул, если её там нет */
export function useDoorCfg(cfg) {
  const p = currentProject(); const repo = getRepo();
  const full = isDoorCfg(cfg) && cfg.id ? cfg : makeDoorCfg(state.ctx, cfg.devices, cfg.cables);
  // устройства и кабели конфигурации из другого проекта: берём недостающие из общего пула; нет и там — не переносим
  if (!state.ctx.configs.has(full.id)) {
    const ops = []; const missing = []; const maps = poolMaps(pool);
    (full.devices || []).forEach((d) => { if (!state.ctx.devices.has(d.deviceId)) { if (maps.devices.has(d.deviceId)) takeFromPoolOps(state.ctx, maps, 'devices', d.deviceId, ops); else missing.push(d.deviceId); } });
    (full.cables || []).forEach((c) => { if (!state.ctx.cables.has(c.cable)) { if (maps.cables.has(c.cable)) takeFromPoolOps(state.ctx, maps, 'cables', c.cable, ops); else missing.push(c.cable); } });
    if (missing.length) { toast(`Конфигурацию нельзя перенести: в проекте и в общем пуле нет «${missing.join('», «')}»`); return ''; }
    if (ops.length) repo.save(p.id, ops);
  }
  if (!state.ctx.configs.has(full.id)) repo.save(p.id, [{ coll: 'configs', id: full.id, data: { ...bare(full), deleted: false } }]);
  if (!doorPool.has(full.id)) { try { repo.savePool([{ coll: 'doorcfg', id: full.id, data: { ...bare(full), deleted: false } }]); } catch (e) { console.warn('doorcfg pool', e); } }
  return full.id;
}
/** id выбранной конфигурации → она есть в проекте (стандартную/из пула копирует). Пустое → '' */
export function ensureDoorCfg(id) {
  if (!id || id === '__clear') return '';
  if (state.ctx.configs.has(id)) return id;
  const c = allDoorCfgs().get(id); return c ? useDoorCfg(c) : id;
}
export function setPins(list) { getRepo().saveProject(currentProject().id, { doorPins: [...new Set(list)] }); }
export function pin(cfg) { const id = typeof cfg === 'string' ? cfg : useDoorCfg(cfg); if (!id) return; const list = pinsOf(); if (!list.includes(id)) setPins([...list, id]); }
export const unpin = (id) => setPins(pinsOf().filter((x) => x !== id));
export const canDeleteFromPool = () => isPoolAdmin();
export function deleteFromPool(id) { if (isPoolAdmin()) getRepo().savePool([{ coll: 'doorcfg', id, remove: true }]); }
/** Удаление конфигурации: открепить, убрать копию из проекта (если нет дверей с ней) и — администратору — из общего пула.
 *  Возвращает { ok, reason, pool } */
export function deleteDoorCfg(id) {
  const c = allDoorCfgs().get(id);
  if (!c) return { ok: false, reason: 'нет такой' };
  if (c.standard) return { ok: false, reason: 'стандартную удалить нельзя — её можно только открепить' };
  if (currentProject()?.defaultConfigId === id) return { ok: false, reason: 'она назначена конфигурацией по умолчанию для проекта — сначала смените её в настройках проекта' };
  const n = usageOf(id); if (n) return { ok: false, reason: `она стоит на дверях проекта (${n}) — сначала смените им конфигурацию` };
  const p = currentProject(); const repo = getRepo();
  if (pinsOf().includes(id)) unpin(id);
  if (state.ctx.configs.has(id)) repo.remove(p.id, 'configs', id);
  const admin = canDeleteFromPool();
  if (admin && doorPool.has(id)) deleteFromPool(id);
  return { ok: true, pool: admin, stays: !admin && doorPool.has(id) };
}
/** Сколько точек проекта с этой конфигурацией */
export const usageOf = (id) => [...state.ctx.points.values()].filter((p) => p.configId === id).length;
