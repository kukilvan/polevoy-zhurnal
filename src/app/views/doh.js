// Вкладка «Дохот»: дни работ, записи дня, текст доха RU/HE, копирование и ссылка на команду «Doh».
import { typeMatch, typeFilterOptions } from '../typegroups.js';
import { cfgMatch, cfgFilterOptions, cfgFilterValid } from '../cfgfilter.js';
import { h, formModal, openModal, confirmDialog, toast } from '../ui.js';
import { hint } from './guide.js';
import { state, getRepo, currentProject, pointsSorted, infoOf } from '../store.js';
import { newId } from '../repo.js';
import { doh, entryLine, dateText, dayEntries, workFits, workUsesPoints, openTasksFor, pullGroups, devicesForWork, compositionOf } from '../../domain/index.js';

let openDayId = null;
const WORK_TYPES = ['Протяжка', 'Хивут', 'Установка', 'Проверка', 'Шилют', 'Перетяжка', 'Перенос', 'Доп. работа', 'Время', 'Текст'];
const blank = (v) => v === undefined || v === null || v === '';

export const todayIso = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD по местному времени

const daysSorted = () => [...state.ctx.days.values()].sort((a, b) =>
  (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt ?? 0) - (a.createdAt ?? 0)));

// ---------- копирование и ссылка на команду iPhone «Doh» ----------
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* запасной способ ниже */ }
  const t = h('textarea', { value: text, style: { position: 'fixed', opacity: '0', top: '0' } });
  document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
  t.remove(); return ok;
}
export const shortcutUrl = (text) => `shortcuts://run-shortcut?name=Doh&input=text&text=${encodeURIComponent(text)}`;

// ---------- «Сегодня» ----------
export function openToday(ui) {
  const today = todayIso();
  const day = daysSorted().find((d) => d.date === today);
  if (ui) ui.go('doh');
  if (day) { openDayId = day.id; ui?.render(); return; }
  dayForm({ date: today }, ui);
}

// ---------- форма дня ----------
function bumpLastWork(date) {
  const p = currentProject(); const ms = Date.parse(date);
  if (p && ms && ms > (p.lastWorkDate || 0)) getRepo().saveProject(p.id, { lastWorkDate: ms });
}

function dayForm(day, ui) {
  const repo = getRepo(); const p = currentProject(); const isNew = !day.id;
  formModal({
    title: isNew ? 'Новый день' : 'День',
    submitLabel: 'Сохранить',
    fields: [
      { key: 'date', label: 'Дата', type: 'date', required: true },
      { key: 'helper', label: 'Помощник (пусто = сам)', type: 'text', placeholder: 'сам' },
      { key: 'helperHe', label: 'Помощник на иврите', type: 'text' },
      { key: 'object', label: 'Объект (для разового выезда)', type: 'text', visible: () => !!p.oneOff },
      { key: 'comment', label: 'Комментарий в конце доха', type: 'textarea' },
    ],
    values: {
      date: day.date, comment: day.comment, object: day.object,
      helper: isNew ? p.helper : (day.helper === 'сам' ? '' : day.helper),
      helperHe: isNew ? p.helperHe : (day.helperHe === 'сам' ? '' : day.helperHe),
    },
    onSubmit: (v) => {
      const id = day.id || newId();
      repo.save(p.id, [{ coll: 'days', id, data: {
        date: v.date, helper: v.helper || 'сам', helperHe: v.helperHe || 'сам', object: v.object, comment: v.comment,
      } }]);
      bumpLastWork(v.date);
      if (isNew) { openDayId = id; ui?.go?.('doh'); }
    },
    extra: isNew ? [] : [{ label: 'Удалить день', kind: 'danger', closes: false, onClick: async (v, { close }) => {
      if (!(await confirmDialog('Удалить день вместе с записями? Его можно будет вернуть из истории.', { yes: 'Удалить', danger: true }))) return;
      repo.remove(p.id, 'days', day.id); openDayId = null; close(); ui?.render();
    } }],
  });
}

