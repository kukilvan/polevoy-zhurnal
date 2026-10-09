// Таблица для руководства: данные одного проекта в формате листов шаблона (без длин и метража).
// Названия листов и колонок совпадают с прежним скриптом syncAll(): на них опираются формулы шаблона.
import { sortNumber } from './points.js';
import { installBinding } from './status.js';

export const TITLE_PREFIX = 'סטטוס נקודות – ';
export const HEADERS = {
  'Проекты': ['ID', 'Название', 'Подрядчик', 'Объект', 'Помощник', 'Конфигурация дверей', 'Разовый', 'Активен', 'Примечание', 'Название HE', 'Объект HE', 'Помощник HE'],
  'Точки': ['ID', 'Проект', 'Обозначение', 'По тохниту', 'Шкаф', 'Этаж', 'Тип', 'Кабель', 'Кабелей', 'Длина', 'Метраж', 'Конфигурация', 'Порт', 'Причина задержки', 'Примечание', 'Фото', 'Сорт'],
  'Журнал': ['ID', 'Запись', 'Дата', 'Проект', 'Точка', 'Обозначение', 'Тип точки', 'Шкаф', 'Действие', 'Работа', 'Кабель', 'Кабелей', 'Длина', 'Метраж', 'Результат'],
  'Типы точек': ['Тип', 'Тип HE', 'Кабель', 'Кабелей', 'Этапы', 'Дверь'],
  'Конфигурации': ['ID', 'Название', 'Компоненты'],
};

const s = (v) => (v === undefined || v === null ? '' : String(v).trim());

// Дата ISO → серийный номер Google Sheets (формулы MAXIFS работают с числами)
export function sheetSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(iso));
  if (!m) return '';
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
}

// Название файла: «סטטוס נקודות – <название HE|название> – <подрядчик> – <объект HE|объект>» без повторов
export function managerNames(p) {
  const parts = [s(p.nameHe) || s(p.name), s(p.contractor), s(p.objectHe) || s(p.object)].filter(Boolean);
  const display = parts.filter((x, i) => parts.indexOf(x) === i).join(' – ');
  return { display, title: TITLE_PREFIX + display };
}

export function fileIdOf(p) {
  if (p.managerFileId) return p.managerFileId;
  const m = /\/d\/([\w-]{20,})/.exec(p.managerLink || '');
  return m ? m[1] : '';
}

export function managerTables(project, ctx) {
  const pid = project.id;
  const types = [...ctx.types.values()];
  const configs = [...ctx.configs.values()];
  const points = [...ctx.points.values()].filter((x) => x.projectId === pid);
  const pointById = new Map(points.map((x) => [x.id, x]));

  const tables = {};
  tables['Проекты'] = [[pid, project.name, project.contractor, project.object, project.helper, project.defaultConfigId,
    !!project.oneOff, project.active !== false, project.note, project.nameHe, project.objectHe, project.helperHe].map((v) => v ?? '')];
  tables['Точки'] = points.map((x) => [x.id, pid, x.label, x.planName, x.cabinet, x.floor, x.typeId, '', '', '', '',
    x.configId, x.port, x.delayReasonId, x.note, '', sortNumber(x.label)].map((v) => v ?? ''));
  const jr = [];
  for (const [pointId, rows] of ctx.journalByPoint) {
    const pt = pointById.get(pointId);
    if (!pt) continue;
    for (const r of rows) jr.push([r.id, r.entryId || '', sheetSerial(r.date), pid, pointId, pt.label, pt.typeId, pt.cabinet,
      r.action, r.workId, '', '', '', '', r.result].map((v) => v ?? ''));
  }
  tables['Журнал'] = jr;
  // Этапы типа под привязку установки: без установки — этап «Установка» убираем (шаблон покажет «—»), с установкой — добавляем
  tables['Типы точек'] = types.map((t) => {
    const mode = installBinding(t).mode;
    let stages = (t.stages || []).filter((x) => x !== 'Установка');
    if (mode !== 'none') { const i = stages.indexOf('Проверка'); stages.splice(i >= 0 ? i : stages.length, 0, 'Установка'); }
    return [t.id, t.nameHe, t.defaultCable, t.defaultCables, stages.join(' , '), mode === 'config'].map((v) => v ?? '');
  });
  tables['Конфигурации'] = configs.map((c) => [c.id, c.name, (c.components || []).join(' , ')]);
  return tables;
}

// Хэш данных: если не менялся — файл руководителя не перезаписываем
export function hashOf(obj) {
  const str = JSON.stringify(obj); let h1 = 0xdeadbeef ^ str.length; let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
