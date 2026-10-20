// Точки из устройств (составная модель).
// Кабель (cables) — вид кабеля и работы, которых требует каждый кабель (cat7: хивут кистона, хивут в шкафу, проверка, шилют).
// Устройство (devices) — кабели (0..n видов с количеством) + свои работы (установка авизара и т. п.).
// Тип точки (types) — состав по умолчанию: devices: [{ deviceId, count }] + работы на всю точку (workIds, например проверка двери).
// Точка может иметь свой состав (point.devices). Тип без поля devices работает по старой схеме (status.js).
// Работа в дохе отмечается на точку; entry.deviceIds (если есть) — только для этих устройств, entry.cableId — только этот вид кабеля.

import { doorCfgOf } from './doorcfg.js';

const blank = (v) => v === undefined || v === null || v === '';
const maxDate = (rows) => rows.reduce((m, r) => (r.date && (!m || r.date > m) ? r.date : m), '');
export const STAGES = ['Протяжка', 'Хивут', 'Установка', 'Проверка', 'Шилют'];

export const isComposedType = (type) => Array.isArray(type?.devices) || (Array.isArray(type?.cables) && type.cables.length > 0);
// Состав точки: свой или из типа; null — старая схема
export function compositionOf(point, ctx) {
  const type = ctx.types.get(point.typeId);
  if (Array.isArray(point.devices)) return point.devices;
  const cfg = doorCfgOf(point, ctx); if (cfg) return cfg.devices;   // дверь с конфигурацией: состав из неё
  return isComposedType(type) ? (type.devices || []) : null;
}
const cleanList = (list) => (Array.isArray(list) ? list : [])
  .filter((c) => c && !blank(c.cable) && Number(c.count) > 0).map((c) => ({ cable: String(c.cable), count: Number(c.count) }));
// Кабели самой точки (не устройств): например, дверь, где 4 авизара сидят на одном кабеле. Свои у точки или из типа.
export const POINT_CABLES = '#';
export function pointCablesOf(point, ctx) {
  const type = ctx.types.get(point.typeId);
  return cleanList(Array.isArray(point.cables) ? point.cables : type?.cables);
}
// Устройства точки как список [{ deviceId, count, dev }] + «кабели точки» как устройство '#'
// point.cableOverride: [{ cable, count }] — свои кабели точки целиком (вместо кабелей устройств и типа), например «RJ45 X2» = 2 кабеля
const hasOverride = (point) => Array.isArray(point?.cableOverride);
function partsOf(point, ctx, comp) {
  // у двери с конфигурацией кабели — из конфигурации (на всю дверь), а не от устройств
  const cfgCables = !hasOverride(point) && !Array.isArray(point.devices) ? doorCfgOf(point, ctx)?.cables : null;
  // у точки устройство может быть изменено: свои кабели (cables) и/или работы (workIds) вместо заданных в «Устройствах»
  const parts = (comp || []).map((e) => {
    const base = ctx.devices?.get(e.deviceId);
    const dev = base && { ...base, cables: Array.isArray(e.cables) ? e.cables : base.cables, workIds: Array.isArray(e.workIds) ? e.workIds : base.workIds };
    return { deviceId: e.deviceId, count: Number(e.count) || 0, dev: dev && (hasOverride(point) || cfgCables) ? { ...dev, cables: [] } : dev };
  }).filter((x) => x.dev && x.count > 0);
  const pc = hasOverride(point) ? cleanList(point.cableOverride) : cfgCables ? cleanList(cfgCables) : pointCablesOf(point, ctx);
  if (pc.length) parts.push({ deviceId: POINT_CABLES, count: 1, dev: { name: 'Кабели точки', cables: pc, workIds: [] } });
  return parts;
}
export const partName = (ctx, deviceId) => (deviceId === POINT_CABLES ? 'Кабели точки' : ctx.devices?.get(deviceId)?.name || deviceId);

