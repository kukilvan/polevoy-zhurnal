// Резервная копия проекта в Google Диск: один JSON-файл на проект и день (формат совместим с «Импортом данных»).
export const BACKUP_FOLDER = 'Полевой журнал — резервные копии';
const LIVE = (arr) => (arr || []).filter((d) => !d.deleted);
const IMPORTABLE = ['points', 'journal', 'days', 'entries', 'cabinetSettings', 'todos', 'notes'];
const REFERENCE = ['catalog', 'types', 'cables', 'configs', 'units', 'culprits', 'delayReasons'];

export function buildBackup(project, data, now = new Date()) {
  const out = {
    format: 'polevoy-import-1', backupOf: project.id, createdAt: now.toISOString(),
    project: { name: project.name, contractor: project.contractor, object: project.object, helper: project.helper, nameHe: project.nameHe,
      objectHe: project.objectHe, helperHe: project.helperHe, defaultConfigId: project.defaultConfigId, oneOff: !!project.oneOff, active: project.active !== false, note: project.note },
    reference: {},
  };
  IMPORTABLE.forEach((c) => { out[c] = LIVE(data[c]); });
  REFERENCE.forEach((c) => { out.reference[c] = LIVE(data[c]); });
  return out;
}

export const backupName = (project, now = new Date()) =>
  `${String(project.name || 'проект').replace(/[\\/:*?"<>|]/g, '_')} ${now.toISOString().slice(0, 10)}.json`;

export async function runBackup(api, project, data, now = new Date()) {
  const folderId = await api.folder(BACKUP_FOLDER);
  const body = buildBackup(project, data, now);
  await api.putJson(folderId, backupName(project, now), JSON.stringify(body));
  const count = IMPORTABLE.reduce((n, c) => n + body[c].length, 0);
  return { patch: { backupAt: now.toISOString() }, message: `Копия сохранена на Диск: ${backupName(project, now)} (записей: ${count})` };
}
