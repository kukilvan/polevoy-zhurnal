// «📥 Точки из файла»: добавить точки из JSON (например, после разбора тохнита) — с предпросмотром, ничего не заменяет.
import { h, openModal, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { newId } from '../repo.js';
import { parsePointsFile, planPointsImport, pointsImportOps, typePool } from '../../domain/index.js';

export function pointsFromFile() {
  const input = h('input', { type: 'file', accept: '.json,application/json,text/plain', style: { display: 'none' } });
  const out = h('div', {});
  const close = openModal('Точки из файла', h('div', {},
    h('div', { class: 'mut' }, 'Файл .json с точками (например, после разбора тохнита). Точки добавятся к проекту; уже существующие (то же обозначение) пропускаются. Перед добавлением — предпросмотр.'),
    h('div', { class: 'btns' }, h('button', { onclick: () => input.click() }, '📂 Выбрать файл'), input), out), { sticky: true });
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; if (!file) return;
    let data;
    try { data = parsePointsFile(await file.text()); } catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)); return; }
    out.replaceChildren(importPreview(data, file.name, close));
  });
}

// Предпросмотр добавления точек (общий для файла и для разбора чертежа в приложении)
export function importPreview(data, title, close) {
  const plan = planPointsImport(state.ctx, data, typePool(getRepo().prefs?.typeLib));
  const off = new Set(); // снятые точки
  const list = (title, items, cls) => (items.length ? h('div', { style: { margin: '8px 0' } }, h('b', { class: cls }, `${title} (${items.length})`),
    h('div', { style: { fontSize: '14px', maxHeight: '160px', overflow: 'auto' } }, items.map((x) => h('div', {}, x)))) : null);
  const goBtn = h('button', {});
  const label = () => { goBtn.textContent = `➕ Добавить точек: ${plan.add.length - off.size}`; goBtn.disabled = plan.add.length - off.size <= 0; };
  goBtn.onclick = () => {
    const ops = pointsImportOps({ ...plan, add: plan.add.filter((p) => !off.has(p.label)) }, newId, data);
    getRepo().save(currentProject().id, ops.map((o) => ({ ...o, data: { ...o.data, deleted: false } })));
    toast(`Добавлено точек: ${ops.filter((o) => o.coll === 'points').length}`); close?.();
  };
  label();
  const parts = [
    h('div', { class: 'card', style: { margin: '10px 0' } }, h('b', {}, `${title}`), data.source ? h('div', { class: 'mut' }, data.source) : null,
      h('div', { style: { marginTop: '6px', fontSize: '14px' } }, Object.entries(plan.byType).sort().map(([k, n]) => h('div', {}, `${k}: ${n}`)))),
    plan.newTypes.length ? list('Будут созданы типы (из файла)', plan.newTypes.map((t) => t.id)) : null,
    plan.poolTypes.length ? list('Будут добавлены типы из общего пула', plan.poolTypes.map((b) => `${b.type.id}${b.devices.length ? ` (${b.devices.map((d) => d.name).join(' + ')})` : ''}`)) : null,
    plan.blankTypes.length ? list('⚠️ Будут созданы пустые типы (нет нигде) — состав настройте потом в «Типах точек»', plan.blankTypes, 'l-warn') : null,
    plan.newDevices.length ? list('Будут созданы устройства', plan.newDevices.map((d) => d.name || d.id)) : null,
    list('❌ Ошибки — эти строки не добавятся', plan.errors, 'l-error'),
    plan.warnings.length ? h('div', { style: { margin: '8px 0' } }, h('b', { class: 'l-warn' }, `⚠️ Подозрительные обозначения (${plan.warnings.length}) — снимите галочку, если это не точка`),
      h('div', { class: 'picklist', style: { maxHeight: '200px' } }, plan.warnings.map((w) => {
        const lbl = w.split(':')[0];
        const cb = h('input', { type: 'checkbox', checked: true, onchange: () => { cb.checked ? off.delete(lbl) : off.add(lbl); label(); } });
        return h('label', { class: 'pickrow' }, cb, h('span', {}, w));
      }))) : null,
    list('Уже есть в проекте — пропущены', plan.skipped),
    h('div', { class: 'btns' }, goBtn)].filter(Boolean);
  return h('div', {}, ...parts);
}
