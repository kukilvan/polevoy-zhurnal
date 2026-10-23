// Мастер нового проекта.
// Обязательные шаги: данные проекта → типы точек из общего пула → устройства → кабели → работы → итог «Создать проект».
// Что нужно выбранному уровнем выше — серые отмеченные галочки («нужно для: …»), остальное из пула можно добавить.
// После создания — необязательные шаги (каждый можно пропустить): участники, чертежи, точки, для руководства.
import { isLocal } from '../../edition.js';
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { state, getRepo, currentProject, setCurrentProject, subscribe } from '../store.js';
import { POOL_KINDS, POOL_TITLES, poolMaps, depsOf, isSystemType, mainTable, withTable } from '../../domain/index.js';
import { bare } from '../../domain/typelib.js';
import { pool, poolReady, poolHasData, onPool } from '../pool.js';
import { typeFilterOptions } from '../typegroups.js';

const nameOf = (kind, x) => (kind === 'types' || kind === 'cables' ? x.id : x.name || x.id);
const FREE_WORKS = ['Протяжка', 'Перетяжка', 'Перенос', 'Время', 'Доп. работа'];  // работы не по составу точек — отмечены сразу

export function projectWizard(ui) {
  const data = { name: '', contractor: '', object: '', helper: 'Марина', nameHe: '', objectHe: '', helperHe: 'מרינה', oneOff: false, note: '' };
  const picked = { types: new Set(), devices: new Set(), cables: new Set(), catalog: new Set() };
  let step = 0; let started = false; const box = h('div', {});
  const close = openModal('➕ Новый проект', box, { sticky: true, wide: true, onClose: () => off() });
  const off = onPool(() => { if (!started && poolReady()) { started = true; preselectFree(); } if (step > 0) draw(); });
  const maps = () => poolMaps(pool);
  function preselectFree() { [...pool.catalog.values()].filter((w) => FREE_WORKS.includes(w.workType) && w.active !== false).forEach((w) => picked.catalog.add(w.id)); }
  if (poolReady()) { started = true; preselectFree(); }

  // что нужно из-за выбранного уровнем выше: Map id → [кому нужно]
  function required() {
    const m = maps(); const need = { devices: new Map(), cables: new Map(), catalog: new Map() };
    const add = (k, id, who) => { if (!need[k].has(id)) need[k].set(id, []); if (!need[k].get(id).includes(who)) need[k].get(id).push(who); };
    picked.types.forEach((t) => { const d = depsOf(m, 'types', t); d.devices.forEach((x) => add('devices', x.id, t)); d.cables.forEach((x) => add('cables', x.id, t)); d.catalog.forEach((x) => add('catalog', x.id, t)); });
    picked.devices.forEach((id) => { const dv = m.devices.get(id); if (!dv) return; const d = depsOf(m, 'devices', id); d.cables.forEach((x) => add('cables', x.id, dv.name)); d.catalog.forEach((x) => add('catalog', x.id, dv.name)); });
    picked.cables.forEach((id) => { const d = depsOf(m, 'cables', id); d.catalog.forEach((x) => add('catalog', x.id, id)); });
    return need;
  }
  const finalSet = () => { const need = required(); return Object.fromEntries(POOL_KINDS.map((k) => [k, new Set([...picked[k], ...(need[k]?.keys() || [])])])); };

  const field = (key, label, attrs = {}) => h('label', { class: 'field' }, h('span', {}, label), h('input', { value: data[key] || '', oninput: (e) => { data[key] = e.target.value; }, ...attrs }));
  function stepData() {
    return h('div', { class: 'form' },
      field('name', 'Название проекта *', { placeholder: 'Например: Mega Or' }), field('contractor', 'Подрядчик'), field('object', 'Объект'),
      field('helper', 'Помощник по умолчанию'), field('nameHe', 'Название (иврит)'), field('objectHe', 'Объект (иврит)'), field('helperHe', 'Помощник (иврит)'),
      h('label', { class: 'pickrow' }, h('input', { type: 'checkbox', checked: data.oneOff, onchange: (e) => { data.oneOff = e.target.checked; } }), h('span', {}, 'Разовый выезд (объект указывается в каждом дне)')));
  }
  let q = ''; let fGroup = '';
  function stepPick(kind) {
    const m = maps(); const need = kind === 'types' ? new Map() : required()[kind];
    let items = [...m[kind].values()].filter((x) => !(kind === 'types' && isSystemType(x)) && !x.deleted);
    items.sort((a, b) => nameOf(kind, a).localeCompare(nameOf(kind, b), 'ru', { numeric: true }));
    if (!items.length) return h('div', { class: 'empty' }, 'В общем пуле этого раздела пока ничего нет.');
    const shown = items.filter((x) => (!q || `${nameOf(kind, x)} ${x.nameHe || ''}`.toLowerCase().includes(q)) && (kind !== 'types' || !fGroup || (fGroup.startsWith('grp:') ? String(x.group || '') === fGroup.slice(4) : x.id === fGroup)));
    const cur = currentProject();
    const sub = (x) => {
      if (kind === 'types') return (x.devices || []).map((d) => `${m.devices.get(d.deviceId)?.name || d.deviceId}${d.count > 1 ? ` ×${d.count}` : ''}`).join(' + ') || x.nameHe || '';
      if (kind === 'devices') return `${(x.cables || []).map((c) => `${c.cable}×${c.count}`).join(' + ') || 'без кабеля'}`;
      if (kind === 'cables') return (x.workIds || []).map((w) => m.catalog.get(w)?.name || w).join(', ') || 'без работ';
      return `${x.workType || ''}${x.unit ? ` · ${x.unit}` : ''}`;
    };
    const search = h('input', { type: 'search', placeholder: 'Поиск', value: q, oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); setTimeout(() => box.querySelector('input[type=search]')?.focus(), 0); } });
    const groupSel = kind === 'types' ? h('select', { onchange: (e) => { fGroup = e.target.value; draw(); } }, h('option', { value: '' }, 'Все типы'),
      ...typeFilterOptions(items.map((x) => x.id)).filter(([v]) => v.startsWith('grp:')).map(([v, t]) => h('option', { value: v, selected: v === fGroup }, t))) : null;
    const fromProject = kind === 'types' && cur && state.ctx ? h('button', { class: 'sec', onclick: () => {
      POOL_KINDS.forEach((k) => state.ctx[k].forEach((x, id) => { if (m[k].has(id)) picked[k].add(id); })); toast(`Отмечено всё из «${cur.name}», что есть в пуле`); draw();
    } }, `Взять набор из «${cur.name}»`) : null;
    const rows = shown.map((x) => {
      const req = need.get(x.id);
      const cb = h('input', { type: 'checkbox', checked: !!req || picked[kind].has(x.id), disabled: !!req, onchange: (e) => { e.target.checked ? picked[kind].add(x.id) : picked[kind].delete(x.id); draw(); } });
      return h('label', { class: 'pickrow' }, cb, h('span', { style: { flex: 1 } }, h('b', {}, nameOf(kind, x)), h('div', { class: 'sub mut' }, sub(x)),
        req ? h('div', { class: 'sub mut' }, `нужно для: ${req.slice(0, 4).join(', ')}${req.length > 4 ? '…' : ''}`) : null));
    });
    return h('div', {},
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' } }, search, groupSel, fromProject,
        h('button', { class: 'sec', onclick: () => { shown.forEach((x) => picked[kind].add(x.id)); draw(); } }, 'Все показанные'),
        h('button', { class: 'sec', onclick: () => { picked[kind].clear(); draw(); } }, 'Снять')),
      h('div', { class: 'picklist', style: { maxHeight: '50vh' } }, rows.length ? rows : h('div', { class: 'empty' }, 'Ничего не найдено')));
  }
  function stepSummary() {
    const f = finalSet();
    return h('div', {},
      h('div', { style: { fontSize: '18px', fontWeight: 700 } }, data.name || '—'),
      h('div', { class: 'mut' }, [data.contractor, data.object].filter(Boolean).join(' · ')),
      h('ul', {}, POOL_KINDS.map((k) => h('li', {}, `${POOL_TITLES[k]}: ${f[k].size}`))),
      h('div', { class: 'mut' }, 'Плюс служебное: единицы, виновники, причины задержки, конфигурации дверей. Всё остальное можно добавить потом из «🗂 Общий пул» в справочниках.'));
  }
  const STEPS = [
    ['Данные проекта', stepData], ['Типы точек', () => stepPick('types')], ['Устройства', () => stepPick('devices')],
    ['Кабели', () => stepPick('cables')], ['Работы', () => stepPick('catalog')], ['Итог', stepSummary],
  ];
  async function create() {
    if (!data.name.trim()) { toast('Впишите название проекта'); step = 0; draw(); return; }
    const noPool = !poolHasData();
    if (!new URLSearchParams(location.search).get('mem') && !isLocal() && (!poolReady() || noPool)) { toast('Общий пул ещё не скачан на телефон. Подключитесь к интернету, подождите минуту и повторите — иначе проект создастся пустым'); return; }
    const f = finalSet(); const m = maps();
    if (!f.types.size && !(isLocal() && noPool) && !new URLSearchParams(location.search).get('mem') && !(await confirmDialog('Не выбран ни один тип точек: проект создастся без типов, добавлять точки будет нельзя, пока вы не добавите типы из общего пула. Всё равно создать?', { yes: 'Создать без типов' }))) { step = 1; draw(); return; }
    // на устройстве без пула (стартовый набор не загружен) — встроенный набор справочников
    const refs = isLocal() && noPool ? null : Object.fromEntries(POOL_KINDS.map((k) => [k, [...f[k]].map((id) => m[k].get(id)).filter(Boolean).map((x) => bare(x))]));
    const pid = getRepo().createProject({ ...data, name: data.name.trim(), oneOff: !!data.oneOff }, refs);
    setCurrentProject(pid, { pending: true });
    close(); ui.go('project'); toast('Проект создан');
    setTimeout(() => afterCreate(pid, ui), 200);
  }
  function draw() {
    const [title, fn] = STEPS[step];
    // при перерисовке (галочка) не прыгать наверх: запоминаем прокрутку списка и окна
    const pl = box.querySelector('.picklist'); const keepList = pl?.scrollTop || 0; const body = box.closest('.sheet-body'); const keepBody = body?.scrollTop || 0; const sameStep = box.dataset.step === String(step);
    box.dataset.step = String(step);
    box.replaceChildren(
      h('div', { class: 'mut', style: { marginBottom: '6px' } }, `Шаг ${step + 1} из ${STEPS.length}: `, h('b', {}, title),
        step > 0 && step < 5 && !poolReady() ? ' · загружаю общий пул…' : ''),
      fn(),
      h('div', { class: 'btns' },
        step > 0 ? h('button', { class: 'sec', onclick: () => { step--; q = ''; draw(); } }, '← Назад') : null,
        step < STEPS.length - 1 ? h('button', { onclick: () => { if (step === 0 && !data.name.trim()) { toast('Впишите название проекта'); return; } step++; q = ''; draw(); } }, 'Далее →')
          : h('button', { onclick: create }, '✅ Создать проект')));
    if (sameStep) { const pl2 = box.querySelector('.picklist'); if (pl2) pl2.scrollTop = keepList; if (body) body.scrollTop = keepBody; }
  }
  draw();
}

