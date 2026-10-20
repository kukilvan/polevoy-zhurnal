// «Таблицы»: свои Google Таблицы с Диска под своими названиями — список в приложении, нажатие открывает таблицу.
// Список закрепляется за проектом (project.sheetLinks: [{ id, name }]) — у каждого проекта свои таблицы.
import { h, openModal, toast, confirmDialog, formModal } from '../ui.js';
import { getRepo, currentProject } from '../store.js';
import { getToken, realApi, clearToken } from '../google.js';

const mem = () => new URLSearchParams(location.search).get('mem');
const linksOf = () => currentProject()?.sheetLinks || [];
const saveLinks = (list) => getRepo().saveProject(currentProject().id, { sheetLinks: list });
const urlOf = (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; const XLSM = 'application/vnd.ms-excel.sheet.macroEnabled.12';
const isExcel = (f) => (f.mimeType && f.mimeType !== 'application/vnd.google-apps.spreadsheet') || /\.(xlsx|xlsm|xls)$/i.test(f.name || '');
const when = (iso) => { try { return new Date(iso).toLocaleDateString('ru-RU'); } catch { return ''; } };

// Все Google Таблицы пользователя (свои и открытые ему), свежие сверху
async function listSheets() {
  if (mem()) return window.__gfileList || [{ id: 'S1', name: 'Мега Ор — кабели', modifiedTime: '2026-10-01T10:00:00Z', ownedByMe: true }, { id: 'S2', name: 'Дохот сентябрь', modifiedTime: '2026-09-30T10:00:00Z', ownedByMe: true }, { id: 'S3', name: 'Заказ шильюта', modifiedTime: '2026-08-01T10:00:00Z', ownedByMe: false }];
  const api = realApi(await getToken('sheets'));
  // Google Таблицы + Excel-файлы (.xlsx, .xlsm, .xls — Google открывает их в Таблицах) + ссылки-ярлыки; в том числе из общих дисков
  const MIMES = ['application/vnd.google-apps.spreadsheet', XLSX, XLSM, 'application/vnd.ms-excel'];
  const q = encodeURIComponent(`(${MIMES.map((m) => `mimeType='${m}'`).join(' or ')} or name contains '.xlsx' or name contains '.xlsm') and mimeType!='application/vnd.google-apps.folder' and trashed=false`);
  const out = []; let page = '';
  do {
    const r = await api.req('GET', `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=${encodeURIComponent('modifiedTime desc')}&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&fields=nextPageToken,files(id,name,mimeType,modifiedTime,ownedByMe)${page ? `&pageToken=${page}` : ''}`);
    out.push(...(r.files || [])); page = r.nextPageToken || '';
  } while (page && out.length < 2000);
  return out;
}

// «➕ Добавить»: найти таблицы на Диске → выбрать галочками → дать названия → в список
export async function addSheetsFlow(retried = false) {
  let files;
  try { toast('Ищу таблицы на Диске…'); files = await listSheets(); } catch (e) {
    if (e.status === 401 && !retried) { clearToken(); toast('Доступ Google истёк — запрашиваю заново…'); return addSheetsFlow(true); }
    toast(`Не получилось: ${e.status === 403 ? `нет доступа (${e.message}). Включён ли Google Drive API?` : e.message || e}`); return;
  }
  const have = new Set(linksOf().map((x) => x.id));
  const chosen = new Set(); let q = '';
  const list = h('div', { class: 'picklist', style: { maxHeight: '55vh' } });
  const count = h('b', {}); const go = h('button', {});
  const fill = () => {
    const shown = files.filter((f) => !q || f.name.toLowerCase().includes(q));
    list.replaceChildren(...(shown.length ? shown.map((f) => {
      const added = have.has(f.id);
      const cb = h('input', { type: 'checkbox', checked: added || chosen.has(f.id), disabled: added, onchange: () => { cb.checked ? chosen.add(f.id) : chosen.delete(f.id); upd(); } });
      return h('label', { class: 'pickrow' }, cb, h('span', {}, f.name, h('small', { class: 'mut' }, `  ${when(f.modifiedTime)}${isExcel(f) ? ' · Excel' : ''}${f.ownedByMe === false ? ' · чужая' : ''}${added ? ' · уже в списке' : ''}`)));
    }) : [h('div', { class: 'empty' }, files.length ? 'Ничего не найдено' : 'На Диске нет Google Таблиц')]));
  };
  const upd = () => { count.textContent = `Выбрано: ${chosen.size}`; go.textContent = `➕ Добавить (${chosen.size})`; go.disabled = !chosen.size; };
  go.onclick = () => { const pick = files.filter((f) => chosen.has(f.id)); close(); nameThem(pick); };
  const close = openModal('Таблицы на Диске', h('div', {},
    h('div', { class: 'mut' }, `Найдено таблиц: ${files.length}${files.some(isExcel) ? ` (из них Excel: ${files.filter(isExcel).length})` : ''}. Отметьте нужные — на следующем шаге дадите им свои названия.`),
    h('input', { type: 'search', placeholder: 'Поиск по названию', style: { margin: '8px 0' }, oninput: (e) => { q = e.target.value.trim().toLowerCase(); fill(); } }),
    h('div', { style: { margin: '6px 0' } }, count), list, h('div', { class: 'btns' }, go)), { sticky: true });
  fill(); upd();
}

// Шаг 2: своё название для каждой выбранной таблицы
function nameThem(pick) {
  const inputs = pick.map((f) => h('input', { type: 'text', value: f.name }));
  const c = openModal('Названия таблиц', h('div', {},
    h('div', { class: 'mut' }, 'Как назвать в приложении (можно оставить как на Диске).'),
    ...pick.map((f, i) => h('div', { class: 'field' }, h('label', {}, f.name), inputs[i])),
    h('div', { class: 'btns' }, h('button', { onclick: () => {
      const add = pick.map((f, i) => ({ id: f.id, name: inputs[i].value.trim() || f.name }));
      saveLinks([...linksOf(), ...add.filter((x) => !linksOf().some((y) => y.id === x.id))]);
      c(); toast(`Добавлено таблиц: ${add.length}`);
    } }, 'Сохранить'))), { sticky: true });
}

export function sheetsView(ui) {
  const list = linksOf(); const old = getRepo().prefs?.sheetLinks || [];
  const redraw = () => setTimeout(() => ui.render(), 300);
  return h('div', {},
    h('div', { class: 'card' },
      h('div', { class: 'mut', style: { marginBottom: '8px' } }, 'Свои Google Таблицы с Диска под своими названиями. Нажатие открывает таблицу в Google Таблицах. Список — у каждого проекта свой.'),
      h('div', { class: 'btns', style: { marginTop: 0 } }, h('button', { onclick: () => addSheetsFlow() }, '➕ Добавить')),
      // таблицы, добавленные в первой версии (общий список в личных настройках) — перенести в этот проект
      old.length ? h('div', { style: { marginTop: '8px' } }, h('button', { class: 'sec', onclick: () => {
        saveLinks([...list, ...old.filter((x) => !list.some((y) => y.id === x.id))]); getRepo().saveUserPrefs({ sheetLinks: [] }); redraw();
      } }, `⤵ Перенести сюда добавленные раньше (${old.length})`)) : null),
    list.length ? h('div', { class: 'card', style: { padding: 0 } }, ...list.map((s) => h('div', { class: 'item', style: { display: 'flex', alignItems: 'center', gap: '8px' } },
      h('div', { class: 'name', style: { flex: 1, minWidth: 0, cursor: 'pointer' }, onclick: () => window.open(urlOf(s.id), '_blank') }, `📊 ${s.name}`),
      h('button', { class: 'sec', style: { padding: '4px 10px' }, title: 'Переименовать', onclick: () => formModal({ title: 'Название таблицы', values: { name: s.name }, fields: [{ key: 'name', label: 'Название', type: 'text', required: true }],
        onSubmit: (v) => { saveLinks(linksOf().map((x) => (x.id === s.id ? { ...x, name: String(v.name).trim() || x.name } : x))); redraw(); } }) }, '✏️'),
      h('button', { class: 'sec', style: { padding: '4px 10px' }, title: 'Убрать из списка', onclick: async () => {
        if (!(await confirmDialog(`Убрать «${s.name}» из списка? Сама таблица на Диске останется.`, { yes: 'Убрать', danger: true }))) return;
        saveLinks(linksOf().filter((x) => x.id !== s.id)); redraw();
      } }, '🗑'))))
      : h('div', { class: 'empty' }, 'Таблиц пока нет — «➕ Добавить»'),
    h('div', { class: 'mut', style: { margin: '10px 2px', fontSize: '13px' } }, 'Работа без интернета: у Google нет способа включить «Доступно офлайн» из приложения — это делается в самой Google Таблицах (⋮ у таблицы → «Доступно офлайн»), один раз для каждой таблицы.'));
}