// ---------- выбор точек ----------
export function pointsPicker({ typesOf, fits, onPick }) {
  let ids = [];
  const btn = h('button', { type: 'button', class: 'sec', style: { width: '100%', textAlign: 'left' } }, 'Выбрать точки…');
  const label = () => { btn.textContent = ids.length ? `Выбрано точек: ${ids.length} — изменить` : 'Выбрать точки…'; };
  let valuesFn = () => ({}); let changedFn = null;
  btn.onclick = () => openPicker();
  function openPicker() {
    const vals = valuesFn();
    const allowed = typesOf ? typesOf(vals) : null;
    const pts = pointsSorted().filter((pt) => (fits ? fits(pt, vals) : (!allowed || allowed.includes(pt.typeId))));
    const chosen = new Set(ids);
    let q = ''; let fCab = ''; let fType = ''; let fCfg = '';
    const list = h('div', { class: 'picklist' });
    const count = h('b', {});
    const fill = () => {
      list.replaceChildren(); let last = null;
      const shown = pts.filter((pt) => (!q || `${pt.label} ${pt.planName ?? ''}`.toLowerCase().includes(q))
        && (!fCab || (fCab === '__none' ? !pt.cabinet : pt.cabinet === fCab)) && typeMatch(fType, pt.typeId) && cfgMatch(fCfg, pt));
      if (!shown.length) list.append(h('div', { class: 'empty' }, pts.length ? 'Ничего не найдено' : 'Подходящих точек нет'));
      shown.forEach((pt) => {
        const key = `${pt.cabinet || ''}\u0000${pt.typeId}`;
        if (key !== last) { list.append(h('div', { class: 'group', style: { padding: '8px 4px 4px' } }, `${pt.cabinet ? `Шкаф ${pt.cabinet}` : 'Без шкафа'} · ${pt.typeId}`)); last = key; }
        const cb = h('input', { type: 'checkbox', checked: chosen.has(pt.id), onchange: () => { cb.checked ? chosen.add(pt.id) : chosen.delete(pt.id); count.textContent = `Выбрано: ${chosen.size}`; } });
        list.append(h('label', { class: 'pickrow' }, cb, h('span', {}, pt.label), h('small', {}, infoOf(pt).status)));
      });
      count.textContent = `Выбрано: ${chosen.size}`;
      list._shown = shown;
    };
    const search = h('input', { type: 'search', placeholder: 'Поиск по обозначению', oninput: (e) => { q = e.target.value.trim().toLowerCase(); fill(); } });
    // фильтры как на вкладке «Точки»: шкаф и тип (с общими группами — «▸ Все: Дверь»)
    const cabs = [...new Set(pts.map((pt) => pt.cabinet || ''))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
    const cabSel = h('select', { onchange: (e) => { fCab = e.target.value; fill(); } }, h('option', { value: '' }, 'Все шкафы'), ...cabs.map((c) => (c ? h('option', { value: c }, `Шкаф ${c}`) : h('option', { value: '__none' }, 'Без шкафа'))));
    const typeSel = h('select', { onchange: (e) => { fType = e.target.value; fill(); } }, h('option', { value: '' }, 'Все типы'), ...typeFilterOptions(pts.map((pt) => pt.typeId)).map(([v, t]) => h('option', { value: v }, t)));
    const cfgOpts = cfgFilterOptions(pts);
    const cfgSel = cfgOpts.length ? h('select', { onchange: (e) => { fCfg = e.target.value; fill(); } }, h('option', { value: '' }, 'Все конфигурации'), ...cfgOpts.map(([v, t]) => h('option', { value: v }, t))) : null;
    const close = openModal('Точки', h('div', {},
      search, h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } }, cabs.length > 1 ? cabSel : null, typeSel, cfgSel), h('div', { class: 'row', style: { margin: '8px 0' } }, count,
        h('button', { type: 'button', class: 'sec', onclick: () => { (list._shown || []).forEach((pt) => chosen.add(pt.id)); fill(); } }, 'Все показанные'),
        h('button', { type: 'button', class: 'sec', onclick: () => { chosen.clear(); fill(); } }, 'Снять все')),
      list,
      h('div', { class: 'row' }, h('button', { class: 'grow', onclick: () => {
        ids = pts.map((pt) => pt.id).filter((id) => chosen.has(id)); // порядок как в списке
        label(); close(); onPick?.(ids); changedFn?.();
      } }, 'Готово'))));
    fill();
  }
  return {
    el: btn, get: () => ids,
    set: (v) => { ids = [...(v || [])]; label(); },
    bind: (fn, changed) => { valuesFn = fn; changedFn = changed; },
  };
}

