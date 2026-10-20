// Конфигурации дверей (новая схема): тип точки один — «Дверь», разновидность задаётся конфигурацией.
// Конфигурация = состав (устройства с количеством) + кабели двери (вид × количество, отдельно от устройств:
// у двери часто коробка, где 2–3 кабеля расходятся на все устройства). Название собирается само из состава.
// id конфигурации — отпечаток состава: одинаковые двери в разных проектах = одна конфигурация в общем пуле.
// Хранение: общий пул (pool_doorcfg) + копия в проекте (configs) для тех, что используются или закреплены.
// Старые конфигурации ({ name, components: [работы] }) продолжают работать по-старому.

import { DEVICES, CATALOG, CABLES } from './seed.js';

// Части двери: порядок — как в окне выбора и в названии
export const DOOR_PARTS = [
  { key: 'lock', name: 'Запирание', one: true, max: 2, hint: 'только одно на дверь' },
  { key: 'reader', name: 'Считыватель', max: 2 },
  { key: 'button', name: 'Кнопки', max: 1 },
  { key: 'sensor', name: 'Датчики', max: 2 },
  { key: 'extra', name: 'Дополнительно', max: 2 },
];
export const DOOR_PART_NAMES = Object.fromEntries(DOOR_PARTS.map((p) => [p.key, p.name]));

// Роль устройства для правил и коротких названий: по id стандартной библиотеки или по названию
const ROLE_BY_ID = { DV_EMAG: 'em', DV_MANUL: 'mh', DV_KORE: 'kore', DV_BIO: 'bio', DV_LPTIHA: 'ptiha', DV_LNIPUTZ: 'niputz', DV_MAGNIT: 'magnit', DV_INT: 'intercom', DV_KEYB: 'keyb' };
export function doorRole(dev) {
  if (!dev) return '';
  if (dev.doorRole) return dev.doorRole;
  if (ROLE_BY_ID[dev.id]) return ROLE_BY_ID[dev.id];
  const n = String(dev.name || dev.id || '').toLowerCase();
  if (/электро\s*-?\s*магнит|^эм\b/.test(n)) return 'em';
  if (/мануль|электро\s*-?\s*замок|^мх\b/.test(n)) return 'mh';
  if (/биометр/.test(n)) return 'bio';
  if (/коре|считыват/.test(n)) return 'kore';
  if (/птих/.test(n)) return 'ptiha';
  if (/нипуц/.test(n)) return 'niputz';
  if (/магнит/.test(n)) return 'magnit';
  if (/интерком/.test(n)) return 'intercom';
  if (/цофар|сирен/.test(n)) return 'tsofar';
  if (/киборд|клавиат/.test(n)) return 'keyb';
  return '';
}
const PART_BY_ROLE = { em: 'lock', mh: 'lock', kore: 'reader', bio: 'reader', keyb: 'reader', ptiha: 'button', niputz: 'button', magnit: 'sensor', intercom: 'extra', tsofar: 'extra' };
/** Часть двери устройства: своя (поле doorPart в «Устройствах»), по роли или '' (не для двери). 'none' — явно не для двери */
export function doorPartOf(dev) {
  if (!dev) return '';
  if (dev.doorPart === 'none') return '';
  if (dev.doorPart && DOOR_PART_NAMES[dev.doorPart]) return dev.doorPart;
  return PART_BY_ROLE[doorRole(dev)] || '';
}
const SHORT = { em: 'ЭМ', mh: 'МХ', kore: 'коре', bio: 'коре биометри', ptiha: 'птиха', niputz: 'нипуц', magnit: 'магнит', intercom: 'интерком', tsofar: 'цофар', keyb: 'киборд' };
const PLURAL = { магнит: 'магнита' };
export const doorShortOf = (dev) => String(dev?.short || SHORT[doorRole(dev)] || dev?.name || dev?.id || '?').trim();

/** Устройства проекта, которые бывают на двери, по частям: { lock: [dev…], … } */
export function doorDevices(ctx) {
  const out = Object.fromEntries(DOOR_PARTS.map((p) => [p.key, []]));
  [...(ctx.devices?.values() || [])].filter((d) => !d.deleted).forEach((d) => { const k = doorPartOf(d); if (k) out[k].push(d); });
  const ord = ['em', 'mh', 'kore', 'bio', 'keyb', 'ptiha', 'niputz', 'magnit', 'intercom', 'tsofar'];
  Object.values(out).forEach((list) => list.sort((a, b) => ((ord.indexOf(doorRole(a)) + 1 || 99) - (ord.indexOf(doorRole(b)) + 1 || 99)) || String(a.name).localeCompare(String(b.name), 'ru')));
  return out;
}