// Задачи точки: [{ key, stage, deviceId, cable?, workId?, qty }]
export function tasksOf(point, ctx, comp = compositionOf(point, ctx)) {
  const type = ctx.types.get(point.typeId);
  const tasks = [];
  partsOf(point, ctx, comp).forEach(({ deviceId, count: n, dev }) => {
    const workQty = new Map(); // workId → количество (кабельные работы — на каждый кабель)
    const addWork = (w, q) => workQty.set(w, (workQty.get(w) || 0) + q);
    cleanList(dev.cables).forEach((c) => {
      tasks.push({ key: `${deviceId}|pull|${c.cable}`, stage: 'Протяжка', deviceId, cable: c.cable, qty: n * c.count });
      (ctx.cables.get(c.cable)?.workIds || []).forEach((w) => addWork(w, n * c.count));
    });
    // работа устройства, которая уже приходит от его кабеля, — не второй раз (нижний уровень главнее)
    (dev.workIds || []).forEach((w) => { if (!workQty.has(w)) addWork(w, n); });
    workQty.forEach((qty, workId) => {
      const work = ctx.catalog.get(workId); if (!work) return;
      tasks.push({ key: `${deviceId}|${workId}`, stage: work.workType, deviceId, workId, qty });
    });
  });
  const fromParts = new Set(tasks.map((t) => t.workId).filter(Boolean));
  (type?.workIds || []).forEach((workId) => {
    const work = ctx.catalog.get(workId); if (!work || fromParts.has(workId)) return;  // уже есть у устройства/кабеля точки
    tasks.push({ key: `*|${workId}`, stage: work.workType, deviceId: null, workId, qty: 1 });
  });
  return tasks;
}

// Кабели точки по видам: [{ cable, count }]
export function composedCables(point, ctx, comp = compositionOf(point, ctx)) {
  const out = [];
  partsOf(point, ctx, comp).forEach(({ count, dev }) => {
    cleanList(dev.cables).forEach((c) => {
      const q = count * c.count; if (q <= 0) return;
      const x = out.find((o) => o.cable === c.cable);
      if (x) x.count += q; else out.push({ cable: c.cable, count: q });
    });
  });
  return out;
}

const forDevice = (row, deviceId) => !row.deviceIds?.length || deviceId === null || row.deviceIds.includes(deviceId);
// Строки журнала, закрывающие задачу
export function rowsForTask(task, rows, kinds) {
  if (task.stage === 'Протяжка' && task.cable) {
    return rows.filter((r) => r.action === 'Протяжка' && forDevice(r, task.deviceId)
      && (!r.cableId || r.cableId === task.cable || !kinds.includes(r.cableId)));
  }
  return rows.filter((r) => r.workId === task.workId && forDevice(r, task.deviceId));
}

