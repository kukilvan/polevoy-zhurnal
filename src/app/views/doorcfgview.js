// Двери: окно выбора конфигурации (закреплённые / собрать / общий пул), поле для форм и вкладка «Конфигурации дверей».
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { state, subscribe, getRepo, currentProject } from '../store.js';
import { DOOR_PARTS, doorDevices, applyDoorRules, autoDoorCables, makeDoorCfg, isDoorCfg, doorLibraryOps } from '../../domain/index.js';
import { allDoorCfgs, pinsOf, useDoorCfg, setPins, pin, unpin, deleteDoorCfg, usageOf, onDoorPool } from '../doorpool.js';
import { itemForm } from './settings.js';
import { doorChips } from './doorchips.js';
import { doorColorOf } from '../../domain/index.js';

const MAX_CABLES = 8;
const counter = (val, max, onSet) => {
  const n = h('b', { style: { minWidth: '18px', textAlign: 'center', display: 'inline-block' } }, String(val));
  return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
    h('button', { type: 'button', class: 'sec', style: { padding: '2px 12px' }, disabled: val <= 0, onclick: () => onSet(val - 1) }, '−'), n,
    h('button', { type: 'button', class: 'sec', style: { padding: '2px 12px' }, disabled: val >= max, onclick: () => onSet(val + 1) }, '+'));
};
const pinned = () => { const all = allDoorCfgs(); return pinsOf().map((id) => all.get(id)).filter(Boolean); };

/**
 * Окно выбора конфигурации двери. current — id текущей (или null). onPick(id) — после выбора (конфигурация уже в проекте и в пуле).
 */