// ---------- форма записи (одна работа) ----------
function entryForm(day, entry, preset) {
  const repo = getRepo(); const pid = currentProject().id; const ctx = state.ctx;
  const catalog = [...ctx.catalog.values()].filter((w) => w.active !== false);
  const workOf = (v) => ctx.catalog.get(v.workId);
  const isTime = (v) => v.workType === 'Время' || workOf(v)?.unit === 'мин';
  const isText = (v) => v.workType === 'Текст';
  const usesCache = new Map();
  const hasPointsWork = (v) => { const w = workOf(v); if (!w) return false; if (!usesCache.has(w.id)) usesCache.set(w.id, workUsesPoints(w, ctx)); return usesCache.get(w.id); };
  const effPts = (v) => (hasPointsWork(v) ? (v.pointIds || []) : []);
  const ptsOf = (v) => effPts(v).map((id) => ctx.points.get(id)).filter(Boolean);
  const anyLegacy = (v) => ptsOf(v).some((p) => !compositionOf(p, ctx));
  const devOpts = (v) => (workOf(v) && ptsOf(v).length ? devicesForWork(ptsOf(v), ctx, v.workId, v.workType) : []);
  // галочки «к каким устройствам относится» (для точек из устройств)
  const devBox = (() => {
    const el = h('div', { class: 'picklist', style: { maxHeight: '200px' } }); let sig = ''; const boxes = new Map();
    const draw = (v) => {
      const opts = devOpts(v); const s = opts.map((o) => o.deviceId).join(',');
      if (s === sig) return; sig = s;
      const keep = new Map([...boxes].map(([k, cb]) => [k, cb.checked])); boxes.clear();
      el.replaceChildren(...opts.map((o) => {
        const was = keep.has(o.deviceId) ? keep.get(o.deviceId) : (entry?.deviceIds?.length ? entry.deviceIds.includes(o.deviceId) : true);
        const cb = h('input', { type: 'checkbox', checked: was }); boxes.set(o.deviceId, cb);
        return h('label', { class: 'pickrow' }, cb, h('span', {}, o.name));
      }));
    };
    return { el, update: draw, get: () => { const all = [...boxes]; const on = all.filter(([, cb]) => cb.checked).map(([k]) => k); return on.length === all.length ? undefined : on; } };
  })();
  let modal = null;
  const picker = pointsPicker({
    fits: (pt, v) => !workOf(v) || workFits(pt, ctx, workOf(v)),
    onPick: (ids) => { // для протяжки подставляем кабель первой точки, если ещё не выбран
      const first = ctx.points.get(ids[0]);
      if (first && modal) modal.set?.('cableId', infoOf(first).cable);
    },
  });
  picker.set(entry?.pointIds ?? preset?.pointIds);

  // новая запись, разбитая на несколько (виды кабеля / пропуск сделанного); время, виновник и приписка — в первую
  const saveGroups = (v, groups) => {
    const ops = [];
    if (day._new) { ops.push({ coll: 'days', id: day.id, data: { date: day.date, helper: day.helper || 'сам', helperHe: day.helperHe || 'сам' } }); day._new = false; }
    const made = groups.map(([cableId, ids], i) => {
      const id = newId();
      ops.push({ coll: 'entries', id, data: { dayId: day.id, workType: v.workType, workId: v.workId, pointIds: ids, cableId, deviceIds: v.deviceIds || null,
        minutes: i ? undefined : v.minutes, culprit: i ? undefined : v.culprit, note: i ? undefined : v.note,
        result: v.workType === 'Проверка' ? (v.result || 'Работает') : undefined } });
      return [id, ids];
    });
    repo.save(pid, ops); made.forEach(([id, ids]) => syncJournal(id, ids)); bumpLastWork(day.date);
    toast(groups.length > 1 ? `Сохранено записей: ${groups.length}` : 'Сохранено');
  };
  modal = formModal({
    title: entry ? 'Запись' : 'Добавить работу', submitLabel: 'Сохранить',
    fields: [
      { key: 'workType', label: 'Тип работы', type: 'select', required: true, emptyLabel: 'Выберите…',
        options: WORK_TYPES.map((t) => ({ value: t, label: t === 'Текст' ? 'Своя строка (текст)' : t })) },
      { key: 'workId', label: 'Работа', type: 'select', emptyLabel: 'Выберите…',
        visible: (v) => !!v.workType && !isText(v),
        optionsFn: (v) => catalog.filter((w) => w.workType === v.workType).map((w) => ({ value: w.id, label: w.name })) },
      { key: 'pointIds', label: 'Точки', type: 'custom', visible: (v) => !isText(v) && hasPointsWork(v),
        build: (api) => { picker.bind(api.values, api.changed); return picker; } },
      { key: 'deviceIds', label: 'Устройства', type: 'custom', hint: 'Снимите галочку, если работа сделана не на всех устройствах точки.',
        visible: (v) => !isText(v) && devOpts(v).length > 1, build: () => devBox },
      { key: 'quantity', label: 'Количество', type: 'number', visible: (v) => !isText(v) && !!v.workId && !isTime(v) && !effPts(v).length && v.workType !== 'Протяжка' },
      { key: 'cableId', label: 'Кабель', type: 'select', visible: (v) => v.workType === 'Протяжка' && (!effPts(v).length || anyLegacy(v) || !!entry),
        hint: 'Для точек из устройств кабели берутся из их состава — по записи на каждый вид кабеля.',
        options: [...ctx.cables.values()].map((c) => ({ value: c.id, label: c.id })) },
      { key: 'pullCount', label: 'Сколько кабелей / точек', type: 'number', visible: (v) => v.workType === 'Протяжка' && !effPts(v).length },
      { key: 'meters', label: 'Метры', type: 'number', visible: (v) => v.workType === 'Протяжка' && !effPts(v).length && ctx.cables.get(v.cableId)?.accounting === 'Метры' },
      { key: 'minutes', label: 'Время, мин', type: 'number', visible: (v) => !isText(v) && !!v.workType },
      { key: 'culprit', label: 'Виновник (если простой/задержка)', type: 'select', visible: (v) => !isText(v) && !!v.workType,
        options: [...ctx.culprits.values()].map((c) => ({ value: c.id, label: c.id })) },
      { key: 'result', label: 'Результат проверки', type: 'select', visible: (v) => v.workType === 'Проверка',
        options: [{ value: 'Работает', label: 'Работает' }, { value: 'Не работает', label: 'Не работает' }] },
      { key: 'note', label: 'Приписка', type: 'textarea', hint: 'Для «своей строки» — весь текст строки доха.', visible: (v) => !!v.workType },
    ],
    values: {
      workType: entry?.workType ?? preset?.workType, workId: entry?.workId ?? preset?.workId, pointIds: entry?.pointIds ?? preset?.pointIds,
      quantity: entry?.quantity, cableId: entry?.cableId ?? preset?.cableId, pullCount: entry?.workType === 'Протяжка' ? entry?.quantity : undefined,
      meters: entry?.meters, minutes: entry?.minutes, culprit: entry?.culprit,
      result: entry?.result ?? 'Работает', note: entry?.note,
    },
    onSubmit: (v) => {
      const pointIds = (isText(v) || !hasPointsWork(v)) ? [] : (v.pointIds || []);
      if (isText(v)) { if (blank(v.note)) { toast('Введите текст строки'); return false; } }
      else {
        if (blank(v.workId)) { toast('Выберите работу'); return false; }
        if (isTime(v) && blank(v.minutes)) { toast('Укажите время в минутах'); return false; }
        if (!isTime(v) && v.workType !== 'Протяжка' && !pointIds.length && blank(v.quantity)) { toast('Выберите точки или укажите количество'); return false; }
        if (v.workType === 'Протяжка' && !pointIds.length && blank(v.pullCount)) { toast('Выберите точки или укажите количество'); return false; }
      }
      // точки из устройств: только несделанное, протяжка — по записи на вид кабеля
      let groups = [[v.workType === 'Протяжка' ? (v.cableId || undefined) : undefined, pointIds]];
      if (!entry && !isText(v) && pointIds.length) {
        const pts = pointIds.map((x) => ctx.points.get(x)).filter(Boolean);
        if (v.workType === 'Протяжка') {
          const r = pullGroups(pts, ctx, v.deviceIds, (p) => v.cableId || infoOf(p).cable);
          if (!r.groups.length) { toast(`Уже протянуто: ${r.done.join(', ')}`); return false; }
          if (r.done.length) toast(`Пропущено (уже протянуто): ${r.done.join(', ')}`);
          groups = r.groups;
        } else {
          const done = pts.filter((p) => { const o = openTasksFor(p, ctx, workOf(v), v.deviceIds); return o !== null && !o.length; });
          if (done.length === pts.length) { toast(`Уже отмечено: ${done.map((p) => p.label).join(', ')}`); return false; }
          if (done.length) toast(`Пропущено (уже отмечено): ${done.map((p) => p.label).join(', ')}`);
          groups = [[undefined, pointIds.filter((x) => !done.some((p) => p.id === x))]];
        }
      }
      if (groups.length > 1 || groups[0][1] !== pointIds) { saveGroups(v, groups); return undefined; }
      const id = entry?.id || newId();
      const data = {
        dayId: day.id, workType: v.workType, workId: isText(v) ? null : v.workId, pointIds,
        quantity: v.workType === 'Протяжка' ? v.pullCount : v.quantity,
        meters: v.workType === 'Протяжка' ? v.meters : undefined,
        cableId: v.workType === 'Протяжка' ? (v.cableId || undefined) : undefined,
        deviceIds: isText(v) ? undefined : (v.deviceIds || null),
        minutes: isText(v) ? undefined : v.minutes, culprit: isText(v) ? undefined : v.culprit,
        result: v.workType === 'Проверка' ? (v.result || 'Работает') : undefined, note: v.note,
      };
      const ops = [{ coll: 'entries', id, data }];
      if (day._new) { // день за сегодня создаём только при сохранении записи
        ops.unshift({ coll: 'days', id: day.id, data: { date: day.date, helper: day.helper || 'сам', helperHe: day.helperHe || 'сам' } });
        day._new = false;
      }
      repo.save(pid, ops);
      syncJournal(id, pointIds);
      bumpLastWork(day.date);
      toast('Сохранено');
    },
    extra: entry ? [{ label: 'Удалить', kind: 'danger', closes: false, onClick: async (v, { close }) => {
      if (!(await confirmDialog('Удалить запись? Её можно будет вернуть из истории.', { yes: 'Удалить', danger: true }))) return;
      repo.remove(pid, 'entries', entry.id); close();
    } }] : [],
  });
}

