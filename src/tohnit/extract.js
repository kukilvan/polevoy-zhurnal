// Разбор тохнита в приложении: извлечение текста, значков и слоёв из PDF через MuPDF (тот же движок, что у tohnit.py).
// Работает и в браузере (подгружается только при разборе), и в node (проверка на эталоне).
// Координаты — точки PDF на повёрнутом листе (как scan.json у tohnit.py), начало — левый верхний угол.

let mupdfP = null;
export const loadMupdf = () => (mupdfP ??= import('mupdf'));

const hex2 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
export function colorHex(color) {
  if (!color || !color.length) return '';
  if (color.length === 1) return hex2(color[0]).repeat(3);
  if (color.length === 3) return color.map(hex2).join('');
  if (color.length === 4) { const [c, m, y, k] = color; return [1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k)].map(hex2).join(''); }
  return '';
}

// Точки вдоль пути (с преобразованием ctm), шаг ~0.3 pt — для подписи формы значка
function pathPoints(path, ctm, step = 0.3) {
  const out = []; let cur = null; let start = null;
  const tf = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
  const seg = (a, b) => {
    const n = Math.max(1, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let i = 0; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  };
  path.walk({
    moveTo(x, y) { cur = start = tf(x, y); },
    lineTo(x, y) { const p = tf(x, y); if (cur) seg(cur, p); cur = p; },
    curveTo(x1, y1, x2, y2, x3, y3) {
      const p0 = cur, p1 = tf(x1, y1), p2 = tf(x2, y2), p3 = tf(x3, y3); let prev = p0;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8, u = 1 - t;
        const p = [u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0], u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]];
        seg(prev, p); prev = p;
      }
      cur = p3;
    },
    closePath() { if (cur && start) seg(cur, start); cur = start; },
  });
  return out;
}
const bboxOf = (pts) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };

/** PDF (ArrayBuffer/Uint8Array) → { pages: [{ w, h, spans, fills, annots, paths, layers }] }
 *  spans: { t, x0, y0, x1, y1, color, font, size, page }; paths: мелкие пути { color, layer, bbox, pts } — для значков;
 *  layers: { имя: { n, colors: {hex: n} } } — для поиска слоёв-мусора. */
export async function extractPdf(data, { maxPathSize = 80 } = {}) {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(data instanceof Uint8Array ? data : new Uint8Array(data), 'application/pdf');
  const pages = [];
  for (let pi = 0; pi < doc.countPages(); pi++) {
    const page = doc.loadPage(pi); const b = page.getBounds();
    // символы в порядке чтения; фрагмент = подряд идущие символы одного стиля и направления без большого разрыва
    // (границы строк MuPDF не важны: вертикальные подписи он режет на кусочки «32» + «A»)
    const spans = []; let cur = null; let dir = [1, 0];
    const flush = () => { if (cur) { const t = cur.t.trim(); if (t) spans.push({ t, x0: cur.x0, y0: cur.y0, x1: cur.x1, y1: cur.y1, color: cur.color, font: cur.font, size: cur.size, page: pi }); } cur = null; };
    page.toStructuredText('preserve-spans').walk({
      beginLine(bbox, wmode, d) { if (d) dir = [d[0] ?? d.x ?? 1, d[1] ?? d.y ?? 0]; },
      onChar(c, origin, font, size, quad, color) {
        const xs = [quad[0], quad[2], quad[4], quad[6]], ys = [quad[1], quad[3], quad[5], quad[7]];
        const r = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        const key = `${font.getName()}|${Math.round(size * 10)}|${colorHex(color)}|${dir[0].toFixed(2)},${dir[1].toFixed(2)}`;
        // разрыв между этим символом и предыдущим вдоль строки (в обе стороны — иврит идёт справа налево)
        const proj = (x, y) => x * dir[0] + y * dir[1]; const perp = (x, y) => -x * dir[1] + y * dir[0];
        const lo = Math.min(...xs.map((x, i) => proj(x, ys[i]))), hi = Math.max(...xs.map((x, i) => proj(x, ys[i])));
        const pm = (Math.min(...xs.map((x, i) => perp(x, ys[i]))) + Math.max(...xs.map((x, i) => perp(x, ys[i])))) / 2;
        if (cur) {
          const gap = Math.max(lo - cur.hi, cur.lo - hi);
          if (cur.key !== key || (c.trim() && (gap > size * (cur.sp ? 0.9 : 0.3) || Math.abs(pm - cur.pm) > size * 0.5))) flush();  // без пробела — только вплотную
        }
        if (!cur) cur = { key, t: '', x0: r[0], y0: r[1], x1: r[2], y1: r[3], color: colorHex(color), font: font.getName(), size: Math.round(size * 10) / 10 };
        cur.t += c; if (c.trim()) { cur.lo = lo; cur.hi = hi; cur.pm = pm; cur.sp = false; } else cur.sp = true;
        if (c.trim()) { cur.x0 = Math.min(cur.x0, r[0]); cur.y0 = Math.min(cur.y0, r[1]); cur.x1 = Math.max(cur.x1, r[2]); cur.y1 = Math.max(cur.y1, r[3]); }
      },
    });
    flush();
    // рисунок: мелкие пути (значки) с цветом и слоем, залитые мелкие фигуры (фон значков), статистика слоёв
    const fills = []; const paths = []; const layers = {}; const stack = [];
    const note = (color) => { const L = stack[stack.length - 1] || '—'; const e = (layers[L] ??= { n: 0, colors: {} }); e.n++; e.colors[color] = (e.colors[color] || 0) + 1; };
    const onPath = (path, ctm, cs, color, filled) => {
      const hx = colorHex(color); note(hx);
      const pts = pathPoints(path, ctm); if (!pts.length) return;
      const bb = bboxOf(pts); const w = bb[2] - bb[0], h = bb[3] - bb[1];
      if (filled && w > 0 && h > 0 && w < 40 && h < 40) fills.push([...bb, hx]);
      if (w <= maxPathSize && h <= maxPathSize) paths.push({ color: hx, layer: stack[stack.length - 1] || '', bbox: bb, pts });
    };
    const dev = new mupdf.Device({
      fillPath(path, evenOdd, ctm, cs, color) { onPath(path, ctm, cs, color, true); },
      strokePath(path, stroke, ctm, cs, color) { onPath(path, ctm, cs, color, false); },
      beginLayer(name) { stack.push(name); },
      endLayer() { stack.pop(); },
    });
    page.run(dev, mupdf.Matrix.identity);
    // аннотации: подписи AutoCAD (Square/FreeText с текстом) — как текст; остальные — пометки поверх чертежа
    const annots = [];
    try {
      for (const a of page.getAnnotations?.() || []) {
        const r = a.getBounds(); const kind = a.getType(); const txt = (a.getContents() || '').trim();
        if (txt && ['Square', 'FreeText', 'Circle', 'Polygon'].includes(kind)) {
          spans.push({ t: txt.split('\n')[0].slice(0, 60), x0: r[0], y0: r[1], x1: r[2], y1: r[3], color: '', font: `аннотация ${kind}`, size: 2 * Math.round(Math.min(r[2] - r[0], r[3] - r[1]) / 2), page: pi });
        } else if (!['Link', 'Widget'].includes(kind)) annots.push({ kind, x0: r[0], y0: r[1], x1: r[2], y1: r[3], text: txt.slice(0, 80), page: pi });
      }
    } catch { /* без аннотаций */ }
    pages.push({ w: b[2] - b[0], h: b[3] - b[1], spans, fills, annots, paths, layers });
  }
  return { pages };
}
