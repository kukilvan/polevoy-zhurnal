// Вкладка «Проект»: карточка текущего проекта и сводка по точкам.
import { state, currentProject, pointsSorted, infoOf, getRepo } from '../store.js';
import { projectForm } from './projects.js';
import { pointForm, generatorForm } from './points.js';
import { openToday } from './doh.js';
import { h, formModal, confirmDialog, toast } from '../ui.js';
import { getToken, realApi, clearToken } from '../google.js';
import { syncManagers } from '../managers.js';
import { runBackup } from '../backup.js';
import { memberLabel } from './members.js';
import { hint } from './guide.js';

// Тестовый режим (?mem=1): вместо Google — заглушка, вызовы пишутся в window.__gcalls
function testApi() {
  const calls = (window.__gcalls = []); const rec = (n) => (...a) => { calls.push([n, ...a]); return Promise.resolve(n === 'sheetsOf' ? [] : { id: 'FILE1', name: 'x' }); };
  return { fileInfo: rec('fileInfo').bind(null), copy: rec('copy'), rename: rec('rename'), batch: rec('batch'), clear: rec('clear'), write: rec('write'),
    sheetsOf: async (...a) => { calls.push(['sheetsOf', ...a]); return ['Проекты', 'Точки', 'Журнал', 'Типы точек', 'Конфигурации', 'Статус'].map((title, i) => ({ sheetId: i, title, gridProperties: { rowCount: 1000, columnCount: 26 } })); } };
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
export async function updateManagerTable(retried = false) {
  const p = currentProject(); if (!p || syncing) return;
  syncing = true;
  try {
    toast('Обновляю таблицу для руководства…');
    const api = new URLSearchParams(location.search).get('mem') ? testApi() : realApi(await getToken());
    const res = await syncManagers(api, p, state.ctx, { uid: getRepo().user.uid });
    getRepo().saveProject(p.id, res.patch);
    toast(res.message);
  } catch (e) {
    if (e.status === 401 && retried !== true) { clearToken(); syncing = false; toast('Доступ Google истёк — запрашиваю заново…'); return updateManagerTable(true); }
    const msg = e.code === 'auth/popup-blocked' ? 'Браузер заблокировал окно разрешения Google' : e.code === 'auth/popup-closed-by-user' ? 'Окно разрешения закрыто'
      : e.status === 403 ? `Нет доступа (${e.message}). Включены ли Google Drive API и Google Sheets API? Открыт ли шаблон по ссылке?` : e.message || String(e);
    toast(`Не получилось: ${msg}`); console.error('managers sync', e);
  } finally { syncing = false; }
}

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
      h('button', { class: 'sec', onclick: backupNow }, p.backupAt ? `💾 Резервная копия (последняя: ${new Date(p.backupAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })})` : '💾 Резервная копия на Диск'),
      h('button', { class: 'sec', onclick: updateManagerTable }, '🔄 Обновить таблицу для руководства'),
      p.managerLink ? h('button', { class: 'sec', onclick: () => window.open(p.managerLink, '_blank') }, '📊 Открыть таблицу руководства') : null));
}
