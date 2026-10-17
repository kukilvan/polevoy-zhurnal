// План (чертёж) — общая часть для приложения и сервера: цвет по статусу, точки чертежа для «PDF с номерами», отпечаток для «изменилось ли».
import { pointInfo } from './status.js';

// Цвет по статусу: померяно — синий, протянуто — жёлтый, дальше от жёлтого к зелёному: установлено не всё → установлено → проверено; проблема — красный
export const STATUS_COLORS = [['#9e9e9e', 'новая'], ['#2979ff', 'померяно'], ['#ffb300', 'протянуто частично'], ['#ffd600', 'протянуто'], ['#e4e000', 'захивучено'],
  ['#b5d800', 'установлено не всё'], ['#6ccf00', 'установлено'], ['#00c853', 'проверено'], ['#ff1744', 'проблема']];
const C = Object.fromEntries(STATUS_COLORS.map(([c, t]) => [t, c]));
export const statusColor = (st = '') => (st === 'Неисправна' ? C['проблема'] : st === 'Проверена' ? C['проверено'] : st === 'Установлена' ? C['установлено']
  : st.startsWith('Установлено') ? C['установлено не всё'] : st === 'Захивучена' ? C['захивучено'] : st === 'Протянута' ? C['протянуто']
  : st.startsWith('Протянуто') ? C['протянуто частично'] : st === 'Посчитана' ? C['померяно'] : C['новая']);

export const onDrawing = (p, d) => !!p.pos && !p.deleted && (p.pos.sheet === d.name || (d.aliases || []).includes(p.pos.sheet));

/** Точки чертежа для PDF: [{ label, typeId, pos, color }] */
export function numberedInput(points, ctx, d) {
  return [...points].filter((p) => onDrawing(p, d)).map((p) => ({ label: p.label, typeId: p.typeId, pos: p.pos, color: statusColor(pointInfo(p, ctx).status) }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}
// Отпечаток содержимого «PDF с номерами»: поменялись точки, статусы, скрытое или значки — будет другой
export function numberedHash(input, d, icons = {}) {
  const s = JSON.stringify([input.map((x) => [x.label, x.typeId, Math.round(x.pos.x), Math.round(x.pos.y), x.pos.page || 0, x.pos.icon ? 1 : 0, x.color]),
    (d.hidden || []).map((m) => [Math.round(m.pos.x), Math.round(m.pos.y)]), d.title || d.name, Object.keys(icons).sort().map((k) => [k, (icons[k].png || '').length])]);
  let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