// Сводка составной точки в том же виде, что pointInfo старой схемы (+ tasks, stages)
export function composedInfo(point, ctx, comp) {
  const rows = ctx.journalByPoint.get(point.id) || [];
  const cableList = composedCables(point, ctx, comp);
  const kinds = cableList.map((c) => c.cable);
  const tasks = tasksOf(point, ctx, comp).map((t) => {
    const hit = rowsForTask(t, rows, kinds);
    return { ...t, done: hit.length > 0, date: maxDate(hit) };
  });
  const stage = (s) => {
    const list = tasks.filter((t) => t.stage === s);
    const done = list.filter((t) => t.done).length;
    return { total: list.length, done, date: list.length && done === list.length ? list.reduce((m, t) => (t.date > m ? t.date : m), '') : '' };
  };
  const st = Object.fromEntries(STAGES.map((s) => [s, stage(s)]));
  const stages = STAGES.filter((s) => st[s].total > 0);

  const checks = rows.filter((r) => r.action === 'Проверка')
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.order - a.order));
  const checkResult = checks.length ? checks[0].result : undefined;

  const pulled = st['Протяжка'].date; const hived = st['Хивут'].date; const checked = st['Проверка'].date; const shilut = st['Шилют'].date;
  const ins = st['Установка'];
  const install = !ins.total || !ins.done ? '' : ins.done >= ins.total ? 'Установлено' : `Установлено ${ins.done}/${ins.total}`;
  const pullDone = st['Протяжка'].done; const pullTotal = st['Протяжка'].total;

  let status;
  if (checkResult === 'Не работает') status = 'Неисправна';
  else if (checked) status = 'Проверена';
  else if (install === 'Установлено') status = 'Установлена';
  else if (install) status = install;
  else if (hived) status = 'Захивучена';
  else if (pulled) status = 'Протянута';
  else if (pullDone) status = `Протянуто ${pullDone}/${pullTotal}`;
  else if (!blank(point.length)) status = 'Посчитана';
  else status = 'Новая';
  const statusHe = checkResult === 'Не работает' ? 'תקלה' : checked ? 'נבדק' : install === 'Установлено' ? 'הותקן'
    : hived ? 'חווט' : pulled ? 'נמשך' : pullDone ? `נמשך חלקית ${pullDone}/${pullTotal}` : 'טרם נמשך';
  const installHe = install === 'Установлено' ? 'הותקן' : install ? `הותקן חלקית ${ins.done}/${ins.total}` : '';
  const cables = cableList.reduce((n, c) => n + c.count, 0);
  const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
  return {
    composed: true, tasks, stages, stageStats: st,
    pulled, pullDone, pullTotal, pulledKinds: kinds.filter((k) => tasks.filter((t) => t.cable === k).every((t) => t.done)), cableList,
    hived, checked, shilut, checkResult,
    installedIds: [...new Set(tasks.filter((t) => t.stage === 'Установка' && t.done).map((t) => t.workId))],
    install, installHe, installDone: ins.done, installTotal: ins.total, status, statusHe,
    cable: cableList[0]?.cable, cables, metrage: round2((Number(point.length) || 0) * cables),
  };
}

// Сколько единиц работы даёт запись на точку (для доха): по задачам точки; null — точка старой схемы или задачи нет
export function taskQty(point, ctx, entry) {
  const comp = compositionOf(point, ctx); if (!comp) return null;
  const tasks = tasksOf(point, ctx, comp);
  const fit = (t) => !entry.deviceIds?.length || t.deviceId === null || entry.deviceIds.includes(t.deviceId);
  if (entry.workType === 'Протяжка') {
    return tasks.filter((t) => t.stage === 'Протяжка' && fit(t) && (blank(entry.cableId) || t.cable === entry.cableId)).reduce((n, t) => n + t.qty, 0);
  }
  const list = tasks.filter((t) => t.workId === entry.workId && fit(t));
  return list.length ? list.reduce((n, t) => n + t.qty, 0) : null;
}

// Устройства точки, к которым относится работа (для галочек в дохе): [{ deviceId, name }]
export function devicesForWork(points, ctx, workId, workType) {
  const seen = new Map();
  points.forEach((p) => {
    const comp = compositionOf(p, ctx); if (!comp) return;
    tasksOf(p, ctx, comp).forEach((t) => {
      if (!t.deviceId) return;
      const ok = workType === 'Протяжка' ? t.stage === 'Протяжка' : t.workId === workId;
      if (ok && !seen.has(t.deviceId)) seen.set(t.deviceId, partName(ctx, t.deviceId));
    });
  });
  return [...seen.entries()].map(([deviceId, name]) => ({ deviceId, name }));
}

// Чего не хватает составной точке: [{ stage, items: [название устройства или работы] }]
export function missingDetails(info, ctx) {
  const by = new Map();
  info.tasks.filter((t) => !t.done).forEach((t) => {
    const dev = t.deviceId ? partName(ctx, t.deviceId) : '';
    const work = t.workId ? ctx.catalog.get(t.workId)?.name || t.workId : '';
    const label = t.stage === 'Протяжка' ? `${dev} (${t.cable})` : t.stage === 'Установка' ? dev || work : [work, dev].filter(Boolean).join(' — ');
    if (!by.has(t.stage)) by.set(t.stage, []);
    by.get(t.stage).push(label);
  });
  const ord = (x) => { const i = STAGES.indexOf(x); return i < 0 ? 99 : i; };
  return [...by.entries()].sort((a, b) => ord(a[0]) - ord(b[0])).map(([stage, items]) => ({ stage, items }));
}