const clean = (list, key) => (Array.isArray(list) ? list : []).filter((x) => x && x[key] && Number(x.count) > 0).map((x) => ({ [key]: String(x[key]), count: Math.round(Number(x.count)) }));

/**
 * Правила при изменении количества устройства (подсказки — потом всё можно поменять руками).
 * sel: Map deviceId → count. Возвращает новый Map.
 * - запирание только одного вида; с ним магнит индикация (если датчика нет); ЭМ → птиха, нипуц и коре (если считывателя нет)
 * - 2 считывателя → без птихи
 */
export function applyDoorRules(ctx, sel, changedId, count) {
  const out = new Map(sel); const devOf = (id) => ctx.devices.get(id);
  const byRole = (r) => [...ctx.devices.values()].find((d) => !d.deleted && doorPartOf(d) && doorRole(d) === r);
  out.set(changedId, count);
  const dev = devOf(changedId); const part = doorPartOf(dev); const role = doorRole(dev);
  const total = (k) => [...out].filter(([id]) => doorPartOf(devOf(id)) === k).reduce((n, [, c]) => n + c, 0);
  if (part === 'lock' && count > 0) {
    [...out.keys()].forEach((id) => { if (id !== changedId && doorPartOf(devOf(id)) === 'lock') out.set(id, 0); });
    if (!total('sensor')) { const d = byRole('magnit'); if (d) out.set(d.id, 1); }   // магнит индикация — по умолчанию 1
    if (role === 'em') {
      ['ptiha', 'niputz'].forEach((r) => { const d = byRole(r); if (d && !out.get(d.id)) out.set(d.id, 1); });
      if (!total('reader')) { const d = byRole('kore'); if (d) out.set(d.id, 1); }
    }
  }
  if (part === 'reader' && total('reader') >= 2) { const d = byRole('ptiha'); if (d && out.get(d.id)) out.set(d.id, 0); }
  [...out].forEach(([id, c]) => { if (!(c > 0)) out.delete(id); });
  return out;
}

/** Кабели двери по составу (подставляются сами, можно поменять): ЭМ — 6005×2, МХ — 6005×3; биометри и интерком — +cat7; цофар — +6005 */
export function autoDoorCables(ctx, devices) {
  let c6005 = 0; let cat7 = 0; let lock = '';
  clean(devices, 'deviceId').forEach(({ deviceId, count }) => {
    const r = doorRole(ctx.devices.get(deviceId));
    if (r === 'em' || r === 'mh') lock = lock || r;
    if (r === 'bio' || r === 'intercom') cat7 += count;
    if (r === 'tsofar') c6005 += count;
  });
  c6005 += lock === 'mh' ? 3 : 2;
  return [{ cable: '6005', count: c6005 }, { cable: 'cat7', count: cat7 }].filter((x) => x.count > 0);
}