export function doorPicker({ current = null, title = '🚪 Конфигурация двери', onPick } = {}) {
  let ctx = state.ctx; let all = allDoorCfgs();
  const start = (current && all.get(current)) || null;
  let sel = new Map((start?.devices || []).map((d) => [d.deviceId, d.count]));
  let cables = new Map((start?.cables || []).map((c) => [c.cable, c.count]));
  let autoCab = !start || JSON.stringify(autoDoorCables(ctx, start.devices)) === JSON.stringify(start.cables);
  let q = '';
  const body = h('div', {}); let close = () => {};
  const choose = (cfg) => { const id = useDoorCfg(cfg); if (!id) return; close(); onPick?.(id); };
  const devList = () => [...sel].map(([deviceId, count]) => ({ deviceId, count }));
  const cur = () => makeDoorCfg(ctx, devList(), [...cables].map(([cable, count]) => ({ cable, count })));
  const recalc = () => { if (autoCab) cables = new Map(autoDoorCables(ctx, devList()).map((c) => [c.cable, c.count])); };
  let stp = current ? 99 : 0;   // номер шага; 99 — всё пройдено (готово к выбору)
  let activeEl = null;
  const stepsOf = (parts) => [...DOOR_PARTS.filter((p) => parts[p.key].length).map((p) => ({ key: p.key, part: p, title: p.key === 'lock' ? 'Запирание' : p.name })), { key: 'cables', title: 'Кабели' }];
  const onlyPart = (parts, key) => devList().filter((d) => parts[key].some((x) => x.id === d.deviceId));
  function stepBlock(st, i, parts, cfg, known, kinds) {
    const last = i === steps.length - 1; const goto = (n) => { stp = n; draw(); };
    const cur = Math.min(stp, steps.length);
    const mini = st.key === 'cables' ? { devices: [], cables: [...cables].map(([cable, count]) => ({ cable, count })) } : { devices: onlyPart(parts, st.key), cables: [] };
    const hasAny = st.key === 'cables' ? mini.cables.length : mini.devices.length;
    const head = (text) => h('div', { class: 'mut', style: { fontSize: '13px', fontWeight: 700 } }, text);
    if (i < cur) {   // пройденный шаг — выбранное, нажатие меняет выбор
      return h('div', { class: 'wk cfg', style: { cursor: 'pointer', margin: '4px 0' }, onclick: () => goto(i) },
        h('span', { class: 'mut', style: { fontSize: '12px', minWidth: '84px' } }, st.title), hasAny ? doorChips(mini) : h('span', { class: 'mut' }, '— нет'), h('span', { class: 'wk-st' }, '✎'));
    }
    if (i > cur) return null;
    // активный шаг
    const doneBtn = (text) => h('button', { type: 'button', style: { width: '100%' }, onclick: () => goto(i + 1) }, text);
    if (st.key === 'cables') {
      const box = h('div', { style: { margin: '8px 0' } }, head(`Кабели двери${autoCab ? ' · подставлены по составу' : ' · свои'}`),
        ...kinds.map((k) => h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' } }, h('span', {}, k),
          counter(cables.get(k) || 0, MAX_CABLES, (n) => { autoCab = false; if (n > 0) cables.set(k, n); else cables.delete(k); draw(); }))),
        !autoCab ? h('div', { class: 'btns' }, h('button', { type: 'button', class: 'sec', onclick: () => { autoCab = true; recalc(); draw(); } }, '↺ Кабели по составу')) : null,
        h('div', { class: 'btns' }, doneBtn('Готово')));
      activeEl = box; return box;
    }
    const p = st.part;
    const tap = (d) => {
      const n = sel.get(d.id) || 0;
      if (p.key === 'lock' && !n) { sel = applyDoorRules(ctx, sel, d.id, 1); recalc(); stp = i + 1; draw(); return; }   // запирание — выбрал и дальше
      const next = n >= p.max ? 0 : n + 1;
      sel = applyDoorRules(ctx, sel, d.id, next); recalc(); draw();
    };
    const items = parts[p.key];
    const box = h('div', { style: { margin: '8px 0' } }, head(`${p.name}${p.hint ? ` · ${p.hint}` : ''}`),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '6px 0' } },
        ...items.map((d) => { const n = sel.get(d.id) || 0; const c = doorColorOf(d);
          return h('button', { type: 'button', class: n ? '' : 'sec', style: { flex: '1 1 40%', borderLeft: `6px solid ${c}`, ...(n ? { background: c, color: '#fff', borderColor: c } : {}) }, onclick: () => tap(d) }, n ? `${d.name} ×${n}` : d.name); })),
      h('div', { class: 'btns' }, doneBtn(hasAny ? 'Готово' : 'Пропустить')));
    activeEl = box; return box;
  }
  let steps = [];
  function draw() {
    ctx = state.ctx; all = allDoorCfgs();
    const parts = doorDevices(ctx); const cfg = cur(); const known = all.get(cfg.id); steps = stepsOf(parts); activeEl = null;
    const pins = pinned();
    const kinds = [...new Set(['6005', 'cat7', ...[...ctx.cables.keys()].sort(), ...cables.keys()])].filter((k) => ctx.cables.has(k) || cables.has(k));
    const other = [...all.values()].filter((c) => !pinsOf().includes(c.id) && (!q || c.name.toLowerCase().includes(q)))
      .sort((a, b) => usageOf(b.id) - usageOf(a.id) || a.name.localeCompare(b.name, 'ru'));
    const noDev = !Object.values(parts).some((l) => l.length); const lib = doorLibraryOps(ctx);
    body.replaceChildren(...[
      pins.length ? h('div', {}, h('div', { class: 'group', style: { padding: '0 0 4px' } }, '📌 Закреплённые'),
        ...pins.map((c) => h('div', { class: `wk ${c.id === current ? 'done' : 'cfg'}`, style: { cursor: 'pointer' }, onclick: () => choose(c) },
          doorChips(c), c.id === current ? h('span', { class: 'wk-st' }, 'сейчас') : null))) : null,
      h('div', { class: 'group', style: { padding: '12px 0 4px' } }, '🧩 Собрать'),
      noDev ? h('div', { class: 'mut' }, 'В проекте нет устройств двери. Добавьте их в «Ещё → Устройства» (поле «Часть двери») или возьмите стандартные:') : null,
      lib.length ? h('div', { class: 'btns' }, h('button', { type: 'button', class: 'sec', onclick: () => { getRepo().save(currentProject().id, lib); toast(`Добавлено устройств: ${lib.filter((o) => o.coll === 'devices').map((o) => o.data.name).length}`); setTimeout(draw, 400); } },
        `📚 Стандартные устройства двери (${lib.filter((o) => o.coll === 'devices').map((o) => o.data.name).join(', ')})`)) : null,
      ...steps.map((st, i) => stepBlock(st, i, parts, cfg, known, kinds)),
      stp >= steps.length ? h('div', {}, h('div', { class: 'card', style: { marginTop: '10px' } }, h('div', { class: 'mut', style: { fontSize: '13px' } }, known ? 'Такая уже есть' : 'Новая — попадёт в общий пул'), doorChips(cfg, { big: true })),
        h('div', { class: 'btns' }, h('button', { disabled: !sel.size, onclick: () => choose(cfg) }, '✅ Выбрать эту'),
          h('button', { type: 'button', class: 'sec', onclick: () => { sel = new Map(); cables = new Map(); autoCab = true; stp = 0; draw(); } }, '↺ Заново'))) : null,
      h('div', { class: 'group', style: { padding: '12px 0 4px' } }, `Общий пул (${other.length})`),
      h('input', { type: 'search', placeholder: 'Поиск: ЭМ, биометри, цофар…', value: q, oninput: (e) => { q = e.target.value.trim().toLowerCase(); const pos = e.target.selectionStart; draw(); const i = body.querySelector('input[type=search]'); i.focus(); i.setSelectionRange(pos, pos); } }),
      ...other.slice(0, 60).map((c) => h('div', { class: 'wk cfg', style: { cursor: 'pointer', marginTop: '4px' }, onclick: () => choose(c) },
        doorChips(c), usageOf(c.id) ? h('span', { class: 'wk-st' }, `дверей в проекте: ${usageOf(c.id)}`) : null))].filter(Boolean));
    if (stp > 0) setTimeout(() => { try { (activeEl || body.querySelector('.card'))?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ok */ } }, 30);
  }
  draw();
  close = openModal(title, body, { sticky: true });
}

