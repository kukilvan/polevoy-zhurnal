// Таблица шкафов для Google Диска: по листу «план шкафа» на каждый шкаф (секцию) и общий лист шильюта.
// Чистые функции: возвращают значения ячеек и описание оформления; запись на Диск — в app/views/racktable.js.
import {
  PANEL_PORTS, panelOf, rackPortsOf, rackOf, subsOf, uOrder, panelsInOrder, rackPointsOf, cabinetFloor,
  blockedOf, shilutLabel, shilutCabName, shilutOf, typeColorOf, rackProblems,
} from './rack.js';

const natural = (a, b) => String(a).localeCompare(String(b), 'ru', { numeric: true });
export const HE_TOTAL = 'כולל שקעים';
export const MODES = { fill: 'fill', split: 'split' };

// Шкафы (секции), у которых есть план: [{ key, cab, sid, sub, rack, floor, name, count }]
export function cabinetsOf(project, points, ctx) {
  const cabs = [...new Set(points.filter((p) => rackPortsOf(p, ctx) > 0).map((p) => p.cabinet || '').filter(Boolean))].sort(natural);
  const out = [];
  for (const cab of cabs) {
    const rack = rackOf(project, cab); if (!rack) continue;
    const pts = rackPointsOf(points, ctx, cab); const floor = cabinetFloor(pts);
    for (const sub of subsOf(rack, cab)) {
      const count = pts.reduce((n, pt) => n + panelOf(pt).filter((x) => (x.s || '') === sub.id).length, 0);
      out.push({ key: `${cab}|${sub.id}`, cab, sid: sub.id, sub, rack, floor, name: shilutCabName(project, cab, sub.id), count });
    }
  }
  return out;
}

// «U|порт» → { pt, i, label } для точек секции
function portsOf(project, ctx, points, c) {
  const m = new Map();
  rackPointsOf(points, ctx, c.cab).forEach((pt) => panelOf(pt).forEach((x, i) => {
    if ((x.s || '') !== c.sid) return;
    m.set(`${x.u}|${x.p}`, { pt, i, label: shilutLabel(pt, i, project, ctx) });
  }));
  return m;
}
const bgOf = (col) => col?.bg || '#d9d9d9';
const fgOf = (col) => col?.fg || '#000000';

// ---------- лист «план шкафа» ----------
function planSheet(project, ctx, points, c, { colors, modelName }) {
  const sh = shilutOf(project); const rack = c.rack; const blocked = blockedOf(rack);
  const placed = portsOf(project, ctx, points, c);
  const panels = new Map(panelsInOrder(rack, c.sub).map((x) => [x.u, x]));
  const rows = [
    [`Project: ${project.name || ''}`], [`Floor: ${c.floor || ''}`], [`Cabinet: ${c.name}`], [],
    ['Unit', ...Array.from({ length: PANEL_PORTS }, (_, i) => i + 1), 'Panel model'],
  ];
  const first = rows.length; const fills = []; const grid = [];
  uOrder(c.sub).forEach((u, ri) => {
    const pn = panels.get(u); const r = first + ri;
    const line = [u];
    for (let p = 1; p <= PANEL_PORTS; p++) {
      const at = placed.get(`${u}|${p}`); const isX = pn && blocked.has(`${c.sid}|${u}|${p}`);
      line.push(at ? at.label : isX ? 'X' : '');
      if (!pn) continue;
      if (at) { const col = typeColorOf(project, at.pt.typeId, colors); fills.push({ r, c0: p, c1: p + 1, bg: bgOf(col), fg: fgOf(col), bold: true }); }
      else if (isX) fills.push({ r, c0: p, c1: p + 1, bg: '#bdbdbd', fg: '#c00000', bold: true });
      else fills.push({ r, c0: p, c1: p + 1, bg: '#f2f2f2', fg: '#000000' });
    }
    line.push(pn ? modelName(pn.m || sh.panelModel) || '' : '');
    rows.push(line); grid.push(r);
  });
  return {
    kind: 'plan', key: c.key, title: c.name, rtl: false, rows, frozenRows: 5, frozenCols: 1,
    widths: [64, ...Array.from({ length: PANEL_PORTS }, () => 76), 170],
    rowHeights: [{ r0: first, r1: first + grid.length, px: 26 }],
    titleRows: 3, headerRow: 4, tableRows: [first, first + grid.length], tableCols: [0, PANEL_PORTS + 1], portCols: [1, PANEL_PORTS + 1], fills,
  };
}

