// «🗂 Общий пул» в каждом справочнике (типы точек, устройства, кабели, работы).
// Все: смотрят пул и галочками берут нужное в свой проект (взятое потом не меняется при правке пула).
// Администратор пула (почта Ивана): правит и удаляет в пуле, разбирает «новое из проектов» — смотрит, правит перед добавлением, добавляет или «больше не показывать».
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { POOL_TITLES, POOL_KINDS, poolMaps, takeFromPoolOps, buildContext, isSystemType, candidateChanges, changedParts, poolHash } from '../../domain/index.js';
import { bare } from '../../domain/typelib.js';
import { pool, onPool, isPoolAdmin, inboxOf, inboxCount, poolSentReset, inbox } from '../pool.js';
import { itemForm, setFormTarget } from './settings.js';

const nameOf = (kind, x) => (kind === 'types' || kind === 'cables' ? x.id : x.name || x.id);

// Кнопка у справочника: «🗂 Общий пул» (+ «• N новых» администратору)
export function poolButton(kind) {
  const b = h('button', { class: 'sec', onclick: () => poolModal(kind) });
  const paint = () => { const n = inboxCount(kind); b.textContent = n ? `🗂 Общий пул • ${n} новых` : '🗂 Общий пул'; b.className = n ? '' : 'sec'; };
  paint(); const off = onPool(() => { if (!b.isConnected) { off(); return; } paint(); });
  return b;
}

// Состав элемента словами (для просмотра)
function describe(kind, x, maps) {
  const nm = (k, id) => { const y = maps[k].get(id); return y ? nameOf(k, y) : id; };
  const rows = [];
  if (x.nameHe) rows.push(['Иврит', x.nameHe]);
  if (kind === 'types') {
    if (x.group) rows.push(['Группа', x.group]);
    rows.push(['Состав', (x.devices || []).map((d) => `${nm('devices', d.deviceId)}${d.count > 1 ? ` ×${d.count}` : ''}`).join(' + ') || '—']);
    if ((x.cables || []).length) rows.push(['Кабели точки', x.cables.map((c) => `${c.cable}×${c.count}`).join(' + ')]);
    if ((x.workIds || []).length) rows.push(['Работы на точку', x.workIds.map((w) => nm('catalog', w)).join(', ')]);
    (x.devices || []).forEach((d) => { const dv = maps.devices.get(d.deviceId); if (dv) rows.push([`  ${dv.name}`, `${(dv.cables || []).map((c) => `${c.cable}×${c.count}`).join(' + ') || 'без кабеля'}${(dv.workIds || []).length ? ` · ${dv.workIds.map((w) => nm('catalog', w)).join(', ')}` : ''}`]); });
  }
  if (kind === 'devices') { rows.push(['Кабели', (x.cables || []).map((c) => `${c.cable}×${c.count}`).join(' + ') || 'без кабеля']); rows.push(['Работы', (x.workIds || []).map((w) => nm('catalog', w)).join(', ') || '—']); }
  if (kind === 'cables') { rows.push(['Учёт', x.accounting || '—']); rows.push(['Работы кабеля', (x.workIds || []).map((w) => nm('catalog', w)).join(', ') || '—']); }
  if (kind === 'catalog') { rows.push(['Тип работы', x.workType || '—']); rows.push(['Единица', x.unit || '—']); }
  return h('div', {}, rows.map(([a, b]) => h('div', { style: { margin: '2px 0' } }, h('b', {}, `${a}: `), b)));
}

// Контекст для форм пула: пул (+ кандидат с зависимостями), остальные справочники — проекта
function poolCtx(extra = null) {
  const lists = Object.fromEntries(POOL_KINDS.map((k) => [k, [...pool[k].values()]]));
  if (extra) {
    const add = (k, x) => { if (x && !lists[k].some((y) => y.id === x.id)) lists[k].push(x); };
    (extra.deps?.catalog || []).forEach((x) => add('catalog', x)); (extra.deps?.cables || []).forEach((x) => add('cables', x)); (extra.deps?.devices || []).forEach((x) => add('devices', x));
    lists[extra.kind] = [...lists[extra.kind].filter((y) => y.id !== extra.item.id), extra.item];
  }
  return buildContext({ ...state.data, ...lists, projects: [currentProject()] });
}
const savePool = (ops) => getRepo().savePool(ops);