// Необязательные шаги после создания: участники, чертежи, точки, для руководства. На каждом — «Пропустить».
function afterCreate(pid, ui) {
  let step = 0; const box = h('div', {});
  const close = openModal('Настройка проекта (можно пропустить)', box, { sticky: true, wide: true, onClose: () => unsub() });
  let shown = false; const unsub = subscribe(() => { if (!shown && ready()) draw(); });
  const ready = () => currentProject()?.id === pid;
  const next = () => { step++; if (step >= STEPS.length) { close(); toast('Готово'); return; } draw(); };
  function members() {
    const ta = h('textarea', { rows: 3, placeholder: 'Почты Google через запятую или с новой строки' });
    return [h('div', { class: 'mut' }, 'Пригласить помощника и коллег: они увидят проект после входа со своей почтой Google.'), ta,
      h('button', { onclick: () => {
        const list = ta.value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean); let n = 0;
        list.forEach((e) => { try { getRepo().invite(currentProject(), e); n++; } catch (err) { toast(`${e}: ${err.message}`); } });
        if (n) toast(`Приглашено: ${n}`); next();
      } }, 'Пригласить и дальше')];
  }
  const added = []; // чертежи, добавленные на шаге «Чертежи» (для выбора на шаге «Точки»)
  function drawings() {
    const rows = h('div', {}); const files = [];
    const paint = () => rows.replaceChildren(...files.map((x) => h('div', { class: 'pickrow' }, h('span', { style: { flex: 1 } }, x.name, x.fileId ? h('small', { class: 'mut' }, '  · с Диска') : null), x.floor)));
    const addOne = async () => { const { pickPdf } = await import('./pdfpick.js'); const rs = await pickPdf({ title: 'Тохниты для проекта', project: false, multiple: true }); if (!rs?.length) return;
      let dup = 0;
      for (const r of rs) {
        if (files.some((x) => x.name === r.name)) { dup++; continue; }
        files.push({ ...r, floor: h('input', { placeholder: 'этаж', style: { width: '90px' }, value: (r.name.match(/(-?\d+(?:\.\d+)?)/) || [])[1] || '' }) });
      }
      if (dup) toast(`Уже в списке: ${dup}`); paint(); };
    return [h('div', { class: 'mut' }, 'Тохниты проекта: с устройства или уже лежащие на Google Диске (без повторной загрузки). Для каждого можно указать этаж.'),
      h('button', { class: 'sec', onclick: addOne }, '➕ Добавить тохниты'), rows,
      h('button', { onclick: async () => {
        if (!files.length) { next(); return; }
        const { addDrawing } = await import('../drawings.js'); const { makeWorker } = await import('./tohnitview.js');
        for (const x of files) {
          try { const wk = makeWorker(); const o = await wk.call('openDoc', { data: x.buf.slice(0) }); wk.stop();
            const d = await addDrawing(x.buf, { name: x.name, floor: x.floor.value.trim(), pages: o.pages, fileId: x.fileId || null }); if (d) added.push(d); } catch (e) { toast(`${x.name}: ${e.message}`); }
        }
        toast(`Чертежей добавлено: ${files.length}`); next();
      } }, 'Добавить и дальше')];
  }
  function points() {
    return [h('div', { class: 'mut' }, 'Точки можно добавить сразу: из файла (после разбора тохнита) или разобрать тохниты проекта («📐 Добавить точки из чертежа»: разобранные отмечаются ✅, внизу — «Дальше»). Потом здесь — «Дальше» или «Пропустить».'),
      h('div', { class: 'btns' },
        h('button', { class: 'sec', onclick: () => import('./tohnitview.js').then((m) => m.drawingsHub({ extra: added, onNext: () => {} })) }, '📐 Добавить точки из чертежа')),
      h('button', { onclick: next }, 'Дальше')];
  }
  function managers() {
    const p = currentProject(); const t = mainTable(p);
    const lang = h('select', {}, h('option', { value: 'he', selected: t.lang !== 'ru' }, 'Иврит'), h('option', { value: 'ru', selected: t.lang === 'ru' }, 'Русский'));
    const layout = h('select', {}, h('option', { value: 'one' }, 'Все точки одним листом'), h('option', { value: 'perCabinet', selected: t.layout === 'perCabinet' }, 'Каждый шкаф на отдельном листе'));
    const summary = h('input', { type: 'checkbox', checked: t.summary !== false });
    const folder = h('input', { type: 'checkbox', checked: true });
    return [h('div', { class: 'mut' }, 'Основная таблица для руководства и папка со ссылкой для руководства. Сами файлы создадутся при первом обновлении (нужно разрешение Google).'),
      h('label', { class: 'field' }, h('span', {}, 'Язык таблицы'), lang), h('label', { class: 'field' }, h('span', {}, 'Раскладка'), layout),
      h('label', { class: 'pickrow' }, summary, h('span', {}, 'Итоги сверху')),
      h('label', { class: 'pickrow' }, folder, h('span', {}, '📁 Папка для руководства со ссылкой (таблица в ней)')),
      h('button', { onclick: async () => {
        const pp = currentProject(); getRepo().saveProject(pp.id, { tables: withTable(pp, mainTable(pp).id, { lang: lang.value, layout: layout.value, summary: summary.checked, inFolder: folder.checked }) });
        if (folder.checked) { const m = await import('./managersfolder.js'); setTimeout(() => m.updateManagersFolder(), 300); }
        next();
      } }, folder.checked ? 'Сохранить и создать папку' : 'Сохранить')];
  }
  const STEPS = [['Участники', members], ['Чертежи', drawings], ['Точки', points], ['Для руководства', managers]];
  function draw() {
    if (!ready()) { box.replaceChildren(h('div', { class: 'mut' }, 'Сохраняю проект…')); return; }
    shown = true;
    const [title, fn] = STEPS[step];
    box.replaceChildren(h('div', { class: 'mut', style: { marginBottom: '6px' } }, `${step + 1} из ${STEPS.length}: `, h('b', {}, title)), ...fn(),
      h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: next }, 'Пропустить')));
  }
  draw();
  void ui;
}
