// Общий пул (одна база на всех): типы точек, устройства, кабели, работы. Управляет только администратор пула (Иван).
// Проект держит свою копию взятого из пула — изменения пула взятое не меняют (только «удалить и взять заново»).
// Новое и изменённое в проектах приложение само отправляет администратору во «входящие» (pool_inbox).
import { bare, bundleFrom } from './typelib.js';
import { isSystemType } from './pointsimport.js';

export const POOL_ADMIN = 'erudit199867@gmail.com';
export const POOL_KINDS = ['types', 'devices', 'cables', 'catalog'];
export const POOL_TITLES = { types: 'Типы точек', devices: 'Устройства', cables: 'Кабели', catalog: 'Работы' };

const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).filter((k) => v[k] !== undefined && v[k] !== null && v[k] !== '' && k !== 'id').sort().map((k) => `${k}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
/** Отпечаток содержимого (без служебных полей) — для «изменилось ли» */
export function poolHash(item) {
  const s = stable(bare(item)); let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
export const poolMaps = (pool) => Object.fromEntries(POOL_KINDS.map((k) => [k, pool?.[k] instanceof Map ? pool[k] : new Map((pool?.[k] || []).map((x) => [x.id, x]))]));

/** Без чего элемент не работает: { devices, cables, catalog } (копии без служебных полей) */
export function depsOf(maps, kind, id) {
  if (kind === 'types') { const b = bundleFrom(maps, id); return b ? { devices: b.devices, cables: b.cables, catalog: b.catalog } : { devices: [], cables: [], catalog: [] }; }
  const out = { devices: [], cables: [], catalog: [] };
  const addW = (w) => { const x = maps.catalog.get(w); if (x && !out.catalog.some((y) => y.id === w)) out.catalog.push(bare(x)); };
  const addC = (c) => { const x = maps.cables.get(c); if (x && !out.cables.some((y) => y.id === c)) { out.cables.push(bare(x)); (x.workIds || []).forEach(addW); } };
  const item = maps[kind].get(id); if (!item) return out;
  if (kind === 'devices') { (item.cables || []).forEach((c) => addC(c.cable)); (item.workIds || []).forEach(addW); }
  if (kind === 'cables') (item.workIds || []).forEach(addW);
  return out;
}

/** Операции «взять из пула в проект»: элемент и всё, без чего он не работает. Что в проекте уже есть — не трогается. */
export function takeFromPoolOps(ctx, maps, kind, id, ops = []) {
  const has = (coll, x) => ctx[coll].has(x) || ops.some((o) => o.coll === coll && o.id === x);
  const put = (coll, x) => { if (x && !has(coll, x.id)) ops.push({ coll, id: x.id, data: { ...bare(x), deleted: false } }); };
  const d = depsOf(maps, kind, id);
  d.catalog.forEach((x) => put('catalog', x)); d.cables.forEach((x) => put('cables', x)); d.devices.forEach((x) => put('devices', x));
  put(kind, maps[kind].get(id));
  return ops;
}

/** Отпечаток элемента вместе с частями (изменилась работа внутри типа — изменился и тип) */
export const deepHash = (maps, kind, id) => { const x = maps[kind].get(id); return x ? poolHash({ item: bare(x), deps: depsOf(maps, kind, id) }) : ''; };
/** Что из проекта стоит показать администратору: нет в пуле или отличается от пула (сам элемент или его части) */
export function inboxCandidates(ctx, maps) {
  const out = [];
  const projMaps = { types: ctx.types, devices: ctx.devices, cables: ctx.cables, catalog: ctx.catalog };
  for (const kind of POOL_KINDS) {
    for (const x of ctx[kind].values()) {
      if (kind === 'types' && isSystemType(x)) continue;
      const hash = deepHash(projMaps, kind, x.id); const inPool = maps[kind].get(x.id);
      if (inPool && deepHash(maps, kind, x.id) === hash) continue;
      out.push({ kind, id: x.id, item: bare(x), deps: depsOf(projMaps, kind, x.id), hash, changedFromPool: !!inPool });
    }
  }
  return out;
}

/** Что поменялось в элементе (для «изменён»): список полей */
export function changedFields(a = {}, b = {}) {
  const keys = new Set([...Object.keys(bare(a)), ...Object.keys(bare(b))]); keys.delete('id');
  return [...keys].filter((k) => stable(a[k]) !== stable(b[k]));
}

// ---- понятный список изменений относительно пула ----
const KIND_ONE = { types: 'Тип', devices: 'Устройство', cables: 'Кабель', catalog: 'Работа' };
const NEW_ONE = { types: 'Новый тип', devices: 'Новое устройство', cables: 'Новый кабель', catalog: 'Новая работа' };
const FIELD = { name: 'Название', nameHe: 'Иврит', group: 'Группа', workType: 'Тип работы', unit: 'Единица', accounting: 'Учёт протяжки', scanId: 'Серийник/MAC',
  active: 'Активна', defaultCable: 'Кабель по умолчанию', defaultCables: 'Кабелей на точку', stages: 'Этапы' };
const show = (v) => (v === undefined || v === null || v === '' ? '—' : Array.isArray(v) ? (v.length ? v.join(', ') : '—') : v === true ? 'да' : v === false ? 'нет' : String(v));

/** Имя элемента по картам (кандидат + пул) */
const nameIn = (maps, kind, id) => { const x = maps[kind]?.get(id); return x ? (kind === 'types' || kind === 'cables' ? x.id : x.name || x.id) : id; };
// поля одного элемента: строки «что стало иначе» (nm — имена из карт)
export function fieldChanges(kind, a = {}, b = {}, maps) {
  const out = []; const nm = (k, id) => nameIn(maps, k, id);
  const listDiff = (label, xa = [], xb = [], fmt) => {
    const ma = new Map((xa || []).map((x) => [fmt.key(x), x])); const mb = new Map((xb || []).map((x) => [fmt.key(x), x]));
    mb.forEach((x, k) => { if (!ma.has(k)) out.push(`${label}: + ${fmt.text(x)}`); else if (fmt.cnt && fmt.cnt(ma.get(k)) !== fmt.cnt(x)) out.push(`${label}: ${fmt.text(ma.get(k))} → ${fmt.text(x)}`); });
    ma.forEach((x, k) => { if (!mb.has(k)) out.push(`${label}: − ${fmt.text(x)}`); });
  };
  const works = { key: (w) => w, text: (w) => nm('catalog', w) };
  const qtyDev = { key: (d) => d.deviceId, cnt: (d) => Number(d.count) || 1, text: (d) => `${nm('devices', d.deviceId)} ×${Number(d.count) || 1}` };
  const qtyCab = { key: (c) => c.cable, cnt: (c) => Number(c.count) || 1, text: (c) => `${c.cable} ×${Number(c.count) || 1}` };
  const done = new Set(['id']);
  if (kind === 'types') { listDiff('Состав', a.devices, b.devices, qtyDev); listDiff('Кабели точки', a.cables, b.cables, qtyCab); listDiff('Работы на точку', a.workIds, b.workIds, works); ['devices', 'cables', 'workIds'].forEach((k) => done.add(k)); }
  if (kind === 'devices') { listDiff('Кабели', a.cables, b.cables, qtyCab); listDiff('Работы', a.workIds, b.workIds, works); ['cables', 'workIds'].forEach((k) => done.add(k)); }
  if (kind === 'cables') { listDiff('Работы кабеля', a.workIds, b.workIds, works); done.add('workIds'); }
  if (kind === 'catalog') { listDiff('Для типов', a.forTypes, b.forTypes, { key: (t) => t, text: (t) => t }); done.add('forTypes'); }
  const A = bare(a); const B = bare(b);
  [...new Set([...Object.keys(A), ...Object.keys(B)])].filter((k) => !done.has(k) && stable(A[k]) !== stable(B[k]))
    .filter((k) => !(k === 'scanId' && !A[k] && !B[k])).forEach((k) => { if (show(A[k]) !== show(B[k])) out.push(`${FIELD[k] || k}: ${show(A[k])} → ${show(B[k])}`); });
  return out;
}
const describeNew = (kind, x, maps) => {
  const nm = (k, id) => nameIn(maps, k, id);
  if (kind === 'catalog') return `${x.workType || '—'}${x.unit ? `, ${x.unit}` : ''}`;
  if (kind === 'cables') return (x.workIds || []).length ? `работы: ${x.workIds.map((w) => nm('catalog', w)).join(', ')}` : 'без работ';
  if (kind === 'devices') return `${(x.cables || []).map((c) => `${c.cable}×${c.count}`).join(' + ') || 'без кабеля'}${(x.workIds || []).length ? `; работы: ${x.workIds.map((w) => nm('catalog', w)).join(', ')}` : ''}`;
  return (x.devices || []).map((d) => `${nm('devices', d.deviceId)} ×${d.count}`).join(' + ') || '—';
};
/** Части кандидата, которых в пуле нет или которые отличаются: [{ kind, item, isNew }] */
export function changedParts(cand, maps) {
  const out = [];
  ['catalog', 'cables', 'devices'].forEach((k) => (cand.deps?.[k] || []).forEach((x) => {
    const p = maps[k].get(x.id);
    if (!p) out.push({ kind: k, item: x, isNew: true }); else if (poolHash(p) !== poolHash(x)) out.push({ kind: k, item: x, isNew: false });
  }));
  return out;
}
/** Все изменения кандидата относительно пула словами (сам элемент + его части) */
export function candidateChanges(cand, maps) {
  const lists = Object.fromEntries(POOL_KINDS.map((k) => [k, new Map(maps[k])]));
  ['catalog', 'cables', 'devices'].forEach((k) => (cand.deps?.[k] || []).forEach((x) => lists[k].set(x.id, x)));
  lists[cand.kind].set(cand.item.id, cand.item);
  const out = [];
  const inPool = maps[cand.kind].get(cand.item.id);
  if (!inPool) out.push(`${NEW_ONE[cand.kind]}: ${describeNew(cand.kind, cand.item, lists)}`);
  else out.push(...fieldChanges(cand.kind, inPool, cand.item, lists));
  changedParts(cand, maps).forEach(({ kind, item, isNew }) => {
    const nm = nameIn(lists, kind, item.id);
    if (isNew) out.push(`${NEW_ONE[kind]} «${nm}»: ${describeNew(kind, item, lists)}`);
    else fieldChanges(kind, maps[kind].get(item.id), item, lists).forEach((s) => out.push(`${KIND_ONE[kind]} «${nm}» — ${s}`));
  });
  return out;
}
// Какие кандидаты «накрыты» кандидатом уровнем выше (тип включает свои устройства, кабели, работы — их принимают вместе с ним)
const LEVEL = { types: 3, devices: 2, cables: 1, catalog: 0 };
export function coveredBy(cand, others) {
  return others.find((o) => o !== cand && o.owner?.uid === cand.owner?.uid && LEVEL[o.kind] > LEVEL[cand.kind]
    && (o.deps?.[cand.kind] || []).some((x) => x.id === cand.itemId && poolHash(x) === poolHash(cand.item))) || null;
}

/** Где используется элемент справочника проекта: [{ label, n }] (устройство, кабель, работа) */
export function usesOf(ctx, coll, id) {
  const out = [];
  const add = (label, n) => { if (n) out.push({ label, n }); };
  const names = (list, f) => list.filter(f).map((x) => x.id || x.label);
  const types = [...ctx.types.values()]; const devs = [...ctx.devices.values()]; const cabs = [...ctx.cables.values()];
  const pts = [...ctx.points.values()]; const cfgs = [...(ctx.configs?.values() || [])].filter((c) => !c.deleted);
  const nm = (list) => list.map((x) => x.name || x.id);
  if (coll === 'devices') {
    add('Типы', names(types, (t) => (t.devices || []).some((d) => d.deviceId === id)).length);
    add('Точки со своим составом', pts.filter((p) => (p.devices || []).some((d) => d.deviceId === id)).length);
    add('Конфигурации дверей', cfgs.filter((c) => (c.devices || []).some((d) => d.deviceId === id)).length);
  } else if (coll === 'cables') {
    add('Типы', types.filter((t) => t.defaultCable === id || (t.cables || []).some((c) => c.cable === id)).length);
    add('Устройства', devs.filter((d) => (d.cables || []).some((c) => c.cable === id)).length);
    add('Точки со своими кабелями', pts.filter((p) => [p.cables, p.cableOverride].some((l) => (l || []).some((c) => c.cable === id)) || (p.devices || []).some((d) => (d.cables || []).some((c) => c.cable === id))).length);
    add('Конфигурации дверей', cfgs.filter((c) => (c.cables || []).some((k) => k.cable === id)).length);
  } else if (coll === 'catalog') {
    const has = (x) => (x.workIds || []).includes(id);
    add('Типы', types.filter(has).length); add('Устройства', devs.filter(has).length); add('Кабели', cabs.filter(has).length);
    add('Точки со своими работами', pts.filter((p) => (p.devices || []).some((d) => (d.workIds || []).includes(id))).length);
    add('Записи в дохе', [...ctx.entries.values()].filter((e) => e.workId === id).length);
  }
  void nm;
  return out;
}
export const usesText = (list) => list.map((u) => `${u.label}: ${u.n}`).join(', ');
