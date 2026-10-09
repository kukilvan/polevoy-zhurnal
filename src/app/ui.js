// Мелкие помощники интерфейса: создание элементов, всплывающие формы, подтверждение, уведомления.
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
export function openModal(title, content, { onClose } = {}) {
  const sheet = h('div', { class: 'sheet', role: 'dialog' },
    h('div', { class: 'sheet-head' }, h('b', {}, title), h('button', { class: 'x', type: 'button', onclick: () => close() }, '✕')),
    h('div', { class: 'sheet-body' }, content));
  const back = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === back) close(); } }, sheet);
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
  const read = () => {
    const out = {};
    fields.forEach((f) => {
      const el = inputs[f.key]; if (!el) return;
      if (f.type === 'checkbox') out[f.key] = el.checked;
      else if (f.type === 'number') { const t = el.value.trim().replace(',', '.'); out[f.key] = t === '' ? undefined : Number(t); }
      else out[f.key] = el.value.trim() === '' ? undefined : el.value.trim();
    });
    return out;
  };
  const previewBox = preview ? h('div', { class: 'preview' }) : null;
  const refresh = () => {
    const v = read();
    fields.forEach((f) => { if (f.visible) rows[f.key].style.display = f.visible(v) ? '' : 'none'; });
    if (previewBox) previewBox.textContent = preview(v);
  };

  fields.forEach((f) => {
    let input;
    const val = values[f.key];
    if (f.type === 'select') {
      input = h('select', {}, h('option', { value: '' }, f.emptyLabel ?? '—'),
        (f.options || []).map((o) => h('option', { value: o.value, selected: String(val ?? '') === String(o.value) }, o.label)));
    } else if (f.type === 'textarea') input = h('textarea', { rows: 3, value: val ?? '', placeholder: f.placeholder });
    else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', checked: !!val });
    else if (f.type === 'date') input = h('input', { type: 'date', value: val ?? '' });
    else input = h('input', { type: 'text', inputMode: f.type === 'number' ? 'decimal' : undefined, value: val ?? '', placeholder: f.placeholder, autocomplete: 'off', autocapitalize: 'off' });
    input.addEventListener('input', refresh); input.addEventListener('change', refresh);
    inputs[f.key] = input;
    rows[f.key] = f.type === 'checkbox'
      ? h('label', { class: 'field check' }, input, h('span', {}, f.label), f.hint && h('small', {}, f.hint))
      : h('label', { class: 'field' }, h('span', {}, f.label, f.required ? ' *' : ''), input, f.hint && h('small', {}, f.hint));
  });

  const errBox = h('div', { class: 'err' });
  let close;
  const submit = async (e) => {
    e?.preventDefault();
    const v = read();
    const missing = fields.filter((f) => f.required && (!f.visible || f.visible(v)) && (v[f.key] === undefined || v[f.key] === ''));
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
