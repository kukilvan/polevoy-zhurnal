// Мелкие помощники интерфейса: создание элементов, всплывающие формы, подтверждение, уведомления.
import { expandShortcut } from '../domain/latin.js';
// быстрый ввод латиницей (T9): «тв » → «TV ». Список берётся у приложения (setShortcutsProvider)
let shortcuts = () => [];
export const setShortcutsProvider = (fn) => { shortcuts = fn; };
const SEP = /[^A-Za-z\u0400-\u04FF]/;
export function attachShortcuts(inp) {
  let skip = false; let conv = null;   // стёр результат вручную — следующий раз это слово не заменяется
  inp.addEventListener('input', (e) => {
    const t = e.inputType || '';
    if (t.startsWith('delete')) { const c = inp.selectionStart; if (conv && c >= conv.from && c <= conv.to + 1) skip = true; return; }
    if (!t.startsWith('insert')) return;
    const c = inp.selectionStart; if (c < 1 || !SEP.test(inp.value[c - 1])) return;
    const r = expandShortcut(inp.value, c, shortcuts());
    if (skip) { skip = false; return; }
    if (!r) return;
    inp.value = r.text; inp.setSelectionRange(r.caret, r.caret); conv = { from: r.from, to: r.to };
  });
  return inp;
}
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (kid) => {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(add);
    else el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  return el;
}

// ---- всплывающее окно (снизу, как на телефоне) ----
let modalRoot = null;
function root() {
  if (!modalRoot) { modalRoot = h('div', { id: 'modal-root' }); document.body.appendChild(modalRoot); }
  return modalRoot;
}
const mousePc = () => { try { return matchMedia('(hover: hover) and (pointer: fine)').matches; } catch { return false; } };
export function openModal(title, content, { onClose, sticky = false, wide = false } = {}) {  // sticky: клик мимо окна не закрывает (долгая работа внутри)
  const sheet = h('div', { class: 'sheet', role: 'dialog', style: wide ? { maxWidth: '1200px' } : {} },
    h('div', { class: 'sheet-head' }, h('b', {}, title), h('button', { class: 'x', type: 'button', onclick: () => close() }, '✕')),
    h('div', { class: 'sheet-body' }, content));
  // на компьютере (мышь) клик мимо окна его не закрывает — только ✕; на телефоне как раньше
  const back = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === back && !sticky && !mousePc()) close(); } }, sheet);
  // колесо мыши сбоку от окна прокручивает само окно, а не страницу под ним
  back.addEventListener('wheel', (e) => {
    const body = sheet.querySelector('.sheet-body'); if (body?.contains(e.target)) return;
    e.preventDefault();
    if (!body) return;
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? body.clientHeight : 1;
    body.scrollTop += e.deltaY * k;
  }, { passive: false });
  root().appendChild(back);
  document.body.classList.add('noscroll');
  function close() {
    if (!back.isConnected) return;
    back.remove();
    if (!root().children.length) document.body.classList.remove('noscroll');
    onClose?.();
  }
  return close;
}

