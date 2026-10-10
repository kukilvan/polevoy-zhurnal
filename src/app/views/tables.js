// Экран «Таблицы для руководства»: профили (какие шкафы, типы, статусы и столбцы попадут в Google-таблицу).
import { h, formModal, confirmDialog, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { COLUMNS, STATUS_KEYS, NO_CABINET, tablesOf, buildReport, fileTitle } from '../../domain/index.js';
import { updateTable } from './project.js';

const when = (iso) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

// Чек-лист «выбрать часть из всего»: пустой выбор означает «все»
function pickList(options, selected, onChange) {
  const sel = new Set(selected || []);
  const box = h('div', { class: 'picklist' });
  const render = () => {
    box.replaceChildren(
      h('label', { class: 'pickrow' }, h('input', { type: 'checkbox', checked: sel.size === 0, onchange: () => { sel.clear(); render(); onChange(); } }), h('span', {}, 'Все')),
      ...options.map((o) => h('label', { class: 'pickrow' },
        h('input', { type: 'checkbox', checked: sel.has(o.value), onchange: (e) => { e.target.checked ? sel.add(o.value) : sel.delete(o.value); render(); onChange(); } }),
        h('span', {}, o.label))));
  };
  render();
  return { el: box, get: () => options.map((o) => o.value).filter((v) => sel.has(v)) };
}

// Столбцы: галочка «показывать» и порядок стрелками
function columnList(selected, lang, onChange) {
  const on = new Set(selected || []);
  let order = [...(selected || []), ...COLUMNS.map((c) => c.id).filter((id) => !on.has(id))];
  const box = h('div', { class: 'picklist' });
  const render = () => {
    box.replaceChildren(...order.map((id, i) => {
      const c = COLUMNS.find((x) => x.id === id);
      const move = (d) => { const j = i + d; if (j < 0 || j >= order.length) return; [order[i], order[j]] = [order[j], order[i]]; render(); onChange(); };
      return h('div', { class: 'pickrow' },
        h('input', { type: 'checkbox', checked: on.has(id), onchange: (e) => { e.target.checked ? on.add(id) : on.delete(id); render(); onChange(); } }),
        h('span', {}, c.ru), h('small', {}, c.he),
        h('button', { type: 'button', class: 'sec', style: { padding: '2px 10px' }, onclick: () => move(-1) }, '▲'),
        h('button', { type: 'button', class: 'sec', style: { padding: '2px 10px' }, onclick: () => move(1) }, '▼'));
    }));
  };
  render();
  return { el: box, get: () => order.filter((id) => on.has(id)) };
}

export function tableForm(table) {
  const repo = getRepo(); const p = currentProject(); const ctx = state.ctx; const list = tablesOf(p);
  const mine = [...ctx.points.values()].filter((x) => x.projectId === p.id);
  const cabs = [...new Set(mine.map((x) => x.cabinet || NO_CABINET))].sort((a, b) => (a === NO_CABINET ? 1 : b === NO_CABINET ? -1 : a.localeCompare(b, 'ru', { numeric: true })));
  const types = [...ctx.types.values()].map((t) => t.id);
  const base = table || { name: '', lang: 'ru', cabinets: [], types: [], statuses: [], layout: 'one', summary: true,
    columns: ['label', 'planName', 'cabinet', 'floor', 'type', 'cable', 'status', 'pulled', 'hived', 'installed', 'checked'] };
  formModal({
    title: table ? `Таблица «${table.name}»` : 'Новая таблица', submitLabel: 'Сохранить',
    values: { name: base.name, fileName: base.fileName || fileTitle(p, base), lang: base.lang, layout: base.layout || 'one', summary: base.summary !== false, main: !!base.main },
    fields: [
      { key: 'name', label: 'Название таблицы', required: true, hint: 'Для себя: например «Для руководства» или «Для заказчика»' },
      { key: 'fileName', label: 'Название файла в Google Диске', hint: 'Применится при следующем «Обновить». Пусто — название по умолчанию' },
      { key: 'lang', label: 'Язык таблицы', type: 'select', options: [{ value: 'he', label: 'Иврит (справа налево)' }, { value: 'ru', label: 'Русский' }] },
      { key: 'cabinets', label: 'Шкафы', type: 'custom', build: (api) => pickList(cabs.map((c) => ({ value: c, label: c === NO_CABINET ? 'Без шкафа' : `Шкаф ${c}` })), base.cabinets, api.changed) },
      { key: 'types', label: 'Типы точек', type: 'custom', build: (api) => pickList(types.map((t) => ({ value: t, label: t })), base.types, api.changed) },
      { key: 'statuses', label: 'Статусы точек', type: 'custom', hint: 'Например, только «Неисправна» — получится список проблем', build: (api) => pickList(STATUS_KEYS.map((t) => ({ value: t, label: t })), base.statuses, api.changed) },
      { key: 'columns', label: 'Столбцы (порядок стрелками)', type: 'custom', required: true, build: (api) => columnList(base.columns, base.lang, api.changed) },
      { key: 'layout', label: 'Раскладка', type: 'select', options: [{ value: 'one', label: 'Все точки одним листом' }, { value: 'perCabinet', label: 'Каждый шкаф на отдельном листе' }] },
      { key: 'summary', label: 'Итоги сверху (всего, протянуто, захивучено…)', type: 'checkbox' },
      { key: 'main', label: 'Основная таблица для руководства', type: 'checkbox', hint: 'Её обновляет кнопка на вкладке «Проект»', visible: () => !table?.main },
    ],
    preview: (v) => {
      try { const r = buildReport(p, ctx, { ...base, ...v, lang: v.lang || 'he', layout: v.layout || 'one' }); return `Будет точек: ${r.pointCount}, столбцов: ${r.colCount}, листов: ${r.sheets.length}`; } catch (e) { return e.message; }
    },
    extra: table && list.length > 1 ? [{ label: 'Удалить', kind: 'danger', onClick: async () => {
      if (!(await confirmDialog(`Удалить таблицу «${table.name}» из приложения? Сам файл в Google Диске останется, его можно удалить вручную.`, { yes: 'Удалить', danger: true }))) return false;
      const left = list.filter((t) => t.id !== table.id);
      if (!left.some((t) => t.main)) left[0] = { ...left[0], main: true };
      repo.saveProject(p.id, { tables: left }); toast('Таблица удалена'); return true;
    } }] : [],
    onSubmit: (v) => {
      const t = {
        ...(table || {}), id: table?.id || `t_${Date.now().toString(36)}`, name: v.name, lang: v.lang || 'he', cabinets: v.cabinets || [], types: v.types || [],
        fileName: (v.fileName || '').trim() && (v.fileName || '').trim() !== fileTitle(p, { ...(table || {}), name: v.name, lang: v.lang || 'he', fileName: '' }) ? v.fileName.trim() : '',
        statuses: v.statuses || [], columns: v.columns, layout: v.layout || 'one', summary: !!v.summary, main: table?.main || !!v.main,
      };
      let next = table ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t];
      if (t.main) next = next.map((x) => ({ ...x, main: x.id === t.id }));
      repo.saveProject(p.id, { tables: next });
      toast('Сохранено');
    },
  });
}