// ---------- работа с дохом ----------
const PULL_LIKE = ['Протяжка', 'Перетяжка', 'Перенос'];
const ALL_STD = ['Камера', 'Дверь', 'Галай', 'Вайфай', 'Бакар', 'Точка', 'TV', 'Оптика', 'Другое'];
// Подходит ли работа точке: старая схема — по «Для каких типов точек»; из устройств — если работа есть в её задачах
export function workFits(point, ctx, work) {
  if (!work) return false;
  const comp = compositionOf(point, ctx);
  if (!comp) return (work.forTypes || []).includes(point.typeId);
  // протяжка — любая точка из устройств; перетяжка/перенос — если отмечен этот тип или работа отмечена для всех стандартных типов
  if (work.workType === 'Протяжка') return (work.forTypes || []).length > 0;
  if (PULL_LIKE.includes(work.workType)) return (work.forTypes || []).includes(point.typeId) || ALL_STD.every((t) => (work.forTypes || []).includes(t));
  return (work.forTypes || []).includes(point.typeId) || tasksOf(point, ctx, comp).some((t) => t.workId === work.id);
}
// Работа выбирается по точкам (а не количеством)
export function workUsesPoints(work, ctx) {
  if (!work) return false;
  if ((work.forTypes || []).length) return true;
  return [...ctx.points.values()].some((p) => compositionOf(p, ctx) && workFits(p, ctx, work));
}
// Несделанные задачи точки по работе (с учётом галочек устройств); null — точка старой схемы
export function openTasksFor(point, ctx, work, deviceIds) {
  const comp = compositionOf(point, ctx); if (!comp) return null;
  return composedInfo(point, ctx, comp).tasks.filter((t) => !t.done
    && (work.workType === 'Протяжка' ? t.stage === 'Протяжка' : t.workId === work.id)
    && (!deviceIds?.length || t.deviceId === null || deviceIds.includes(t.deviceId)));
}
// Протяжка по точкам: по записи на каждый вид кабеля, только то, что ещё не протянуто.
// mainCable(point) — кабель точки старой схемы. → { groups: [[cableId, pointIds]], done: [метки уже протянутых] }
export function pullGroups(points, ctx, deviceIds, mainCable) {
  const m = new Map(); const done = [];
  const add = (cable, id) => { const k = cable || ''; if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(id)) m.get(k).push(id); };
  points.forEach((p) => {
    const open = openTasksFor(p, ctx, { workType: 'Протяжка' }, deviceIds);
    if (open === null) { add(mainCable(p), p.id); return; }
    if (!open.length) { done.push(p.label); return; }
    open.forEach((t) => add(t.cable, p.id));
  });
  return { groups: [...m.entries()].map(([c, ids]) => [c || undefined, ids]), done };
}

