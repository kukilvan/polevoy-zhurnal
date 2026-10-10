// «Что осталось»: точки, на которых ещё не сделан хивут, установка или проверка (с учётом этапов типа точки).
import { installBinding } from './status.js';
import { pointInfo } from './status.js';
import { comparePoints } from './points.js';

export const REMAIN_STAGES = ['Хивут', 'Установка', 'Проверка'];

// Каких из трёх этапов не хватает точке
export function missingStages(point, ctx) {
  const type = ctx.types.get(point.typeId);
  const stages = type?.stages;
  const has = (s) => !stages || stages.includes(s);
  const info = pointInfo(point, ctx);
  const out = [];
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