const padTo = (list) => [...list, ...Array(PANEL_PORTS - list.length).fill('')];

// Раскладка очередей одного типа по столбцам шильюта (режим «по 24»):
// • очередь из 12 и больше точек (в том числе полная панель из 24) — отдельный столбец;
// • короткие очереди (меньше 12) собираются вместе, независимо от шкафа, чтобы заполнить столбцы по 24 строки; очередь не режется;
//   сначала крупные, мелочь — в оставшееся место (best fit); внутри столбца очереди идут в порядке панелей.
// → [[очередь, …], …]: сначала столбцы с большими очередями (в порядке панелей), потом сборные.
export const BIG_QUEUE = 12;
export function packQueues(queues, cap = PANEL_PORTS) {
  const big = queues.filter((q) => q.labels.length >= BIG_QUEUE).sort((a, b) => a.idx - b.idx).map((q) => [q]);
  const bins = [];
  [...queues].filter((q) => q.labels.length < BIG_QUEUE).sort((a, b) => b.labels.length - a.labels.length || a.idx - b.idx).forEach((q) => {
    let best = null;
    for (const b of bins) { const left = cap - b.used - q.labels.length; if (left >= 0 && (!best || left < cap - best.used - q.labels.length)) best = b; }
    if (!best) { best = { used: 0, qs: [] }; bins.push(best); }
    best.qs.push(q); best.used += q.labels.length;
  });
  const packed = bins.map((b) => b.qs.sort((x, y) => x.idx - y.idx)).sort((a, b) => a[0].idx - b[0].idx);
  return [...big, ...packed];
}

// ---------- лист шильюта ----------
// Режим fill: точки одного типа из выбранных шкафов — очередями из панелей (см. packQueues); 1 пустой столбец между типами.
// Режим split: как стоит в панелях — столбец на каждую панель (и тип); подписи подряд без пропусков строк; 1 пустой столбец между типами, 2 между шкафами.
// mergeColors: типы с одним цветом считаются одним типом (общие столбцы / очереди)
function shilutSheet(project, ctx, points, cabs, { mode, colors, modelName, mergeColors }) {
  const sh = shilutOf(project); const defModel = modelName(sh.panelModel) || '';
  const colorHe = (typeId) => typeColorOf(project, typeId, colors);
  const gk = (typeId) => (mergeColors && colorHe(typeId) ? `color:${colorHe(typeId).id}` : typeId);   // ключ столбца: тип или (по галке) цвет
  const cols = []; // { gap: n } или { typeId, model, cells: [24] }
  if (mode === MODES.split) {
    cabs.forEach((c, ci) => {
      const placed = portsOf(project, ctx, points, c);
      const typeOrder = []; const byType = new Map();
      panelsInOrder(c.rack, c.sub).forEach((pn) => {
        const here = new Map();
        for (let p = 1; p <= PANEL_PORTS; p++) { const at = placed.get(`${pn.u}|${p}`); if (at) { const k = gk(at.pt.typeId); if (!here.has(k)) here.set(k, { typeId: at.pt.typeId, list: [] }); here.get(k).list.push(at.label); } }
        for (const [t, { typeId, list }] of here) {
          const cells = [...list, ...Array(PANEL_PORTS - list.length).fill('')];   // подписи всегда подряд с первой строки, закрытые порты и пустые места не учитываются
          if (!byType.has(t)) { byType.set(t, []); typeOrder.push(t); }
          byType.get(t).push({ typeId, model: modelName(pn.m || sh.panelModel) || defModel, cells });
        }
      });
      if (ci > 0 && cols.length) cols.push({ gap: 1 }, { gap: 1 });
      typeOrder.forEach((t, ti) => { if (ti > 0) cols.push({ gap: 1 }); cols.push(...byType.get(t)); });
    });
  } else {
    // «Очередь» — точки одного типа (цвета) из одной панели, в том порядке, как стоят в панели. Очередь не режется и не переставляется.
    const groups = new Map(); let idx = 0;
    cabs.forEach((c) => {
      const placed = portsOf(project, ctx, points, c);
      panelsInOrder(c.rack, c.sub).forEach((pn) => {
        const here = new Map();
        for (let p = 1; p <= PANEL_PORTS; p++) { const at = placed.get(`${pn.u}|${p}`); if (!at) continue; const k = gk(at.pt.typeId); if (!here.has(k)) here.set(k, { typeId: at.pt.typeId, labels: [] }); here.get(k).labels.push(at.label); }
        for (const [k, { typeId, labels }] of here) {
          if (!groups.has(k)) groups.set(k, { typeId, queues: [] });
          groups.get(k).queues.push({ idx: idx++, labels, model: modelName(pn.m || sh.panelModel) || defModel });
        }
      });
    });
    [...groups.values()].forEach(({ typeId, queues }, ti) => {
      if (ti > 0) cols.push({ gap: 1 });
      packQueues(queues).forEach((col) => cols.push({ typeId, model: col[0].model, cells: padTo(col.flatMap((q) => q.labels)) }));
    });
  }
  if (!cols.some((x) => x.cells)) return null;
  // A — узкое поле слева (как в образце); дальше столбцы; строка 1 — пустая, 2 — «כולל שקעים», 3 — модель, 4 — цвет, дальше подписи
  const rows = [[], ['', ...cols.map((x) => (x.cells ? HE_TOTAL : ''))], ['', ...cols.map((x) => (x.cells ? x.model : ''))],
    ['', ...cols.map((x) => (x.cells ? colorHe(x.typeId)?.he || '' : ''))]];
  for (let i = 0; i < PANEL_PORTS; i++) rows.push(['', ...cols.map((x) => (x.cells ? x.cells[i] : ''))]);
  const colorCells = []; cols.forEach((x, i) => { if (x.cells) { const col = colorHe(x.typeId); if (col) colorCells.push({ r: 3, c0: i + 1, c1: i + 2, bg: col.bg, fg: col.fg, bold: true }); } });
  return {
    kind: 'shilut', key: 'shilut', title: 'שילוט', rtl: true, rows, frozenRows: 0, frozenCols: 0,
    widths: [26, ...cols.map((x) => (x.cells ? 120 : 20))],
    rowHeights: [{ r0: 0, r1: 1, px: 12 }],
    stripCols: cols.map((x, i) => (x.cells ? i + 1 : -1)).filter((i) => i >= 0), stripRows: [1, 4 + PANEL_PORTS], fills: colorCells,
  };
}

