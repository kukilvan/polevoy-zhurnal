// Вкладка «Проект»: карточка текущего проекта и сводка по точкам.
import { readsCount } from '../repo.js';
import { state, currentProject, pointsSorted, infoOf, getRepo } from '../store.js';
import { projectForm } from './projects.js';
import { pointForm, generatorForm } from './points.js';
import { openToday } from './doh.js';
import { h, formModal, confirmDialog, toast } from '../ui.js';
import { getToken, realApi, clearToken } from '../google.js';
import { syncTable } from '../managers.js';
import { tablesOf, mainTable, withTable } from '../../domain/index.js';
import { runBackup } from '../backup.js';
import { memberLabel, memberNameByUid } from './members.js';
import { hint } from './guide.js';

// Тестовый режим (?mem=1): вместо Google — заглушка, вызовы пишутся в window.__gcalls
function testApi() {
  const calls = (window.__gcalls = window.__gcalls || []); const files = (window.__gfiles = window.__gfiles || {});
  return {
    fileInfo: async (id) => { calls.push(['fileInfo', id]); return files[id] || null; },
    create: async (title) => { const id = `FILE${Object.keys(files).length + 1}`; files[id] = { id, name: title }; calls.push(['create', title]); return files[id]; },
    share: async (id, email) => { calls.push(['share', id, email]); },
    rename: async (id, name) => { calls.push(['rename', id, name]); files[id].name = name; },
    sheetsOf: async (id) => { calls.push(['sheetsOf', id]); return [{ sheetId: 0, title: 'Sheet1', gridProperties: { rowCount: 1000, columnCount: 26 } }]; },
    batch: async (id, requests) => { calls.push(['batch', id, requests]); return {}; },
    write: async (id, data) => { calls.push(['write', id, data]); },
  };
}
let syncing = false;
export async function backupNow(retried = false) {
  const p = currentProject(); if (!p || syncing) return;
  syncing = true;
  try {
    toast('Сохраняю резервную копию на Диск…');
    let api;
    if (new URLSearchParams(location.search).get('mem')) { const t = testApi(); api = { folder: async () => 'F', putJson: async (...a) => { window.__gcalls.push(['putJson', ...a]); return 'X'; } }; void t; }
    else api = realApi(await getToken('backup'));
    const res = await runBackup(api, p, state.data);
    getRepo().saveProject(p.id, res.patch);
    toast(res.message);
  } catch (e) {
    if (e.status === 401 && retried !== true) { clearToken(); syncing = false; toast('Доступ Google истёк — запрашиваю заново…'); return backupNow(true); }
    toast(`Не получилось: ${e.message || e}`); console.error('backup', e);
  } finally { syncing = false; }
}
// Обновляет одну таблицу для руководства (по id профиля)
export async function updateTable(tableId, retried = false) {
  const p = currentProject(); if (!p || syncing) return;
  const table = tablesOf(p).find((t) => t.id === tableId) || mainTable(p);
  syncing = true;
  try {
    toast(`Обновляю таблицу «${table.name}»…`);
    const api = new URLSearchParams(location.search).get('mem') ? testApi() : realApi(await getToken(`table:${table.id}`));
    const res = await syncTable(api, p, state.ctx, table, { uid: getRepo().user.uid, nameOf: (u) => memberNameByUid(p, u), shareWith: p.serverEmail || '' });
    getRepo().saveProject(p.id, { tables: withTable(p, table.id, res.patch) });
    toast(res.message);
  } catch (e) {
    if (e.status === 401 && retried !== true) { clearToken(); syncing = false; toast('Доступ Google истёк — запрашиваю заново…'); return updateTable(tableId, true); }
    const msg = e.code === 'auth/popup-blocked' ? 'Браузер заблокировал окно разрешения Google' : e.code === 'auth/popup-closed-by-user' ? 'Окно разрешения закрыто'
      : e.status === 403 ? `Нет доступа (${e.message}). Включены ли Google Drive API и Google Sheets API?` : e.message || String(e);
    if (e.patch && Object.keys(e.patch).length) getRepo().saveProject(p.id, { tables: withTable(p, table.id, e.patch) });
    toast(`Не получилось: ${msg}`); console.error('table sync', e);
  } finally { syncing = false; }
}
// Основная таблица (кнопка на вкладке «Проект»)
export const updateManagerTable = (retried) => updateTable(mainTable(currentProject()).id, retried);

export function statusClass(status) {
  if (status === 'Неисправна') return 'pill st-bad';
  if (status === 'Проверена' || status === 'Установлена') return 'pill st-ok';
  if (status === 'Новая') return 'pill';
  return 'pill st-mid';
}

