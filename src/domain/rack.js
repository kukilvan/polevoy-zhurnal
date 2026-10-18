// Шкафы и шильют: «Порт в панели» (U панели + порт 1–24) у точек с кабелями cat7.
// У точки поле panel: [{ u, p, label? }] — по одному на каждый кабель cat7 (label — своя подпись порта в шильюте).
import { effectiveCablesOf } from './status.js';

export const PANEL_PORTS = 24;
// «cat7» — условное имя кабелей, которые идут в патч-панели (каким бы ни был кабель на самом деле)
export const isRackCable = (cableId) => /cat\s*-?\s*7/i.test(String(cableId || ''));
// Сколько портов панели занимает точка (= кабелей cat7)
export const rackPortsOf = (point, ctx) => effectiveCablesOf(point, ctx).filter((c) => isRackCable(c.cable)).reduce((n, c) => n + c.count, 0);

const pad2 = (n) => String(n).padStart(2, '0');
// Порт точки: { u, p, s?, label? } — s: секция (один «шкаф» точек может состоять из нескольких физических шкафов), '' — первая
export const slotKey = (x) => `${x.s || ''}|${x.u}|${x.p}`;
export const fmtPanelPort = (x, subName = '') => (x && x.u ? `${subName ? `${subName} ` : ''}U${pad2(x.u)}-${pad2(x.p)}` : '');
export const panelOf = (point) => (Array.isArray(point?.panel) ? point.panel.filter((x) => x && x.u > 0 && x.p > 0) : []);
// Название секции порта (только если у шкафа несколько секций)
export const subNameOf = (project, cabinet, sid) => { const subs = project?.racks?.[cabinet]?.subs; return subs?.length > 1 ? (subs.find((x) => (x.id || '') === (sid || ''))?.name || '') : ''; };
export const panelText = (point, project = null) => panelOf(point).map((x) => fmtPanelPort(x, subNameOf(project, point.cabinet || '', x.s))).join(', ');