// порядок устройств в конфигурации и названии: по частям, внутри — по роли/названию
function sortDevices(ctx, devices) {
  const parts = doorDevices(ctx); const rank = new Map(); let i = 0;
  DOOR_PARTS.forEach((p) => parts[p.key].forEach((d) => rank.set(d.id, i++)));
  return clean(devices, 'deviceId').sort((a, b) => (rank.get(a.deviceId) ?? 999) - (rank.get(b.deviceId) ?? 999) || a.deviceId.localeCompare(b.deviceId));
}
const CABLE_ORDER = ['6005', 'cat7'];
const sortCables = (cables) => clean(cables, 'cable').sort((a, b) => ((CABLE_ORDER.indexOf(a.cable) + 1 || 99) - (CABLE_ORDER.indexOf(b.cable) + 1 || 99)) || a.cable.localeCompare(b.cable));

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
/** id конфигурации по составу (одинаковый состав → один id) */
export function doorCfgId(devices, cables) {
  const d = clean(devices, 'deviceId').sort((a, b) => a.deviceId.localeCompare(b.deviceId)).map((x) => `${x.deviceId}*${x.count}`).join('+');
  const c = clean(cables, 'cable').sort((a, b) => a.cable.localeCompare(b.cable)).map((x) => `${x.cable}*${x.count}`).join('+');
  return `DC_${hash(`${d}|${c}`)}`;
}
/** Название: «ЭМ · коре · птиха · нипуц · магнит · 6005×2» */
export function doorCfgName(ctx, devices, cables) {
  const parts = sortDevices(ctx, devices).map(({ deviceId, count }) => {
    const s = doorShortOf(ctx.devices.get(deviceId) || { id: deviceId });
    return count > 1 ? `${count} ${PLURAL[s] || s}` : s;
  });
  const cab = sortCables(cables).map((c) => `${c.cable}×${c.count}`).join(' + ');
  return [...parts, cab].filter(Boolean).join(' · ') || 'пустая дверь';
}
/** Коротко для списков и плана: ЭМ / МХ */
export function doorCfgShort(ctx, cfg) {
  if (!isDoorCfg(cfg)) return '';
  const lock = cfg.devices.map((x) => ctx.devices.get(x.deviceId)).find((d) => doorPartOf(d) === 'lock' || ['em', 'mh'].includes(doorRole(d)));
  return lock ? doorShortOf(lock) : '';
}
export const isDoorCfg = (cfg) => !!cfg && Array.isArray(cfg.devices);
/** Конфигурация (полная запись) из состава */
export function makeDoorCfg(ctx, devices, cables) {
  const d = sortDevices(ctx, devices); const c = sortCables(cables);
  return { id: doorCfgId(d, c), name: doorCfgName(ctx, d, c), devices: d, cables: c, kind: 'door' };
}

/** Стандартные: ЭМ (коре, птиха, нипуц, магнит, 6005×2) и МХ (коре, магнит, 6005×3) — из устройств проекта */
export function standardDoorCfgs(ctx) {
  const byRole = (r) => [...ctx.devices.values()].find((d) => !d.deleted && doorPartOf(d) && doorRole(d) === r);
  const pick = (roles) => roles.map(byRole);
  const out = [];
  const em = pick(['em', 'kore', 'ptiha', 'niputz', 'magnit']); const mh = pick(['mh', 'kore', 'magnit']);
  if (em.every(Boolean)) { const devs = em.map((d) => ({ deviceId: d.id, count: 1 })); out.push({ ...makeDoorCfg(ctx, devs, autoDoorCables(ctx, devs)), standard: true }); }
  if (mh.every(Boolean)) { const devs = mh.map((d) => ({ deviceId: d.id, count: 1 })); out.push({ ...makeDoorCfg(ctx, devs, autoDoorCables(ctx, devs)), standard: true }); }
  return out;
}
/** Закреплённые в проекте (порядок важен): project.doorPins или, если не задано, стандартные */
export const doorPinsOf = (project, ctx) => (Array.isArray(project?.doorPins) ? project.doorPins : standardDoorCfgs(ctx).map((c) => c.id));

/** Конфигурация двери точки (новая схема) или null */
export function doorCfgOf(point, ctx) {
  const cfg = point?.configId ? ctx.configs?.get(point.configId) : null;
  return isDoorCfg(cfg) && !cfg.deleted ? cfg : null;
}

/** Стандартные устройства двери из библиотеки, которых нет в проекте (с их работами и кабелями): операции записи */
export function doorLibraryOps(ctx) {
  const ops = []; const has = (coll, id) => ctx[coll].has(id) || ops.some((o) => o.coll === coll && o.id === id);
  const roles = new Set(['em', 'mh', 'kore', 'bio', 'ptiha', 'niputz', 'magnit', 'intercom']);
  const present = new Set([...ctx.devices.values()].filter((d) => !d.deleted).map((d) => doorRole(d)));
  DEVICES.filter((d) => roles.has(doorRole(d)) && !present.has(doorRole(d)) && !ctx.devices.has(d.id)).forEach((d) => {
    d.workIds.forEach((w) => { const x = CATALOG.find((c) => c.id === w); if (x && !has('catalog', w)) ops.push({ coll: 'catalog', id: w, data: x }); });
    d.cables.forEach((c) => { const x = CABLES.find((k) => k.id === c.cable); if (x && !has('cables', x.id)) {
      x.workIds.forEach((w) => { const y = CATALOG.find((k) => k.id === w); if (y && !has('catalog', w)) ops.push({ coll: 'catalog', id: w, data: y }); });
      ops.push({ coll: 'cables', id: x.id, data: x });
    } });
    ops.push({ coll: 'devices', id: d.id, data: d });
  });
  return ops;
}
