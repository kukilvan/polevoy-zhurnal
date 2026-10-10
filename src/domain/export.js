// Выгрузка всего проекта в Excel: листы значениями (без формул). Чистая функция — файл собирает приложение.
import { COLUMNS, buildReport } from './report.js';
import { pullFigures, itogShtuk } from './doh.js';

const blank = (v) => v === undefined || v === null || v === '';
const s = (v) => (blank(v) ? '' : v);
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

// Возвращает [{ name, rows: [[…]], widths: [число символов…] }]; первая строка каждого листа — заголовки
export function exportSheets(project, ctx, { nameOf = (u) => s(u) } = {}) {
  const sheets = [];

  // 1. Точки: все столбцы
  const table = { id: 'x', name: 'x', main: false, lang: 'ru', cabinets: [], types: [], statuses: [], layout: 'one', summary: false, columns: COLUMNS.map((c) => c.id) };
  const rep = buildReport(project, ctx, table, { nameOf });
  const sh = rep.sheets[0];
  sheets.push({ name: 'Точки', rows: sh.rows.slice(sh.headerRow), widths: sh.cols.map((c) => Math.round(c.width / 7)) });

  // 2. Журнал по точкам: что и когда сделано на каждой точке
  const jr = [];
  ctx.journalByPoint.forEach((rows, pid) => {
    const p = ctx.points.get(pid); if (!p) return;
    rows.forEach((r) => jr.push({ date: r.date || '', p, r }));
  });
  jr.sort((a, b) => byDate(a, b) || a.r.order - b.r.order);
  sheets.push({
    name: 'Журнал по точкам',
    rows: [['Дата', 'Точка', 'Шкаф', 'Тип', 'Этап', 'Работа', 'Результат', 'Кто внёс', 'Правка без записи'],
      ...jr.map(({ date, p, r }) => [date, p.label, s(p.cabinet), s(p.typeId), s(r.action), s(ctx.catalog.get(r.workId)?.name || r.workId), s(r.result), nameOf(r.by), r.fromEdit ? 'да' : ''])],
    widths: [12, 16, 10, 14, 12, 28, 14, 18, 10],
  });

  // 3. Дни и работы (то, из чего собирается дохот)
  const days = [...ctx.days.values()].sort(byDate);
  const er = [];
  days.forEach((d) => {
    const ents = [...ctx.entries.values()].filter((e) => e.dayId === d.id).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    ents.forEach((e) => {
      const w = ctx.catalog.get(e.workId);
      const pts = (e.pointIds || []).map((id) => ctx.points.get(id)?.label).filter(Boolean);
      const f = e.workType === 'Протяжка' ? pullFigures(e, ctx) : null;
      er.push([d.date, s(d.object), s(d.helper), s(e.workType), s(w?.name), pts.join(', '), pts.length || (blank(e.quantity) ? '' : Number(e.quantity)),
        f ? f.meters : s(e.meters), blank(e.minutes) ? '' : Number(e.minutes), e.workType === 'Текст' ? '' : itogShtuk(e, ctx), s(e.culprit), s(e.result), s(e.note), s(d.comment)]);
    });
    if (!ents.length) er.push([d.date, s(d.object), s(d.helper), '', '', '', '', '', '', '', '', '', '', s(d.comment)]);
  });
  sheets.push({
    name: 'Дни и работы',
    rows: [['Дата', 'Объект', 'Помощник', 'Тип работы', 'Работа', 'Точки', 'Количество', 'Метры', 'Минуты', 'Итог, шт', 'Виновник', 'Результат', 'Приписка', 'Комментарий дня'], ...er],
    widths: [12, 18, 12, 12, 26, 30, 11, 9, 9, 9, 16, 12, 30, 24],
  });

  // 4. Справочники
  const ref = [['Справочник', 'Название', 'Иврит', 'Прочее']];
  ctx.types.forEach((t) => ref.push(['Тип точек', t.id, s(t.nameHe), (t.stages || []).join(' → ')]));
  ctx.cables.forEach((c) => ref.push(['Кабель', c.id, s(c.nameHe), s(c.accounting)]));
  ctx.catalog.forEach((w) => ref.push(['Работа', w.name, s(w.nameHe), [s(w.workType), s(w.unit)].filter(Boolean).join(', ')]));
  ctx.culprits.forEach((c) => ref.push(['Виновник', c.id, s(c.he), '']));
  ctx.delayReasons.forEach((r) => ref.push(['Причина задержки', r.id, s(r.he), '']));
  ctx.configs.forEach((c) => ref.push(['Конфигурация двери', s(c.name), '', (c.components || []).map((id) => ctx.catalog.get(id)?.name || id).join(' + ')]));
  sheets.push({ name: 'Справочники', rows: ref, widths: [20, 30, 30, 40] });
  return sheets;
}

export const exportFileName = (project, date = new Date()) => {
  const d = date.toISOString().slice(0, 10);
  return `${String(project?.name || 'Проект').replace(/[\\/:*?"<>|]/g, '_')} — выгрузка ${d}.xlsx`;
};
