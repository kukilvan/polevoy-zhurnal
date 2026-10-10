// Таблицы для руководства: профили (что показывать) и сборка листов значениями, без формул.
// Профиль: { id, name, main, lang: 'he'|'ru', cabinets: [], types: [], statuses: [], columns: [id…], layout: 'one'|'perCabinet', summary }
// Пустой список шкафов/типов/статусов = «все».
import { comparePoints, cableOf, cablesCountOf, metrageOf } from './points.js';
import { pointInfo, installBinding } from './status.js';
import { sheetSerial, hashOf, TITLE_PREFIX } from './managers.js';

export const NO_CABINET = '__none';

// kind: text | num | status | stage (дата этапа). stage — название этапа типа точки; он может отсутствовать у типа («—»)
export const COLUMNS = [
  { id: 'label', ru: 'Обозначение', he: 'נקודה', w: 140 },
  { id: 'planName', ru: 'Имя в плане', he: 'שם בתוכנית', w: 150 },
  { id: 'cabinet', ru: 'Шкаф', he: 'ארון', w: 90 },
  { id: 'floor', ru: 'Этаж', he: 'קומה', w: 70 },
  { id: 'type', ru: 'Тип', he: 'סוג', w: 120 },
  { id: 'cable', ru: 'Кабель', he: 'כבל', w: 110 },
  { id: 'cables', ru: 'Кабелей', he: "מס' כבלים", w: 85, kind: 'num' },
  { id: 'length', ru: 'Длина (орэх), м', he: "אורך (מ')", w: 100, kind: 'num' },
  { id: 'port', ru: 'Порт', he: 'פורט', w: 80 },
  { id: 'serial', ru: 'Серийный номер', he: "מס' סידורי", w: 170 },
  { id: 'mac', ru: 'MAC', he: 'MAC', w: 150 },
  { id: 'config', ru: 'Конфигурация двери', he: 'תצורת דלת', w: 220 },
  { id: 'delay', ru: 'Причина задержки', he: 'סיבת עיכוב', w: 150 },
  { id: 'note', ru: 'Примечание', he: 'הערה', w: 220 },
  { id: 'status', ru: 'Статус', he: 'סטטוס', w: 135, kind: 'status' },
  { id: 'pulled', ru: 'Протянуто', he: 'הושחל', w: 105, kind: 'stage', stage: 'Протяжка' },
  { id: 'hived', ru: 'Захивучено', he: 'חווט', w: 105, kind: 'stage', stage: 'Хивут' },
  { id: 'installed', ru: 'Установлено', he: 'הותקן', w: 150, kind: 'stage', stage: 'Установка' },
  { id: 'checked', ru: 'Проверено', he: 'נבדק', w: 105, kind: 'stage', stage: 'Проверка' },
  { id: 'checkResult', ru: 'Результат проверки', he: 'תוצאת בדיקה', w: 135 },
  { id: 'shilut', ru: 'Шилют', he: 'שילוט', w: 105, kind: 'stage', stage: 'Шилют' },
  { id: 'lastBy', ru: 'Внёс последним', he: 'עודכן ע״י', w: 140 },
];
const colById = new Map(COLUMNS.map((c) => [c.id, c]));

// Статусы точки (для фильтра) и их подписи в таблице. Иврит прежний (его видели руководители), новые подписи — на проверку.
export const STATUS_KEYS = ['Новая', 'Посчитана', 'Протянута', 'Захивучена', 'Частично установлена', 'Установлена', 'Проверена', 'Неисправна'];
const STATUS_HE = { 'Новая': 'טרם נמשך', 'Посчитана': 'טרם נמשך', 'Протянута': 'נמשך', 'Захивучена': 'חווט', 'Установлена': 'הותקן', 'Проверена': 'נבדק', 'Неисправна': 'תקלה' };
export const statusKeyOf = (info) => (info.status.startsWith('Установлено ') ? 'Частично установлена' : info.status);

