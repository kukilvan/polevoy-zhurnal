// Шкафы и шильют: «Порт в панели» (U панели + порт 1–24) у точек с кабелями cat7.
// У точки поле panel: [{ u, p, label? }] — по одному на каждый кабель cat7 (label — своя подпись порта в шильюте).
import { effectiveCablesOf } from './status.js';

export const PANEL_PORTS = 24;
// «cat7» — условное имя кабелей, которые идут в патч-панели (каким бы ни был кабель на самом деле)
export const isRackCable = (cableId) => /cat\s*-?\s*7/i.test(String(cableId || ''));
// Сколько портов панели занимает точка (= кабелей cat7)
export const rackPortsOf = (point, ctx) => effectiveCablesOf(point, ctx).filter((c) => isRackCable(c.cable)).reduce((n, c) => n + c.count, 0);

const pad2 = (n) => String(n).padStart(2, '0');
export const fmtPanelPort = (x) => (x && x.u ? `U${pad2(x.u)}-${pad2(x.p)}` : '');
export const panelOf = (point) => (Array.isArray(point?.panel) ? point.panel.filter((x) => x && x.u > 0 && x.p > 0) : []);
export const panelText = (point) => panelOf(point).map(fmtPanelPort).join(', ');

// «U38-05, 38-6, 38/7» → [{ u, p }]; ошибки — текстом
export function parsePanelPorts(text) {
  const out = []; const errors = [];
  String(text || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean).forEach((s) => {
    const m = s.match(/^U?\s*(\d{1,3})\s*[-/.:]\s*(\d{1,2})$/i);
    if (!m) { errors.push(`«${s}» — нужно вида U38-05`); return; }
    const u = Number(m[1]); const p = Number(m[2]);
    if (u < 1) { errors.push(`«${s}»: U с 1`); return; }
    if (p < 1 || p > PANEL_PORTS) { errors.push(`«${s}»: порт панели от 1 до ${PANEL_PORTS}`); return; }
    if (out.some((x) => x.u === u && x.p === p)) { errors.push(`«${s}» повторяется`); return; }
    out.push({ u, p });
  });
  return { list: out, errors };
}

// Подписи портов точки по умолчанию: один кабель — название точки; пара «…25-26» на 2 порта — «…25» и «…26»; иначе «имя.1», «имя.2»…
export function defaultPortLabels(label, n) {
  const l = String(label || '');
  if (n <= 1) return [l];
  const m = l.match(/^(.*?)(\d+)-(\d+)$/);
  if (m) {
    const a = Number(m[2]); const b = Number(m[3]);
    if (b > a && b - a + 1 === n) return Array.from({ length: n }, (_, i) => `${m[1]}${String(a + i).padStart(m[2].length, '0')}`);
  }
  return Array.from({ length: n }, (_, i) => `${l}.${i + 1}`);
}

// Занятые порты: «шкаф|U|порт» → [{ point, i }]; конфликты — где больше одной точки
export function panelOccupancy(points) {
  const map = new Map();
  for (const pt of points) panelOf(pt).forEach((x, i) => {
    const k = `${pt.cabinet || ''}|${x.u}|${x.p}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ point: pt, i });
  });
  return map;
}
export function panelConflicts(points) {
  return [...panelOccupancy(points).entries()].filter(([, v]) => v.length > 1)
    .map(([k, v]) => { const [cabinet, u, p] = k.split('|'); return { cabinet, u: Number(u), p: Number(p), points: v.map((x) => x.point) }; });
}
// Совпадает ли точка с поиском по порту панели: «U38-05», «38-05», «38-5»
export function matchesPanelQuery(point, q) {
  const { list, errors } = parsePanelPorts(q);
  if (errors.length || list.length !== 1) return false;
  return panelOf(point).some((x) => x.u === list[0].u && x.p === list[0].p);
}