export function poolModal(kind) {
  const admin = isPoolAdmin(); const box = h('div', {}); let q = '';
  const close = openModal(`🗂 Общий пул — ${POOL_TITLES[kind]}`, box, { sticky: true, wide: true, onClose: () => { off(); setFormTarget(null); } });
  const off = onPool(() => draw());
  const mark = (list, status) => getRepo().setInbox(list.map((x) => ({ key: x.key, data: { status, seenHash: x.hash, seenItem: x.item, seenAt: Date.now() } })));
  const inProject = (id) => state.ctx[kind].has(id);
  const usage = (id) => {
    const c = state.ctx; const pts = [...c.points.values()];
    if (kind === 'types') return pts.filter((p) => p.typeId === id).length;
    if (kind === 'devices') return [...c.types.values()].filter((t) => (t.devices || []).some((d) => d.deviceId === id)).length + pts.filter((p) => (p.devices || []).some((d) => d.deviceId === id)).length;
    if (kind === 'cables') return [...c.devices.values()].filter((d) => (d.cables || []).some((x) => x.cable === id)).length + [...c.types.values()].filter((t) => (t.cables || []).some((x) => x.cable === id)).length;
    return [...c.types.values(), ...c.devices.values(), ...c.cables.values()].filter((x) => (x.workIds || []).includes(id)).length + (state.data.entries || []).filter((e) => e.workId === id && !e.deleted).length;
  };
  const toggle = (id, on) => {
    const pid = currentProject().id;
    if (on) { if (state.ctx[kind].has(id)) return; const ops = takeFromPoolOps(state.ctx, poolMaps(pool), kind, id); if (ops.length) getRepo().save(pid, ops); toast(`Взято в проект${ops.length > 1 ? ` вместе с тем, без чего не работает (${ops.length})` : ''}`); return; }
    if (!state.ctx[kind].has(id)) return;
    const n = usage(id); if (n) { toast(`Используется (${n}) — сначала уберите его из точек/типов`); draw(); return; }
    getRepo().remove(pid, kind, id); toast('Убрано из проекта');
  };
  const view = (x, { candidate = null } = {}) => {
    const maps = candidate ? poolMaps(poolCtx(candidate)) : poolMaps(pool);
    const it = candidate ? candidate.item : x;
    const btns = [];
    if (admin && candidate) {
      btns.push(h('button', { onclick: () => { c(); editCandidate(candidate); } }, '✏️ Изменить и добавить'));
      btns.push(h('button', { class: 'sec', onclick: () => { accept(candidate); toast('Добавлено в общий пул — вместе со всеми частями'); c(); } }, '➕ В общий пул'));
      btns.push(h('button', { class: 'sec', onclick: () => { mark([candidate], 'ignored'); toast('Больше не будет в уведомлениях'); c(); } }, '🚫 Больше не показывать'));
    } else if (admin) {
      btns.push(h('button', { onclick: () => { c(); setFormTarget({ ctx: poolCtx(), save: savePool }); itemForm(kind, x); } }, '✏️ Изменить в пуле'));
      btns.push(h('button', { class: 'danger', onclick: async () => { if (!(await confirmDialog(`Удалить «${nameOf(kind, x)}» из общего пула у всех? В проектах, где он уже взят, останется.`, { yes: 'Удалить', danger: true }))) return; savePool([{ coll: kind, id: x.id, remove: true }]); toast('Удалено из пула'); c(); } }, '🗑 Удалить из пула'));
    }
    const diff = candidate ? candidateChanges(candidate, poolMaps(pool)) : null;
    const c = openModal(nameOf(kind, it), h('div', {},
      candidate ? h('div', { class: 'mut', style: { marginBottom: '6px' } }, `От ${candidate.owner?.name || candidate.owner?.email || '—'}${candidate.owner?.email ? ` (${candidate.owner.email})` : ''} · проект «${candidate.project?.name || '—'}»`) : null,
      diff ? h('div', { class: 'card', style: { margin: '6px 0' } }, h('b', {}, 'Что изменится в пуле:'), diff.length ? h('ul', { style: { margin: '4px 0 0', paddingInlineStart: '18px' } }, diff.map((s) => h('li', {}, s))) : h('div', { class: 'mut' }, 'Отличий нет')) : null,
      describe(kind, it, maps), h('div', { class: 'btns' }, ...btns)), {});
  };
  // правка кандидата перед добавлением: те же формы, сохраняется в пул (у хозяина ничего не меняется)
  // принять кандидата: сам элемент + все его новые и изменённые части; закрыть и отдельные уведомления этих частей
  const partOps = (cand) => changedParts(cand, poolMaps(pool)).map((p) => ({ coll: p.kind, id: p.item.id, data: p.item }));
  const markWithParts = (cand) => {
    const parts = changedParts(cand, poolMaps(pool));
    const rel = inbox.filter((x) => x !== cand && x.owner?.uid === cand.owner?.uid && parts.some((p) => p.kind === x.kind && p.item.id === x.itemId && poolHash(p.item) === poolHash(x.item)));
    mark([cand, ...rel], 'added');
  };
  const accept = (cand) => { const ops = [...partOps(cand), { coll: kind, id: cand.itemId, data: cand.item }]; markWithParts(cand); savePool(ops); };
  const editCandidate = (cand) => {
    setFormTarget({ ctx: poolCtx(cand), save: (ops) => { const po = partOps(cand); markWithParts(cand); savePool([...po.filter((o) => !ops.some((x) => x.coll === o.coll && x.id === o.id)), ...ops]); } });
    itemForm(kind, cand.item);
  };
  const row = (x, { candidate = null } = {}) => {
    const it = candidate ? candidate.item : x;
    const cb = candidate ? null : h('input', { type: 'checkbox', checked: inProject(x.id), title: 'В этом проекте', onchange: (e) => toggle(x.id, e.target.checked) });
    return h('div', { class: 'item', style: { alignItems: 'center' } },
      cb ? h('label', { onclick: (e) => e.stopPropagation(), style: { display: 'flex', alignItems: 'center' } }, cb) : null,
      h('div', { class: 'name', style: { cursor: 'pointer' }, onclick: () => view(x, { candidate }) }, nameOf(kind, it),
        h('div', { class: 'sub' }, candidate ? `${candidate.owner?.email || ''} · «${candidate.project?.name || ''}»${pool[kind].has(candidate.itemId) ? ' · отличается от пула' : ''}` : (it.nameHe || ''))));
  };
  function draw() {
    const all = [...pool[kind].values()].filter((x) => !(kind === 'types' && isSystemType(x))).sort((a, b) => nameOf(kind, a).localeCompare(nameOf(kind, b), 'ru', { numeric: true }));
    const shown = all.filter((x) => !q || `${nameOf(kind, x)} ${x.nameHe || ''}`.toLowerCase().includes(q));
    const inb = admin ? inboxOf(kind) : null;
    const body = box.closest('.sheet-body') || box.parentElement; const keep = body?.scrollTop || 0; // не прыгать наверх после галочки
    const search = h('input', { type: 'search', placeholder: 'Поиск', value: q, oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); search.focus(); } });
    const seedBtn = admin && POOL_KINDS.every((k) => !pool[k].size) ? h('div', { class: 'card' },
      h('div', {}, 'Пул пуст. Заполнить его всем из справочников этого проекта (типы точек, устройства, кабели, работы)?'),
      h('div', { class: 'btns' }, h('button', { onclick: async () => {
        const c = state.ctx; const ops = [];
        c.types.forEach((x) => { if (!isSystemType(x)) ops.push({ coll: 'types', id: x.id, data: bare(x) }); });
        ['devices', 'cables', 'catalog'].forEach((k) => c[k].forEach((x) => ops.push({ coll: k, id: x.id, data: bare(x) })));
        if (!(await confirmDialog(`Положить в общий пул: ${ops.length} (типов ${c.types.size}, устройств ${c.devices.size}, кабелей ${c.cables.size}, работ ${c.catalog.size})?`, { yes: 'Заполнить' }))) return;
        for (let i = 0; i < ops.length; i += 300) await savePool(ops.slice(i, i + 300));
        getRepo().saveUserPrefs({ typeLib: [] }); poolSentReset(); toast('Общий пул заполнен');
      } }, `📥 Заполнить пул из «${currentProject()?.name}»`))) : null;
    box.replaceChildren(...[
      h('div', { class: 'mut', style: { marginBottom: '8px' } }, admin
        ? 'Вы администратор пула: правите и удаляете в пуле, разбираете новое из проектов. Галочка слева — взять в этот проект (взятое потом не меняется при правке пула).'
        : 'Общая база для переноса между проектами. Галочка слева — взять в этот проект вместе со всем, без чего он не работает. Нажмите на название — посмотреть состав.'),
      seedBtn,
      inb && inb.fresh.length ? h('div', { class: 'card', style: { padding: 0, marginBottom: '10px' } }, h('div', { class: 'group', style: { padding: '10px 14px 4px' } }, `🆕 Новое из проектов (${inb.fresh.length})`), inb.fresh.map((x) => row(null, { candidate: x }))) : null,
      inb && inb.changed.length ? h('details', { class: 'card', style: { marginBottom: '10px' } }, h('summary', {}, `✏️ Изменилось после вашего решения (${inb.changed.length})`), inb.changed.map((x) => row(null, { candidate: x }))) : null,
      inb && inb.ignored.length ? h('details', { class: 'card', style: { marginBottom: '10px' } }, h('summary', {}, `🚫 Не показываются (${inb.ignored.length})`), inb.ignored.map((x) => row(null, { candidate: x }))) : null,
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, search, admin ? h('button', { class: 'sec', onclick: () => { setFormTarget({ ctx: poolCtx(), save: savePool }); itemForm(kind, null); } }, '➕ Новый в пул') : null),
      h('div', { class: 'card', style: { padding: 0, marginTop: '8px' } }, shown.length ? shown.map((x) => row(x)) : h('div', { class: 'empty' }, all.length ? 'Ничего не найдено' : 'В пуле пока ничего нет'))].filter(Boolean));
    if (body) body.scrollTop = keep;
  }
  draw();
  void close;
}
