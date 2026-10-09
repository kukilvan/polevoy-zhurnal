// Состояние приложения: проекты пользователя, данные текущего проекта и контекст расчётов.
import { COLLECTIONS } from './repo.js';
import { buildContext, pointInfo, comparePoints } from '../domain/index.js';
import { info } from '../log.js';

const listeners = new Set();
let repo = null;
let unsubProjects = null;
let unsubColls = [];
let rebuildTimer = null;
const infoCache = new WeakMap();
let unsubInvites = null;
let unsubPrefs = null;
let unsubAllDays = new Map(); // дни всех проектов (для вкладки «Месяц»)
const allDaysByProject = new Map();

export const state = {
  projects: [], currentProjectId: null, projectsLoaded: false,
  data: Object.fromEntries(COLLECTIONS.map((c) => [c, []])), loaded: new Set(),
  ctx: null, online: navigator.onLine, pendingProjectId: null, invitations: [],
};

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => fn());
const storeKey = () => `pz.currentProject.${repo?.user.uid}`;

function rebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    const project = currentProject();
    state.ctx = project ? buildContext({ ...state.data, projects: [project] }) : null;
    emit();
  }, 0);
}

export const liveProjects = () => state.projects.filter((p) => !p.deleted);
export const currentProject = () => state.projects.find((p) => p.id === state.currentProjectId && !p.deleted) || null;

function openProjectData(pid) {
  unsubColls.forEach((u) => u()); unsubColls = [];
  state.data = Object.fromEntries(COLLECTIONS.map((c) => [c, []])); state.loaded = new Set();
  if (!pid) return;
  COLLECTIONS.forEach((name) => {
    unsubColls.push(repo.listenColl(pid, name, (docs) => { state.data[name] = docs; state.loaded.add(name); rebuild(); }));
  });
}

export function setCurrentProject(pid, { pending = false } = {}) {
  if (pid === state.currentProjectId) return;
  state.currentProjectId = pid; state.pendingProjectId = pending ? pid : null;
  try { localStorage.setItem(storeKey(), pid || ''); } catch { /* нет доступа к хранилищу */ }
  info(`Текущий проект: ${currentProject()?.name || '—'}`);
  openProjectData(pid); rebuild();
}

function syncAllDays(live) {
  const ids = new Set(live.map((p) => p.id));
  unsubAllDays.forEach((u, id) => { if (!ids.has(id)) { u(); unsubAllDays.delete(id); allDaysByProject.delete(id); } });
  ids.forEach((id) => {
    if (unsubAllDays.has(id)) return;
    unsubAllDays.set(id, repo.listenColl(id, 'days', (docs) => { allDaysByProject.set(id, docs); emit(); }));
  });
}
export const allDays = () => [...allDaysByProject.entries()].flatMap(([pid, docs]) => docs.map((d) => ({ ...d, projectId: d.projectId || pid })));

export function start(r) {
  repo = r;
  unsubInvites = repo.listenInvitations((docs) => { state.invitations = docs; emit(); });
  unsubPrefs = repo.listenUserPrefs(() => emit());
  unsubProjects = repo.listenProjects((docs) => {
    state.projects = docs; state.projectsLoaded = true;
    const live = liveProjects();
    syncAllDays(live);
    // только что созданный проект может ещё не прийти в список — не уходим с него
    if (state.pendingProjectId && state.pendingProjectId === state.currentProjectId) {
      if (!live.some((p) => p.id === state.pendingProjectId)) { rebuild(); return; }
      state.pendingProjectId = null;
    }
    let saved = null; try { saved = localStorage.getItem(storeKey()); } catch { /* нет доступа */ }
    const wanted = live.find((p) => p.id === state.currentProjectId)?.id || live.find((p) => p.id === saved)?.id
      || [...live].sort((a, b) => (b.lastWorkDate || b.createdAt || 0) - (a.lastWorkDate || a.createdAt || 0))[0]?.id || null;
    if (wanted !== state.currentProjectId) { state.currentProjectId = null; setCurrentProject(wanted); } else rebuild();
  });
}

export function stop() {
  unsubInvites?.(); unsubPrefs?.(); state.invitations = [];
  unsubProjects?.(); unsubColls.forEach((u) => u()); unsubColls = [];
  unsubAllDays.forEach((u) => u()); unsubAllDays = new Map(); allDaysByProject.clear();
  repo = null; state.projects = []; state.currentProjectId = null; state.projectsLoaded = false; state.ctx = null;
  state.data = Object.fromEntries(COLLECTIONS.map((c) => [c, []])); state.loaded = new Set();
}

export const getRepo = () => repo;
export const ready = () => !!state.ctx && COLLECTIONS.every((c) => state.loaded.has(c));

// Расчёты по точке (кэшируются на время жизни контекста)
export function infoOf(point) {
  const ctx = state.ctx; if (!ctx) return null;
  let m = infoCache.get(ctx); if (!m) { m = new Map(); infoCache.set(ctx, m); }
  if (!m.has(point.id)) m.set(point.id, pointInfo(point, ctx));
  return m.get(point.id);
}
export const pointsSorted = () => (state.ctx ? [...state.ctx.points.values()].sort(comparePoints) : []);