// ---------- перевод типов проекта на устройства ----------
// typeDevices: { тип: [[deviceId, count]] }, typeWorks: { тип: [workId] }, library: { ops, devices, cables, catalog } — что будет добавлено.
// Задним числом: если у точки есть проверка, а шилют по новой схеме не отмечен — шилют с датой проверки (по просьбе Ивана).
export function migrationOps(ctx, { typeDevices, typeWorks, libraryOps }) {
  const ops = [...libraryOps];
  const added = (coll) => new Map(ops.filter((o) => o.coll === coll).map((o) => [o.id, { ...(ctx[coll].get(o.id) || {}), ...o.data, id: o.id }]));
  const merge = (coll) => { const m = new Map(ctx[coll]); added(coll).forEach((v, k) => m.set(k, v)); return m; };
  const types = merge('types'); const converted = [];
  const ctx2pre = { devices: merge('devices'), catalog: merge('catalog') };
  [...types.values()].forEach((t) => {
    if (isComposedType(t) || !typeDevices[t.id]) return;
    const devs = typeDevices[t.id].filter(([deviceId]) => ctx2pre.devices.has(deviceId)).map(([deviceId, count = 1]) => ({ deviceId, count }));
    const data = { devices: devs, cables: [], workIds: (typeWorks[t.id] || []).filter((w) => ctx2pre.catalog.has(w)) };
    types.set(t.id, { ...t, ...data }); converted.push(t.id);
    ops.push({ coll: 'types', id: t.id, data });
  });
  const ctx2 = { ...ctx, types, devices: merge('devices'), cables: merge('cables'), catalog: merge('catalog') };
  let backfilled = 0;
  [...ctx.points.values()].filter((p) => converted.includes(p.typeId) && !Array.isArray(p.devices)).forEach((p) => {
    const rows = ctx.journalByPoint.get(p.id) || [];
    const checkDate = maxDate(rows.filter((r) => r.action === 'Проверка'));
    if (!checkDate) return;
    const info = composedInfo(p, ctx2, compositionOf(p, ctx2));
    [...new Set(info.tasks.filter((t) => !t.done && t.stage === 'Шилют').map((t) => t.workId))].forEach((w) => {
      ops.push({ coll: 'journal', id: `edit_${p.id}_${w}`, data: { pointId: p.id, editDate: checkDate, editWorkId: w, entryId: null, deleted: false } });
      backfilled += 1;
    });
  });
  return { ops, converted, backfilled };
}

// ---------- проверка справочников на противоречия ----------
// → [{ level: 'error' | 'warn' | 'info', text }]
export function auditRefs(ctx) {
  const out = []; const W = (id) => ctx.catalog.get(id)?.name || id;
  const err = (text) => out.push({ level: 'error', text }); const warn = (text) => out.push({ level: 'warn', text }); const info = (text) => out.push({ level: 'info', text });
  ctx.cables.forEach((c) => (c.workIds || []).forEach((w) => { if (!ctx.catalog.has(w)) err(`Кабель ${c.id}: работы «${w}» нет в каталоге`); }));
  ctx.devices.forEach((d) => {
    (d.workIds || []).forEach((w) => { if (!ctx.catalog.has(w)) err(`Устройство «${d.name}»: работы «${w}» нет в каталоге`); });
    (d.cables || []).forEach((c) => { if (!ctx.cables.has(c.cable)) err(`Устройство «${d.name}»: кабеля «${c.cable}» нет в «Кабелях»`); });
  });
  const usedDev = new Set(); const usedWork = new Set();
  ctx.cables.forEach((c) => (c.workIds || []).forEach((w) => usedWork.add(w)));
  ctx.devices.forEach((d) => (d.workIds || []).forEach((w) => usedWork.add(w)));
  ctx.types.forEach((t) => {
    if (!isComposedType(t)) { warn(`Тип «${t.id}» — старая схема (ещё не переведён на устройства)`); (t.installWorkIds || []).forEach((w) => usedWork.add(w)); return; }
    (t.devices || []).forEach((x) => { usedDev.add(x.deviceId); if (!ctx.devices.has(x.deviceId)) err(`Тип «${t.id}»: устройства «${x.deviceId}» нет`); });
    (t.cables || []).forEach((c) => { if (!ctx.cables.has(c.cable)) err(`Тип «${t.id}»: кабеля «${c.cable}» нет`); });
    (t.workIds || []).forEach((w) => { usedWork.add(w); if (!ctx.catalog.has(w)) err(`Тип «${t.id}»: работы «${w}» нет в каталоге`); });
    if (!(t.devices || []).length && !(t.cables || []).length) warn(`Тип «${t.id}»: состав пуст`);
  });
  ctx.points.forEach((p) => (Array.isArray(p.devices) ? p.devices : []).forEach((x) => {
    usedDev.add(x.deviceId);
    if (!ctx.devices.has(x.deviceId)) err(`Точка ${p.label}: устройства «${x.deviceId}» нет`);
    (x.workIds || []).forEach((w) => { usedWork.add(w); if (!ctx.catalog.has(w)) err(`Точка ${p.label}: работы «${w}» нет в каталоге`); });
  }));
  ctx.points.forEach((p) => { if (!ctx.types.has(p.typeId)) err(`Точка ${p.label}: типа «${p.typeId}» нет`); });
  ctx.devices.forEach((d) => { if (!usedDev.has(d.id)) info(`Устройство «${d.name}» не входит ни в один тип и ни в одну точку`); });
  ctx.catalog.forEach((w) => {
    if (['Хивут', 'Установка', 'Проверка', 'Шилют'].includes(w.workType) && w.active !== false && !usedWork.has(w.id)) info(`Работа «${W(w.id)}» (${w.workType}) не требуется ни одним кабелем, устройством или типом`);
  });
  return out;
}

