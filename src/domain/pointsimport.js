// Добавление точек из файла (например, после разбора тохнита). Формат:
// { format: 'polevoy-points-1', source?, floor?, sheet?: { pdf, pages: [{ w, h }] },
//   points: [{ label, typeId, planName?, cabinet?, floor?, note?, devices?, cables?, pos?: { page, x, y, w, h } }],
//   types?: [{ id, nameHe, devices, cables, workIds }], devices?: [{ id, name, nameHe, cables, workIds }] }
// Ничего не заменяет: существующие точки (то же обозначение) пропускаются; новые типы и устройства из файла создаются, если их нет.
import { addBundleOps } from './typelib.js';
export const POINTS_FORMAT = 'polevoy-points-1';
const s = (v) => (v === undefined || v === null ? '' : String(v).trim());

export function parsePointsFile(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Файл не читается как JSON'); }
  if (data?.format !== POINTS_FORMAT) throw new Error(`Это не файл точек (нужен format: "${POINTS_FORMAT}")`);
  if (!Array.isArray(data.points)) throw new Error('В файле нет списка точек (points)');
  return data;
}

// Подозрительные обозначения: не похожи на номер точки
export function labelProblems(label) {
  const out = [];
  if (!label) return ['пустое обозначение'];
  if (/[А-Яа-яЁё]/.test(label)) out.push('русские буквы');
  if (/[֐-׿]/.test(label)) out.push('иврит');
  if (/\s/.test(label)) out.push('пробел');
  if (/^H\s*=?\s*\d/i.test(label)) out.push('похоже на высоту установки');
  if (label.length > 20) out.push('слишком длинное');
  if (!/\d/.test(label)) out.push('нет цифр');
  return out;
}

// pool — общий пул типов (Map id → комплект): тип, которого нет ни в проекте, ни в файле, берётся оттуда;
// нет и там — создаётся пустой тип с этим названием (состав потом настраивается в «Типах точек»)
export function planPointsImport(ctx, data, pool = new Map()) {
  const fileTypes = new Map((data.types || []).map((t) => [s(t.id), t]));
  const fileDevices = new Map((data.devices || []).map((d) => [s(d.id), d]));
  const have = new Map([...ctx.points.values()].map((p) => [p.label, p]));
  const seen = new Set();
  const add = []; const skipped = []; const errors = []; const warnings = [];
  const fromPool = new Map(); const blank = new Set();
  data.points.forEach((raw, i) => {
    const p = { ...raw, label: s(raw.label), typeId: s(raw.typeId), cabinet: s(raw.cabinet) || s(data.cabinet), floor: s(raw.floor) || s(data.floor), planName: s(raw.planName), note: s(raw.note) };
    const where = `строка ${i + 1}${p.label ? ` (${p.label})` : ''}`;
    if (!p.label) { errors.push(`${where}: нет обозначения`); return; }
    if (!p.typeId) { errors.push(`${where}: нет типа`); return; }
    if (!ctx.types.has(p.typeId) && !fileTypes.has(p.typeId)) {
      if (!fromPool.has(p.typeId) && !blank.has(p.typeId)) (pool.get(p.typeId) ? fromPool.set(p.typeId, pool.get(p.typeId)) : blank.add(p.typeId));
    }
    if (seen.has(p.label)) { errors.push(`${where}: обозначение повторяется в файле`); return; }
    seen.add(p.label);
    if (have.has(p.label)) { skipped.push(p.label); return; }
    const bad = labelProblems(p.label); if (bad.length) warnings.push(`${p.label}: ${bad.join(', ')}`);
    (Array.isArray(p.devices) ? p.devices : []).forEach((d) => { if (!ctx.devices.has(d.deviceId) && !fileDevices.has(d.deviceId)) errors.push(`${where}: устройства «${d.deviceId}» нет`); });
    add.push(p);
  });
  const newTypes = [...fileTypes.values()].filter((t) => !ctx.types.has(s(t.id)) && add.some((p) => p.typeId === s(t.id)));
  const newDevices = [...fileDevices.values()].filter((d) => !ctx.devices.has(s(d.id)));
  newTypes.forEach((t) => (t.devices || []).forEach((d) => { if (!ctx.devices.has(d.deviceId) && !fileDevices.has(d.deviceId)) errors.push(`Тип «${t.id}»: устройства «${d.deviceId}» нет`); }));
  const byType = {}; add.forEach((p) => { const k = `${p.cabinet || 'без шкафа'} · ${p.typeId}`; byType[k] = (byType[k] || 0) + 1; });
  const poolTypes = [...fromPool.values()].filter((b) => add.some((p) => p.typeId === b.type.id));
  const blankTypes = [...blank].filter((id) => add.some((p) => p.typeId === id));
  return { add, skipped, errors, warnings, newTypes, newDevices, byType, poolTypes, blankTypes, ctx };
}

// Место точки на листе чертежа (для будущего плана в приложении): pt PDF от левого верхнего угла + размер листа и имя файла
export function posOf(p, data) {
  const q = p.pos; const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (!q || n(q.x) === null || n(q.y) === null) return undefined;
  const page = Number.isInteger(q.page) ? q.page : 0; const sz = data?.sheet?.pages?.[page] || {};
  const out = { page, x: q.x, y: q.y };
  if (n(q.w) !== null) out.w = q.w; if (n(q.h) !== null) out.h = q.h;
  if (n(sz.w) !== null) out.pw = sz.w; if (n(sz.h) !== null) out.ph = sz.h;
  if (data?.sheet?.pdf) out.sheet = String(data.sheet.pdf);
  return out;
}

// Операции записи (после предпросмотра)
export function pointsImportOps(plan, newId, data) {
  const ops = [];
  plan.newDevices.forEach((d) => ops.push({ coll: 'devices', id: s(d.id), data: { name: d.name || d.id, nameHe: d.nameHe || '', cables: d.cables || [], workIds: d.workIds || [] } }));
  plan.newTypes.forEach((t) => ops.push({ coll: 'types', id: s(t.id), data: { nameHe: t.nameHe || '', devices: t.devices || [], cables: t.cables || [], workIds: t.workIds || [] } }));
  if (plan.ctx) (plan.poolTypes || []).forEach((b) => addBundleOps(plan.ctx, b, ops)); // тип из общего пула — вместе с устройствами, кабелями, работами
  (plan.blankTypes || []).forEach((id) => ops.push({ coll: 'types', id, data: { nameHe: '', devices: [], cables: [], workIds: [] } }));
  plan.add.forEach((p) => ops.push({ coll: 'points', id: newId(), data: {
    label: p.label, typeId: p.typeId, cabinet: p.cabinet || undefined, floor: p.floor || undefined, planName: p.planName || undefined, note: p.note || undefined,
    ...(Array.isArray(p.devices) ? { devices: p.devices } : {}), ...(Array.isArray(p.cables) ? { cables: p.cables } : {}),
    ...(posOf(p, data) ? { pos: posOf(p, data) } : {}),
  } }));
  return ops;
}
