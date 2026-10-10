// Вкладка «Дохот»: дни работ, записи дня, текст доха RU/HE, копирование и ссылка на команду «Doh».
import { h, formModal, openModal, confirmDialog, toast } from '../ui.js';
import { hint } from './guide.js';
import { state, getRepo, currentProject, pointsSorted, infoOf } from '../store.js';
import { newId } from '../repo.js';
import { doh, entryLine, dateText, dayEntries } from '../../domain/index.js';

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
export function pointsPicker({ typesOf, onPick }) {
  let ids = [];
  const btn = h('button', { type: 'button', class: 'sec', style: { width: '100%', textAlign: 'left' } }, 'Выбрать точки…');
  const label = () => { btn.textContent = ids.length ? `Выбрано точек: ${ids.length} — изменить` : 'Выбрать точки…'; };
  let valuesFn = () => ({}); let changedFn = null;
  btn.onclick = () => openPicker();
  function openPicker() {
    const allowed = typesOf(valuesFn());
    const pts = pointsSorted().filter((pt) => !allowed || allowed.includes(pt.typeId));
    const chosen = new Set(ids);
    let q = '';
    const list = h('div', { class: 'picklist' });
    const count = h('b', {});
    const fill = () => {
      list.replaceChildren(); let last = null;
      const shown = pts.filter((pt) => !q || `${pt.label} ${pt.planName ?? ''}`.toLowerCase().includes(q));
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
    const close = openModal('Точки', h('div', {},
      search, h('div', { class: 'row', style: { margin: '8px 0' } }, count,
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
  const hasPointsWork = (v) => !!workOf(v)?.forTypes?.length;
  const effPts = (v) => (hasPointsWork(v) ? (v.pointIds || []) : []);
  let modal = null;
  const picker = pointsPicker({
    typesOf: (v) => workOf(v)?.forTypes || null,
    onPick: (ids) => { // для протяжки подставляем кабель первой точки, если ещё не выбран
      const first = ctx.points.get(ids[0]);
      if (first && modal) modal.set?.('cableId', infoOf(first).cable);
    },
  });
  picker.set(entry?.pointIds ?? preset?.pointIds);

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
      { key: 'quantity', label: 'Количество', type: 'number', visible: (v) => !isText(v) && !!v.workId && !isTime(v) && !effPts(v).length && v.workType !== 'Протяжка' },
      { key: 'cableId', label: 'Кабель', type: 'select', visible: (v) => v.workType === 'Протяжка',
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
      workType: entry?.workType, workId: entry?.workId, pointIds: entry?.pointIds ?? preset?.pointIds,
      quantity: entry?.quantity, cableId: entry?.cableId, pullCount: entry?.workType === 'Протяжка' ? entry?.quantity : undefined,
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
      const id = entry?.id || newId();
      const data = {
        dayId: day.id, workType: v.workType, workId: isText(v) ? null : v.workId, pointIds,
        quantity: v.workType === 'Протяжка' ? v.pullCount : v.quantity,
        meters: v.workType === 'Протяжка' ? v.meters : undefined,
        cableId: v.workType === 'Протяжка' ? (v.cableId || undefined) : undefined,
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
    return [...ctx.catalog.values()].filter((w) => w.active !== false && (w.forTypes || []).length
      && pts.some((pt) => w.forTypes.includes(pt.typeId))
      && (w.workType !== 'Хивут' || w.id === 'HIV_DEV' || pts.some((pt) => !infoOf(pt).hived))
      && (w.workType !== 'Установка' || pts.some((pt) => !infoOf(pt).installedIds.includes(w.id)))
      && (w.workType !== 'Шилют' || pts.some((pt) => !infoOf(pt).shilut)));
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
        // протяжка: отдельная запись на каждый тип кабеля
        const groups = w.workType === 'Протяжка'
          ? [...pts.reduce((m, pt) => { const c = infoOf(pt).cable; m.set(c, [...(m.get(c) || []), pt.id]); return m; }, new Map())]
          : [[undefined, pts.map((pt) => pt.id)]];
        groups.forEach(([cableId, ids]) => {
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
