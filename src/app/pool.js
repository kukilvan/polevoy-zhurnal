// Общий пул в приложении: слушает пул (все пользователи), входящие (только администратор пула)
// и отправляет администратору новое/изменённое из текущего проекта.
import { state, getRepo, subscribe, currentProject } from './store.js';
import { POOL_ADMIN, POOL_KINDS, poolMaps, inboxCandidates, deepHash, bundleFrom, coveredBy, candidateChanges } from '../domain/index.js';
import { docKey } from './repo.js';

export const pool = Object.fromEntries(POOL_KINDS.map((k) => [k, new Map()]));
const loaded = new Set();
export let inbox = [];
const subs = new Set();
export const onPool = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach((f) => { try { f(); } catch { /* ok */ } });
export const isPoolAdmin = () => String(getRepo()?.user?.email || '').toLowerCase() === POOL_ADMIN;
export const poolReady = () => loaded.size === POOL_KINDS.length;
// Пул реально скачан на телефон (а не пустой из-за того, что связи ещё не было ни разу)
export const poolHasData = () => POOL_KINDS.some((k) => pool[k].size > 0);

let started = false; let timer = null;
export function startPool() {
  if (started || !getRepo()) return; started = true;
  POOL_KINDS.forEach((k) => getRepo().listenPool(k, (docs) => { pool[k] = new Map(docs.filter((x) => !x.deleted).map((x) => [x.id, x])); loaded.add(k); emit(); schedule(); }));
  if (isPoolAdmin()) getRepo().listenInbox((list) => { inbox = list; emit(); });
  subscribe(() => schedule());
}
function schedule() { clearTimeout(timer); timer = setTimeout(pushCandidates, 4000); }

// новое/изменённое в текущем проекте → во входящие администратора (один раз на версию; пока пул пуст — не шлём)
const sentKey = 'pz.poolSent';
function pushCandidates() {
  try {
    const p = currentProject(); const repo = getRepo();
    if (!p || !poolReady() || !state.ctx || !['types', 'devices', 'cables', 'catalog'].every((c) => state.loaded?.has?.(c))) return;
    if (POOL_KINDS.every((k) => !pool[k].size)) return;
    let sent = {}; try { sent = JSON.parse(localStorage.getItem(sentKey) || '{}'); } catch { /* ok */ }
    const uid = repo.user.uid; const list = [];
    for (const c of inboxCandidates(state.ctx, poolMaps(pool))) {
      const key = `${uid}_${c.kind}_${docKey(c.id)}`.slice(0, 1400);
      if (sent[key] === c.hash) continue;
      list.push({ key, data: { kind: c.kind, itemId: c.id, item: c.item, deps: c.deps, hash: c.hash, owner: { uid, email: repo.user.email || '', name: repo.by.name }, project: { id: p.id, name: p.name || '' }, at: Date.now() } });
      sent[key] = c.hash;
    }
    if (!list.length) return;
    for (let i = 0; i < list.length; i += 300) repo.setInbox(list.slice(i, i + 300));
    try { localStorage.setItem(sentKey, JSON.stringify(sent)); } catch { /* ok */ }
  } catch (e) { console.warn('pool push', e); }
}

// Входящие по разделу: новые (без решения), изменённые после решения, отклонённые
// открыт: в пуле нет или есть отличия (по отпечатку; на всякий случай — и по списку изменений, чтобы старые записи без отличий не висели)
const openItem = (x) => { const m = poolMaps(pool); if (!m[x.kind]?.get(x.itemId)) return true; if (deepHash(m, x.kind, x.itemId) === x.hash) return false; return candidateChanges(x, m).length > 0; };
const decided = (x) => x.status && x.seenHash === x.hash;
export function inboxOf(kind) {
  // часть (работа, кабель, устройство), которая входит в открытый кандидат уровнем выше, принимается вместе с ним — отдельно не показываем
  const open = inbox.filter((x) => openItem(x) && !decided(x));
  const live = inbox.filter((x) => x.kind === kind && openItem(x) && !(!decided(x) && coveredBy(x, open)));
  return {
    fresh: live.filter((x) => !x.status),
    changed: live.filter((x) => x.status && x.seenHash && x.seenHash !== x.hash),
    ignored: live.filter((x) => x.status === 'ignored' && x.seenHash === x.hash),
  };
}
export const inboxCount = (kind) => (isPoolAdmin() ? inboxOf(kind).fresh.length : 0);

// Комплекты типов из пула (для импорта точек из файла: незнакомый тип можно взять из пула)
export function poolBundles() {
  const maps = poolMaps(pool); const m = new Map();
  maps.types.forEach((t, id) => { const b = bundleFrom(maps, id); if (b) m.set(id, { ...b, source: 'pool' }); });
  return m;
}
export const poolSentReset = () => { try { localStorage.removeItem(sentKey); } catch { /* ok */ } };
if (typeof window !== 'undefined' && new URLSearchParams(location.search).has('mem')) window.__pzPool = { pool, get inbox() { return inbox; }, poolMaps, deepHash, inboxCandidates, state };