function summary(ui) {
  const ctx = state.ctx; const rows = new Map();
  pointsSorted().forEach((pt) => {
    const info = infoOf(pt);
    const r = rows.get(pt.typeId) || { total: 0, pulled: 0, installed: 0, checked: 0, bad: 0 };
    r.total += 1; if (info.pulled) r.pulled += 1;
    if (info.install === 'Установлено' || info.checked) r.installed += 1;
    if (info.checked) r.checked += 1; if (info.status === 'Неисправна') r.bad += 1;
    rows.set(pt.typeId, r);
  });
  if (!rows.size) return hint(ui, 'Точек пока нет. Сначала создайте все точки проекта по плану заказчика: кнопка «Добавить точки» ниже создаёт их пачкой (например, 1A-01 … 1A-24).', 'points', '📖 Как добавить точки');
  const sum = [...rows.values()].reduce((a, r) => ({ total: a.total + r.total, pulled: a.pulled + r.pulled, installed: a.installed + r.installed, checked: a.checked + r.checked, bad: a.bad + r.bad }), { total: 0, pulled: 0, installed: 0, checked: 0, bad: 0 });
  const line = (name, r, bold) => h('tr', {}, h('td', {}, bold ? h('b', {}, name) : name), ...['total', 'pulled', 'installed', 'checked'].map((k) => h('td', {}, bold ? h('b', {}, r[k]) : r[k])));
  return h('div', {},
    h('table', { class: 'sum' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Тип'), h('th', {}, 'Всего'), h('th', {}, 'Протянуто'), h('th', {}, 'Установлено'), h('th', {}, 'Проверено'))),
      h('tbody', {}, [...rows.entries()].map(([t, r]) => line(t, r)), line('Итого', sum, true))),
    sum.bad ? h('div', { class: 'pill st-bad', style: { marginTop: '8px' } }, `Неисправных: ${sum.bad}`) : null,
    h('div', { class: 'mut', style: { marginTop: '6px' } }, ctxMetres(ctx)));
}
function ctxMetres() {
  const m = pointsSorted().reduce((s, pt) => s + infoOf(pt).metrage, 0);
  return m ? `Метраж по точкам с длиной: ${Math.round(m * 100) / 100} м` : '';
}

// Ночная копия на сервере: когда была последняя; красным, если давно (копии идут раз в 2 дня)
function autoBackupLine(p) {
  if (!p.serverBackupAt) return h('div', { class: 'mut', style: { width: '100%' } }, 'Автокопия на сервере ещё не запускалась');
  const t = new Date(p.serverBackupAt); const days = (Date.now() - t.getTime()) / 86400000;
  const when = t.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
  return h('div', { class: days > 4 ? 'pill st-bad' : 'mut', style: { width: '100%' } }, days > 4 ? `⚠️ Автокопия давно не делалась (последняя: ${when})` : `🛡 Автокопия на сервере: ${when}`);
}

function members(p, ui) {
  const me = getRepo().user.email?.toLowerCase();
  const invited = p.invitedEmails || [];
  return h('div', { class: 'card' }, h('b', {}, 'Участники'),
    h('div', { style: { marginTop: '6px' } }, (p.memberEmails || []).map((e) =>
      h('div', { class: 'mut' }, `${memberLabel(p, e)}${e === me ? ' (вы)' : ''}`))),
    invited.length ? h('div', { class: 'mut', style: { marginTop: '6px' } }, `Приглашены: ${invited.join(', ')}`) : null,
    h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => ui.open('members') }, '👥 Управлять участниками')));
}

export function projectView(ui) {
  const p = currentProject();
  if (!p) {
    return h('div', { class: 'empty' }, h('p', {}, 'У вас пока нет проекта.'),
      h('button', { onclick: () => projectForm(null, ui) }, '➕ Создать проект'));
  }
  return h('div', {},
    h('div', { class: 'card' },
      h('div', { style: { fontSize: '18px', fontWeight: 700 } }, p.name),
      h('div', { class: 'mut' }, [p.contractor, p.object].filter(Boolean).join(' · ')),
      h('div', { class: 'mut' }, `Помощник по умолчанию: ${p.helper || 'сам'}${p.oneOff ? ' · разовый выезд' : ''}`),
      p.note ? h('div', { class: 'mut' }, p.note) : null),
    members(p, ui),
    h('div', { class: 'card' }, h('b', {}, 'Точки'), h('div', { style: { marginTop: '8px' } }, summary(ui)),
      h('div', { class: 'btns' },
        h('button', { onclick: () => generatorForm() }, '➕ Добавить точки'),
        h('button', { class: 'sec', onclick: () => pointForm(null) }, 'Новая точка'),
        h('button', { class: 'sec', onclick: () => ui.go('meter') }, '📏 Метраж'))),
    h('div', { class: 'btns' },
      h('button', { class: 'wide', onclick: () => openToday(ui) }, '📝 Сегодня'),
      h('button', { class: 'sec', onclick: () => ui.open('projects') }, 'Все проекты'),
      autoBackupLine(p),
      h('div', { class: 'mut', style: { width: '100%' } }, `📈 Чтений базы с сервера за этот запуск: ${readsCount()} (лимит в день — 50 000)`),
      h('button', { class: 'sec', onclick: backupNow }, p.backupAt ? `💾 Резервная копия (последняя: ${new Date(p.backupAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })})` : '💾 Резервная копия на Диск'),
      h('button', { class: 'sec', onclick: updateManagerTable }, '🔄 Обновить таблицу для руководства'),
      mainTable(p).link ? h('button', { class: 'sec', onclick: () => window.open(mainTable(p).link, '_blank') }, '📊 Открыть таблицу руководства') : null));
}
