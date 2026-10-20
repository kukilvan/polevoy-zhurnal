// Двери: окно выбора конфигурации (закреплённые / собрать / общий пул), поле для форм и вкладка «Конфигурации дверей».
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { state, subscribe, getRepo, currentProject } from '../store.js';
import { DOOR_PARTS, doorDevices, applyDoorRules, autoDoorCables, makeDoorCfg, isDoorCfg, doorLibraryOps } from '../../domain/index.js';
import { allDoorCfgs, pinsOf, useDoorCfg, setPins, pin, unpin, canDeleteFromPool, deleteFromPool, usageOf, onDoorPool } from '../doorpool.js';
import { itemForm } from './settings.js';

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
  const start = (current && all.get(current)) || pinned()[0] || null;
  let sel = new Map((start?.devices || []).map((d) => [d.deviceId, d.count]));
  let cables = new Map((start?.cables || []).map((c) => [c.cable, c.count]));
  let autoCab = !start || JSON.stringify(autoDoorCables(ctx, start.devices)) === JSON.stringify(start.cables);
  let q = '';
  const body = h('div', {}); let close = () => {};
  const choose = (cfg) => { const id = useDoorCfg(cfg); close(); onPick?.(id); };
  const devList = () => [...sel].map(([deviceId, count]) => ({ deviceId, count }));
  const cur = () => makeDoorCfg(ctx, devList(), [...cables].map(([cable, count]) => ({ cable, count })));
  const recalc = () => { if (autoCab) cables = new Map(autoDoorCables(ctx, devList()).map((c) => [c.cable, c.count])); };
  function draw() {
    ctx = state.ctx; all = allDoorCfgs();
    const parts = doorDevices(ctx); const cfg = cur(); const known = all.get(cfg.id);
    const pins = pinned();
    const kinds = [...new Set(['6005', 'cat7', ...[...ctx.cables.keys()].sort(), ...cables.keys()])].filter((k) => ctx.cables.has(k) || cables.has(k));
    const other = [...all.values()].filter((c) => !pinsOf().includes(c.id) && (!q || c.name.toLowerCase().includes(q)))
      .sort((a, b) => usageOf(b.id) - usageOf(a.id) || a.name.localeCompare(b.name, 'ru'));
    const noDev = !Object.values(parts).some((l) => l.length); const lib = doorLibraryOps(ctx);
    body.replaceChildren(...[
      pins.length ? h('div', {}, h('div', { class: 'group', style: { padding: '0 0 4px' } }, '📌 Закреплённые'),
        ...pins.map((c) => h('div', { class: `wk ${c.id === current ? 'done' : 'todo'}`, style: { cursor: 'pointer' }, onclick: () => choose(c) },
          h('b', {}, c.name), c.id === current ? h('span', { class: 'wk-st' }, 'сейчас') : null))) : null,
      h('div', { class: 'group', style: { padding: '12px 0 4px' } }, '🧩 Собрать'),
      noDev ? h('div', { class: 'mut' }, 'В проекте нет устройств двери. Добавьте их в «Настройки → Устройства» (поле «Часть двери») или возьмите стандартные:') : null,
      lib.length ? h('div', { class: 'btns' }, h('button', { type: 'button', class: 'sec', onclick: () => { getRepo().save(currentProject().id, lib); toast(`Добавлено устройств: ${lib.filter((o) => o.coll === 'devices').length}`); setTimeout(draw, 400); } },
        `📚 Стандартные устройства двери (${lib.filter((o) => o.coll === 'devices').map((o) => o.data.name).join(', ')})`)) : null,
      ...DOOR_PARTS.filter((p) => parts[p.key].length).map((p) => h('div', { style: { margin: '6px 0' } },
        h('div', { class: 'mut', style: { fontSize: '13px', fontWeight: 700 } }, `${p.name}${p.hint ? ` · ${p.hint}` : ''}`),
        ...parts[p.key].map((d) => h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '3px 0' } },
          h('span', { style: { fontWeight: sel.get(d.id) ? 700 : 400 } }, d.name),
          counter(sel.get(d.id) || 0, p.max, (n) => { sel = applyDoorRules(ctx, sel, d.id, n); recalc(); draw(); }))))),
      h('div', { class: 'mut', style: { fontSize: '13px', fontWeight: 700, marginTop: '10px' } }, `Кабели двери${autoCab ? ' · подставлены по составу' : ' · свои'}`),
      ...kinds.map((k) => h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' } }, h('span', {}, k),
        counter(cables.get(k) || 0, MAX_CABLES, (n) => { autoCab = false; if (n > 0) cables.set(k, n); else cables.delete(k); draw(); }))),
      !autoCab ? h('div', { class: 'btns' }, h('button', { type: 'button', class: 'sec', onclick: () => { autoCab = true; recalc(); draw(); } }, '↺ Кабели по составу')) : null,
      h('div', { class: 'card', style: { marginTop: '10px' } }, h('div', { class: 'mut', style: { fontSize: '13px' } }, known ? 'Такая уже есть' : 'Новая — попадёт в общий пул'), h('b', {}, cfg.name)),
      h('div', { class: 'btns' }, h('button', { disabled: !sel.size, onclick: () => choose(cfg) }, '✅ Выбрать эту')),
      h('div', { class: 'group', style: { padding: '12px 0 4px' } }, `Общий пул (${other.length})`),
      h('input', { type: 'search', placeholder: 'Поиск: ЭМ, биометри, цофар…', value: q, oninput: (e) => { q = e.target.value.trim().toLowerCase(); const pos = e.target.selectionStart; draw(); const i = body.querySelector('input[type=search]'); i.focus(); i.setSelectionRange(pos, pos); } }),
      ...other.slice(0, 60).map((c) => h('div', { class: 'wk todo', style: { cursor: 'pointer', marginTop: '4px' }, onclick: () => choose(c) },
        h('b', {}, c.name), usageOf(c.id) ? h('span', { class: 'wk-st' }, `дверей в проекте: ${usageOf(c.id)}`) : null))].filter(Boolean));
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
      const name = h('b', {}); const el = h('div', {});
      const paint = () => {
        const c = val && val !== '__clear' ? (allDoorCfgs().get(val) || state.ctx.configs.get(val)) : null;
        name.textContent = val === '__clear' ? '✖ Убрать конфигурацию' : c ? c.name : bulk ? 'Не менять' : '— не выбрана —';
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
  const paint = () => {
    if (!state.ctx) return;
    const all = allDoorCfgs(); const pins = pinsOf(); const list = pins.map((id) => all.get(id)).filter(Boolean);
    const rest = [...all.values()].filter((c) => !pins.includes(c.id)).sort((a, b) => usageOf(b.id) - usageOf(a.id) || a.name.localeCompare(b.name, 'ru'));
    const legacy = [...state.ctx.configs.values()].filter((c) => !isDoorCfg(c));
    const move = (i, d) => { const l = [...pins]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; setPins(l); };
    const sub = (c) => [c.standard ? 'стандарт' : '', usageOf(c.id) ? `дверей в проекте: ${usageOf(c.id)}` : ''].filter(Boolean).join(' · ');
    box.replaceChildren(...[
      h('div', { class: 'mut', style: { marginBottom: '10px' } }, 'Тип точки — «Дверь», разновидность — конфигурация: состав (запирание, считыватель, кнопки, датчики, дополнительно) и кабели двери. Название собирается само. Закреплённые идут первыми в списках выбора, в этом порядке; закрепление — для этого проекта. Новые конфигурации сами попадают в общий пул.'),
      h('div', { class: 'btns', style: { marginTop: 0 } }, h('button', { onclick: () => doorPicker({ title: '🧩 Новая конфигурация', onPick: (id) => { pin(id); toast('Закреплена в проекте'); } }) }, '➕ Собрать новую')),
      h('div', { class: 'group', style: { padding: '12px 0 4px' } }, `📌 Закреплённые в проекте (${list.length})`),
      list.length ? h('div', {}, ...list.map((c, i) => h('div', { class: 'wk done' },
        h('div', {}, h('b', {}, c.name), sub(c) ? h('div', { class: 'wk-sub' }, sub(c)) : null),
        h('span', { style: { display: 'flex', gap: '4px' } },
          h('button', { class: 'sec', style: { padding: '2px 10px' }, disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'sec', style: { padding: '2px 10px' }, disabled: i === list.length - 1, onclick: () => move(i, 1) }, '↓'),
          h('button', { class: 'sec', style: { padding: '2px 10px' }, title: 'Открепить', onclick: () => unpin(c.id) }, '✖'))))) : h('div', { class: 'empty' }, 'Ничего не закреплено'),
      h('div', { class: 'group', style: { padding: '12px 0 4px' } }, `Общий пул (${rest.length})`),
      rest.length ? h('div', {}, ...rest.map((c) => h('div', { class: 'wk todo' },
        h('div', {}, h('b', {}, c.name), sub(c) ? h('div', { class: 'wk-sub' }, sub(c)) : null),
        h('span', { style: { display: 'flex', gap: '4px' } },
          h('button', { class: 'sec', style: { padding: '2px 10px' }, title: 'Закрепить', onclick: () => pin(c) }, '📌'),
          canDeleteFromPool() ? h('button', { class: 'sec', style: { padding: '2px 10px' }, title: 'Удалить из общего пула', onclick: async () => {
            if (!(await confirmDialog(`Удалить из общего пула «${c.name}»?${usageOf(c.id) ? ` Двери этого проекта (${usageOf(c.id)}) продолжат работать — копия есть в проекте.` : ''}`, { yes: 'Удалить', danger: true }))) return;
            deleteFromPool(c.id); toast('Удалено из пула');
          } }, '🗑') : null)))) : h('div', { class: 'empty' }, 'Пусто'),
      legacy.length ? h('div', {}, h('div', { class: 'group', style: { padding: '12px 0 4px' } }, `Старые конфигурации — только работы (${legacy.length})`),
        h('div', { class: 'card', style: { padding: 0 } }, ...legacy.map((c) => h('div', { class: 'item', onclick: () => itemForm('configs', c) },
          h('div', { class: 'name' }, c.name, h('div', { class: 'sub' }, (c.components || []).map((id) => state.ctx.catalog.get(id)?.name || id).join(' + '))))))) : null].filter(Boolean));
  };
  paint();
  const offP = onDoorPool(() => { if (!box.isConnected) { offP(); return; } paint(); });
  const offS = subscribe(() => { if (!box.isConnected) { offS?.(); return; } paint(); });
  return box;
}
