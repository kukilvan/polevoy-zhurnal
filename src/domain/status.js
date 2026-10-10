// Статусы точек, установка, комплектность (разделы 3.1–3.3, Приложение А).
import { cableOf, cablesCountOf, metrageOf, cableListOf } from './points.js';
import { defaultInstallBinding } from './seed.js';
import { compositionOf, composedInfo } from './compose.js';

// Привязка установки типа точек: поля типа (installMode/installWorkIds), для старых данных — стандартная привязка по названию типа
export function installBinding(type) {
  if (!type) return { mode: 'any', workIds: [] };
  if (type.installMode) return { mode: type.installMode, workIds: type.installWorkIds || [] };
  return defaultInstallBinding(type.id) || { mode: type.isDoor ? 'config' : 'any', workIds: [] };
}
export const usesConfig = (type) => installBinding(type).mode === 'config';

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
  const shilut = dateOf('Шилют');

  // Результат самой свежей проверки (при равной дате — более поздняя строка)
  const checks = rows.filter((r) => r.action === 'Проверка')
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.order - a.order));
  const checkResult = checks.length ? checks[0].result : undefined;

  const installedIds = [...new Set(rows.filter((r) => r.action === 'Установка').map((r) => r.workId))];
  const type = ctx.types.get(point.typeId);
  const project = ctx.projects.get(point.projectId);
  const config = ctx.configs.get(point.configId || project?.defaultConfigId);

  // Установка по привязке типа: config — набор двери (k/n), works — выбранные работы (k/n), any — любая установка, none — не требуется
  const bind = installBinding(type);
  let install = ''; let installDone = 0; let installTotal = 0;
  const partial = (ids) => {
    installTotal = ids.length; installDone = ids.filter((c) => installedIds.includes(c)).length;
    return installDone === 0 ? '' : installDone >= installTotal ? 'Установлено' : `Установлено ${installDone}/${installTotal}`;
  };
  if (bind.mode === 'config') install = config ? partial(config.components) : (installedIds.length > 0 ? 'Установлено' : '');
  else if (bind.mode === 'works' && bind.workIds.length) install = partial(bind.workIds);
  else install = installedIds.length > 0 ? 'Установлено' : '';

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
