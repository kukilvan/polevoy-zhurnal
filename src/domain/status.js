// Статусы точек, установка, комплектность (разделы 3.1–3.3, Приложение А).
import { cableOf, cablesCountOf, metrageOf, cableListOf } from './points.js';
import { compositionOf, composedInfo, composedCables as composedCablesOf, doneByPorts, workFits, STAGES } from './compose.js';

// Типы-двери (у них выбирается конфигурация двери): тип «Дверь» и все типы из группы «Дверь»
export const usesConfig = (type) => !!type && (type.id === 'Дверь' || type.group === 'Дверь');

// Кабели точки целиком [{ cable, count }]: свои (cableOverride) или по типу/устройствам/настройке шкафа
export function effectiveCablesOf(point, ctx) {
  return compositionOf(point, ctx) ? composedCablesOf(point, ctx) : cableListOf(point, ctx);
}
// Кабели по умолчанию для типа (как будет у новой точки этого типа в этом шкафу)
export const typeCablesOf = (ctx, typeId, cabinet = '', projectId) => effectiveCablesOf({ typeId, cabinet, projectId }, ctx);
// Что записать в точку: null — как у типа, иначе свой список
export function cableOverrideFor(list, ctx, typeId, cabinet, projectId) {
  const norm = (l) => JSON.stringify((l || []).filter((c) => c.cable && c.count > 0).map((c) => [c.cable, Number(c.count)]));
  return norm(list) === norm(typeCablesOf(ctx, typeId, cabinet, projectId)) ? null : (list || []).filter((c) => c.cable && c.count > 0).map((c) => ({ cable: c.cable, count: Number(c.count) }));
}

const maxDate = (rows) => rows.reduce((m, r) => (r.date && (!m || r.date > m) ? r.date : m), '');

export function pointInfo(point, ctx) {
  const comp = compositionOf(point, ctx);
  if (comp) return composedInfo(point, ctx, comp); // точка из устройств
  const rows = ctx.journalByPoint.get(point.id) || [];
  const dateOf = (action) => maxDate(rows.filter((r) => r.action === action));
  // Протяжка по видам кабеля: точка протянута, когда протянут каждый её вид кабеля.
  // Запись без кабеля (старые данные) засчитывается всем видам; кабель не из списка точки — основному.
  const cableList = cableListOf(point, ctx); const kinds = cableList.map((c) => c.cable);
  const pullRows = rows.filter((r) => r.action === 'Протяжка');
  let pulled = ''; let pullDone = 0; const pullTotal = kinds.length; const pulledKinds = [];
  if (!kinds.length) pulled = maxDate(pullRows);
  else {
    const dates = kinds.map((k, i) => maxDate(pullRows.filter((r) => !r.cableId || r.cableId === k || (i === 0 && !kinds.includes(r.cableId)))));
    dates.forEach((d, i) => { if (d) { pullDone += 1; pulledKinds.push(kinds[i]); } });
    if (pullDone === pullTotal) pulled = dates.reduce((m, d) => (d > m ? d : m), '');
  }
  const hived = dateOf('Хивут');
  const checked = dateOf('Проверка');
  const shRows = rows.filter((r) => r.action === 'Шилют');
  const shilut = shRows.length && doneByPorts({ stage: 'Шилют' }, shRows, cableList) ? maxDate(shRows) : '';

  // Результат самой свежей проверки (при равной дате — более поздняя строка)
  const checks = rows.filter((r) => r.action === 'Проверка')
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.order - a.order));
  const checkResult = checks.length ? checks[0].result : undefined;

  const installedIds = [...new Set(rows.filter((r) => r.action === 'Установка').map((r) => r.workId))];
  const type = ctx.types.get(point.typeId);

  // Установка (старые точки): любая запись «Установка» в журнале
  const install = installedIds.length > 0 ? 'Установлено' : ''; const installDone = installedIds.length; const installTotal = installedIds.length;

  // Статус: первое сработавшее правило сверху вниз
  let status;
  if (checkResult === 'Не работает') status = 'Неисправна';
  else if (checked) status = 'Проверена';
  else if (install === 'Установлено') status = 'Установлена';
  else if (install) status = install;
  else if (hived) status = 'Захивучена';
  else if (pulled) status = 'Протянута';
  else if (pullDone) status = `Протянуто ${pullDone}/${pullTotal}`;
  else if (point.length !== undefined && point.length !== null && point.length !== '') status = 'Посчитана';
  else status = 'Новая';

  // Ивритский статус и «установлено» для таблицы руководителей (раздел 5.1)
  const statusHe = checkResult === 'Не работает' ? 'תקלה' : checked ? 'נבדק' : install === 'Установлено' ? 'הותקן'
    : hived ? 'חווט' : pulled ? 'נמשך' : pullDone ? `נמשך חלקית ${pullDone}/${pullTotal}` : 'טרם נמשך';
  const installHe = install === 'Установлено' ? 'הותקן' : install ? `הותקן חלקית ${installDone}/${installTotal}` : '';

  return {
    pulled, pullDone, pullTotal, pulledKinds, cableList, hived, checked, shilut, checkResult, installedIds, install, installHe, status, statusHe,
    cable: cableOf(point, ctx), cables: cablesCountOf(point, ctx), metrage: metrageOf(point, ctx),
  };
}

/**
 * Ждёт ли точка эту работу: подходит ей по составу/типу И ещё не сделана.
 * Перетяжка и перенос — всегда можно; «Проверка» — повторно, если точка «Не работает»; «Время», «Доп. работа» — без задач.
 * infoFn — функция статуса точки (в приложении — кэшированная infoOf).
 */
export function workApplicable(point, ctx, work, infoFn = pointInfo) {
  if (!work || work.active === false || !workFits(point, ctx, work)) return false;
  if (['Перетяжка', 'Перенос'].includes(work.workType)) return true;
  const info = infoFn(point, ctx);
  if (info.composed) {
    if (!STAGES.includes(work.workType)) return true;   // свободная работа (доп. работа и т.п.) — задач у точки нет
    const mine = info.tasks.filter((t) => (work.workType === 'Протяжка' ? t.stage === 'Протяжка' : t.workId === work.id));
    if (!mine.length) return false;                      // такой работы у этой точки нет в составе
    if (work.workType === 'Проверка' && info.checkResult === 'Не работает') return true;
    return mine.some((t) => !t.done);
  }
  switch (work.workType) {
    case 'Протяжка': return !info.pulled;
    case 'Хивут': return work.id === 'HIV_DEV' || !info.hived;
    case 'Установка': return !info.installedIds.includes(work.id);
    case 'Проверка': return !info.checked || info.checkResult === 'Не работает';
    case 'Шилют': return !info.shilut;
    default: return true;
  }
}
