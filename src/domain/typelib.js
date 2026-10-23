// Общий пул типов точек: стандартные типы + «мой пул» (типы, сохранённые из любого проекта; хранится в личных настройках).
// Тип переносится в проект вместе со всем, без чего он не работает: устройствами, кабелями и работами каталога.
import { POINT_TYPES, DEVICES, CABLES, CATALOG, composedTypes } from './seed.js';

const META = ['createdAt', 'createdBy', 'createdByName', 'updatedAt', 'updatedBy', 'updatedByName', 'projectId', 'deleted',
  'deletedAt', 'deletedBy', 'deletedByName', 'updatedAtServer', '_pending'];
export const bare = (x) => { const c = { ...x }; META.forEach((k) => delete c[k]); return JSON.parse(JSON.stringify(c)); };

// Комплект типа: { type, devices, cables, catalog } — из справочников (Map'ов) проекта или библиотеки
export function bundleFrom(maps, typeId) {
  const type = maps.types.get(typeId);
  if (!type || type.system || typeId === 'Не разобрано') return null;  // служебный тип — не в пул
  const devices = []; const cables = []; const catalog = [];
  const addC = (id) => { const c = maps.cables.get(id); if (c && !cables.some((x) => x.id === id)) { cables.push(bare(c)); (c.workIds || []).forEach(addW); } };
  const addW = (id) => { const w = maps.catalog.get(id); if (w && !catalog.some((x) => x.id === id)) catalog.push(bare(w)); };
  (type.devices || []).forEach((d) => {
    const dv = maps.devices.get(d.deviceId);
    if (dv && !devices.some((x) => x.id === dv.id)) { devices.push(bare(dv)); (dv.cables || []).forEach((c) => addC(c.cable)); (dv.workIds || []).forEach(addW); }
  });
  (type.cables || []).forEach((c) => addC(c.cable));
  if (type.defaultCable) addC(type.defaultCable);
  (type.workIds || []).forEach(addW);
  return { type: bare(type), devices, cables, catalog };
}

const toMaps = (lists) => Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, new Map(v.map((x) => [x.id, x]))]));
export function standardBundles() {
  const maps = toMaps({ types: composedTypes(POINT_TYPES), devices: DEVICES, cables: CABLES, catalog: CATALOG });
  return [...maps.types.keys()].map((id) => ({ ...bundleFrom(maps, id), source: 'standard' }));
}

// Пул: стандартные + мой пул (одноимённый тип из моего пула заменяет стандартный)
export function typePool(userLib = []) {
  const m = new Map(standardBundles().map((b) => [b.type.id, b]));
  (userLib || []).forEach((b) => { if (b?.type?.id) m.set(b.type.id, { ...b, source: 'mine' }); });
  return m;
}

// Мой пул после сохранения типов проекта (одноимённые заменяются)
export function libWith(userLib, bundles) {
  const m = new Map((userLib || []).map((b) => [b.type.id, b]));
  bundles.filter(Boolean).forEach((b) => { const { source, ...rest } = b; m.set(b.type.id, rest); });
  return [...m.values()].sort((a, b) => a.type.id.localeCompare(b.type.id, 'ru'));
}

// Операции: добавить тип из пула в проект. Чего в проекте нет (или удалено) — добавляется; что есть — не трогается.
export function addBundleOps(ctx, bundle, ops = []) {
  const has = (coll, id) => ctx[coll].has(id) || ops.some((o) => o.coll === coll && o.id === id);
  const put = (coll, x) => { if (!has(coll, x.id)) ops.push({ coll, id: x.id, data: { ...x } }); };
  (bundle.catalog || []).forEach((w) => put('catalog', w));
  (bundle.cables || []).forEach((c) => put('cables', c));
  (bundle.devices || []).forEach((d) => put('devices', d));
  put('types', bundle.type);
  return ops;
}
