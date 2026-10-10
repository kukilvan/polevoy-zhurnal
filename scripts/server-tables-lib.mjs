// Ночное автообновление таблиц для руководства на сервере (GitHub Actions). Логика без обращения к сети — проверяется тестом.
import { buildContext, tablesOf } from '../src/domain/index.js';
import { syncTable } from '../src/app/managers.js';
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

// Применяет патчи к свежей версии списка таблиц (в приложении её могли изменить, пока шла работа)
export const applyPatches = (project, patches) => tablesOf(project).map((t) => (patches[t.id] ? { ...t, ...patches[t.id] } : t));

export { isDeleted };