// «Добавить работу на эту точку»: запись в сегодняшний день (день создаётся при сохранении)
// работа сразу на несколько точек (например, выбранных на плане)
export function addWorkForPoints(pointIds, preset = {}) {
  const p = currentProject(); const today = todayIso();
  const day = daysSorted().find((d) => d.date === today)
    || { id: newId(), date: today, helper: p.helper, helperHe: p.helperHe, _new: true };
  entryForm(day, null, { ...preset, pointIds: [...pointIds] });
}
// «Шилют поклеен» одним нажатием (из панели шкафа): запись работы «Шилют» в сегодняшний день, без формы.
// Работа подбирается как в «Несколько работ»: у точки из устройств — открытая задача «Шилют», у старых точек — работа типа «Шилют» для её типа.
// → { made: записей, done: [метки: уже поклеены], none: [метки: у типа нет работы «Шилют»] }
export function markShilutForPoints(pointIds) {
  const ctx = state.ctx; const repo = getRepo(); const p = currentProject(); const today = todayIso();
  const pts = [...new Set(pointIds)].map((id) => ctx.points.get(id)).filter(Boolean);
  const works = [...ctx.catalog.values()].filter((w) => w.active !== false && w.workType === 'Шилют');
  const byWork = new Map(); const done = []; const none = [];
  const put = (w, pt) => { if (!byWork.has(w.id)) byWork.set(w.id, []); byWork.get(w.id).push(pt.id); };
  pts.forEach((pt) => {
    if (compositionOf(pt, ctx)) {
      const fit = works.filter((w) => workFits(pt, ctx, w));
      const open = fit.filter((w) => (openTasksFor(pt, ctx, w) || []).length > 0);
      if (open.length) open.forEach((w) => put(w, pt)); else if (fit.length) done.push(pt.label); else none.push(pt.label);
    } else {
      const w = works.find((x) => (x.forTypes || []).includes(pt.typeId));
      if (!w) none.push(pt.label); else if (infoOf(pt).shilut) done.push(pt.label); else put(w, pt);
    }
  });
  if (!byWork.size) return { made: 0, done, none };
  const day = daysSorted().find((d) => d.date === today); const dayId = day?.id || newId();
  const ops = day ? [] : [{ coll: 'days', id: dayId, data: { date: today, helper: p.helper || 'сам', helperHe: p.helperHe || 'сам' } }];
  const made = [];
  byWork.forEach((ids, workId) => { const id = newId(); ops.push({ coll: 'entries', id, data: { dayId, workType: 'Шилют', workId, pointIds: ids } }); made.push([id, ids]); });
  repo.save(p.id, ops); made.forEach(([id, ids]) => syncJournal(id, ids)); bumpLastWork(today);
  return { made: made.length, done, none };
}
export function addWorkForPoint(pointId) {
  const p = currentProject(); const today = todayIso();
  const day = daysSorted().find((d) => d.date === today)
    || { id: newId(), date: today, helper: p.helper, helperHe: p.helperHe, _new: true };
  entryForm(day, null, { pointIds: [pointId] });
}

