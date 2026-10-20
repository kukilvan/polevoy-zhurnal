// «📊 Таблица для шильюта»: один файл Google Таблицы «תכנון ארונות ושילוט» на проект (папка проекта «Для руководства»): лист-план на каждый шкаф + общий лист шильюта.
// Повторное создание обновляет тот же файл. Значения пишутся прямо в ячейки — листы можно копировать и отправлять по отдельности.
import { h, openModal, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { getToken, realApi, clearToken } from '../google.js';
import { buildRackSheets, cabinetsOf, MODES } from '../../domain/shilutsheet.js';
import { syncRackTable, RACK_TITLE } from '../racktablecore.js';

const mem = () => new URLSearchParams(location.search).get('mem');
const when = (iso) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const prefs = () => getRepo().prefs || {};
const build = (p, opts) => buildRackSheets(p, state.ctx, [...state.ctx.points.values()], { mode: opts.mode, mergeColors: !!opts.mergeColors, cabs: opts.cabs, colors: prefs().shilutColors || [], models: prefs().panelModels || [] });
const defaults = (p) => { const rt = p.rackTable || {}; const all = cabinetsOf(p, [...state.ctx.points.values()], state.ctx);
  return { auto: rt.auto ?? true, mode: rt.mode || MODES.fill, mergeColors: !!rt.mergeColors, cabs: rt.cabs?.length ? rt.cabs.filter((k) => all.some((c) => c.key === k)) : all.filter((c) => c.count > 0).map((c) => c.key) }; };

// Заглушка Диска для проверки в браузере (?mem=1)
function testApi() {
  const calls = (window.__gcalls = window.__gcalls || []); const files = (window.__gfiles = window.__gfiles || {});
  return {
    fileInfo: async (id) => files[id] || null,
    create: async (name) => { const id = `RFILE${Object.keys(files).length + 1}`; files[id] = { id, name }; calls.push(['create', name]); return files[id]; },
    placeIn: async (id, p, kind) => { calls.push(['placeIn', id, kind]); return true; },
    share: async (id, email) => { calls.push(['share', id, email]); },
    rename: async (id, name) => { calls.push(['rename', id, name]); files[id].name = name; },
    sheetsOf: async () => [{ sheetId: 0, title: 'Sheet1' }],
    batch: async (id, requests) => { calls.push(['batch', id, requests.length]); window.__gbatch = requests; },
    write: async (id, data) => { calls.push(['write', id, data]); window.__gwrite = data; },
  };
}

let busy = false;
// Личные настройки автора (модели панелей, свои цвета) копируются в проект: по ним таблицу собирает и сервер
const prefsCopy = () => ({ models: prefs().panelModels || [], colors: prefs().shilutColors || [] });
export async function generateRackTable(opts = null, retried = false) {
  const p = currentProject(); if (!p || busy) return; busy = true;
  try {
    const rt = p.rackTable || {};
    const o = opts || defaults(p);
    const next = { ...rt, mode: o.mode, mergeColors: !!o.mergeColors, cabs: o.cabs, auto: o.auto ?? rt.auto ?? true, prefs: prefsCopy() };
    getRepo().saveProject(p.id, { rackTable: next });   // запоминаем: после входа в Google на iPhone продолжим с теми же настройками
    const proj = { ...p, rackTable: next };
    if (!build(proj, o).count) { toast('Нет шкафов с планом: сначала постройте план в «🗄 Шкафы и шильют»'); return; }
    toast('Создаю таблицу на Диске…');
    const api = mem() ? testApi() : realApi(await getToken('racks'));
    let r;
    try { r = await syncRackTable(api, proj, state.ctx, { force: true, uid: getRepo().user.uid, shareWith: p.serverEmail || '' }); } catch (e) { if (e.patch) getRepo().saveProject(p.id, { rackTable: { ...next, ...e.patch } }); throw e; }
    getRepo().saveProject(p.id, { rackTable: { ...next, ...r.patch, serverError: '' } });
    const shared = currentProject()?.managers?.shared;
    toast(`Таблица «${RACK_TITLE}» готова (папка «Для руководства»): листов ${r.res.sheets.length}${r.res.warnings.length ? `. Внимание: ${r.res.warnings.join('; ')}` : ''}${shared ? '' : '. Чтобы начальство её увидело: «Для руководства» → «🔄 Обновить всё сейчас»'}`);
  } catch (e) {
    if (e.status === 401 && retried !== true) { clearToken(); busy = false; toast('Доступ Google истёк — запрашиваю заново…'); return generateRackTable(opts, true); }
    const msg = e.status === 403 ? `Нет доступа (${e.message}). Включены ли Google Drive API и Google Sheets API?` : e.message || String(e);
    toast(`Не получилось: ${msg}`); console.error('rack table', e);
  } finally { busy = false; }
}

// Карточка в списке шкафов
export function rackTableCard(ui) {
  const p = currentProject(); const rt = p.rackTable || {};
  return h('div', { class: 'card' },
    h('b', {}, '📊 Таблица для шильюта'),
    h('div', { class: 'mut', style: { margin: '4px 0' } }, `Файл Google Таблицы «${RACK_TITLE}» для руководства — лежит в папке «Для руководства»: лист-план на каждый шкаф и общий лист шильюта. Повторное создание обновляет тот же файл${rt.fileId ? (rt.auto === false ? '; автообновление выключено.' : '; обновляется автоматически вместе с папкой и каждую ночь.') : '.'}`),
    rt.at ? h('div', { class: 'mut', style: { fontSize: '13px' } }, `Обновлена ${when(rt.at)}`) : null,
    h('div', { class: 'btns' },
      h('button', { onclick: () => rackTableModal(ui) }, rt.fileId ? '📊 Обновить таблицу…' : '📊 Создать таблицу…'),
      rt.link ? h('button', { class: 'sec', onclick: () => window.open(rt.link, '_blank') }, '🔗 Открыть') : null));
}

// Окно: режим шильюта и какие шкафы включить
function rackTableModal(ui) {
  const p = currentProject(); const cabs = cabinetsOf(p, [...state.ctx.points.values()], state.ctx);
  if (!cabs.length) { toast('Нет шкафов с планом: сначала постройте план в «🗄 Шкафы и шильют»'); return; }
  const o = defaults(p); const sel = new Set(o.cabs);
  const warn = h('div', { style: { margin: '8px 0' } });
  const upd = () => { const r = build(p, { mode: o.mode, mergeColors: o.mergeColors, cabs: [...sel] }); warn.replaceChildren(...r.warnings.map((w) => h('div', { style: { fontSize: '14px', color: '#ff9f0a' } }, `⚠️ ${w}`))); go.disabled = !sel.size; };
  const radio = (v, title, hint) => h('label', { class: 'pickrow', style: { alignItems: 'flex-start' } },
    h('input', { type: 'radio', name: 'rt-mode', checked: o.mode === v, onchange: () => { o.mode = v; upd(); } }), h('span', {}, h('b', {}, title), h('div', { class: 'mut', style: { fontSize: '13px' } }, hint)));
  const go = h('button', { onclick: () => { close(); generateRackTable({ mode: o.mode, mergeColors: o.mergeColors, cabs: [...sel], auto: o.auto }).then(() => ui.render()); } }, '📊 Создать / обновить');
  const close = openModal('📊 Таблица для шильюта', h('div', {},
    h('div', { class: 'mut' }, 'Лист-план строится для каждого выбранного шкафа. Лист шильюта — общий.'),
    h('div', { style: { fontWeight: 700, margin: '10px 0 2px' } }, 'Как собрать лист шильюта'),
    radio(MODES.fill, 'Заполнять по 24 одного типа', 'Точки одного типа из всех шкафов, порядок как в панелях. «Очередь» — точки одного типа в одной панели. Очередь от 12 точек (и полная панель) начинает свой столбец, свободное место добирают короткие очереди (меньше 12) из любых шкафов, без разрезания. Между типами — пустой столбец.'),
    radio(MODES.split, 'Как в панелях: по типам и шкафам', 'Столбец на каждую панель (смешанные типы — отдельными столбцами, каждый своего цвета). Подписи идут подряд с первой строки, без пропусков; между типами — один пустой столбец, между шкафами — два.'),
    h('label', { class: 'pickrow', style: { alignItems: 'flex-start', marginTop: '6px' } }, h('input', { type: 'checkbox', checked: !!o.mergeColors, onchange: (e) => { o.mergeColors = e.target.checked; upd(); } }),
      h('span', {}, h('b', {}, 'Объединять точки одного цвета'), h('div', { class: 'mut', style: { fontSize: '13px' } }, 'Разные типы, у которых в настройках шильюта выбран один цвет (например, «Кор биометрия» и «Интерком»), идут общими столбцами по 24, а не каждый тип отдельно.'))),
    h('div', { style: { fontWeight: 700, margin: '10px 0 2px' } }, 'Шкафы'),
    ...cabs.map((c) => h('label', { class: 'pickrow' }, h('input', { type: 'checkbox', checked: sel.has(c.key), onchange: (e) => { e.target.checked ? sel.add(c.key) : sel.delete(c.key); upd(); } }),
      h('span', {}, c.name, h('small', { class: 'mut' }, ` · ${c.sub.height}U · расставлено портов ${c.count}`)))),
    h('label', { class: 'pickrow', style: { marginTop: '8px' } }, h('input', { type: 'checkbox', checked: o.auto, onchange: (e) => { o.auto = e.target.checked; } }), h('span', {}, 'Обновлять автоматически (вместе с «Обновить всё сейчас» и каждую ночь на сервере)')),
    warn, h('div', { class: 'btns' }, go)), { sticky: true });
  upd();
}
