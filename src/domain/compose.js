// Точки из устройств (составная модель).
// Кабель (cables) — вид кабеля и работы, которых требует каждый кабель (cat7: хивут кистона, хивут в шкафу, проверка, шилют).
// Устройство (devices) — кабели (0..n видов с количеством) + свои работы (установка авизара и т. п.).
// Тип точки (types) — состав по умолчанию: devices: [{ deviceId, count }] + работы на всю точку (workIds, например проверка двери).
// Точка может иметь свой состав (point.devices). Тип без поля devices работает по старой схеме (status.js).
// Работа в дохе отмечается на точку; entry.deviceIds (если есть) — только для этих устройств, entry.cableId — только этот вид кабеля.

const blank = (v) => v === undefined || v === null || v === '';
const maxDate = (rows) => rows.reduce((m, r) => (r.date && (!m || r.date > m) ? r.date : m), '');
export const STAGES = ['Протяжка', 'Хивут', 'Установка', 'Проверка', 'Шилют'];

export const isComposedType = (type) => Array.isArray(type?.devices) || (Array.isArray(type?.cables) && type.cables.length > 0);
// Состав точки: свой или из типа; null — старая схема
export function compositionOf(point, ctx) {
  const type = ctx.types.get(point.typeId);
  if (Array.isArray(point.devices)) return point.devices;
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
function partsOf(point, ctx, comp) {
  const parts = (comp || []).map(({ deviceId, count }) => ({ deviceId, count: Number(count) || 0, dev: ctx.devices?.get(deviceId) }))
    .filter((x) => x.dev && x.count > 0);
  const pc = pointCablesOf(point, ctx);
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
    (dev.workIds || []).forEach((w) => addWork(w, n));
    workQty.forEach((qty, workId) => {
      const work = ctx.catalog.get(workId); if (!work) return;
      tasks.push({ key: `${deviceId}|${workId}`, stage: work.workType, deviceId, workId, qty });
    });
  });
  (type?.workIds || []).forEach((workId) => {
    const work = ctx.catalog.get(workId); if (!work) return;
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
