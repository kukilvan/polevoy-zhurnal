// Точки: форма точки, генератор пачкой, вкладка «Метраж» (ввод длины).
import { h, formModal, openModal, confirmDialog, toast } from '../ui.js';
import { state, getRepo, pointsSorted, infoOf, currentProject } from '../store.js';
import { generateLabels, parseSuffixes, comparePoints, usesConfig } from '../../domain/index.js';
import { statusClass } from './project.js';

const typeOptions = () => [...state.ctx.types.values()].map((t) => ({ value: t.id, label: t.id }));
const isDoorType = (id) => usesConfig(state.ctx.types.get(id));
const configOptions = () => [...state.ctx.configs.values()].map((c) => ({ value: c.id, label: c.name }));
const reasonOptions = () => [...state.ctx.delayReasons.values()].map((r) => ({ value: r.id, label: r.id }));

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
      if (v.length !== undefined && !(v.length >= 0)) { toast('Длина должна быть числом'); return false; }
      repo.save(pid, [{ coll: 'points', id: point?.id, data: {
        label, planName: v.planName, cabinet: v.cabinet, floor: v.floor, typeId: v.typeId, length: v.length,
        configId: isDoorType(v.typeId) ? v.configId : undefined, port: v.port, delayReasonId: v.delayReasonId, note: v.note,
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

let searchText = '';
export function meterView(ui) {
  const list = h('div', { class: 'card', style: { padding: 0 } });
  const total = pointsSorted();
  const withLen = total.filter((p) => p.length !== undefined && p.length !== null && p.length !== '').length;
  function fill() {
    const q = searchText.trim().toLowerCase();
    const pts = pointsSorted().filter((p) => !q || `${p.label} ${p.planName ?? ''}`.toLowerCase().includes(q));
    list.replaceChildren();
    if (!pts.length) { list.append(h('div', { class: 'empty' }, total.length ? 'Ничего не найдено' : 'Точек пока нет. Добавьте их пачкой или по одной.')); return; }
    let lastKey = null;
    pts.forEach((p) => {
      const key = `${p.cabinet || ''}\u0000${p.typeId}`;
      if (key !== lastKey) { list.append(h('div', { class: 'group', style: { padding: '10px 12px 6px' } }, `${p.cabinet ? `Шкаф ${p.cabinet}` : 'Без шкафа'} · ${p.typeId}`)); lastKey = key; }
      const info = infoOf(p);
      list.append(h('div', { class: 'item', onclick: () => meterForm(p) },
        h('div', { class: 'name' }, p.label, p.planName ? h('div', { class: 'sub' }, p.planName) : null),
        h('div', { class: 'len' }, p.length !== undefined && p.length !== null && p.length !== '' ? `${p.length} м` : '—'),
        h('span', { class: statusClass(info.status) }, info.status)));
    });
  }
  const search = h('input', { type: 'search', placeholder: 'Поиск по обозначению', value: searchText, oninput: (e) => { searchText = e.target.value; fill(); } });
  fill();
  return h('div', {},
    h('div', { class: 'btns', style: { marginTop: 0 } },
      h('button', { onclick: () => generatorForm() }, '➕ Точки пачкой'),
      h('button', { class: 'sec', onclick: () => pointForm(null) }, 'Новая точка')),
    h('div', { class: 'mut', style: { margin: '10px 2px' } }, `Точек: ${total.length} · с длиной: ${withLen}`),
    search, h('div', { style: { height: '10px' } }), list);
}