// Работы, которые уже приходят с нижнего уровня (для серых галочек и для очистки повторов): Map workId → откуда
export function inheritedFromCables(ctx, cables = []) {
  const out = new Map();
  (cables || []).forEach((c) => (ctx.cables.get(c.cable)?.workIds || []).forEach((w) => { if (!out.has(w)) out.set(w, `кабель «${c.cable}»`); }));
  return out;
}
export function inheritedOfType(ctx, devices = [], cables = []) {
  const out = new Map();
  (devices || []).forEach((d) => {
    const dev = ctx.devices.get(d.deviceId); if (!dev) return;
    (dev.workIds || []).forEach((w) => { if (!out.has(w)) out.set(w, `устройство «${dev.name}»`); });
    inheritedFromCables(ctx, dev.cables).forEach((v, w) => { if (!out.has(w)) out.set(w, `${v} устройства «${dev.name}»`); });
  });
  inheritedFromCables(ctx, cables).forEach((v, w) => { if (!out.has(w)) out.set(w, `${v} точки`); });
  return out;
}
// Повторы в справочниках и точках: [{ coll, id, name, workId, from }] + ops (убрать лишнюю копию на верхнем уровне)
export function duplicateWorks(ctx) {
  const found = []; const ops = [];
  const w = (id) => ctx.catalog.get(id)?.name || id;
  ctx.devices.forEach((d) => {
    const inh = inheritedFromCables(ctx, d.cables); const dup = (d.workIds || []).filter((x) => inh.has(x));
    if (dup.length) { dup.forEach((x) => found.push({ what: `Устройство «${d.name}»`, work: w(x), from: inh.get(x) })); ops.push({ coll: 'devices', id: d.id, data: { workIds: d.workIds.filter((x) => !inh.has(x)) } }); }
  });
  ctx.types.forEach((t) => {
    if (!Array.isArray(t.devices)) return;
    const inh = inheritedOfType(ctx, t.devices, t.cables); const dup = (t.workIds || []).filter((x) => inh.has(x));
    if (dup.length) { dup.forEach((x) => found.push({ what: `Тип «${t.id}»`, work: w(x), from: inh.get(x) })); ops.push({ coll: 'types', id: t.id, data: { workIds: t.workIds.filter((x) => !inh.has(x)) } }); }
  });
  ctx.points.forEach((p) => {
    if (!Array.isArray(p.devices)) return; let changed = false;
    const devices = p.devices.map((e) => {
      if (!Array.isArray(e.workIds)) return e;
      const base = ctx.devices.get(e.deviceId) || {}; const inh = inheritedFromCables(ctx, Array.isArray(e.cables) ? e.cables : base.cables);
      const dup = e.workIds.filter((x) => inh.has(x)); if (!dup.length) return e;
      changed = true; dup.forEach((x) => found.push({ what: `Точка ${p.label}, устройство «${base.name || e.deviceId}»`, work: w(x), from: inh.get(x) }));
      return { ...e, workIds: e.workIds.filter((x) => !inh.has(x)) };
    });
    if (changed) ops.push({ coll: 'points', id: p.id, data: { devices } });
  });
  return { found, ops };
}
