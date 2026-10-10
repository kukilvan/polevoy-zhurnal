// Точки: форма точки, генератор пачкой, карточка точки с историей, вкладка «Точки».
import { h, formModal, openModal, confirmDialog, toast } from '../ui.js';
import { state, getRepo, pointsSorted, infoOf, currentProject } from '../store.js';
import { generateLabels, parseSuffixes, comparePoints, usesConfig, remaining, REMAIN_STAGES, hasDeviceId, normalizeMac, findDuplicate } from '../../domain/index.js';
import { scanDevice } from '../scan.js';
import { statusClass } from './project.js';
import { hint } from './guide.js';
import { dateText, cablesText } from '../../domain/index.js';
import { addWorkForPoint } from './doh.js';
import { whoIs } from './journal.js';

const typeOptions = () => [...state.ctx.types.values()].map((t) => ({ value: t.id, label: t.id }));
const hasIdType = (id) => hasDeviceId(state.ctx.types.get(id));
const isDoorType = (id) => usesConfig(state.ctx.types.get(id));
const configOptions = () => [...state.ctx.configs.values()].map((c) => ({ value: c.id, label: c.name }));
const reasonOptions = () => [...state.ctx.delayReasons.values()].map((r) => ({ value: r.id, label: r.id }));

// Поле со сканером: текстовое поле + кнопка «📷»
function scanField(key, label, kind, value) {
  const input = h('input', { type: 'text', value: value ?? '', autocomplete: 'off', autocapitalize: 'characters', style: { flex: 1, minWidth: 0 } });
  if (kind === 'mac') input.addEventListener('blur', () => { const m = normalizeMac(input.value); if (m) input.value = m; }); // 12 символов → AA:BB:…
  const btn = h('button', { type: 'button', class: 'sec', onclick: () => scanDevice({ kind, onPick: (v) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); } }) }, '📷');
  return { key, label, type: 'custom', build: () => ({ el: h('div', { style: { display: 'flex', gap: '8px' } }, input, btn), get: () => (input.value.trim() === '' ? undefined : input.value.trim()) }) };
}

export function pointForm(point, { onDone } = {}) {
  const repo = getRepo(); const pid = currentProject().id;
  const fields = [
    { key: 'label', label: 'Обозначение', required: true, hint: 'Например: 1A-01-02' },
    { key: 'planName', label: 'Имя в плане заказчика (по тохниту)' },
    { key: 'cabinet', label: 'Шкаф' }, { key: 'floor', label: 'Этаж' },
    { key: 'typeId', label: 'Тип', type: 'select', required: true, options: typeOptions(), emptyLabel: 'Выберите тип' },
    { key: 'length', label: 'Длина (м на 1 кабель)', type: 'number' },
    { key: 'configId', label: 'Конфигурация двери (если отличается от проекта)', type: 'select', options: configOptions(), visible: (v) => isDoorType(v.typeId) },
    { key: 'port', label: 'Порт' },
    { ...scanField('serial', 'Серийный номер', 'serial', point?.serial), visible: (v) => hasIdType(v.typeId) },
    { ...scanField('mac', 'MAC', 'mac', point?.mac), visible: (v) => hasIdType(v.typeId) },
    { key: 'delayReasonId', label: 'Причина задержки', type: 'select', options: reasonOptions() },
    { key: 'note', label: 'Примечание', type: 'textarea' },
  ];
  formModal({
    title: point ? point.label : 'Новая точка', fields, values: point || { typeId: typeOptions()[0]?.value },
    extra: point ? [{ label: 'Удалить', kind: 'danger', onClick: async () => {
      if (!(await confirmDialog(`Удалить точку «${point.label}»? Её можно будет вернуть из истории.`, { yes: 'Удалить', danger: true }))) return false;
      repo.remove(pid, 'points', point.id); toast('Точка удалена'); onDone?.(); return true;
    } }] : [],
    onSubmit: (v) => {
      const label = v.label;
      const dup = [...state.ctx.points.values()].find((p) => p.label === label && p.id !== point?.id);
      if (dup) { toast('Точка с таким обозначением уже есть'); return false; }
      const idOn = hasIdType(v.typeId);
      const mac = idOn && v.mac ? (normalizeMac(v.mac) || v.mac) : undefined; const serial = idOn ? v.serial : undefined;
      const pts = state.ctx.points.values();
      const dm = mac && findDuplicate(pts, point, 'mac', mac); const ds = serial && findDuplicate(state.ctx.points.values(), point, 'serial', serial);
      if (dm || ds) { toast(`${dm ? 'Такой MAC' : 'Такой серийный номер'} уже у точки ${(dm || ds).label}`); return false; }
      if (v.length !== undefined && !(v.length >= 0)) { toast('Длина должна быть числом'); return false; }
      repo.save(pid, [{ coll: 'points', id: point?.id, data: {
        label, planName: v.planName, cabinet: v.cabinet, floor: v.floor, typeId: v.typeId, length: v.length,
        configId: isDoorType(v.typeId) ? v.configId : undefined, port: v.port, serial, mac, delayReasonId: v.delayReasonId, note: v.note,
      } }]);
      toast(point ? 'Сохранено' : 'Точка добавлена'); onDone?.();
    },
  });
}

