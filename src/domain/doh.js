// Текст «доха» (отчёт за день) на русском и иврите (раздел 3.5, Приложение А).
import { round2 } from './points.js';
import { pointInfo } from './status.js';

// ВНИМАНИЕ: в описании не видно, чем разделены строки работ и дата/объект (в формулах AppSheet они
// склеены через SUBSTITUTE). Разделители вынесены сюда; уточнить по образцу реального доха.
export const DOH_SEP = { dateObject: ' ', lines: '; ' };

const blank = (v) => v === undefined || v === null || v === '';
const num = (v) => (blank(v) ? 0 : Number(v));

export function dateText(iso) { // 'YYYY-MM-DD' → 'ДД.ММ.ГГГГ'
  const [y, m, d] = String(iso).split('-');
  return `${d}.${m}.${y}`;
}

const isTime = (entry, work) => entry.workType === 'Время' || work?.unit === 'мин';
const entryPoints = (entry, ctx) => (entry.pointIds || []).map((id) => ctx.points.get(id)).filter(Boolean);

// «Итог шт»: сколько единиц работы (0 для времени)
export function itogShtuk(entry, ctx) {
  const work = ctx.catalog.get(entry.workId);
  if (isTime(entry, work)) return 0;
  const pts = entryPoints(entry, ctx);
  const base = pts.length ? pts.length : num(entry.quantity);
  return round2(base * (blank(work?.multiplier) ? 1 : Number(work.multiplier)));
}

function pullFigures(entry, ctx) {
  const pts = entryPoints(entry, ctx);
  if (pts.length) {
    return {
      count: round2(pts.reduce((s, p) => s + pointInfo(p, ctx).cables, 0)),
      meters: round2(pts.reduce((s, p) => s + pointInfo(p, ctx).metrage, 0)),
    };
  }
  return { count: num(entry.quantity), meters: num(entry.meters) };
}

const tail = (entry, ctx, he) => ({
  minutes: !blank(entry.minutes) ? (he ? `, ${entry.minutes} דקות` : `, ${entry.minutes} мин`) : '',
  note: !blank(entry.note) ? `. ${entry.note}` : '',
  culprit: !blank(entry.culprit)
    ? ` (${he ? (ctx.culprits.get(entry.culprit)?.he ?? entry.culprit) : entry.culprit})` : '',
});

export function entryLine(entry, ctx, lang = 'ru') {
  const he = lang === 'he';
  const work = ctx.catalog.get(entry.workId);
  const name = he ? work?.nameHe : work?.name;
  const t = tail(entry, ctx, he);
  const unit = ctx.units.get(work?.unit);

  if (isTime(entry, work)) { // «Время» и любые работы в минутах
    return he
      ? `${name} ${entry.minutes ?? ''} דקות${t.culprit}${t.note}`
      : `${name} ${entry.minutes ?? ''} мин${t.culprit}${t.note}`;
  }
  if (entry.workType === 'Протяжка') {
    const cable = ctx.cables.get(entry.cableId);
    const { count, meters } = pullFigures(entry, ctx);
    const meterMode = cable?.accounting === 'Метры';
    if (he) {
      return `השחלת ${cable?.nameHe ?? entry.cableId ?? ''}: ${count}${meterMode ? ` כבלים, ${meters} מטר` : ' נקודות'}${t.minutes}${t.note}`;
    }
    return `Протяжка ${entry.cableId ?? ''}: ${count}${meterMode ? ` каб., ${meters} м` : ' точек'}${t.minutes}${t.note}`;
  }
  const bad = entry.result === 'Не работает' ? (he ? ' (לא תקין)' : ' (не работает)') : '';
  return `${name} ${itogShtuk(entry, ctx)} ${he ? (unit?.he ?? work?.unit) : work?.unit}${bad}${t.minutes}${t.culprit}${t.note}`;
}

const helperIsSelf = (h) => blank(h) || h === 'сам';

// Шапка: «ДД.ММ.ГГГГ Подрядчик Объект сам/с Помощником» (для месячного списка и начала доха)
export function dohHeader(day, ctx, lang = 'ru') {
  const he = lang === 'he';
  const p = ctx.projects.get(day.projectId) || {};
  const where = p.oneOff ? day.object
    : he ? `${p.nameHe || p.name} ${p.objectHe ?? ''}`.trim() : `${p.contractor ?? ''} ${p.object ?? ''}`.trim();
  const helper = he ? (day.helperHe ?? p.helperHe) : (day.helper ?? p.helper);
  const who = helperIsSelf(helper) ? (he ? ' לבד' : ' сам') : (he ? ` עם ${helper}` : ` с ${helper}`);
  return `${dateText(day.date)}${DOH_SEP.dateObject}${where ?? ''}${who}`;
}

export function dayEntries(day, ctx) {
  return [...ctx.entries.values()].filter((e) => e.dayId === day.id)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function doh(day, ctx, lang = 'ru') {
  const lines = dayEntries(day, ctx).map((e) => entryLine(e, ctx, lang)).join(DOH_SEP.lines);
  return `${dohHeader(day, ctx, lang)} ${lines}${blank(day.comment) ? '' : ` ${day.comment}`}`;
}
