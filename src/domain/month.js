// Месячный отчёт: сумма всех дохов месяца (RU) и «דוח חודשי» на иврите (раздел 5.2 ТЗ).
import { round2 } from './points.js';
import { doh, dohHeader, dayEntries, itogShtuk, pullFigures } from './doh.js';

export const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const blank = (v) => v === undefined || v === null || v === '';

// ym = 'YYYY-MM'
export function monthDays(ctx, ym) {
  return [...ctx.days.values()].filter((d) => String(d.date).startsWith(ym))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt ?? 0) - (b.createdAt ?? 0)));
}
export const monthTitle = (ym, lang = 'ru') => {
  const [y, m] = ym.split('-').map(Number);
  return `${(lang === 'he' ? MONTHS_HE : MONTHS_RU)[m - 1]} ${y}`;
};

// «Дохот» + все дохи месяца подряд (как файл Дохот.txt для начальника)
export function monthReportRu(ctx, ym) {
  const days = monthDays(ctx, ym);
  return ['Дохот', ...days.map((d) => doh(d, ctx, 'ru'))].join('\n\n\n');
}
export const monthHeaders = (ctx, ym, lang = 'ru') => monthDays(ctx, ym).map((d) => dohHeader(d, ctx, lang)).join('\n');

export function monthSummary(ctx, ym) {
  const days = monthDays(ctx, ym);
  let minutes = 0;
  const works = new Map(); const pulls = new Map();
  days.forEach((d) => dayEntries(d, ctx).forEach((e) => {
    if (!blank(e.minutes)) minutes += Number(e.minutes);
    if (e.workType === 'Текст') return;
    const w = ctx.catalog.get(e.workId);
    if (e.workType === 'Протяжка') {
      const f = pullFigures(e, ctx); const key = e.cableId || '—';
      const r = pulls.get(key) || { cableId: key, nameHe: ctx.cables.get(key)?.nameHe ?? key, accounting: ctx.cables.get(key)?.accounting, count: 0, meters: 0 };
      r.count = round2(r.count + f.count); r.meters = round2(r.meters + f.meters); pulls.set(key, r);
      return;
    }
    if (e.workType === 'Время' || w?.unit === 'мин') return;
    const r = works.get(e.workId) || { id: e.workId, name: w?.name ?? e.workId, nameHe: w?.nameHe ?? e.workId, unit: w?.unit, unitHe: ctx.units.get(w?.unit)?.he ?? w?.unit, qty: 0 };
    r.qty = round2(r.qty + itogShtuk(e, ctx)); works.set(e.workId, r);
  }));
  return { days: days.length, minutes, hours: round2(minutes / 60), works: [...works.values()], pulls: [...pulls.values()] };
}

// Месячный отчёт на иврите: часы, список дней (дох HE), количества, протяжка по кабелям
export function monthReportHe(ctx, ym) {
  const s = monthSummary(ctx, ym); const days = monthDays(ctx, ym);
  const lines = [`דוח חודשי – ${monthTitle(ym, 'he')}`, `סה"כ שעות: ${s.hours}`, '', ...days.flatMap((d) => [doh(d, ctx, 'he'), ''])];
  if (s.works.length) lines.push('כמויות:', ...s.works.map((w) => `${w.nameHe}: ${w.qty} ${w.unitHe ?? ''}`.trim()), '');
  if (s.pulls.length) lines.push('השחלות:', ...s.pulls.map((p) => (p.accounting === 'Метры' ? `${p.nameHe}: ${p.count} כבלים, ${p.meters} מטר` : `${p.nameHe}: ${p.count} נקודות`)));
  return lines.join('\n').trim();
}