export function generatorForm() {
  const repo = getRepo(); const pid = currentProject().id;
  const fields = [
    { key: 'prefix', label: 'Префикс', hint: 'Например: 1A-' },
    { key: 'from', label: 'От', type: 'number', required: true }, { key: 'to', label: 'До', type: 'number', required: true },
    { key: 'step', label: 'Шаг', type: 'number' },
    { key: 'digits', label: 'Цифр в номере (ведущие нули, 0 = без)', type: 'number' },
    { key: 'suffixes', label: 'Суффиксы через запятую', hint: 'Например: A,B — на каждый номер будет по точке с каждым суффиксом' },
    { key: 'pair', label: 'Пара номеров (вид 01-02)', type: 'checkbox' },
    { key: 'typeId', label: 'Тип', type: 'select', required: true, options: typeOptions(), emptyLabel: 'Выберите тип' },
    { key: 'cabinet', label: 'Шкаф' }, { key: 'floor', label: 'Этаж' },
    { key: 'configId', label: 'Конфигурация двери', type: 'select', options: configOptions(), visible: (v) => isDoorType(v.typeId) },
  ];
  const labelsOf = (v) => generateLabels({ prefix: v.prefix ?? '', from: v.from, to: v.to, step: v.step ?? 1, digits: v.digits ?? 0, suffixes: parseSuffixes(v.suffixes), pair: !!v.pair });
  formModal({
    title: 'Добавить точки пачкой', fields, values: { step: 1, digits: 0, typeId: typeOptions()[0]?.value }, submitLabel: 'Создать',
    preview: (v) => { const l = labelsOf(v); return l.length ? `Пример: ${l.slice(0, 4).join(', ')}${l.length > 4 ? ' …' : ''}\nВсего: ${l.length}` : 'Укажите «от» и «до»'; },
    onSubmit: async (v) => {
      const labels = labelsOf(v);
      if (!labels.length) { toast('Нечего создавать: проверьте «от», «до» и шаг'); return false; }
      const have = new Set([...state.ctx.points.values()].map((p) => p.label));
      const fresh = labels.filter((l) => !have.has(l));
      if (!fresh.length) { toast('Все такие точки уже есть'); return false; }
      if (fresh.length > 100 && !(await confirmDialog(`Создать ${fresh.length} точек?`, { yes: 'Создать' }))) return false;
      repo.save(pid, fresh.map((label) => ({ coll: 'points', data: {
        label, cabinet: v.cabinet, floor: v.floor, typeId: v.typeId, configId: isDoorType(v.typeId) ? v.configId : undefined,
      } })));
      toast(`Создано точек: ${fresh.length}${labels.length > fresh.length ? `, уже были: ${labels.length - fresh.length}` : ''}`);
    },
  });
}

