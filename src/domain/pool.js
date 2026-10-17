// Общий пул (одна база на всех): типы точек, устройства, кабели, работы. Управляет только администратор пула (Иван).
// Проект держит свою копию взятого из пула — изменения пула взятое не меняют (только «удалить и взять заново»).
// Новое и изменённое в проектах приложение само отправляет администратору во «входящие» (pool_inbox).
import { bare, bundleFrom } from './typelib.js';
import { isSystemType } from './pointsimport.js';

export const POOL_ADMIN = 'erudit199867@gmail.com';
export const POOL_KINDS = ['types', 'devices', 'cables', 'catalog'];
export const POOL_TITLES = { types: 'Типы точек', devices: 'Устройства', cables: 'Кабели', catalog: 'Работы' };

const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).filter((k) => v[k] !== undefined && v[k] !== null && k !== 'id').sort().map((k) => `${k}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
/** Отпечаток содержимого (без служебных полей) — для «изменилось ли» */
export function poolHash(item) {
  const s = stable(bare(item)); let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
export const poolMaps = (pool) => Object.fromEntries(POOL_KINDS.map((k) => [k, pool?.[k] instanceof Map ? pool[k] : new Map((pool?.[k] || []).map((x) => [x.id, x]))]));

/** Без чего элемент не работает: { devices, cables, catalog } (копии без служебных полей) */
export function depsOf(maps, kind, id) {
  if (kind === 'types') { const b = bundleFrom(maps, id); return b ? { devices: b.devices, cables: b.cables, catalog: b.catalog } : { devices: [], cables: [], catalog: [] }; }
  const out = { devices: [], cables: [], catalog: [] };
  const addW = (w) => { const x = maps.catalog.get(w); if (x && !out.catalog.some((y) => y.id === w)) out.catalog.push(bare(x)); };
  const addC = (c) => { const x = maps.cables.get(c); if (x && !out.cables.some((y) => y.id === c)) { out.cables.push(bare(x)); (x.workIds || []).forEach(addW); } };
  const item = maps[kind].get(id); if (!item) return out;
  if (kind === 'devices') { (item.cables || []).forEach((c) => addC(c.cable)); (item.workIds || []).forEach(addW); }
  if (kind === 'cables') (item.workIds || []).forEach(addW);
  return out;
}

/** Операции «взять из пула в проект»: элемент и всё, без чего он не работает. Что в проекте уже есть — не трогается. */
export function takeFromPoolOps(ctx, maps, kind, id, ops = []) {
  const has = (coll, x) => ctx[coll].has(x) || ops.some((o) => o.coll === coll && o.id === x);
  const put = (coll, x) => { if (x && !has(coll, x.id)) ops.push({ coll, id: x.id, data: { ...bare(x), deleted: false } }); };
  const d = depsOf(maps, kind, id);
  d.catalog.forEach((x) => put('catalog', x)); d.cables.forEach((x) => put('cables', x)); d.devices.forEach((x) => put('devices', x));
  put(kind, maps[kind].get(id));
  return ops;
}

/** Что из проекта стоит показать администратору: нет в пуле или отличается от пула */
export function inboxCandidates(ctx, maps) {
  const out = [];
  const projMaps = { types: ctx.types, devices: ctx.devices, cables: ctx.cables, catalog: ctx.catalog };
  for (const kind of POOL_KINDS) {
    for (const x of ctx[kind].values()) {
      if (kind === 'types' && isSystemType(x)) continue;
      const hash = poolHash(x); const inPool = maps[kind].get(x.id);
      if (inPool && poolHash(inPool) === hash) continue;
      out.push({ kind, id: x.id, item: bare(x), deps: depsOf(projMaps, kind, x.id), hash, changedFromPool: !!inPool });
    }
  }
  return out;
}

/** Что поменялось в элементе (для «изменён»): список полей */
export function changedFields(a = {}, b = {}) {
  const keys = new Set([...Object.keys(bare(a)), ...Object.keys(bare(b))]); keys.delete('id');
  return [...keys].filter((k) => stable(a[k]) !== stable(b[k]));
}
