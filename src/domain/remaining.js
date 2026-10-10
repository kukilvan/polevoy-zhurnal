// «Что осталось»: точки, на которых ещё не сделан хивут, установка или проверка (с учётом этапов типа точки).
import { installBinding } from './status.js';
import { pointInfo } from './status.js';
import { comparePoints } from './points.js';

export const REMAIN_STAGES = ['Дотянуть', 'Хивут', 'Установка', 'Проверка'];

// Каких этапов не хватает точке («Дотянуть» — протянута только часть кабелей)
export function missingStages(point, ctx) {
  const type = ctx.types.get(point.typeId);
  const stages = type?.stages;
  const has = (s) => !stages || stages.includes(s);
  const info = pointInfo(point, ctx);
  const out = [];
  // протянуты не все виды кабеля (например, 6005 есть, а cat7 ещё нет)
  if (has('Протяжка') && !info.pulled && info.pullDone) out.push('Дотянуть');
  if (has('Хивут') && !info.hived) out.push('Хивут');
  if (has('Установка') && installBinding(type).mode !== 'none' && info.install !== 'Установлено') out.push('Установка');
  if (has('Проверка') && !info.checked) out.push('Проверка');
  return out;
}

// Группы по шкафам: [{ cabinet, items: [{ point, missing }] }] — только точки, где чего-то не хватает
export function remaining(ctx) {
  const by = new Map();
  [...ctx.points.values()].sort(comparePoints).forEach((point) => {
    const missing = missingStages(point, ctx);
    if (!missing.length) return;
    const key = point.cabinet || '';
    if (!by.has(key)) by.set(key, []);
    by.get(key).push({ point, missing });
  });
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru', { numeric: true }))
    .map(([cabinet, items]) => ({ cabinet, items }));
}

// Точка полностью завершена: сделаны все этапы её типа (протяжка, хивут, установка если нужна, проверка без неисправности, шилют)
export function isFinished(point, ctx) {
  const type = ctx.types.get(point.typeId);
  const stages = type?.stages || ['Протяжка', 'Хивут', 'Установка', 'Проверка', 'Шилют'];
  const info = pointInfo(point, ctx);
  const ok = {
    'Протяжка': !!info.pulled, 'Хивут': !!info.hived, 'Проверка': !!info.checked && info.checkResult !== 'Не работает', 'Шилют': !!info.shilut,
    'Установка': installBinding(type).mode === 'none' || info.install === 'Установлено',
  };
  return stages.every((s) => ok[s] !== false);
}

// Готовность по шкафам: [{ cabinet, done, total }]
export function readinessByCabinet(ctx) {
  const by = new Map();
  [...ctx.points.values()].forEach((p) => {
    const k = p.cabinet || '';
    const r = by.get(k) || { cabinet: k, done: 0, total: 0 };
    r.total += 1; if (isFinished(p, ctx)) r.done += 1; by.set(k, r);
  });
  return [...by.values()].sort((a, b) => a.cabinet.localeCompare(b.cabinet, 'ru', { numeric: true }));
}