// → { sheets, warnings }; opts: { mode, cabs: [ключи шкафов], colors: пользовательские цвета, models: [{id,name}] }
export function buildRackSheets(project, ctx, points, { mode = MODES.fill, cabs: keys = null, colors = [], models = [], mergeColors = false } = {}) {
  const all = cabinetsOf(project, points, ctx);
  const chosen = all.filter((c) => !keys || keys.includes(c.key));
  const modelName = (id) => models.find((m) => m.id === id)?.name || '';
  const sheets = []; const warnings = [];
  const names = new Set();
  chosen.forEach((c) => {
    const s = planSheet(project, ctx, points, c, { colors, modelName });
    let t = String(s.title).replace(/[[\]*?:/\\]/g, '-').slice(0, 90) || 'Шкаф'; let n = 2; const base = t;
    while (names.has(t.toLowerCase())) t = `${base} ${n++}`;
    names.add(t.toLowerCase()); s.title = t; sheets.push(s);
  });
  const sl = shilutSheet(project, ctx, points, chosen.filter((c) => c.count > 0), { mode, colors, modelName, mergeColors });
  if (sl) { let t = sl.title; let n = 2; while (names.has(t.toLowerCase())) t = `${sl.title} ${n++}`; sl.title = t; sheets.push(sl); }
  else if (chosen.length) warnings.push('В выбранных шкафах нет расставленных точек — лист шильюта не создан');
  // предупреждения
  const typesIn = new Set(); chosen.forEach((c) => rackPointsOf(points, ctx, c.cab).forEach((pt) => { if (panelOf(pt).some((x) => (x.s || '') === c.sid)) typesIn.add(pt.typeId); }));
  const noColor = [...typesIn].filter((t) => !typeColorOf(project, t, colors)); if (noColor.length) warnings.push(`Не выбран цвет шильюта: ${noColor.join(', ')}`);
  if (!modelName(shilutOf(project).panelModel) && !(chosen.some((c) => c.rack.panels?.some((x) => modelName(x.m))))) warnings.push('Не выбрана модель панели — вторая строка шильюта будет пустой');
  const cabsDone = new Set(); let problems = 0;
  chosen.forEach((c) => { if (cabsDone.has(c.cab)) return; cabsDone.add(c.cab); problems += rackProblems(c.rack, rackPointsOf(points, ctx, c.cab), ctx, c.cab).length; });
  if (problems) warnings.push(`В плане шкафов есть замечания (${problems}) — см. «Проверка» в шкафу`);
  return { sheets, warnings, count: chosen.length };
}
