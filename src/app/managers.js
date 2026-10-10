// Таблицы для руководства: приложение само создаёт Google Таблицу (без шаблона) и записывает готовые значения.
import { buildReport } from '../domain/index.js';

const rgb = (hex) => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });
const colLetter = (n) => { let s = ''; let x = n + 1; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };
const esc = (t) => String(t).replace(/'/g, "''");

// Запросы оформления одного листа: ширины, шапка, даты, подсветка, фильтр
export function sheetRequests(sheetId, sh) {
  const out = []; const nCols = sh.cols.length; const first = sh.headerRow + 1; const lastRow = Math.max(sh.rows.length, first + 1);
  const range = (r0, r1, c0, c1) => ({ sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  sh.cols.forEach((c, i) => out.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: c.width || 110 }, fields: 'pixelSize' } }));
  out.push({ repeatCell: { range: range(0, 1, 0, 1), cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } }, fields: 'userEnteredFormat.textFormat' } });
  out.push({ repeatCell: { range: range(1, 2, 0, 1), cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat' } });
  if (sh.summaryRows.length) {
    out.push({ repeatCell: { range: range(2, 3, 0, 7), cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: rgb('#E8EEF5'), horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)' } });
    out.push({ repeatCell: { range: range(3, 4, 0, 7), cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12 }, backgroundColor: rgb('#D3E3F5'), horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)' } });
  }
  out.push({ repeatCell: { range: range(sh.headerRow, sh.headerRow + 1, 0, nCols), cell: { userEnteredFormat: {
    backgroundColor: rgb('#1F3B5C'), textFormat: { bold: true, foregroundColor: rgb('#FFFFFF') }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
  fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } });
  out.push({ repeatCell: { range: range(first, lastRow, 0, nCols), cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)' } });
  sh.cols.forEach((c, i) => {
    if (c.kind === 'stage') out.push({ repeatCell: { range: range(first, lastRow, i, i + 1), cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } });
    else if (c.kind === 'num' || c.kind === 'status') out.push({ repeatCell: { range: range(first, lastRow, i, i + 1), cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } });
  });
  // цвет информационных столбцов по статусу точки: подряд идущие строки одного цвета — одним запросом
  const infoCols = []; sh.cols.forEach((c, i) => { if (c.kind !== 'stage' && c.kind !== 'status' && c.id !== 'checkResult') infoCols.push(i); });
  const groups = []; infoCols.forEach((i) => { const g = groups[groups.length - 1]; if (g && g[1] === i) g[1] = i + 1; else groups.push([i, i + 1]); });
  const rc = sh.rowColors || [];
  for (let i = 0; i < rc.length;) {
    let j = i; while (j < rc.length && rc[j] === rc[i]) j += 1;
    if (rc[i]) groups.forEach(([c0, c1]) => out.push({ repeatCell: { range: range(first + i, first + j, c0, c1), cell: { userEnteredFormat: { backgroundColor: rgb(rc[i]) } }, fields: 'userEnteredFormat.backgroundColor' } }));
    i = j;
  }
  // подсветка: условное форматирование (в ячейках только значения)
  const rowNo = first + 1; // номер первой строки данных в A1
  sh.rules.forEach((r) => {
    const cell = `${colLetter(r.col)}${rowNo}`;
    const cond = r.kind === 'number' ? { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=ISNUMBER(${cell})` }] }
      : r.kind === 'blank' ? { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=(COUNTA($A${rowNo}:$${colLetter(Math.max(nCols - 1, 0))}${rowNo})>0)*(LEN(${cell})=0)` }] }
        : { type: r.kind === 'eq' ? 'TEXT_EQ' : 'TEXT_STARTS_WITH', values: [{ userEnteredValue: r.text }] };
    const format = { backgroundColor: rgb(r.color), ...(r.textColor ? { textFormat: { foregroundColor: rgb(r.textColor) } } : {}) };
    out.push({ addConditionalFormatRule: { rule: { ranges: [range(first, lastRow, r.col, r.col + 1)], booleanRule: { condition: cond, format } }, index: 0 } });
  });
  out.push({ setBasicFilter: { filter: { range: range(sh.headerRow, Math.max(sh.rows.length, sh.headerRow + 1), 0, nCols) } } });
  return out;
}

// Пересобирает все листы файла: добавляет новые, удаляет старые (в одном запросе), затем пишет значения
export async function rebuildSheets(api, fileId, sheets) {
  const old = await api.sheetsOf(fileId);
  const base = 100000 + Math.floor(Math.random() * 800000);
  const ids = sheets.map((_, i) => base + i);
  const requests = [];
  sheets.forEach((sh, i) => requests.push({ addSheet: { properties: { sheetId: ids[i], title: `__pz${i}`, index: i, rightToLeft: sh.rtl,
    gridProperties: { rowCount: Math.max(50, sh.rows.length + 20), columnCount: Math.max(sh.cols.length, ...sh.rows.map((r) => r.length), 7), frozenRowCount: sh.headerRow + 1 } } } }));
  old.forEach((o) => requests.push({ deleteSheet: { sheetId: o.sheetId } }));
  sheets.forEach((sh, i) => requests.push({ updateSheetProperties: { properties: { sheetId: ids[i], title: sh.title, rightToLeft: !!sh.rtl }, fields: 'title,rightToLeft' } }));
  sheets.forEach((sh, i) => requests.push(...sheetRequests(ids[i], sh)));
  await api.batch(fileId, requests);
  await api.write(fileId, sheets.map((sh) => ({ range: `'${esc(sh.title)}'!A1`, values: sh.rows })));
}

// Обновляет одну таблицу проекта. Возвращает { patch, link, changed, message }: patch — поля профиля для сохранения
export async function syncTable(api, project, ctx, table, { force = false, uid = '', nameOf } = {}) {
  const rep = buildReport(project, ctx, table, { nameOf });
  const patch = {};
  let fileId = table.fileId || '';
  let oldHash = table.hash || '';
  let file = fileId ? await api.fileInfo(fileId) : null;
  if (!file && fileId && table.by && uid && table.by !== uid) {
    // файл создал другой участник: у вас к нему нет доступа — новый не создаём, чтобы не подменить ссылку
    throw new Error('Эту таблицу создал другой участник проекта, у вас нет к ней доступа. Обновить её может он.');
  }
  if (!file) { file = await api.create(rep.title); fileId = file.id; oldHash = ''; if (uid) patch.by = uid; }
  if (uid && !table.by && !patch.by) patch.by = uid;
  const link = `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
  if (fileId !== table.fileId) patch.fileId = fileId;
  if (link !== table.link) patch.link = link;
  let changed = false;
  try {
    if (force || rep.hash !== oldHash) {
      await rebuildSheets(api, fileId, rep.sheets);
      patch.hash = rep.hash; changed = true;
    }
    if (file.name !== rep.title) await api.rename(fileId, rep.title);
  } catch (e) { e.patch = patch; throw e; } // файл уже создан: запоминаем его, чтобы следующая попытка не плодила новые
  patch.syncedAt = new Date().toISOString();
  return { patch, link, changed, rep, message: changed ? `Таблица «${table.name}» обновлена: точек ${rep.pointCount}, столбцов ${rep.colCount}` : `Таблица «${table.name}»: данные не менялись, она актуальна` };
}