const T = {
  title: { ru: 'Статус выполнения точек', he: 'סטטוס התקדמות נקודות' },
  project: { ru: 'Проект', he: 'פרויקט' },
  noCabinet: { ru: 'Без шкафа', he: 'ללא ארון' },
  partial: { ru: 'частично', he: 'הותקן חלקית' },
  ok: { ru: 'Работает', he: 'תקין' },
  bad: { ru: 'Не работает', he: 'לא תקין' },
  sum: {
    total: { ru: 'Всего точек', he: 'סה״כ נקודות' }, pulled: { ru: 'Протянуто', he: 'הושחל' }, hived: { ru: 'Захивучено', he: 'חווט' },
    installed: { ru: 'Установлено', he: 'הותקן' }, partial: { ru: 'Установлено частично', he: 'הותקן חלקית' }, checked: { ru: 'Проверено', he: 'נבדק' },
    faulty: { ru: 'Неисправно', he: 'תקלות' },
  },
};

// ---------- профили ----------
export const defaultTables = () => [
  { id: 't_main', name: 'Для руководства', main: true, lang: 'he', cabinets: [], types: [], statuses: [], layout: 'one', summary: true,
    columns: ['label', 'planName', 'type', 'cabinet', 'floor', 'cable', 'pulled', 'hived', 'installed', 'checked'] },
  { id: 't_ext', name: 'Расширенная', main: false, lang: 'ru', cabinets: [], types: [], statuses: [], layout: 'one', summary: true,
    columns: ['label', 'planName', 'cabinet', 'floor', 'type', 'cable', 'cables', 'length', 'port', 'config', 'delay', 'status',
      'pulled', 'hived', 'installed', 'checked', 'checkResult', 'shilut', 'lastBy', 'note'] },
];
// Старый столбец «метраж» слит со столбцом «длина»: в сохранённых профилях заменяем и убираем дубли
const fixColumns = (t) => ({ ...t, columns: [...new Set((t.columns || []).map((c) => (c === 'metrage' ? 'length' : c)))] });
export const tablesOf = (project) => (project?.tables?.length ? project.tables.map(fixColumns) : defaultTables());
export const mainTable = (project) => { const t = tablesOf(project); return t.find((x) => x.main) || t[0]; };
// Новый список профилей с изменениями одного (patch); основной всегда ровно один
export function withTable(project, id, patch) {
  const list = tablesOf(project).map((t) => (t.id === id ? { ...t, ...patch } : t));
  if (patch.main) list.forEach((t) => { t.main = t.id === id; });
  return list;
}

// ---------- сборка ----------
const safeSheet = (s) => String(s).replace(/[[\]*?:/\\]/g, '_').slice(0, 90) || '_';
const s = (v) => (v === undefined || v === null ? '' : v);

export function displayName(project, lang) {
  const p = lang === 'he' ? [project.nameHe || project.name, project.contractor, project.objectHe || project.object] : [project.name, project.contractor, project.object];
  const parts = p.map((x) => String(x ?? '').trim()).filter(Boolean);
  return parts.filter((x, i) => parts.indexOf(x) === i).join(' – ');
}
export function fileTitle(project, table) {
  if (table.fileName) return table.fileName;
  const d = displayName(project, table.lang);
  if (table.main) return table.lang === 'he' ? TITLE_PREFIX + d : `Статус точек – ${d}`;
  return `${d} – ${table.name}`;
}

// Этапы типа точек с учётом привязки установки (если установка не требуется — этапа «Установка» нет)
function stagesOf(type) {
  if (!type) return null;
  const stages = (type.stages || []).filter((x) => x !== 'Установка');
  if (installBinding(type).mode !== 'none') { const i = stages.indexOf('Проверка'); stages.splice(i >= 0 ? i : stages.length, 0, 'Установка'); }
  return stages;
}

function configText(point, project, ctx, lang) {
  const type = ctx.types.get(point.typeId);
  if (installBinding(type).mode !== 'config') return '';
  const cfg = ctx.configs.get(point.configId || project.defaultConfigId);
  if (!cfg) return '';
  if (lang === 'ru') return cfg.name || '';
  return (cfg.components || []).map((id) => ctx.catalog.get(id)?.nameHe || ctx.catalog.get(id)?.name || id).join(' + ');
}

