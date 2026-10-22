// «Протяжки»: выбор точек на плане → «до шкафа» → метраж по точкам → чеклист → завершение (запись в доход).
// Запись протяжки: { name, createdAt, drawingId, screen, curId, pointIds, base, meters: {id: своё}, kept: {id: итог из карточки},
//   checked: [id], finished: [id], finishedAt, deleted }

export const PULL_STATUSES = [
  ['Завершена', '#34c759'], ['Завершена частично', '#ffcc00'], ['Есть метраж', '#2f7cf6'],
  ['Частично есть метраж', '#0fa5a0'], ['Точки выбраны', '#ff3b30'], ['Заготовка', '#8e8e93'],
];
export const pullColor = (st) => (PULL_STATUSES.find(([s]) => s === st) || [])[1] || '#8e8e93';

const ids = (pull) => pull?.pointIds || [];
// meters / kept хранятся списком [{id, v}] (словарь в базе при merge не теряет удалённые ключи)
export const pairsToMap = (x) => (Array.isArray(x) ? Object.fromEntries(x.filter((e) => e && e.id != null).map((e) => [e.id, e.v])) : (x || {}));
export const mapToPairs = (m) => Object.entries(m || {}).filter(([, v]) => v != null).map(([id, v]) => ({ id, v }));
const val = (pull, key, id) => { const v = pairsToMap(pull?.[key])[id]; return v == null ? null : v; };
export const isMeasured = (pull, id) => val(pull, 'kept', id) != null || val(pull, 'meters', id) != null;
/** Итоговый метраж точки в протяжке (до шкафа + свой; или оставленный из карточки), иначе null */
export function pullTotal(pull, id) {
  const k = val(pull, 'kept', id); if (k != null) return Number(k);
  const m = val(pull, 'meters', id); if (m == null) return null;
  return (Number(pull.base) || 0) + Number(m);
}
export function pullStatus(pull) {
  const all = ids(pull); const fin = new Set(pull?.finished || []);
  if (fin.size) return all.every((id) => fin.has(id)) ? 'Завершена' : 'Завершена частично';
  if (!all.length) return 'Заготовка';
  const m = all.filter((id) => isMeasured(pull, id)).length;
  if (m === all.length) return 'Есть метраж';
  if (m) return 'Частично есть метраж';
  return 'Точки выбраны';
}
export const canDeletePull = (pull) => pullStatus(pull) !== 'Завершена';

/** Ближайшая к from точка из списка (одна страница чертежа — ближе всего; потом остальные) */
export function nearestPoint(from, list) {
  if (!list.length) return null;
  if (!from?.pos) return list[0];
  const pg = from.pos.page || 0;
  const dist = (p) => ((p.pos?.page || 0) === pg ? 0 : 1e9) + Math.hypot((p.pos?.x || 0) - from.pos.x, (p.pos?.y || 0) - from.pos.y);
  return [...list].sort((a, b) => dist(a) - dist(b))[0];
}
/** Название с датой и временем создания: «Коридор B — 22.10.2026 18:40» */
export function pullTitle(pull) {
  const d = new Date(pull?.createdAt || 0);
  const t = d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
  return `${pull?.name || 'Протяжка'} — ${t}`;
}
