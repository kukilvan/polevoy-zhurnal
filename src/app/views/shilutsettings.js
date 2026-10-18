// Настройки шильюта: модели панелей (общие для всех проектов), цвета по типам, названия шкафов, подписи по шаблонам.
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import {
  SHILUT_COLORS, defaultTypeColor, rackPortsOf, subsOf, rackOf, contrastFg, shilutOf, shilutLabel, shilutCabName,
} from '../../domain/rack.js';

const sortRu = (a, b) => a.localeCompare(b, 'ru', { numeric: true });
export const panelModels = () => getRepo().prefs?.panelModels || [];
export const modelName = (id) => panelModels().find((m) => m.id === id)?.name || '';
export const allColors = () => [...SHILUT_COLORS, ...(getRepo().prefs?.shilutColors || [])];

export function shilutSettings(ui) {
  const p = currentProject(); const repo = getRepo();
  const rackPts = [...state.ctx.points.values()].filter((pt) => rackPortsOf(pt, state.ctx) > 0);
  const types = [...new Set(rackPts.map((pt) => pt.typeId))].sort(sortRu);
  const cabs = [...new Set(rackPts.map((pt) => pt.cabinet || '').filter(Boolean))].sort(sortRu);
  const src = shilutOf(p);
  const sh = { panelModel: src.panelModel || '', dropCab: !!src.dropCab, typeColors: { ...(src.typeColors || {}) }, cabNames: { ...(src.cabNames || {}) }, tpl: { ...(src.tpl || {}) } };
  const box = h('div', {});

  const colorChip = (c, text) => h('span', { style: { display: 'inline-block', minWidth: '22px', height: '22px', borderRadius: '6px', background: c?.bg || 'transparent', color: c?.fg || 'inherit', border: '1px solid var(--line)', textAlign: 'center', fontSize: '12px', lineHeight: '22px', padding: '0 4px' } }, text || '');

  const addColor = () => {
    const ru = h('input', { type: 'text', placeholder: 'Название по-русски, например оранжевый' });
    const he = h('input', { type: 'text', placeholder: 'Название на иврите, например כתום', dir: 'rtl' });
    const col = h('input', { type: 'color', value: '#ff9500', style: { width: '64px', height: '38px', padding: 0 } });
    const c = openModal('➕ Свой цвет', h('div', {},
      h('div', { class: 'mut' }, 'Цвет добавится в общий список — им можно пользоваться во всех проектах.'),
      h('div', { class: 'field' }, h('label', {}, 'По-русски (список в приложении)'), ru),
      h('div', { class: 'field' }, h('label', {}, 'На иврите (попадёт в таблицу шильюта)'), he),
      h('div', { class: 'field' }, h('label', {}, 'Цвет'), col),
      h('div', { class: 'btns' }, h('button', { onclick: () => {
        const r = ru.value.trim(); const hh = he.value.trim();
        if (!r || !hh) { toast('Нужны оба названия: русское и ивритское'); return; }
        if (allColors().some((x) => x.ru.toLowerCase() === r.toLowerCase())) { toast('Такой цвет уже есть'); return; }
        repo.saveUserPrefs({ shilutColors: [...(repo.prefs?.shilutColors || []), { id: `c${Date.now().toString(36)}`, ru: r, he: hh, bg: col.value, fg: contrastFg(col.value) }] });
        c(); setTimeout(draw, 250);
      } }, 'Добавить'))));
  };

  const card = (title, hint, ...rest) => h('div', { class: 'card', style: { margin: '8px 0' } }, h('b', {}, title), hint ? h('div', { class: 'mut', style: { margin: '4px 0 8px' } }, hint) : null, ...rest);

  const modelsCard = () => {
    const list = panelModels();
    const add = h('input', { type: 'text', placeholder: 'Название модели панели', style: { flex: 1 } });
    const doAdd = () => { const n = add.value.trim(); if (!n) return; if (list.some((m) => m.name.toLowerCase() === n.toLowerCase())) { toast('Такая модель уже есть'); return; } repo.saveUserPrefs({ panelModels: [...list, { id: `m${Date.now().toString(36)}`, name: n }] }); setTimeout(draw, 250); };
    return card('Модели патч-панелей', 'Список общий для всех ваших проектов. Модель попадает во вторую строку таблицы шильюта.',
      ...list.map((m) => h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '4px 0' } },
        h('input', { type: 'text', value: m.name, style: { flex: 1 }, onchange: (e) => { const n = e.target.value.trim(); if (n) repo.saveUserPrefs({ panelModels: list.map((x) => (x.id === m.id ? { ...x, name: n } : x)) }); } }),
        h('button', { class: 'sec', style: { padding: '4px 10px' }, onclick: async () => {
          if (!(await confirmDialog(`Удалить модель «${m.name}» из списка? У панелей, где она выбрана, модель сбросится.`, { yes: 'Удалить', danger: true }))) return;
          if (sh.panelModel === m.id) sh.panelModel = '';
          repo.saveUserPrefs({ panelModels: list.filter((x) => x.id !== m.id) }); setTimeout(draw, 250);
        } }, '🗑'))),
      h('div', { style: { display: 'flex', gap: '6px', margin: '6px 0' } }, add, h('button', { class: 'sec', onclick: doAdd }, '➕ Добавить')),
      list.length ? h('div', { class: 'field' }, h('label', {}, 'Модель по умолчанию в этом проекте (для панелей без своей)'),
        h('select', { onchange: (e) => { sh.panelModel = e.target.value; } }, h('option', { value: '' }, '— не указана —'), ...list.map((m) => h('option', { value: m.id, selected: m.id === sh.panelModel }, m.name)))) : null);
  };

  const colorsCard = () => card('Цвета шильюта по типам точек', 'Цвет порта в плане шкафа и в таблице. В таблицу цвет идёт названием на иврите.',
    ...(types.length ? types.map((t) => {
      const cur = sh.typeColors[t] || ''; const def = defaultTypeColor(t);
      const eff = allColors().find((c) => c.id === (cur || def));
      return h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '6px 0' } },
        colorChip(eff, ' '), h('span', { style: { flex: 1, minWidth: 0 } }, t),
        h('select', { style: { width: 'auto', maxWidth: '55%' }, onchange: (e) => { sh.typeColors[t] = e.target.value; draw(); } },
          h('option', { value: '' }, `по умолчанию${def ? ` (${allColors().find((c) => c.id === def)?.ru})` : ' — без цвета'}`),
          ...allColors().map((c) => h('option', { value: c.id, selected: c.id === cur }, `${c.ru} · ${c.he}`))));
    }) : [h('div', { class: 'mut' }, 'Нет точек с кабелями cat7')]),
    h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: addColor }, '➕ Свой цвет…')));

  const cabsCard = () => card('Названия шкафов в шильюте', 'Как называть шкаф в таблице и в подписях ({шкаф}). Пусто — как в приложении.',
    h('label', { class: 'pickrow' }, h('input', { type: 'checkbox', checked: sh.dropCab, onchange: (e) => { sh.dropCab = e.target.checked; draw(); } }), h('span', {}, 'Убирать название шкафа из подписей (1A-C5 → C5)')),
    ...cabs.flatMap((c) => subsOf(rackOf(p, c), c).map((sub) => {
      const key = `${c}|${sub.id || ''}`; const multi = subsOf(rackOf(p, c), c).length > 1;
      return h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '4px 0' } },
        h('span', { style: { minWidth: '80px' } }, multi ? sub.name : c),
        h('input', { type: 'text', value: sh.cabNames[key] || '', placeholder: multi ? sub.name : c, style: { flex: 1 }, oninput: (e) => { sh.cabNames[key] = e.target.value.trim(); } }));
    })));

  const tplCard = () => {
    const fake = { ...p, shilut: sh };
    return card('Подписи по типам', 'Шаблон подписи порта: {имя} — обозначение точки, {номер} — без названия шкафа, {шкаф}, {U}, {порт}. Пусто — просто {имя}. Свою подпись для отдельного порта можно задать в плане шкафа.',
      ...(types.length ? types.map((t) => {
        const ex = rackPts.filter((pt) => pt.typeId === t).sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }))[0];
        const prev = h('small', { class: 'mut' });
        const upd = () => { prev.textContent = ex ? `например: ${shilutLabel({ ...ex, panel: (ex.panel || []).map((x) => ({ ...x, label: '' })) }, 0, { ...fake, shilut: sh }, state.ctx) || ex.label}` : ''; };
        upd();
        return h('div', { style: { margin: '6px 0' } }, h('div', {}, t),
          h('input', { type: 'text', value: sh.tpl[t] || '', placeholder: '{имя}', oninput: (e) => { sh.tpl[t] = e.target.value; upd(); } }), prev);
      }) : [h('div', { class: 'mut' }, 'Нет точек с кабелями cat7')]));
  };

  const draw = () => box.replaceChildren(modelsCard(), colorsCard(), cabsCard(), tplCard());
  draw();
  const c = openModal('🎨 Настройки шильюта', h('div', {}, box, h('div', { class: 'btns' }, h('button', { onclick: () => {
    repo.saveProject(p.id, { shilut: sh }); c(); toast('Настройки шильюта сохранены'); setTimeout(() => ui.render(), 250);
  } }, 'Сохранить'))), { sticky: true });
}
