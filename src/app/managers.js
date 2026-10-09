// Синхронизация таблицы для руководства (замена Apps Script syncAll): копия шаблона + данные проекта значениями.
import { HEADERS, managerNames, managerTables, fileIdOf, hashOf } from '../domain/index.js';

export const TEMPLATE_ID = '1jnokOHgr6NXLW_FyvKsztTIFnNOmDwk19FzWSOssVWY';
const colName = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

async function ensureGrid(api, fileId, need) {
  const props = await api.sheetsOf(fileId);
  const requests = [];
  for (const [title, rows, cols] of need) {
    const p = props.find((x) => x.title === title);
    if (!p) throw new Error(`В шаблоне нет листа «${title}»`);
    const g = p.gridProperties || {};
    if ((g.rowCount || 0) < rows) requests.push({ appendDimension: { sheetId: p.sheetId, dimension: 'ROWS', length: rows - g.rowCount } });
    if ((g.columnCount || 0) < cols) requests.push({ appendDimension: { sheetId: p.sheetId, dimension: 'COLUMNS', length: cols - g.columnCount } });
  }
  if (requests.length) await api.batch(fileId, requests);
}

// Возвращает { patch, message }: patch — поля проекта для сохранения (если что-то изменилось)
export async function syncManagers(api, project, ctx, { force = false } = {}) {
  const names = managerNames(project);
  if (!names.display) throw new Error('У проекта пустое название — заполните название, подрядчика или объект');
  const tables = managerTables(project, ctx);
  const hash = hashOf([names.title, names.display, tables]);
  const patch = {};
  let fileId = fileIdOf(project);
  let oldHash = project.managerHash || '';
  let file = fileId ? await api.fileInfo(fileId) : null;
  if (!file) {
    file = await api.copy(TEMPLATE_ID, names.title);
    fileId = file.id; oldHash = '';
  }
  const link = `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
  if (fileId !== project.managerFileId) patch.managerFileId = fileId;
  if (link !== project.managerLink) patch.managerLink = link;
  let changed = false;
  if (force || hash !== oldHash) {
    const sheets = Object.keys(HEADERS);
    await ensureGrid(api, fileId, sheets.map((n) => [n, tables[n].length + 5, HEADERS[n].length]));
    await api.clear(fileId, sheets);
    const data = sheets.map((n) => ({ range: `${n}!A1:${colName(HEADERS[n].length)}${tables[n].length + 1}`, values: [HEADERS[n], ...tables[n]] }));
    data.push({ range: 'Статус!B3:B4', values: [[names.display], [project.id]] });
    await api.write(fileId, data);
    if (file.name !== names.title) await api.rename(fileId, names.title);
    patch.managerHash = hash; changed = true;
  }
  patch.managerSyncedAt = new Date().toISOString();
  return { patch, link, changed, message: changed ? `Таблица обновлена: ${names.title}` : 'Данные не менялись, таблица актуальна' };
}