export function tablesView(ui) {
  const p = currentProject(); const list = tablesOf(p);
  const card = (t) => h('div', { class: 'card' },
    h('div', { style: { fontWeight: 700, fontSize: '16px' } }, t.name, t.main ? h('span', { class: 'pill st-ok', style: { marginInlineStart: '8px' } }, 'основная') : null),
    h('div', { class: 'mut', style: { marginTop: '4px' } },
      `${t.lang === 'ru' ? 'Русский' : 'Иврит'} · столбцов: ${(t.columns || []).length} · ${t.layout === 'perCabinet' ? 'шкаф на листе' : 'один лист'}`),
    h('div', { class: 'mut' }, `Шкафы: ${(t.cabinets || []).length ? (t.cabinets || []).map((c) => (c === NO_CABINET ? 'без шкафа' : c)).join(', ') : 'все'} · Типы: ${(t.types || []).length ? t.types.join(', ') : 'все'}${(t.statuses || []).length ? ` · Статусы: ${t.statuses.join(', ')}` : ''}`),
    h('div', { class: 'mut' }, t.syncedAt ? `Обновлена: ${when(t.syncedAt)}` : 'Ещё не создавалась'),
    h('div', { class: 'btns' },
      h('button', { onclick: () => updateTable(t.id) }, '🔄 Обновить'),
      t.link ? h('button', { class: 'sec', onclick: () => window.open(t.link, '_blank') }, '📊 Открыть') : null,
      h('button', { class: 'sec', onclick: () => tableForm(t) }, '✏️ Изменить')));
  return h('div', {},
    h('div', { class: 'mut', style: { margin: '0 2px 10px' } }, 'Таблицу создаёт и заполняет приложение (значениями, без формул). Здесь выбирается, что в неё попадёт. Основная обновляется кнопкой на вкладке «Проект».'),
    h('div', { class: 'btns', style: { marginTop: 0, marginBottom: '10px' } }, h('button', { onclick: () => tableForm(null) }, '➕ Новая таблица')),
    list.map(card));
}
