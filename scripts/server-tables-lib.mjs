// Ночное автообновление таблиц для руководства на сервере (GitHub Actions). Логика без обращения к сети — проверяется тестом.
import { buildContext, tablesOf, numberedInput, numberedHash } from '../src/domain/index.js';
import { numberedPdf } from '../src/tohnit/numbered.js';
import { syncTable } from '../src/app/managers.js';
import { syncRackTable, rackAuto } from '../src/app/racktablecore.js';
import { isDeleted } from './server-backup-lib.mjs';

const memberKey = (email) => String(email).toLowerCase().replace(/\./g, '_');
// Имя автора по uid (как в приложении): имя участника или его почта
export function nameByUid(p, uid) {
  if (!uid) return '';
  const i = (p.memberUids || []).indexOf(uid);
  const email = i >= 0 ? (p.memberEmails || [])[i] : (p.removedMembers || {})[uid];
  return email ? (p.memberNames?.[memberKey(email)] || email) : '';
}

// Какие таблицы обновлять ночью: с файлом и включённой галочкой (основная — по умолчанию включена)
export const autoTables = (project) => tablesOf(project).filter((t) => t.fileId && (t.auto === undefined ? !!t.main : t.auto));

// Обновляет таблицы одного проекта. Возвращает { patches: {tableId: поля}, report: [строки] }
export async function updateProjectTables(api, project, data, now = new Date()) {
  const ctx = buildContext({ ...data, projects: [project] });
  const patches = {}; const report = [];
  for (const table of autoTables(project)) {
    try {
      const r = await syncTable(api, project, ctx, table, { uid: '__server', nameOf: (u) => nameByUid(project, u), noCreate: true });
      const { by, ...rest } = r.patch; void by;
      patches[table.id] = { ...rest, serverAt: now.toISOString(), serverError: '' };
      report.push(`${table.name}: ${r.changed ? `обновлена (точек ${r.rep.pointCount})` : 'без изменений'}`);
    } catch (e) {
      patches[table.id] = { serverAt: now.toISOString(), serverError: String(e.message || e).slice(0, 300) };
      report.push(`${table.name}: ОШИБКА ${e.message}`);
    }
  }
  return { patches, report };
}

// Таблица шкафов и шильюта для руководства: обновляется, если что-то поменялось. → { patch|null, report }
export async function updateProjectRackTable(api, project, data, now = new Date()) {
  if (!rackAuto(project)) return { patch: null, report: [] };
  const ctx = buildContext({ ...data, projects: [project] });
  try {
    const r = await syncRackTable(api, project, ctx, { uid: '__server', noCreate: true });
    const { by, ...rest } = r.patch; void by;
    return { patch: { ...rest, serverAt: now.toISOString(), serverError: '' }, report: [`шкафы и шильют: ${r.changed ? 'обновлена' : 'без изменений'}`] };
  } catch (e) {
    return { patch: { serverAt: now.toISOString(), serverError: String(e.message || e).slice(0, 300) }, report: [`шкафы и шильют: ОШИБКА ${e.message}`] };
  }
}

// «PDF с номерами» на Диске: чертежи, которые приложение уже выложило (numberedFileId) и открыло серверу.
// Пересобираем, только если что-то поменялось (отпечаток). api: download(fileId) → байты, upload(fileId, байты)
export async function updateProjectNumbered(api, mupdf, project, data, now = new Date()) {
  const ctx = buildContext({ ...data, projects: [project] });
  const icons = project.typeIcons || {}; const patches = {}; const mgrPatches = {}; const report = [];
  const typeNames = Object.fromEntries([...ctx.types.values()].map((t) => [t.id, t.nameHe || t.id]));
  const updated = now.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' });
  const srcCache = new Map(); const src = async (id) => { if (!srcCache.has(id)) srcCache.set(id, await api.download(id)); return srcCache.get(id); };
  // ваши «Чертежи с номерами» и копии в папке «Для руководства» (своё название, язык легенды)
  const jobs = [];
  for (const d of (project.drawings || []).filter((x) => !x.deleted && x.fileId)) {
    if (d.numberedFileId) jobs.push({ d, fileId: d.numberedFileId, old: d.numberedHash, title: d.title || d.name, lang: 'ru', what: 'PDF с номерами', put: (pt) => { patches[d.id] = pt.ok ? { numberedHash: pt.hash, numberedAt: pt.at, numberedError: '' } : { numberedError: pt.error, numberedTried: pt.at }; } });
    const md = project.managers?.drawings?.[d.id];
    if (md?.on && md.fileId) jobs.push({ d, fileId: md.fileId, old: md.hash, title: (md.name || '').trim() || (d.title || d.name).replace(/\.pdf$/i, ''), lang: md.lang || 'ru', what: 'для руководства', put: (pt) => { mgrPatches[d.id] = pt.ok ? { hash: pt.hash, at: pt.at, error: '' } : { error: pt.error }; } });
  }
  for (const j of jobs) {
    try {
      const input = numberedInput(ctx.points.values(), ctx, j.d);
      const hash = numberedHash(input, { ...j.d, title: j.title }, icons, j.lang);  // так же, как в приложении
      if (hash === j.old) { report.push(`${j.title} (${j.what}): без изменений`); continue; }
      const out = numberedPdf(mupdf, await src(j.d.fileId), input, { title: j.title, icons, hidden: j.d.hidden || [], lang: j.lang, typeNames, updated });
      await api.upload(j.fileId, out);
      j.put({ ok: true, hash, at: now.toISOString() });
      report.push(`${j.title} (${j.what}): обновлён (точек ${input.length})`);
    } catch (e) {
      j.put({ ok: false, error: String(e.message || e).slice(0, 300), at: now.toISOString() });
      report.push(`${j.title} (${j.what}): ОШИБКА — ${e.message}`);
    }
  }
  return { patches, mgrPatches, report };
}
export const applyManagerPatches = (project, patches) => { const m = project.managers || {}; const ds = { ...(m.drawings || {}) }; Object.entries(patches).forEach(([id, pt]) => { ds[id] = { ...(ds[id] || {}), ...pt }; }); return { ...m, drawings: ds }; };
export const applyDrawingPatches = (project, patches) => (project.drawings || []).map((d) => (patches[d.id] ? { ...d, ...patches[d.id] } : d));

// Применяет патчи к свежей версии списка таблиц (в приложении её могли изменить, пока шла работа)
export const applyPatches = (project, patches) => tablesOf(project).map((t) => (patches[t.id] ? { ...t, ...patches[t.id] } : t));

export { isDeleted };