// строки журнала записи: добавить недостающие, убрать лишние
function syncJournal(entryId, pointIds) {
  const repo = getRepo(); const pid = currentProject().id;
  const have = state.data.journal.filter((r) => r.entryId === entryId);
  const want = new Set(pointIds);
  const live = new Map(have.filter((r) => !r.deleted).map((r) => [r.pointId, r]));
  const ops = pointIds.filter((pt) => !live.has(pt)).map((pt) => ({ coll: 'journal', id: `${entryId}_${pt}`, data: { entryId, pointId: pt, deleted: false } }));
  if (ops.length) repo.save(pid, ops);
  have.filter((r) => !r.deleted && !want.has(r.pointId)).forEach((r) => repo.remove(pid, 'journal', r.id));
}

// ---------- несколько работ сразу по одним и тем же точкам ----------
function batchForm(day) {
  const repo = getRepo(); const pid = currentProject().id; const ctx = state.ctx;
  const picker = pointsPicker({ typesOf: () => null });
  let selected = new Set();
  let box = null; let lastKey = '';
  const applicable = (ptIds) => {
    const pts = ptIds.map((id) => ctx.points.get(id)).filter(Boolean);
    if (!pts.length) return [];
    const legacyOk = (w, pt) => w.forTypes.includes(pt.typeId)
      && (w.workType !== 'Хивут' || w.id === 'HIV_DEV' || !infoOf(pt).hived)
      && (w.workType !== 'Установка' || !infoOf(pt).installedIds.includes(w.id))
      && (w.workType !== 'Шилют' || !infoOf(pt).shilut);
    // точка из устройств: работа есть в её задачах и ещё не сделана (перетяжка/перенос — всегда)
    const composedOk = (w, pt) => workFits(pt, ctx, w)
      && (['Перетяжка', 'Перенос'].includes(w.workType) || (openTasksFor(pt, ctx, w) || []).length > 0);
    return [...ctx.catalog.values()].filter((w) => w.active !== false && w.workType !== 'Время'
      && pts.some((pt) => (compositionOf(pt, ctx) ? composedOk(w, pt) : (w.forTypes || []).length && legacyOk(w, pt))));
  };
  const works = {
    el: (box = h('div', { class: 'picklist' }, h('div', { class: 'mut' }, 'Сначала выберите точки'))),
    get: () => [...selected],
    update: (v) => {
      const list = applicable(v.pointIds || []);
      const key = list.map((w) => w.id).join(',');
      if (key === lastKey) return; lastKey = key;
      selected = new Set([...selected].filter((id) => list.some((w) => w.id === id)));
      box.replaceChildren();
      if (!list.length) { box.append(h('div', { class: 'mut' }, (v.pointIds || []).length ? 'Для этих точек нет доступных работ' : 'Сначала выберите точки')); return; }
      list.forEach((w) => {
        const cb = h('input', { type: 'checkbox', checked: selected.has(w.id), onchange: () => { cb.checked ? selected.add(w.id) : selected.delete(w.id); } });
        box.append(h('label', { class: 'pickrow' }, cb, h('span', {}, w.name), h('small', {}, w.workType)));
      });
    },
  };
  formModal({
    title: 'Несколько работ', submitLabel: 'Сохранить всё',
    fields: [
      { key: 'pointIds', label: 'Точки', type: 'custom', required: true, build: (api) => { picker.bind(api.values, api.changed); return picker; } },
      { key: 'workIds', label: 'Работы', type: 'custom', required: true, build: () => works },
    ],
    onSubmit: (v) => {
      const pts = v.pointIds.map((id) => ctx.points.get(id)).filter(Boolean);
      let made = 0;
      v.workIds.forEach((wid) => {
        const w = ctx.catalog.get(wid); if (!w) return;
        // протяжка: отдельная запись на каждый вид кабеля, только непротянутое; остальные работы — только где не сделано
        const groups = w.workType === 'Протяжка'
          ? pullGroups(pts, ctx, null, (pt) => infoOf(pt).cable).groups
          : [[undefined, pts.filter((pt) => { const o = openTasksFor(pt, ctx, w); return o === null || o.length > 0 || ['Перетяжка', 'Перенос'].includes(w.workType); }).map((pt) => pt.id)]];
        groups.forEach(([cableId, ids]) => {
          if (!ids.length) return;
          const id = newId();
          repo.save(pid, [{ coll: 'entries', id, data: { dayId: day.id, workType: w.workType, workId: w.id, pointIds: ids, cableId, result: w.workType === 'Проверка' ? 'Работает' : undefined } }]);
          syncJournal(id, ids); made += 1;
        });
      });
      bumpLastWork(day.date);
      toast(`Записей добавлено: ${made}`);
    },
  });
}