// версия оформления: при её смене таблицы перестраиваются, даже если данные те же
const STYLE_V = 3;
const COLORS = { green: '#C6E5C9', grey: '#EFEFEF', pink: '#FCE8E8', orange: '#FFE0B2', red: '#F4B6B6', yellow: '#FFF2B3' };

// Значения одной ячейки
function cellOf(col, point, info, ctx, project, lang, nameOf) {
  const type = ctx.types.get(point.typeId);
  switch (col.id) {
    case 'label': return point.label;
    case 'planName': return s(point.planName);
    case 'cabinet': return s(point.cabinet);
    case 'floor': return s(point.floor);
    case 'type': return lang === 'he' ? (type?.nameHe || point.typeId) : point.typeId;
    case 'cable': { const id = cableOf(point, ctx); return lang === 'he' ? (ctx.cables.get(id)?.nameHe || s(id)) : s(id); }
    case 'cables': return cablesCountOf(point, ctx);
    case 'length': return info.metrage || '';
    case 'port': return s(point.port);
    case 'serial': return s(point.serial);
    case 'mac': return s(point.mac);
    case 'config': return configText(point, project, ctx, lang);
    case 'delay': { const r = ctx.delayReasons.get(point.delayReasonId); return r ? (lang === 'he' ? (r.he || r.id) : r.id) : s(point.delayReasonId); }
    case 'note': return s(point.note);
    case 'status': {
      if (lang === 'ru') return info.status;
      return info.status.startsWith('Установлено ') ? info.installHe : (STATUS_HE[info.status] || info.status);
    }
    case 'checkResult': return info.checked ? (info.checkResult === 'Не работает' ? T.bad[lang] : T.ok[lang]) : '';
    case 'lastBy': {
      const rows = (ctx.journalByPoint.get(point.id) || []).filter((r) => r.by);
      if (!rows.length) return '';
      const last = rows.reduce((a, b) => ((b.date || '') > (a.date || '') || ((b.date || '') === (a.date || '') && b.order > a.order) ? b : a));
      return nameOf ? nameOf(last.by) : '';
    }
    default: {
      // этапы: «—» если у типа нет такого этапа, пусто если ещё не сделан, иначе дата
      const stages = stagesOf(type);
      if (stages && !stages.includes(col.stage)) return '—';
      if (col.id === 'installed') {
        if (!info.install) return '';
        if (info.install === 'Установлено') {
          const d = (ctx.journalByPoint.get(point.id) || []).filter((r) => r.action === 'Установка').reduce((m, r) => (r.date > m ? r.date : m), '');
          return sheetSerial(d) || (lang === 'he' ? 'הותקן' : 'да');
        }
        return lang === 'he' ? info.installHe : `${T.partial.ru} ${info.install.replace('Установлено ', '')}`;
      }
      return sheetSerial(info[col.id]);
    }
  }
}

// Правила подсветки (без формул в ячейках): колонка → условие → цвет
function rulesFor(cols, lang) {
  const rules = [];
  cols.forEach((c, i) => {
    if (c.kind === 'stage') {
      rules.push({ col: i, kind: 'number', color: COLORS.green }, { col: i, kind: 'eq', text: '—', color: COLORS.grey, textColor: '#8C8C8C' });
      if (c.id === 'installed') rules.push({ col: i, kind: 'starts', text: T.partial[lang], color: COLORS.orange });
      rules.push({ col: i, kind: 'blank', color: COLORS.pink });
    } else if (c.id === 'status') {
      const t = (k) => (lang === 'he' ? STATUS_HE[k] : k);
      rules.push({ col: i, kind: 'eq', text: t('Проверена'), color: COLORS.green }, { col: i, kind: 'eq', text: t('Установлена'), color: COLORS.green },
        { col: i, kind: 'starts', text: lang === 'he' ? T.partial.he : 'Установлено ', color: COLORS.orange },
        { col: i, kind: 'eq', text: t('Неисправна'), color: COLORS.red }, { col: i, kind: 'eq', text: t('Захивучена'), color: COLORS.yellow },
        { col: i, kind: 'eq', text: t('Протянута'), color: COLORS.yellow });
    } else if (c.id === 'checkResult') {
      rules.push({ col: i, kind: 'eq', text: T.ok[lang], color: COLORS.green }, { col: i, kind: 'eq', text: T.bad[lang], color: COLORS.red });
    }
  });
  return rules;
}

