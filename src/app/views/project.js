// Вкладка «Проект»: карточка текущего проекта и сводка по точкам.
import { state, currentProject, pointsSorted, infoOf, getRepo } from '../store.js';
import { projectForm } from './projects.js';
import { pointForm, generatorForm } from './points.js';
import { openToday } from './doh.js';
import { h, formModal, confirmDialog, toast } from '../ui.js';
import { getToken, realApi } from '../google.js';
import { syncManagers } from '../managers.js';

// Тестовый режим (?mem=1): вместо Google — заглушка, вызовы пишутся в window.__gcalls
function testApi() {
  const calls = (window.__gcalls = []); const rec = (n) => (...a) => { calls.push([n, ...a]); return Promise.resolve(n === 'sheetsOf' ? [] : { id: 'FILE1', name: 'x' }); };
  return { fileInfo: rec('fileInfo').bind(null), copy: rec('copy'), rename: rec('rename'), batch: rec('batch'), clear: rec('clear'), write: rec('write'),
    sheetsOf: async (...a) => { calls.push(['sheetsOf', ...a]); return ['Проекты', 'Точки', 'Журнал', 'Типы точек', 'Конфигурации', 'Статус'].map((title, i) => ({ sheetId: i, title, gridProperties: { rowCount: 1000, columnCount: 26 } })); } };
}
let syncing = false;
export async function updateManagerTable() {
  const p = currentProject(); if (!p || syncing) return;
  syncing = true;
  try {
    toast('Обновляю таблицу для руководства…');
    const api = new URLSearchParams(location.search).get('mem') ? testApi() : realApi(await getToken());
    const res = await syncManagers(api, p, state.ctx);
    getRepo().saveProject(p.id, res.patch);
    toast(res.message);
  } catch (e) {
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

function summary() {
  const ctx = state.ctx; const rows = new Map();
  pointsSorted().forEach((pt) => {
    const info = infoOf(pt);
    const r = rows.get(pt.typeId) || { total: 0, pulled: 0, installed: 0, checked: 0, bad: 0 };
    r.total += 1; if (info.pulled) r.pulled += 1;
    if (info.install === 'Установлено' || info.checked) r.installed += 1;
    if (info.checked) r.checked += 1; if (info.status === 'Неисправна') r.bad += 1;
    rows.set(pt.typeId, r);
  });
  if (!rows.size) return h('div', { class: 'mut' }, 'Точек пока нет. Добавьте их кнопкой ниже.');
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

function inviteForm(p) {
  formModal({
    title: 'Пригласить в проект', submitLabel: 'Пригласить',
    fields: [{ key: 'email', label: 'Почта Google коллеги', required: true, hint: 'Коллега входит в приложение этой почтой и принимает приглашение. Права у всех равные.' }],
    onSubmit: (v) => {
      try { getRepo().invite(p, v.email); } catch (e) { toast(e.message); return false; }
      toast('Приглашение отправлено — пусть коллега откроет приложение');
    },
  });
}

function members(p) {
  const me = getRepo().user.email?.toLowerCase();
  const invited = p.invitedEmails || [];
  return h('div', { class: 'card' }, h('b', {}, 'Участники'),
    h('div', { style: { marginTop: '6px' } }, (p.memberEmails || []).map((e) =>
      h('div', { class: 'mut' }, `${e}${e === me ? ' (вы)' : ''}`))),
    invited.length ? h('div', { style: { marginTop: '8px' } }, h('div', { class: 'mut' }, 'Приглашены, ещё не вошли:'),
      invited.map((e) => h('div', { class: 'item', style: { padding: '6px 0' } }, h('div', { class: 'name' }, e),
        h('button', { class: 'sec', style: { flex: 'none' }, onclick: async () => {
          if (await confirmDialog(`Отозвать приглашение для ${e}?`, { yes: 'Отозвать', danger: true })) getRepo().cancelInvite(p, e);
        } }, '✕')))) : null,
    h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => inviteForm(p) }, '➕ Пригласить коллегу')));
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
    members(p),
    h('div', { class: 'card' }, h('b', {}, 'Точки'), h('div', { style: { marginTop: '8px' } }, summary()),
      h('div', { class: 'btns' },
        h('button', { onclick: () => generatorForm() }, '➕ Добавить точки'),
        h('button', { class: 'sec', onclick: () => pointForm(null) }, 'Новая точка'),
        h('button', { class: 'sec', onclick: () => ui.go('meter') }, '📏 Метраж'))),
    h('div', { class: 'btns' },
      h('button', { onclick: () => openToday(ui) }, '📝 Сегодня'),
      h('button', { class: 'sec', onclick: () => projectForm(p, ui) }, 'Редактировать проект'),
      h('button', { class: 'sec', onclick: () => ui.open('projects') }, 'Все проекты'),
      h('button', { class: 'sec', onclick: updateManagerTable }, '🔄 Обновить таблицу для руководства'),
      p.managerLink ? h('button', { class: 'sec', onclick: () => window.open(p.managerLink, '_blank') }, '📊 Открыть таблицу руководства') : null));
}
