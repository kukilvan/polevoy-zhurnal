// Контекст расчётов: индексы по данным проекта. Мягко удалённые записи (deleted: true) не учитываются.
const live = (arr) => (arr || []).filter((x) => !x.deleted);
const byId = (arr) => new Map(live(arr).map((x) => [x.id, x]));

export function buildContext(data) {
  const ctx = {
    projects: byId(data.projects),
    points: byId(data.points),
    days: byId(data.days),
    entries: byId(data.entries),
    catalog: byId(data.catalog),
    types: byId(data.types),
    cables: byId(data.cables),
    devices: byId(data.devices),
    configs: byId(data.configs),
    units: byId(data.units),
    culprits: byId(data.culprits),
    delayReasons: byId(data.delayReasons),
    todos: byId(data.todos),
    notes: byId(data.notes),
    cabinetSettings: live(data.cabinetSettings),
    journalByPoint: new Map(),
  };
  // Журнал: одна строка = точка × работа. Строки без записи — «правки» (дата и работа хранятся в самой строке).
  live(data.journal).forEach((row, order) => {
    const point = ctx.points.get(row.pointId);
    if (!point) return;
    let resolved;
    if (row.entryId) {
      const entry = ctx.entries.get(row.entryId);
      const day = entry && ctx.days.get(entry.dayId);
      if (!entry || !day) return; // запись/день удалены — строка не считается
      resolved = { date: day.date, action: entry.workType, workId: entry.workId, cableId: entry.cableId, deviceIds: entry.deviceIds, result: entry.result, projectId: day.projectId, by: entry.updatedBy || entry.createdBy };
    } else {
      resolved = {
        date: row.editDate, workId: row.editWorkId, cableId: row.editCableId, deviceIds: row.editDeviceIds, action: ctx.catalog.get(row.editWorkId)?.workType,
        result: undefined, projectId: point.projectId, by: row.updatedBy || row.createdBy,
      };
    }
    const full = { id: row.id, pointId: row.pointId, order, fromEdit: !row.entryId, ...resolved };
    if (!ctx.journalByPoint.has(row.pointId)) ctx.journalByPoint.set(row.pointId, []);
    ctx.journalByPoint.get(row.pointId).push(full);
  });
  return ctx;
}