// ---------- экран дня ----------
function dayScreen(day, ui) {
  const ctx = state.ctx; const entries = dayEntries(day, ctx);
  const ru = doh(day, ctx, 'ru'); const he = doh(day, ctx, 'he');
  const textBlock = (text, rtl) => h('pre', { class: 'dohtext', dir: rtl ? 'rtl' : 'ltr' }, text);
  const act = (label, text, cls = 'sec') => h('button', { class: cls, onclick: async () => { toast((await copyText(text)) ? 'Скопировано' : 'Не удалось скопировать'); } }, label);
  const link = (label, text) => h('a', { class: 'btnlink', href: shortcutUrl(text) }, label);
  return h('div', {},
    h('div', { class: 'btns', style: { marginTop: 0 } },
      h('button', { class: 'sec', onclick: () => { openDayId = null; ui.render(); } }, '← Все дни'),
      h('button', { class: 'sec', onclick: () => dayForm(day, ui) }, '✏️ День')),
    h('div', { class: 'card' },
      h('div', { style: { fontSize: '18px', fontWeight: 700 } }, dateText(day.date)),
      entries.length ? h('div', { style: { marginTop: '8px' } }, entries.map((e) =>
        h('div', { class: 'item', onclick: () => entryForm(day, e) },
          h('div', { class: 'name' }, entryLine(e, ctx, 'ru') || '—', e.updatedByName ? h('div', { class: 'sub' }, e.updatedByName) : null))))
        : hint(ui, 'Записей пока нет. «Добавить работу» — одна работа (можно сразу на много точек). «Несколько работ» — выбрать точки один раз и отметить сразу несколько работ.', 'doh', '📖 Что такое дох и как его заполнять'),
      h('div', { class: 'btns' },
        h('button', { onclick: () => entryForm(day, null) }, '➕ Добавить работу'),
        h('button', { class: 'sec', onclick: () => batchForm(day) }, 'Несколько работ'))),
    h('div', { class: 'card' }, h('b', {}, 'Дох (русский)'), textBlock(ru, false),
      h('div', { class: 'btns' }, act('📋 Копировать RU', ru, ''), link('➡️ Отправить', ru))),
    h('div', { class: 'card' }, h('b', {}, 'Дох (иврит)'), textBlock(he, true),
      h('div', { class: 'btns' }, act('📋 Копировать HE', he, ''), link('➡️ Отправить', he))));
}