// Ввод длины: «Сохранить и дальше» открывает следующую точку того же шкафа и типа
export function meterForm(startPoint) {
  const repo = getRepo(); const pid = currentProject().id;
  let point = startPoint;
  const nextOf = () => {
    const list = pointsSorted();
    const i = list.findIndex((p) => p.id === point.id);
    return list.slice(i + 1).find((p) => p.cabinet === point.cabinet && p.typeId === point.typeId);
  };
  // Одно окно на всю серию точек: поле ввода не пересоздаётся, поэтому клавиатура на телефоне не закрывается
  const titleEl = h('b', {});
  const labelEl = h('span', {});
  const input = h('input', { type: 'text', inputMode: 'decimal', autocomplete: 'off', autocapitalize: 'off', enterKeyHint: 'next' });
  const errBox = h('div', { class: 'err' });
  const okBtn = h('button', { type: 'submit', class: 'grow' });
  // не даём кнопке забрать фокус у поля ввода (иначе iOS убирает клавиатуру)
  okBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  okBtn.addEventListener('mousedown', (e) => e.preventDefault());
  const more = h('button', { type: 'button', class: 'sec', onclick: () => { const pt = point; close(); setTimeout(() => pointForm(pt), 60); } }, 'Подробнее…');
  const show = (pt) => {
    point = pt;
    titleEl.textContent = pt.label;
    labelEl.textContent = `Длина, м на 1 кабель${pt.planName ? ` · ${pt.planName}` : ''}`;
    input.value = pt.length ?? '';
    errBox.textContent = '';
    okBtn.textContent = nextOf() ? 'Сохранить и дальше' : 'Сохранить';
    input.focus(); input.select();
  };
  const form = h('form', { onsubmit: (e) => {
    e.preventDefault();
    const t = input.value.trim().replace(',', '.');
    const length = t === '' ? undefined : Number(t);
    if (length !== undefined && !(length >= 0)) { errBox.textContent = 'Длина должна быть числом'; return; }
    repo.save(pid, [{ coll: 'points', id: point.id, data: { length } }]);
    const nxt = nextOf();
    if (nxt) { show(state.ctx.points.get(nxt.id) || nxt); return; }
    toast('Это была последняя точка'); close();
  } }, h('label', { class: 'field' }, labelEl, input), errBox, h('div', { class: 'row' }, okBtn, more));
  const close = openModal('Метраж', form);
  const head = form.closest('.sheet')?.querySelector('.sheet-head b');
  if (head) head.replaceWith(titleEl);
  show(point);
}