/** Поле формы: конфигурация двери (значение — id). bulk: «не менять» + «убрать» (значение '__clear') */
export function doorField(key, label, { bulk = false, visible, hint } = {}) {
  return {
    key, label, type: 'custom', visible, hint,
    build: (api) => {
      let val = api.value || '';
      const name = h('div', {}); const el = h('div', {});
  const paint = () => {
        const c = val && val !== '__clear' ? (allDoorCfgs().get(val) || state.ctx.configs.get(val)) : null;
        name.replaceChildren(c ? doorChips(c, { big: true }) : h('b', {}, val === '__clear' ? '✖ Убрать конфигурацию' : bulk ? 'Не менять' : '— не выбрана —'));
        el.replaceChildren(name, h('div', { class: 'btns', style: { marginTop: '4px' } },
          h('button', { type: 'button', class: 'sec', onclick: () => doorPicker({ current: val, onPick: (id) => { val = id; paint(); api.changed(); } }) }, '🚪 Выбрать…'),
          bulk && val ? h('button', { type: 'button', class: 'sec', onclick: () => { val = ''; paint(); api.changed(); } }, 'Не менять') : null,
          bulk && val !== '__clear' ? h('button', { type: 'button', class: 'sec', onclick: () => { val = '__clear'; paint(); api.changed(); } }, '✖ Убрать') : null,
          !bulk && val ? h('button', { type: 'button', class: 'sec', onclick: () => { val = ''; paint(); api.changed(); } }, '✖') : null));
      };
      paint();
      return { el, get: () => val || undefined };
    },
  };
}

