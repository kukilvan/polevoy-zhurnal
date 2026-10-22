// Вкладка «Проект»: карточка текущего проекта и сводка по точкам.
import { projectWizard } from './wizard.js';
import { readsCount, readsToday, readsResetAt, DAILY_READ_LIMIT } from '../repo.js';
import { state, currentProject, pointsSorted, infoOf, getRepo } from '../store.js';
import { projectForm } from './projects.js';
import { pointForm, generatorForm } from './points.js';
import { openToday } from './doh.js';
import { h, formModal, confirmDialog, toast } from '../ui.js';
import { getToken, realApi, clearToken } from '../google.js';
import { syncTable } from '../managers.js';
import { tablesOf, mainTable, withTable, readinessByCabinet } from '../../domain/index.js';
import { runBackup, BACKUP_FOLDER, backupName } from '../backup.js';
import { liveProjects } from '../store.js';
import { filesIn } from '../drivefolders.js';
import { cacheGet, pushDrawing } from '../drawings.js';
import { memberLabel, memberNameByUid } from './members.js';
import { hint } from './guide.js';
import { exportExcel } from '../excel.js';

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
// «📁 Разложить файлы по папкам»: чертежи, таблицы и резервные копии всех проектов — в «Полевой журнал / <проект> / …» на Диске.
// Файлы, созданные другими участниками, Диск переложить не даст — они остаются у них.
export async function organizeDrive(retried = false) {
  if (syncing) return; syncing = true;
  try {
    toast('Раскладываю файлы на Диске по папкам проектов…');
    const api = realApi(await getToken('folders')); let moved = 0; let uploaded = 0; const missing = [];
    for (const p of liveProjects()) {
      // чертежи, которые есть только на устройстве (не ушли на Диск), — загрузить, если файл есть на этом устройстве
      for (const d of (p.drawings || []).filter((x) => !x.fileId && !x.deleted)) {
        const buf = await cacheGet(d.id);
        if (!buf) { missing.push(d.title || d.name); continue; }
        try { await pushDrawing(d, buf, p); uploaded++; } catch (e) { console.warn('push', e); missing.push(d.title || d.name); }
      }
      for (const d of (p.drawings || []).filter((x) => x.fileId && !x.deleted)) if (await api.placeIn(d.fileId, p, 'drawings')) moved++;
      for (const t of (p.tables || []).filter((x) => x.fileId)) if (await api.placeIn(t.fileId, p)) moved++;
      const prefix = backupName(p, new Date()).replace(/ \d{4}-\d{2}-\d{2}\.json$/, ' ');
      const olds = (await filesIn(api.req, BACKUP_FOLDER, prefix)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f.name.slice(prefix.length)));
      for (const f of olds) if (await api.placeIn(f.id, p, 'backups')) moved++;
      await api.projectFolder(p);  // папка есть у каждого проекта, даже без файлов
    }
    toast(`Готово: переложено файлов — ${moved}${uploaded ? `, загружено чертежей — ${uploaded}` : ''}. Всё в папке «Полевой журнал» на Диске.${missing.length ? ` Нет на этом устройстве (загрузите с того, где добавляли): ${missing.join(', ')}` : ''}`);
  } catch (e) {
    if (e.status === 401 && retried !== true) { clearToken(); syncing = false; return organizeDrive(true); }
    toast(`Не получилось: ${e.message || e}`); console.error('folders', e);
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
    getRepo().saveProject(p.id, { tables: withTable(p, table.id, { ...res.patch, serverError: '' }) });
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

// Полоски готовности по шкафам: цвет плавно от красного через жёлтый к зелёному
function readiness() {
  const rows = readinessByCabinet(state.ctx);
  if (!rows.length) return null;
  return h('div', { class: 'ready' }, rows.map((r) => {
    const k = r.total ? r.done / r.total : 0; const hue = Math.round(k * 120);
    const bar = h('div', { class: 'ready-bar' },
      h('div', { class: 'ready-fill', style: { width: `${Math.round(k * 100)}%` } }),
      h('span', { class: 'ready-name' }, r.cabinet ? `Шкаф ${r.cabinet}` : 'Без шкафа'),
      h('span', { class: 'ready-num' }, `${r.done} из ${r.total}`));
    bar.style.setProperty('--h', hue);
    return bar;
  }));
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

// Чтения базы: сколько осталось от суточного лимита (по этому устройству) и когда лимит сбросится
function readsLine() {
  const used = readsToday(); const left = Math.max(0, DAILY_READ_LIMIT - used);
  const at = readsResetAt(); const hhmm = at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const day = at.toDateString() === new Date().toDateString() ? 'сегодня' : 'завтра';
  return `📈 Чтений базы: осталось ${left.toLocaleString('ru-RU')} из ${DAILY_READ_LIMIT.toLocaleString('ru-RU')} (с этого телефона; за этот запуск ${readsCount()}). Лимит сбросится ${day} в ${hhmm}`;
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
      h('button', { onclick: () => projectWizard(ui) }, '➕ Создать проект'));
  }
  return h('div', {},
    h('div', { class: 'card' },
      h('div', { style: { fontSize: '18px', fontWeight: 700 } }, p.name),
      h('div', { class: 'mut' }, [p.contractor, p.object].filter(Boolean).join(' · ')),
      h('div', { class: 'mut' }, `Помощник по умолчанию: ${p.helper || 'сам'}${p.oneOff ? ' · разовый выезд' : ''}`),
      p.note ? h('div', { class: 'mut' }, p.note) : null),
    members(p, ui),
    h('div', { class: 'card' }, h('b', {}, 'План'),
      h('div', { class: 'mut', style: { marginTop: '6px' } }, (p.drawings || []).filter((d) => !d.deleted).length ? `Чертежей: ${(p.drawings || []).filter((d) => !d.deleted).map((d) => d.name).join(', ')}` : 'Чертежей пока нет — добавьте PDF тохнита, точки появятся на нём по статусу.'),
      h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => import('./planmodal.js').then((m) => m.planModal()) }, '🗺 Открыть план'))),
    h('div', { class: 'card' }, h('b', {}, 'Точки'), readiness(), h('div', { style: { marginTop: '8px' } }, summary(ui)),
      h('div', { class: 'btns' },
        h('button', { onclick: () => generatorForm() }, '➕ Добавить точки'),
        h('button', { class: 'sec', onclick: () => pointForm(null) }, 'Новая точка'),
        h('button', { class: 'sec', onclick: () => ui.go('meter') }, '📏 Точки'))),
    h('div', { class: 'btns' },
      h('button', { class: 'wide', onclick: () => openToday(ui) }, '📝 Сегодня'),
      h('button', { class: 'wide', onclick: () => import('./pullview.js').then((m) => m.openPulls()) }, '🧵 Протяжки'),
      h('button', { class: 'sec', onclick: () => ui.open('projects') }, 'Все проекты'),
      autoBackupLine(p),
      h('div', { class: 'mut', style: { width: '100%' } }, readsLine()),
      h('button', { class: 'sec', onclick: backupNow }, p.backupAt ? `💾 Резервная копия (последняя: ${new Date(p.backupAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })})` : '💾 Резервная копия на Диск'),
      h('button', { class: 'sec', onclick: exportExcel }, '📊 Выгрузить всё в Excel'),
      h('button', { class: 'sec', onclick: updateManagerTable }, '🔄 Обновить таблицу для руководства'),
      mainTable(p).link ? h('button', { class: 'sec', onclick: () => window.open(mainTable(p).link, '_blank') }, '📊 Открыть таблицу руководства') : null));
}