// Карточка точки: сведения, история работ (что, когда, кто) и действия
export function pointCard(startPoint) {
  const proj = currentProject();
  let close = () => {};
  const body = h('div', {});
  const render = () => {
    const ctx = state.ctx;
    const p = ctx.points.get(startPoint.id);
    if (!p) { close(); return; }
    const info = infoOf(p);
    const cfg = ctx.configs.get(p.configId || proj.defaultConfigId);
    const hasLen = p.length !== undefined && p.length !== null && p.length !== '';
    const facts = [
      ['Шкаф / этаж', [p.cabinet && `шкаф ${p.cabinet}`, p.floor && `этаж ${p.floor}`].filter(Boolean).join(', ')],
      ['Тип', p.typeId], ['Имя в плане', p.planName], ['Кабель', info.cableList.length > 1 ? cablesText(info.cableList) : info.cable],
      ['Длина', hasLen ? `${p.length} м на 1 кабель${info.metrage ? ` (всего ${Math.round(info.metrage * 100) / 100} м)` : ''}` : ''],
      ['Конфигурация', usesConfig(ctx.types.get(p.typeId)) ? cfg?.name : ''], ['Порт', p.port], ['Серийный номер', p.serial], ['MAC', p.mac], ['Причина задержки', p.delayReasonId], ['Примечание', p.note],
    ].filter(([, v]) => v);
    const rows = (ctx.journalByPoint.get(p.id) || []).map((r) => ({ ...r, work: `${ctx.catalog.get(r.workId)?.name || r.action || '?'}${r.action === 'Протяжка' && r.cableId ? ` (${r.cableId})` : ''}` }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.order - a.order));
    body.replaceChildren(
      h('div', { style: { margin: '2px 0 10px' } }, h('span', { class: statusClass(info.status) }, info.status)),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: '14px' } },
        facts.flatMap(([k, v]) => [h('span', { class: 'mut' }, k), h('span', { style: { fontWeight: 600 } }, String(v))])),
      h('div', { class: 'btns' },
        h('button', { onclick: () => { close(); setTimeout(() => addWorkForPoint(p.id), 60); } }, '➕ Добавить работу на эту точку')),
      h('div', { class: 'btns' },
        h('button', { class: 'sec', onclick: () => { close(); setTimeout(() => meterForm(p), 60); } }, '📏 Длина'),
        h('button', { class: 'sec', onclick: () => { close(); setTimeout(() => pointForm(p), 60); } }, '✏️ Изменить')),
      h('div', { class: 'group', style: { padding: '12px 0 6px' } }, `История работ (${rows.length})`),
      rows.length ? h('div', {}, rows.map((r) => {
        const who = whoIs(proj, r.by);
        return h('div', { class: 'item', style: { cursor: 'default' } },
          h('div', { class: 'name' }, r.work,
            h('div', { class: 'sub' }, `${dateText(r.date)}${r.result === 'Не работает' ? ' · не работает' : ''}${r.fromEdit ? ' · правка' : ''}${who ? ` · ${who}` : ''}`)));
      })) : h('div', { class: 'empty' }, 'По этой точке работ пока не отмечено'));
  };
  render();
  close = openModal(startPoint.label, body);
}

// «Что осталось»: точки без хивута / установки / проверки по шкафам
function remainingModal() {
  let stage = '';
  const body = h('div', {});
  let close = () => {};
  const fill = () => {
    const groups = remaining(state.ctx).map((g) => ({ ...g, items: g.items.filter((x) => !stage || x.missing.includes(stage)) })).filter((g) => g.items.length);
    const n = groups.reduce((s, g) => s + g.items.length, 0);
    const sel = h('select', { onchange: (e) => { stage = e.target.value; fill(); } },
      h('option', { value: '' }, 'Все этапы'), ...REMAIN_STAGES.map((s) => h('option', { value: s, selected: s === stage }, `Без этапа «${s}»`)));
    const CHIP = { 'Дотянуть': ['pul', 'дотянуть'], 'Хивут': ['hiv', 'хивут'], 'Установка': ['ins', 'установка'], 'Проверка': ['chk', 'проверка'] };
    const chipText = (m, point) => {
      if (m !== 'Дотянуть') return CHIP[m]?.[1] || m;
      const i = infoOf(point); return `дотянуть ${i.cableList.filter((c) => !i.pulledKinds.includes(c.cable)).map((c) => c.cable).join(', ')}`;
    };
    const list = h('div', { class: 'rem-list' }, ...groups.flatMap((g) => [
      h('div', { class: 'rem-group' }, h('span', {}, g.cabinet ? `Шкаф ${g.cabinet}` : 'Без шкафа'), h('span', { class: 'rem-count' }, g.items.length)),
      ...g.items.map(({ point, missing }) => h('div', { class: 'rem-row', onclick: () => { close(); setTimeout(() => pointCard(point), 60); } },
        h('div', { class: 'rem-name' }, h('b', {}, point.label), h('span', {}, `${point.typeId}${point.planName ? ` · ${point.planName}` : ''}`)),
        h('div', { class: 'rem-chips' }, missing.map((m) => h('span', { class: `chip ${CHIP[m]?.[0] || ''}` }, chipText(m, point)))))),
    ]));
    body.replaceChildren(sel, h('div', { class: 'rem-total' }, n ? h('span', {}, 'Осталось точек: ', h('b', {}, n)) : 'Всё сделано 🎉'), n ? list : '');
  };
  fill();
  close = openModal('Что осталось', body);
}