// ---- форма по описанию полей ----
// fields: [{key,label,type: text|number|textarea|select|checkbox|date, options:[{value,label}], required, hint, placeholder, visible(values)}]
export function formModal({ title, fields, values = {}, submitLabel = 'Сохранить', extra = [], preview, onSubmit }) {
  const inputs = {};
  const rows = {};
  const customs = {};
  const read = () => {
    const out = {};
    fields.forEach((f) => {
      const el = inputs[f.key]; if (!el) return;
      if (f.type === 'custom') out[f.key] = customs[f.key].get();
      else if (f.type === 'checkbox') out[f.key] = el.checked;
      else if (f.type === 'number') { const t = el.value.trim().replace(',', '.'); out[f.key] = t === '' ? undefined : Number(t); }
      else out[f.key] = el.value.trim() === '' ? undefined : el.value.trim();
    });
    return out;
  };
  // зависимые списки: варианты считаются по текущим значениям других полей
  const fillOptions = (f, v) => {
    const el = inputs[f.key]; const opts = f.optionsFn(v) || [];
    const sig = JSON.stringify(opts.map((o) => o.value));
    if (el.dataset.sig === sig) return;
    const keep = el.value || el.dataset.init || '';
    delete el.dataset.init;
    el.replaceChildren(h('option', { value: '' }, f.emptyLabel ?? '—'),
      ...opts.map((o) => h('option', { value: o.value }, o.label)));
    el.dataset.sig = sig;
    el.value = opts.some((o) => String(o.value) === keep) ? keep : (opts.length === 1 ? String(opts[0].value) : '');
  };
  const previewBox = preview ? h('div', { class: 'preview' }) : null;
  const refresh = () => {
    // сначала зависимые списки (по порядку полей), потом видимость по свежим значениям
    fields.forEach((f) => { if (f.optionsFn && f.type === 'select') fillOptions(f, read()); });
    const v = read();
    fields.forEach((f) => {
      if (f.visible) rows[f.key].style.display = f.visible(v) ? '' : 'none';
      customs[f.key]?.update?.(v);
    });
    if (previewBox) previewBox.textContent = preview(v);
  };

  fields.forEach((f) => {
    let input;
    const val = values[f.key];
    if (f.type === 'custom') {
      const c = f.build({ value: val, changed: () => refresh(), values: () => read() });
      customs[f.key] = c; input = c.el;
    } else if (f.type === 'select') {
      input = h('select', f.optionsFn ? { 'data-init': String(val ?? '') } : {}, h('option', { value: '' }, f.emptyLabel ?? '—'),
        (f.options || []).map((o) => h('option', { value: o.value, selected: String(val ?? '') === String(o.value) }, o.label)));
    } else if (f.type === 'textarea') input = h('textarea', { rows: 3, value: val ?? '', placeholder: f.placeholder });
    else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', checked: !!val });
    else if (f.type === 'date') input = h('input', { type: 'date', value: val ?? '' });
    else { input = h('input', { type: 'text', inputMode: f.type === 'number' ? 'decimal' : undefined, value: val ?? '', placeholder: f.placeholder, autocomplete: 'off', autocapitalize: 'off' }); if (f.latin) attachShortcuts(input); }
    input.addEventListener('input', refresh); input.addEventListener('change', refresh);
    inputs[f.key] = input;
    rows[f.key] = f.type === 'custom' ? h('div', { class: 'field' }, h('span', {}, f.label, f.required ? ' *' : ''), input, f.hint && h('small', {}, f.hint))
      : f.type === 'checkbox'
      ? h('label', { class: 'field check' }, input, h('span', {}, f.label), f.hint && h('small', {}, f.hint))
      : h('label', { class: 'field' }, h('span', {}, f.label, f.required ? ' *' : ''), input, f.hint && h('small', {}, f.hint));
  });

  const errBox = h('div', { class: 'err' });
  let close;
  const submit = async (e) => {
    e?.preventDefault();
    const v = read();
    const emptyVal = (x) => x === undefined || x === '' || (Array.isArray(x) && !x.length);
    const missing = fields.filter((f) => f.required && (!f.visible || f.visible(v)) && emptyVal(v[f.key]));
    if (missing.length) { errBox.textContent = `Заполните: ${missing.map((f) => f.label).join(', ')}`; return; }
    const res = await onSubmit(v, { close });
    if (res !== false) close();
  };
  const form = h('form', { onsubmit: submit },
    fields.map((f) => rows[f.key]), previewBox, errBox,
    h('div', { class: 'row' },
      h('button', { type: 'submit', class: 'grow' }, submitLabel),
      extra.map((x) => h('button', { type: 'button', class: x.kind === 'danger' ? 'danger' : 'sec', onclick: async () => {
        const res = await x.onClick(read(), { close });
        if (res !== false && x.closes !== false) close();
      } }, x.label))));
  close = openModal(title, form);
  // programmatic setter for cross-field defaults
  close.set = (key, value) => { const el = inputs[key]; if (el && !customs[key]) { el.value = value ?? ''; refresh(); } };
  refresh();
  const first = form.querySelector('input[type=text], textarea');
  // автофокус в первое поле, только если пользователь ещё не успел нажать в другое
  if (first && !first.value) setTimeout(() => { if (!form.contains(document.activeElement)) first.focus(); }, 50);
  return close;
}

// ---- подтверждение (свой диалог вместо window.confirm) ----
export function confirmDialog(message, { yes = 'Да', no = 'Отмена', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const close = openModal('Подтвердите', h('div', {},
      h('p', {}, message),
      h('div', { class: 'row' },
        h('button', { class: danger ? 'danger grow' : 'grow', onclick: () => { finish(true); close(); } }, yes),
        h('button', { class: 'sec', onclick: () => { finish(false); close(); } }, no))), { onClose: () => finish(false) });
  });
}

export function toast(message) {
  const t = h('div', { class: 'toast' }, message);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2400);
}

// ---- список «вариант × количество» (кабели устройства, устройства в типе точки) ----
// options: [{value,label}]; get() → [{ value, count }]; пустой список допустим
// onCreate(add): «🆕 Новое…» — открыть форму создания; add({value,label}) добавит вариант и строку ×1
export function qtyList(options, { addLabel = '➕ Добавить', empty = 'Пусто', onChange, onCreate, createLabel = '🆕 Создать новое' } = {}) {
  let rows = [];
  const box = h('div', { class: 'qtylist' });
  const draw = () => {
    box.replaceChildren(
      ...(rows.length ? rows.map((r, i) => {
        const sel = h('select', { onchange: (e) => { r.value = e.target.value; onChange?.(); } },
          options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(r.value) }, o.label)));
        const cnt = h('input', { type: 'text', inputMode: 'numeric', value: String(r.count), class: 'qty', oninput: (e) => { r.count = Number(String(e.target.value).replace(',', '.')) || 0; onChange?.(); } });
        return h('div', { class: 'qtyrow' }, sel, h('span', { class: 'mut' }, '×'), cnt,
          h('button', { type: 'button', class: 'sec x', onclick: () => { rows.splice(i, 1); draw(); onChange?.(); } }, '✕'));
      }) : [h('div', { class: 'mut', style: { padding: '4px 2px' } }, empty)]),
      h('div', { class: 'btns', style: { marginTop: '4px' } },
        options.length ? h('button', { type: 'button', class: 'sec', onclick: () => { rows.push({ value: options[0].value, count: 1 }); draw(); onChange?.(); } }, addLabel) : null,
        onCreate ? h('button', { type: 'button', class: 'sec', onclick: () => onCreate((o) => { if (!options.some((x) => x.value === o.value)) options.push(o); rows.push({ value: o.value, count: 1 }); draw(); onChange?.(); }) }, createLabel) : null));
  };
  draw();
  return {
    el: box,
    get: () => rows.filter((r) => r.value !== '' && r.count > 0).map((r) => ({ value: r.value, count: r.count })),
    set: (list) => { rows = (list || []).map((x) => ({ value: x.value, count: Number(x.count) || 1 })); draw(); },
  };
}