// «U38-05, 38-6, 38/7», с секцией: «CCTV1-A U38-05» или «CCTV1-A: U38-05» → [{ u, p, sub? }]; ошибки — текстом
export function parsePanelPorts(text) {
  const out = []; const errors = [];
  const pieces = [];
  String(text || '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).forEach((x) => {
    if (/^(U?\s*\d{1,3}\s*[-/.]\s*\d{1,2}\s+)+U?\s*\d{1,3}\s*[-/.]\s*\d{1,2}$/i.test(x)) pieces.push(...x.split(/\s+(?=U?\s*\d)/i)); else pieces.push(x);
  });
  pieces.forEach((s) => {
    const m = s.match(/^(?:(.+?)\s*(?::|\s)\s*)?U?\s*(\d{1,3})\s*[-/.:]\s*(\d{1,2})$/i);
    if (!m) { errors.push(`«${s}» — нужно вида U38-05`); return; }
    const sub = (m[1] || '').trim(); const u = Number(m[2]); const p = Number(m[3]);
    if (u < 1) { errors.push(`«${s}»: U с 1`); return; }
    if (p < 1 || p > PANEL_PORTS) { errors.push(`«${s}»: порт панели от 1 до ${PANEL_PORTS}`); return; }
    if (out.some((x) => x.u === u && x.p === p && (x.sub || '') === sub)) { errors.push(`«${s}» повторяется`); return; }
    out.push(sub ? { u, p, sub } : { u, p });
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
    const k = `${pt.cabinet || ''}|${slotKey(x)}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ point: pt, i });
  });
  return map;
}
export function panelConflicts(points) {
  return [...panelOccupancy(points).entries()].filter(([, v]) => v.length > 1)
    .map(([k, v]) => { const [cabinet, s, u, p] = k.split('|'); return { cabinet, s, u: Number(u), p: Number(p), points: v.map((x) => x.point) }; });
}
// Совпадает ли точка с поиском по порту панели: «U38-05», «38-05», «38-5»
export function matchesPanelQuery(point, q) {
  const { list, errors } = parsePanelPorts(q);
  if (errors.length || list.length !== 1) return false;
  return panelOf(point).some((x) => x.u === list[0].u && x.p === list[0].p);
}

// ---------- план шкафа ----------
// project.racks[шкаф] = { height, bottomUp (U1 внизу), panels: [{ u, s? }], subs?: [{ id, name, height, bottomUp }] }
// subs — если «шкаф» точек на деле несколько физических шкафов (секций); у первой секции id '' (старые данные без секций — она же)
export const rackOf = (project, cabinet) => project?.racks?.[cabinet] || null;
export const subsOf = (rack, cabinet = '') => (rack?.subs?.length ? rack.subs.map((x) => ({ ...x, id: x.id || '' }))
  : [{ id: '', name: cabinet, height: Number(rack?.height) || 0, bottomUp: rack?.bottomUp !== false }]);
// U сверху вниз, как в шкафу (секции)
export const uOrder = (sub) => { const n = Number(sub?.height) || 0; return Array.from({ length: n }, (_, i) => (sub.bottomUp === false ? i + 1 : n - i)); };
export const panelsInOrder = (rack, sub = subsOf(rack)[0]) => { const pos = new Map(uOrder(sub).map((u, i) => [u, i]));
  return [...(rack?.panels || [])].filter((x) => (x.s || '') === (sub?.id || '')).sort((a, b) => (pos.get(a.u) ?? 1e9) - (pos.get(b.u) ?? 1e9)); };
// Точки шкафа, которым нужны порты панели
export const rackPointsOf = (points, ctx, cabinet) => [...points].filter((p) => (p.cabinet || '') === cabinet && rackPortsOf(p, ctx) > 0);
// Этаж шкафа — тот, что у большинства его точек
export function cabinetFloor(points) {
  const n = new Map(); points.forEach((p) => { const f = String(p.floor ?? '').trim(); if (f) n.set(f, (n.get(f) || 0) + 1); });
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}
// Разложить точки (уже в нужном порядке) по панелям (в нужном порядке) с порта start первой панели; занятые порты пропускаются.
// Порты одной точки — подряд в одной панели (если не влезает в остаток панели — со следующей). → { assign: Map(id → [{u,p}]), left: [точки] }
export function autoFill(points, ctx, panels, occupied, { start = 1 } = {}) {
  const busy = new Set(occupied); const assign = new Map(); const left = [];
  let pi = 0; let port = start;
  for (const pt of points) {
    const n = rackPortsOf(pt, ctx); let done = false;
    while (pi < panels.length && !done) {
      const u = panels[pi].u; const sec = panels[pi].s || '';
      let s = port;
      while (s + n - 1 <= PANEL_PORTS) {
        const ok = Array.from({ length: n }, (_, k) => !busy.has(slotKey({ s: sec, u, p: s + k }))).every(Boolean);
        if (ok) break; s++;
      }
      if (s + n - 1 <= PANEL_PORTS) {
        const list = Array.from({ length: n }, (_, k) => (sec ? { s: sec, u, p: s + k } : { u, p: s + k }));
        list.forEach((x) => busy.add(slotKey(x))); assign.set(pt.id, list); port = s + n; done = true;
      } else { pi++; port = 1; }
    }
    if (!done) left.push(pt);
  }
  return { assign, left };
}
// Проверки плана шкафа: занятые дважды порты, точки на несуществующих панелях, панели вне шкафа и на одном U, число портов ≠ cat7
export function rackProblems(rack, points, ctx, cabinet = '') {
  const out = [];
  const subs = subsOf(rack, cabinet); const subById = new Map(subs.map((x) => [x.id, x]));
  const nm = (sid) => (subs.length > 1 ? `${subById.get(sid || '')?.name || '?'} ` : '');
  const us = new Set((rack?.panels || []).map((x) => `${x.s || ''}|${x.u}`));
  const seenU = new Set();
  (rack?.panels || []).forEach((x) => {
    const k = `${x.s || ''}|${x.u}`; const sub = subById.get(x.s || '');
    if (!sub) out.push(`Панель U${x.u}: такой секции шкафа нет`);
    if (seenU.has(k)) out.push(`Две панели на ${nm(x.s)}U${x.u}`); seenU.add(k);
    if (sub?.height && (x.u < 1 || x.u > sub.height)) out.push(`Панель ${nm(x.s)}U${x.u} вне шкафа (${sub.height}U)`);
  });
  panelConflicts(points).forEach((c) => out.push(`Порт ${fmtPanelPort(c, nm(c.s).trim())} занят несколькими точками: ${c.points.map((p) => p.label).join(', ')}`));
  points.forEach((pt) => {
    const pl = panelOf(pt); if (!pl.length) return;
    const bad = pl.filter((x) => !us.has(`${x.s || ''}|${x.u}`)); if (bad.length) out.push(`${pt.label}: ${bad.map((x) => fmtPanelPort(x, nm(x.s).trim())).join(', ')} — такой панели в плане нет`);
    const n = rackPortsOf(pt, ctx); if (pl.length !== n) out.push(`${pt.label}: портов в панели ${pl.length}, а кабелей cat7 ${n}`);
  });
  return out;
}

// ---------- цвета шильюта ----------
// Стандартные цвета (свои цвета добавляются в настройках пользователя: { id, ru, he, bg?, fg? })
export const SHILUT_COLORS = [
  { id: 'yellow', ru: 'жёлтый', he: 'צהוב', bg: '#ffd60a', fg: '#000' },
  { id: 'green', ru: 'зелёный', he: 'ירוק', bg: '#2fb350', fg: '#000' },
  { id: 'blue', ru: 'синий', he: 'כחול', bg: '#0a84ff', fg: '#fff' },
  { id: 'red', ru: 'красный', he: 'אדום', bg: '#ff3b30', fg: '#fff' },
  { id: 'black', ru: 'чёрный', he: 'שחור', bg: '#111111', fg: '#fff' },
];
// Цвет по умолчанию по названию типа: камеры — зелёный, биометрия/двери (core) — синий, бакары — жёлтый, вайфай — красный, точки — чёрный
export function defaultTypeColor(typeId) {
  const t = String(typeId || '').toLowerCase();
  if (/камер|camera|cctv/.test(t)) return 'green';
  if (/биометр|biometr|core|кор\b|двер/.test(t)) return 'blue';
  if (/бакар|bms|контрол/.test(t)) return 'yellow';
  if (/вайфа|wi-?fi|\bap\b|точка доступа/.test(t)) return 'red';
  if (/^точк/.test(t)) return 'black';
  return '';
}
// Цвет типа в проекте: свой (project.shilut.typeColors) или по умолчанию → объект цвета или null
export function typeColorOf(project, typeId, extraColors = []) {
  const id = project?.shilut?.typeColors?.[typeId] ?? defaultTypeColor(typeId);
  return [...SHILUT_COLORS, ...extraColors].find((c) => c.id === id) || null;
}
