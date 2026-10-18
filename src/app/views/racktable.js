// «📊 Таблица для шильюта»: один файл Google Таблицы на проект (папка проекта «Шкафы»): лист-план на каждый шкаф + общий лист шильюта.
// Повторное создание обновляет тот же файл. Значения пишутся прямо в ячейки — листы можно копировать и отправлять по отдельности.
import { h, openModal, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { getToken, realApi, clearToken } from '../google.js';
import { buildRackSheets, cabinetsOf, MODES } from '../../domain/shilutsheet.js';
import { rebuildRackSheets } from '../racksheet.js';

const mem = () => new URLSearchParams(location.search).get('mem');
const when = (iso) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const prefs = () => getRepo().prefs || {};
const build = (p, opts) => buildRackSheets(p, state.ctx, [...state.ctx.points.values()], { mode: opts.mode, cabs: opts.cabs, colors: prefs().shilutColors || [], models: prefs().panelModels || [] });
const defaults = (p) => { const rt = p.rackTable || {}; const all = cabinetsOf(p, [...state.ctx.points.values()], state.ctx);
  return { mode: rt.mode || MODES.fill, cabs: rt.cabs?.length ? rt.cabs.filter((k) => all.some((c) => c.key === k)) : all.filter((c) => c.count > 0).map((c) => c.key) }; };

// Заглушка Диска для проверки в браузере (?mem=1)
function testApi() {
  const calls = (window.__gcalls = window.__gcalls || []); const files = (window.__gfiles = window.__gfiles || {});
  return {
    fileInfo: async (id) => files[id] || null,
    create: async (name) => { const id = `RFILE${Object.keys(files).length + 1}`; files[id] = { id, name }; calls.push(['create', name]); return files[id]; },
    placeIn: async (id, p, kind) => { calls.push(['placeIn', id, kind]); return true; },
    rename: async (id, name) => { calls.push(['rename', id, name]); files[id].name = name; },
    sheetsOf: async () => [{ sheetId: 0, title: 'Sheet1' }],
    batch: async (id, requests) => { calls.push(['batch', id, requests.length]); window.__gbatch = requests; },
    write: async (id, data) => { calls.push(['write', id, data]); window.__gwrite = data; },
  };
}

let busy = false;
export async function generateRackTable(opts = null, retried = false) {
  const p = currentProject(); if (!p || busy) return; busy = true;
  try {
    const rt = p.rackTable || {};
    const o = opts || defaults(p);
    if (opts) getRepo().saveProject(p.id, { rackTable: { ...rt, mode: o.mode, cabs: o.cabs } });   // запоминаем: после входа в Google на iPhone продолжим с теми же настройками
    const res = build(p, o);
    if (!res.count) { toast('Нет шкафов с планом: сначала постройте план в «🗄 Шкафы и шильют»'); return; }
    toast('Создаю таблицу на Диске…');
    const api = mem() ? testApi() : realApi(await getToken('racks'));
    const uid = getRepo().user.uid;
    let file = rt.fileId ? await api.fileInfo(rt.fileId) : null;
    if (!file && rt.fileId && rt.by && rt.by !== uid) throw new Error('Эту таблицу создал другой участник проекта, у вас нет к ней доступа. Обновить её может он.');
    const title = `Шкафы и шильют — ${p.name}`;
    const patch = { mode: o.mode, cabs: o.cabs };
    if (!file) { file = await api.create(title); patch.by = uid; }
    patch.fileId = file.id; patch.link = `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
    try { await api.placeIn(file.id, p, 'racks'); } catch (e) { console.warn('placeIn', e); }
    getRepo().saveProject(p.id, { rackTable: { ...rt, ...patch } });  // файл создан — запоминаем сразу, чтобы повтор не плодил новые
    await rebuildRackSheets(api, file.id, res.sheets);
    if (file.name !== title) await api.rename(file.id, title);
    getRepo().saveProject(p.id, { rackTable: { ...rt, ...patch, at: new Date().toISOString() } });
    toast(`Таблица готова: листов ${res.sheets.length}${res.warnings.length ? `. Внимание: ${res.warnings.join('; ')}` : ''}`);
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
    h('div', { class: 'mut', style: { margin: '4px 0' } }, 'Файл Google Таблицы в папке проекта «Шкафы»: лист-план на каждый шкаф и общий лист шильюта. Повторное создание обновляет тот же файл.'),
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
  const upd = () => { const r = build(p, { mode: o.mode, cabs: [...sel] }); warn.replaceChildren(...r.warnings.map((w) => h('div', { style: { fontSize: '14px', color: '#ff9f0a' } }, `⚠️ ${w}`))); go.disabled = !sel.size; };
  const radio = (v, title, hint) => h('label', { class: 'pickrow', style: { alignItems: 'flex-start' } },
    h('input', { type: 'radio', name: 'rt-mode', checked: o.mode === v, onchange: () => { o.mode = v; upd(); } }), h('span', {}, h('b', {}, title), h('div', { class: 'mut', style: { fontSize: '13px' } }, hint)));
  const go = h('button', { onclick: () => { close(); generateRackTable({ mode: o.mode, cabs: [...sel] }).then(() => ui.render()); } }, '📊 Создать / обновить');
  const close = openModal('📊 Таблица для шильюта', h('div', {},
    h('div', { class: 'mut' }, 'Лист-план строится для каждого выбранного шкафа. Лист шильюта — общий.'),
    h('div', { style: { fontWeight: 700, margin: '10px 0 2px' } }, 'Как собрать лист шильюта'),
    radio(MODES.fill, 'Заполнять по 24 одного типа', 'Точки одного типа из всех выбранных шкафов подряд, по 24 в столбце, без пустых мест; между типами — пустой столбец.'),
    radio(MODES.split, 'Как в панелях: по типам и шкафам', 'Столбец на каждую панель (смешанные типы — отдельными столбцами, каждый своего цвета). Подписи идут подряд с первой строки, без пропусков; между типами — один пустой столбец, между шкафами — два.'),
    h('div', { style: { fontWeight: 700, margin: '10px 0 2px' } }, 'Шкафы'),
    ...cabs.map((c) => h('label', { class: 'pickrow' }, h('input', { type: 'checkbox', checked: sel.has(c.key), onchange: (e) => { e.target.checked ? sel.add(c.key) : sel.delete(c.key); upd(); } }),
      h('span', {}, c.name, h('small', { class: 'mut' }, ` · ${c.sub.height}U · расставлено портов ${c.count}`)))),
    warn, h('div', { class: 'btns' }, go)), { sticky: true });
  upd();
}
