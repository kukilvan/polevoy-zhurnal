// «📥 Точки из файла»: добавить точки из JSON (например, после разбора тохнита) — с предпросмотром, ничего не заменяет.
import { h, openModal, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { newId } from '../repo.js';
import { parsePointsFile, planPointsImport, pointsImportOps, UNSORTED_TYPE, posOf } from '../../domain/index.js';
import { poolBundles } from '../pool.js';
import { drawingsOf } from '../drawings.js';

export function pointsFromFile() {
  const input = h('input', { type: 'file', accept: '.json,application/json,text/plain', style: { display: 'none' } });
  const out = h('div', {});
  const close = openModal('Точки из файла', h('div', {},
    h('div', { class: 'mut' }, 'Файл .json с точками (например, после разбора тохнита). Точки добавятся к проекту; уже существующие (то же обозначение в том же шкафу) пропускаются; такое же обозначение в другом шкафу — не помеха. Перед добавлением — предпросмотр.'),
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
  const plan = planPointsImport(state.ctx, data, poolBundles());
  const off = new Set(); // снятые точки
  const list = (title, items, cls) => (items.length ? h('div', { style: { margin: '8px 0' } }, h('b', { class: cls }, `${title} (${items.length})`),
    h('div', { style: { fontSize: '14px', maxHeight: '160px', overflow: 'auto' } }, items.map((x) => h('div', {}, x)))) : null);
  // точки, которые уже есть в проекте, но без места на этом чертеже — отметить их место (связать с чертежом)
  const sheetName = data?.sheet?.pdf || '';
  const drawingNames = new Set(drawingsOf().flatMap((d) => [d.name, ...(d.aliases || [])]));
  const keyOf = (label, cab) => `${cab || ''}\u0000${label}`;
  const byLabel = new Map([...state.ctx.points.values()].map((p) => [keyOf(p.label, p.cabinet), p]));
  const fKey = (f) => keyOf(String(f.label).trim(), String(f.cabinet || data.cabinet || '').trim());   // то же обозначение в том же шкафу
  const toLink = sheetName ? data.points.filter((f) => f.pos && byLabel.has(fKey(f))).map((f) => ({ f, p: byLabel.get(fKey(f)) }))
    .filter(({ p }) => p.pos?.sheet !== sheetName && !(p.pos?.sheet && drawingNames.has(p.pos.sheet) && p.pos.sheet !== sheetName)) : [];
  const linkCb = h('input', { type: 'checkbox', checked: true, onchange: () => label() });
  const goBtn = h('button', {});
  const nLink = () => (linkCb.checked ? toLink.length : 0);
  const label = () => { const n = plan.add.length - off.size; goBtn.textContent = n > 0 ? `➕ Добавить точек: ${n}${nLink() ? ` · отметить на чертеже: ${nLink()}` : ''}` : nLink() ? `📍 Отметить на чертеже: ${nLink()}` : '➕ Добавить точек: 0'; goBtn.disabled = n <= 0 && !nLink(); };
  goBtn.onclick = () => {
    const ops = pointsImportOps({ ...plan, add: plan.add.filter((p) => !off.has(p)) }, newId, data);
    const linkOps = nLink() ? toLink.map(({ f, p }) => ({ coll: 'points', id: p.id, data: { pos: posOf(f, data) } })) : [];
    getRepo().save(currentProject().id, [...ops.map((o) => ({ ...o, data: { ...o.data, deleted: false } })), ...linkOps]);
    toast(`Добавлено точек: ${ops.filter((o) => o.coll === 'points').length}${linkOps.length ? `, отмечено на чертеже: ${linkOps.length}` : ''}`); close?.();
  };
  label();
  // все точки к добавлению — по группам (шкаф · тип), у каждой галочка: снять — не добавлять; у группы — снять/поставить всю группу
  const warnOf = new Map(plan.warnings.map((w) => [w.split(':')[0], w.slice(w.indexOf(':') + 1).trim()]));
  const groups = new Map(); plan.add.forEach((p) => { const k = `${p.cabinet || 'без шкафа'} · ${p.typeId}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
  const groupEls = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru', { numeric: true })).map(([k, list]) => {
    const boxes = list.map((p) => {
      const cb = h('input', { type: 'checkbox', checked: true, onchange: () => { cb.checked ? off.delete(p) : off.add(p); sync(); label(); } });
      return { p, cb, el: h('label', { class: 'pickrow' }, cb, h('span', {}, p.label, warnOf.has(p.label) ? h('small', { class: 'l-warn' }, ` ⚠️ ${warnOf.get(p.label)}`) : null, p.planName && p.planName !== p.label ? h('small', { class: 'mut' }, ` · ${p.planName}`) : null, plan.alsoIn?.has(`${p.cabinet || ''}\u0000${p.label}`) ? h('small', { class: 'mut' }, ` · такое же есть: ${plan.alsoIn.get(`${p.cabinet || ''}\u0000${p.label}`)}`) : null)) };
    });
    const all = h('input', { type: 'checkbox', checked: true, onchange: () => { boxes.forEach((b) => { b.cb.checked = all.checked; all.checked ? off.delete(b.p) : off.add(b.p); }); sync(); label(); } });
    const cnt = h('span', {});
    const sync = () => { const on = boxes.filter((b) => b.cb.checked).length; all.checked = on === boxes.length; all.indeterminate = on > 0 && on < boxes.length; cnt.textContent = ` ${k}: ${on}${on < boxes.length ? ` из ${boxes.length}` : ''}`; };
    sync();
    // галочка группы — отдельно от раскрывающегося заголовка (нажатие по названию только раскрывает)
    return h('div', { style: { display: 'flex', gap: '6px', alignItems: 'flex-start', margin: '4px 0' } }, h('span', { style: { paddingTop: '2px' } }, all),
      h('details', { style: { flex: 1, minWidth: 0 } }, h('summary', { style: { cursor: 'pointer', fontSize: '14px' } }, cnt, list.some((p) => warnOf.has(p.label)) ? h('small', { class: 'l-warn' }, ' ⚠️') : null),
        h('div', { class: 'picklist', style: { maxHeight: '260px' } }, boxes.map((b) => b.el))));
  });
  const parts = [
    h('div', { class: 'card', style: { margin: '10px 0' } }, h('b', {}, `${title}`), data.source ? h('div', { class: 'mut' }, data.source) : null,
      plan.add.length ? h('div', { style: { marginTop: '6px' } }, h('div', { class: 'mut' }, 'Будут добавлены — раскройте группу и снимите галочки с точек, которые не нужны (галочка у группы — вся группа):'), ...groupEls) : null),
    plan.newTypes.length ? list('Будут созданы типы (из файла)', plan.newTypes.map((t) => t.id)) : null,
    plan.poolTypes.length ? list('Будут добавлены типы из общего пула', plan.poolTypes.map((b) => `${b.type.id}${b.devices.length ? ` (${b.devices.map((d) => d.name).join(' + ')})` : ''}`)) : null,
    plan.blankTypes.filter((t) => t !== UNSORTED_TYPE).length ? list('⚠️ Будут созданы пустые типы (нет нигде) — состав настройте потом в «Типах точек»', plan.blankTypes.filter((t) => t !== UNSORTED_TYPE), 'l-warn') : null,
    plan.add.some((p) => p.typeId === UNSORTED_TYPE) ? h('div', { class: 'mut', style: { margin: '8px 0' } }, `❓ Не разобрано: ${plan.add.filter((p) => p.typeId === UNSORTED_TYPE).length} — разберёте потом: «Точки» → «❓ Не разобрано»`) : null,
    plan.newDevices.length ? list('Будут созданы устройства', plan.newDevices.map((d) => d.name || d.id)) : null,
    list('❌ Ошибки — эти строки не добавятся', plan.errors, 'l-error'),
    plan.warnings.length ? h('div', { class: 'l-warn', style: { margin: '8px 0' } }, `⚠️ Подозрительные обозначения: ${plan.warnings.length} — отмечены ⚠️ в группах выше; снимите галочку, если это не точка.`) : null,
    toLink.length ? h('label', { class: 'pickrow', style: { margin: '8px 0' } }, linkCb, h('span', {}, `📍 Уже есть в проекте, но без места на этом чертеже: ${toLink.length} (${toLink.slice(0, 6).map((x) => x.p.label).join(', ')}${toLink.length > 6 ? '…' : ''}) — отметить их место на чертеже`)) : null,
    list('Уже есть в проекте (то же обозначение в том же шкафу) — пропущены', plan.skipped),
    h('div', { class: 'btns' }, goBtn)].filter(Boolean);
  return h('div', {}, ...parts);
}