// Цвет «информационных» столбцов строки по общему статусу точки (статус-столбец красится своими правилами)
const ROW_COLOR = { 'Неисправна': COLORS.red, 'Проверена': COLORS.green, 'Установлена': COLORS.green, 'Частично установлена': COLORS.orange,
  'Захивучена': COLORS.yellow, 'Протянута': COLORS.yellow };
function pointsFor(project, ctx, table, nameOf) {
  const cabs = new Set(table.cabinets || []); const types = new Set(table.types || []); const sts = new Set(table.statuses || []);
  return [...ctx.points.values()].filter((p) => p.projectId === project.id).sort(comparePoints)
    .map((point) => ({ point, info: pointInfo(point, ctx) }))
    .filter(({ point, info }) => (!cabs.size || cabs.has(point.cabinet || NO_CABINET)) && (!types.size || types.has(point.typeId))
      && (!sts.size || sts.has(statusKeyOf(info))));
}

function sheetOf(title, items, project, ctx, table, cols, nameOf) {
  const lang = table.lang === 'ru' ? 'ru' : 'he';
  const rows = [[T.title[lang]], [displayName(project, lang)]];
  if (table.summary) {
    const n = (f) => items.filter(f).length;
    const keys = ['total', 'pulled', 'hived', 'installed', 'partial', 'checked', 'faulty'];
    const vals = [items.length, n((x) => x.info.pulled), n((x) => x.info.hived), n((x) => x.info.install === 'Установлено'),
      n((x) => x.info.install.startsWith('Установлено ')), n((x) => x.info.checked), n((x) => x.info.status === 'Неисправна')];
    rows.push(keys.map((k) => T.sum[k][lang]), vals, []);
  } else rows.push([]);
  const headerRow = rows.length;
  rows.push(cols.map((c) => c[lang]));
  items.forEach(({ point, info }) => rows.push(cols.map((c) => cellOf(c, point, info, ctx, project, lang, nameOf))));
  return { title, rtl: lang === 'he', rows, headerRow, summaryRows: table.summary ? [2, 3] : [],
    cols: cols.map((c) => ({ id: c.id, kind: c.kind || 'text', width: c.w })), rules: rulesFor(cols, lang), count: items.length,
    rowColors: items.map(({ info }) => ROW_COLOR[statusKeyOf(info)] || '') };
}

// Возвращает { title, sheets, hash, pointCount, colCount } для записи в Google Таблицу
export function buildReport(project, ctx, table, { nameOf } = {}) {
  const lang = table.lang === 'ru' ? 'ru' : 'he';
  const cols = (table.columns || []).map((id) => colById.get(id)).filter(Boolean);
  if (!cols.length) throw new Error('В таблице не выбран ни один столбец');
  const items = pointsFor(project, ctx, table, nameOf);
  let sheets;
  if (table.layout === 'perCabinet' && items.length) {
    const groups = new Map();
    items.forEach((it) => { const k = it.point.cabinet || NO_CABINET; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
    const used = new Set();
    sheets = [...groups.entries()].sort(([x], [y]) => (x === NO_CABINET) - (y === NO_CABINET)).map(([k, list]) => {
      let name = safeSheet(k === NO_CABINET ? T.noCabinet[lang] : k); let i = 2; const base = name;
      while (used.has(name.toLowerCase())) { name = `${base} (${i})`; i += 1; }
      used.add(name.toLowerCase());
      return sheetOf(name, list, project, ctx, table, cols, nameOf);
    });
  } else sheets = [sheetOf(lang === 'he' ? 'סטטוס' : 'Статус', items, project, ctx, table, cols, nameOf)];
  const title = fileTitle(project, table);
  return { title, sheets, pointCount: items.length, colCount: cols.length, hash: hashOf([STYLE_V, title, lang, sheets.map((x) => [x.title, x.rtl, x.rows, x.cols.map((c) => c.id), x.rowColors])]) };
}
