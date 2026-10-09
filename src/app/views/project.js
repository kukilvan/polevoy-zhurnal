// Вкладка «Проект»: карточка текущего проекта и сводка по точкам.
import { h } from '../ui.js';
import { state, currentProject, pointsSorted, infoOf } from '../store.js';
import { projectForm } from './projects.js';
import { pointForm, generatorForm } from './points.js';

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
    h('div', { class: 'card' }, h('b', {}, 'Точки'), h('div', { style: { marginTop: '8px' } }, summary()),
      h('div', { class: 'btns' },
        h('button', { onclick: () => generatorForm() }, '➕ Добавить точки'),
        h('button', { class: 'sec', onclick: () => pointForm(null) }, 'Новая точка'),
        h('button', { class: 'sec', onclick: () => ui.go('meter') }, '📏 Метраж'))),
    h('div', { class: 'btns' },
      h('button', { class: 'sec', onclick: () => projectForm(p, ui) }, 'Редактировать проект'),
      h('button', { class: 'sec', onclick: () => ui.open('projects') }, 'Все проекты'),
      p.managerLink ? h('button', { class: 'sec', onclick: () => window.open(p.managerLink, '_blank') }, '📊 Таблица для руководства') : null));
}