// Массовые действия: выбранные точки (живёт, пока открыто приложение)
let selMode = false; const selected = new Set();

function bulkEditForm(ids, done) {
  const repo = getRepo(); const pid = currentProject().id;
  formModal({
    title: `Изменить точек: ${ids.length}`, submitLabel: 'Применить',
    fields: [
      { key: 'cabinet', label: 'Шкаф', hint: 'Пусто — не менять' }, { key: 'floor', label: 'Этаж', hint: 'Пусто — не менять' },
      { key: 'typeId', label: 'Тип', type: 'select', options: typeOptions(), emptyLabel: 'Не менять' },
    ],
    onSubmit: (v) => {
      if (!v.cabinet && !v.floor && !v.typeId) { toast('Ничего не выбрано для изменения'); return false; }
      const ops = ids.map((id) => {
        const data = {};
        if (v.cabinet) data.cabinet = v.cabinet;
        if (v.floor) data.floor = v.floor;
        if (v.typeId) { data.typeId = v.typeId; if (!isDoorType(v.typeId)) data.configId = undefined; }
        return { coll: 'points', id, data };
      });
      repo.save(pid, ops); toast(`Изменено точек: ${ids.length}`); done();
    },
  });
}

let searchText = ''; let fCab = ''; let fType = '';
export function meterView(ui) {
  const list = h('div', { class: 'card', style: { padding: 0 } });
  const total = pointsSorted();
  const withLen = total.filter((p) => p.length !== undefined && p.length !== null && p.length !== '').length;
  const bar = h('div', { class: 'card selbar', style: { position: 'sticky', top: '53px', zIndex: 6, margin: '8px 0 0' } });
  const shown = () => pointsSorted().filter((p) => { const q = searchText.trim().toLowerCase();
    return (!q || `${p.label} ${p.planName ?? ''}`.toLowerCase().includes(q)) && (!fCab || (fCab === '__none' ? !p.cabinet : p.cabinet === fCab)) && (!fType || p.typeId === fType); });
  function updateBar() {
    for (const id of [...selected]) if (!state.ctx.points.has(id)) selected.delete(id);
    bar.style.display = selMode ? '' : 'none';
    const ids = [...selected];
    bar.replaceChildren(h('b', {}, `Выбрано: ${ids.length}`),
      h('div', { class: 'btns', style: { marginTop: '8px' } },
        h('button', { class: 'sec', onclick: () => { shown().forEach((p) => selected.add(p.id)); fill(); } }, 'Все в списке'),
        h('button', { class: 'sec', onclick: () => { selected.clear(); fill(); } }, 'Снять')),
      h('div', { class: 'btns' },
        h('button', { disabled: !ids.length, onclick: () => bulkEditForm(ids, () => { selected.clear(); selMode = false; ui.render(); }) }, '✏️ Изменить'),
        h('button', { class: 'danger', disabled: !ids.length, onclick: async () => {
          if (!(await confirmDialog(`Удалить точек: ${ids.length}? Их можно будет вернуть из истории.`, { yes: 'Удалить', danger: true }))) return;
          const repo = getRepo(); const pid = currentProject().id;
          ids.forEach((id) => repo.remove(pid, 'points', id)); toast(`Удалено точек: ${ids.length}`); selected.clear(); selMode = false; ui.render();
        } }, '🗑 Удалить')),
      h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => { selMode = false; selected.clear(); ui.render(); } }, 'Готово')));
  }
  function fill() {
    updateBar();
    const q = searchText.trim().toLowerCase();
    const pts = pointsSorted().filter((p) => (!q || `${p.label} ${p.planName ?? ''}`.toLowerCase().includes(q))
      && (!fCab || (fCab === '__none' ? !p.cabinet : p.cabinet === fCab)) && (!fType || p.typeId === fType));
    list.replaceChildren();
    if (!pts.length) { list.append(total.length ? h('div', { class: 'empty' }, 'Ничего не найдено') : hint(ui, 'Точек пока нет. Добавьте их пачкой («Точки пачкой») или по одной. Нажмите точку: откроется её карточка с историей работ, там же кнопка «📏 Длина».', 'meter', '📖 Как вносить метраж')); return; }
    let lastKey = null;
    pts.forEach((p) => {
      const key = `${p.cabinet || ''}\u0000${p.typeId}`;
      if (key !== lastKey) { list.append(h('div', { class: 'group', style: { padding: '10px 12px 6px' } }, `${p.cabinet ? `Шкаф ${p.cabinet}` : 'Без шкафа'} · ${p.typeId}`)); lastKey = key; }
      const info = infoOf(p);
      const cb = selMode ? h('input', { type: 'checkbox', checked: selected.has(p.id), style: { width: '22px', height: '22px', flex: 'none' } }) : null;
      list.append(h('div', { class: 'item', onclick: () => {
        if (!selMode) { pointCard(p); return; }
        if (selected.has(p.id)) selected.delete(p.id); else selected.add(p.id);
        cb.checked = selected.has(p.id); updateBar();
      } }, cb,
        h('div', { class: 'name' }, p.label, p.planName ? h('div', { class: 'sub' }, p.planName) : null),
        h('div', { class: 'len' }, p.length !== undefined && p.length !== null && p.length !== '' ? `${p.length} м` : '—'),
        h('span', { class: statusClass(info.status) }, info.status)));
    });
  }
  const search = h('input', { type: 'search', placeholder: 'Поиск по обозначению', value: searchText, oninput: (e) => { searchText = e.target.value; fill(); } });
  const cabs = [...new Set(total.map((p) => p.cabinet || ''))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  const types = [...new Set(total.map((p) => p.typeId))].sort((a, b) => String(a).localeCompare(String(b), 'ru'));
  if (!cabs.includes(fCab) && fCab !== '__none') fCab = '';
  if (!types.includes(fType)) fType = '';
  const sel = (all, opts, cur, set) => h('select', { onchange: (e) => { set(e.target.value); fill(); } },
    h('option', { value: '' }, all), ...opts.map(([v, t]) => h('option', { value: v, selected: v === cur }, t)));
  const filters = h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
    sel('Все шкафы', cabs.map((c) => (c ? [c, `Шкаф ${c}`] : ['__none', 'Без шкафа'])), fCab, (v) => { fCab = v; }),
    sel('Все типы', types.map((t) => [t, t]), fType, (v) => { fType = v; }));
  fill();
  return h('div', {},
    h('div', { class: 'btns', style: { marginTop: 0 } },
      h('button', { onclick: () => generatorForm() }, '➕ Точки пачкой'),
      h('button', { class: 'sec', onclick: () => pointForm(null) }, 'Новая точка'),
      h('button', { class: 'wide sec', onclick: () => remainingModal() }, '🧾 Что осталось')),
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 2px' } },
      h('span', { class: 'mut' }, `Точек: ${total.length} · с длиной: ${withLen}`),
      selMode ? null : h('button', { class: 'sec', style: { padding: '6px 12px' }, onclick: () => { selMode = true; ui.render(); } }, '☑ Выбрать')),
    search, filters, bar, h('div', { style: { height: '10px' } }), list);
}