/** Вкладка «Конфигурации дверей»: закреплённые (порядок, открепить), собрать новую, общий пул, старые (только работы) */
export function doorConfigsView() {
  const box = h('div', {});
  const delBtn = (c) => !c.standard ? h('button', { class: 'sec', style: { padding: '2px 10px' }, title: 'Удалить конфигурацию', onclick: async () => {
            if (currentProject()?.defaultConfigId === c.id) { toast('Нельзя: она назначена по умолчанию для проекта. Смените её в настройках проекта.'); return; }
            if (usageOf(c.id)) { toast(`Нельзя: она стоит на дверях проекта (${usageOf(c.id)}). Сначала смените им конфигурацию.`); return; }
            if (!(await confirmDialog(`Удалить конфигурацию «${c.name}»? Она пропадёт из проекта и (у администратора) из общего пула.`, { yes: 'Удалить', danger: true }))) return;
            const r = deleteDoorCfg(c.id); toast(r.ok ? (r.stays ? 'Убрана из проекта. Из общего пула удаляет только администратор' : 'Удалена') : `Нельзя: ${r.reason}`);
          } }, '🗑') : null;
  const paint = () => {
    if (!state.ctx) return;
    const all = allDoorCfgs(); const pins = pinsOf(); const list = pins.map((id) => all.get(id)).filter(Boolean);
    const rest = [...all.values()].filter((c) => !pins.includes(c.id)).sort((a, b) => usageOf(b.id) - usageOf(a.id) || a.name.localeCompare(b.name, 'ru'));
    const move = (i, d) => { const l = [...pins]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; setPins(l); };
    const sub = (c) => [c.standard ? 'стандарт' : '', usageOf(c.id) ? `дверей в проекте: ${usageOf(c.id)}` : ''].filter(Boolean).join(' · ');
    box.replaceChildren(...[
      h('div', { class: 'mut', style: { marginBottom: '10px' } }, 'Тип точки — «Дверь», разновидность — конфигурация: состав (запирание, считыватель, кнопки, датчики, дополнительно) и кабели двери. Название собирается само. Закреплённые идут первыми в списках выбора, в этом порядке; закрепление — для этого проекта. Новые конфигурации сами попадают в общий пул.'),
      h('div', { class: 'btns', style: { marginTop: 0 } }, h('button', { onclick: () => doorPicker({ title: '🧩 Новая конфигурация', onPick: (id) => { pin(id); toast('Закреплена в проекте'); } }) }, '➕ Собрать новую')),
      h('div', { class: 'group', style: { padding: '12px 0 4px' } }, `📌 Закреплённые в проекте (${list.length})`),
      list.length ? h('div', {}, ...list.map((c, i) => h('div', { class: 'wk cfg pinned' },
        h('div', {}, doorChips(c), sub(c) ? h('div', { class: 'wk-sub' }, sub(c)) : null),
        h('span', { style: { display: 'flex', gap: '4px' } },
          h('button', { class: 'sec', style: { padding: '2px 10px' }, disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'sec', style: { padding: '2px 10px' }, disabled: i === list.length - 1, onclick: () => move(i, 1) }, '↓'),
          h('button', { class: 'sec', style: { padding: '2px 10px' }, title: 'Открепить', onclick: () => unpin(c.id) }, '✖'), delBtn(c))))) : h('div', { class: 'empty' }, 'Ничего не закреплено'),
      h('div', { class: 'group', style: { padding: '12px 0 4px' } }, `Общий пул (${rest.length})`),
      rest.length ? h('div', {}, ...rest.map((c) => h('div', { class: 'wk cfg' },
        h('div', {}, doorChips(c), sub(c) ? h('div', { class: 'wk-sub' }, sub(c)) : null),
        h('span', { style: { display: 'flex', gap: '4px' } },
          h('button', { class: 'sec', style: { padding: '2px 10px' }, title: 'Закрепить', onclick: () => pin(c) }, '📌'),
          delBtn(c))))) : h('div', { class: 'empty' }, 'Пусто')].filter(Boolean));
  };
  paint();
  const offP = onDoorPool(() => { if (!box.isConnected) { offP(); return; } paint(); });
  const offS = subscribe(() => { if (!box.isConnected) { offS?.(); return; } paint(); });
  return box;
}