// ---------- вкладка ----------
export function dohView(ui) {
  const ctx = state.ctx;
  const open = openDayId && ctx.days.get(openDayId);
  if (open) return dayScreen(open, ui);
  // день мог ещё не попасть в контекст (сохранение только что прошло) — не сбрасываем, придёт следующим обновлением
  const days = daysSorted();
  return h('div', {},
    h('div', { class: 'btns', style: { marginTop: 0 } },
      h('button', { onclick: () => openToday(ui) }, '📝 Сегодня'),
      h('button', { class: 'sec', onclick: () => dayForm({ date: todayIso() }, ui) }, 'Другой день')),
    days.length ? h('div', { class: 'card', style: { padding: 0, marginTop: '10px' } }, days.map((d) => {
      const n = dayEntries(d, ctx).length;
      return h('div', { class: 'item', onclick: () => { openDayId = d.id; ui.render(); } },
        h('div', { class: 'name' }, dateText(d.date), h('div', { class: 'sub' }, `${n ? `записей: ${n}` : 'пока без записей'}${d.createdByName ? ` · ${d.createdByName}` : ''}`)));
    })) : hint(ui, 'Дней пока нет. Нажмите «Сегодня» и внесите сделанные работы: из них соберётся дох — отчёт за день.', 'doh', '📖 Что такое дох и как его заполнять'));
}
