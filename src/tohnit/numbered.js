// PDF с номерами — как план в приложении: подписи на чертеже обводятся рамкой цвета статуса, значки — кружком,
// своя подпись (в рамке, белый фон) ставится там, где не закрывает значки, рамки и другие подписи. Несколько точек на одной отметке —
// одна подпись («TV13-14» или столбиком). Скрытое закрашивается белым. Пометки PDF разложены по слоям «Номера: <тип>» —
// в просмотрщике можно оставить только нужные. Последняя страница — легенда.
import { combineLabels } from '../domain/points.js';
import { STATUS_COLORS } from '../domain/plan.js';

export const TYPE_COLORS = ['#e0007a', '#0a84ff', '#ff9f0a', '#30a14e', '#bf5af2', '#ff453a', '#0fb5ae', '#8e6c00', '#5856d6', '#c2185b'];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(String(hex || '#9e9e9e').slice(i, i + 2), 16) / 255);
const isText = (pos) => { const w = pos.w || 0; const h = pos.h || 0; return w && h && Math.max(w, h) / Math.min(w, h) > 1.6; };
const keyOf = (p) => `${p.pos.page || 0}|${Math.round(p.pos.x)}|${Math.round(p.pos.y)}`;

/** Раскладка подписей (единицы листа PDF): tags [{x,y,r,lines}] → [{tag, box:[x0,y0,x1,y1]}]. Чистая функция — проверяется тестом. */
export function layoutTags(tags, { circles = [], frames = [], fs = 6 } = {}) {
  const placed = [...frames]; const out = []; const padX = 1.5; const lh = fs * 1.2;
  const hitsBox = (b) => placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
  const hitsCircle = (b) => circles.some(([cx, cy, cr]) => { const dx = Math.max(b[0] - cx, 0, cx - b[2]); const dy = Math.max(b[1] - cy, 0, cy - b[3]); return dx * dx + dy * dy < cr * cr; });
  for (const t of [...tags].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const w = Math.max(...t.lines.map((l) => l.length)) * fs * 0.58 + 2 * padX; const hh = t.lines.length * lh + 1.5; const gap = 1.2; const r = t.r;
    const opts = [[t.x + r + gap, t.y - r - hh + 2], [t.x + r + gap, t.y - hh / 2], [t.x + r + gap, t.y + r - 2], [t.x - w / 2, t.y - r - hh - gap], [t.x - w / 2, t.y + r + gap],
      [t.x - r - gap - w, t.y - r - hh + 2], [t.x - r - gap - w, t.y - hh / 2], [t.x - r - gap - w, t.y + r - 2],
      [t.x + r + gap, t.y - r - 2 * hh], [t.x - w / 2, t.y + r + gap + hh], [t.x - w / 2, t.y - r - 2 * hh - gap], [t.x + r + gap, t.y + r + hh],
      [t.x + r + 3 * gap + w / 2, t.y - r - 2 * hh], [t.x - r - 3 * gap - 1.5 * w, t.y + r + hh]];
    const box = ([x0, y0]) => [x0, y0, x0 + w, y0 + hh];
    const best = opts.map(box).find((b) => !hitsBox(b) && !hitsCircle(b)) || opts.map(box).find((b) => !hitsCircle(b)) || box(opts[0]);
    placed.push(best); out.push({ tag: t, box: best });
  }
  return out;
}

/** mupdf — модуль; data — PDF; points — [{ label, typeId, pos, color? }]; hidden — [{pos}] → Uint8Array */
export function numberedPdf(mupdf, data, points, { title = '', icons = {}, hidden = [], fs = 7 } = {}) {
  const doc = mupdf.Document.openDocument(data, 'application/pdf').asPDF();
  const types = [...new Set(points.map((p) => p.typeId))].sort((a, b) => a.localeCompare(b, 'ru'));
  const typeColor = (t) => rgb(TYPE_COLORS[types.indexOf(t) % TYPE_COLORS.length]);
  const colorOf = (p) => (p.color ? rgb(p.color) : typeColor(p.typeId));
  // слои: «Номера: <тип>», «Добавлено на объекте» (значки точек, которых нет на чертеже), «Скрытое»
  let order = null; let ocgs = null;
  try {
    const root = doc.getTrailer().get('Root'); let ocp = root.get('OCProperties'); if (ocp.isNull()) { ocp = doc.newDictionary(); root.put('OCProperties', ocp); }
    ocgs = ocp.get('OCGs'); if (ocgs.isNull()) { ocgs = doc.newArray(); ocp.put('OCGs', ocgs); }
    let D = ocp.get('D'); if (D.isNull()) { D = doc.newDictionary(); ocp.put('D', D); }
    order = D.get('Order'); if (order.isNull()) { order = doc.newArray(); D.put('Order', order); }
  } catch { /* без слоёв — просто пометки */ }
  const layers = new Map();
  const layer = (name) => { if (!ocgs) return null; if (!layers.has(name)) { const o = doc.newDictionary(); o.put('Type', doc.newName('OCG')); o.put('Name', doc.newString(name)); const ref = doc.addObject(o); ocgs.push(ref); order.push(ref); layers.set(name, ref); } return layers.get(name); };
  const inLayer = (a, name) => { const ref = layer(name); if (ref) try { a.getObject().put('OC', ref); } catch { /* ok */ } };
  const b64 = (s) => { const bin = atob(String(s).split(',')[1] || ''); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const imgs = new Map();
  const stampOf = (t) => { if (!icons[t]) return null; if (!imgs.has(t)) { try { imgs.set(t, new mupdf.Image(b64(icons[t].png))); } catch { imgs.set(t, null); } } return imgs.get(t); };
  const pages = new Map(); const pageOf = (pi) => { if (!pages.has(pi)) pages.set(pi, doc.loadPage(pi)); return pages.get(pi); };
  const n = doc.countPages();

  // скрытое — белым
  for (const m of hidden) {
    const pi = m.pos?.page || 0; if (!m.pos || pi >= n) continue; const q = m.pos;
    const a = pageOf(pi).createAnnotation('Square'); a.setRect([q.x - (q.w || 8) / 2 - 1.5, q.y - (q.h || 8) / 2 - 1.5, q.x + (q.w || 8) / 2 + 1.5, q.y + (q.h || 8) / 2 + 1.5]);
    a.setColor([1, 1, 1]); a.setInteriorColor([1, 1, 1]); a.setBorderWidth(0.5); a.update(); inLayer(a, 'Скрытое');
  }
  // отметки по группам (одна отметка — одна рамка/кружок, одна подпись)
  const groups = new Map();
  for (const p of points) { if (!p.pos || (p.pos.page || 0) >= n) continue; const k = keyOf(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const perPage = new Map();
  for (const g of groups.values()) {
    const p = g[0]; const pi = p.pos.page || 0; const page = pageOf(pi); const c = colorOf(p); const q = p.pos; const lyr = `Номера: ${p.typeId}`;
    if (!perPage.has(pi)) perPage.set(pi, { tags: [], circles: [], frames: [] });
    const pp = perPage.get(pi); const lines = combineLabels(g.map((x) => x.label));
    const img = q.icon ? stampOf(p.typeId) : null;
    if (img) { const iw = icons[p.typeId].w || 12; const ih = icons[p.typeId].h || 12; const st = page.createAnnotation('Stamp'); st.setRect([q.x - iw / 2, q.y - ih / 2, q.x + iw / 2, q.y + ih / 2]); st.setStampImage(img); st.setContents(`${lines.join(', ')} — ${p.typeId} (добавлено на объекте)`); st.update(); inLayer(st, 'Добавлено на объекте'); }
    if (isText(q)) {
      const r = [q.x - q.w / 2 - 1.2, q.y - q.h / 2 - 1.2, q.x + q.w / 2 + 1.2, q.y + q.h / 2 + 1.2];
      const a = page.createAnnotation('Square'); a.setRect(r); a.setColor(c); a.setBorderWidth(1); a.setContents(`${lines.join(', ')} — ${p.typeId}`); a.update(); inLayer(a, lyr);
      pp.frames.push(r);
      if (g.length > 1 || (q.text && q.text !== p.label)) pp.tags.push({ x: q.x, y: q.y, r: Math.max(q.w, q.h) / 2 + 1.5, lines, c, lyr });
    } else {
      const rr = Math.max(q.w || 8, q.h || 8) / 2 + 1.2;
      const a = page.createAnnotation('Circle'); a.setRect([q.x - rr, q.y - rr, q.x + rr, q.y + rr]); a.setColor(c); a.setBorderWidth(1); a.setContents(`${lines.join(', ')} — ${p.typeId}`); a.update(); inLayer(a, lyr);
      pp.circles.push([q.x, q.y, rr]); pp.tags.push({ x: q.x, y: q.y, r: rr, lines, c, lyr });
    }
  }
  // подписи — поверх всего
  for (const [pi, pp] of perPage) {
    const page = pageOf(pi);
    for (const { tag: t, box: b } of layoutTags(pp.tags, { circles: pp.circles, frames: pp.frames, fs })) {
      const cx = Math.max(b[0], Math.min(t.x, b[2])); const cy = Math.max(b[1], Math.min(t.y, b[3]));
      if (Math.hypot(cx - t.x, cy - t.y) > t.r + 2.5) { const ln = page.createAnnotation('Line'); ln.setLine([t.x, t.y], [cx, cy]); ln.setColor(t.c); ln.setBorderWidth(0.5); ln.update(); inLayer(ln, t.lyr); }
      const sq = page.createAnnotation('Square'); sq.setRect(b); sq.setColor(t.c); sq.setInteriorColor([1, 1, 1]); sq.setBorderWidth(0.8); sq.update(); inLayer(sq, t.lyr);
      const ft = page.createAnnotation('FreeText'); ft.setRect([b[0] + 0.5, b[1] + 0.5, b[2] - 0.2, b[3] - 0.2]); ft.setContents(t.lines.join('\n'));
      ft.setDefaultAppearance('Helv', fs, [0, 0, 0]); ft.setBorderWidth(0); ft.update(); inLayer(ft, t.lyr);
    }
  }
  // легенда: цвета статусов и точки по типам
  const W = 842; const H = 595; const lines = [];
  lines.push([`Легенда номеров${title ? ` - ${title}` : ''}`, 14, [0, 0, 0]]);
  lines.push([`Цвет рамки - статус точки: ${STATUS_COLORS.map(([, t]) => t).join(', ')}`, 9, [0.3, 0.3, 0.3]]);
  STATUS_COLORS.forEach(([c, t]) => lines.push([`■ ${t}`, 9, rgb(c)]));
  for (const t of types) {
    const ls = points.filter((p) => p.typeId === t).map((p) => p.label);
    lines.push([`${t}: ${ls.length}`, 11, typeColor(t)]);
    let cur = '';
    for (const l of ls) { const nxt = cur ? `${cur}, ${l}` : l; if (nxt.length * 9 * 0.55 > W - 60) { lines.push([cur, 9, [0.2, 0.2, 0.2]]); cur = l; } else cur = nxt; }
    if (cur) lines.push([cur, 9, [0.2, 0.2, 0.2]]);
  }
  let lp = null; let y = 0;
  for (const [text, size, c] of lines) {
    if (!lp || y + size * 1.6 > H - 30) { const obj = doc.addPage([0, 0, W, H], 0, doc.addObject(doc.newDictionary()), ''); doc.insertPage(-1, obj); lp = doc.loadPage(doc.countPages() - 1); y = 30; }
    const a = lp.createAnnotation('FreeText'); a.setRect([30, y, W - 30, y + size * 1.4]); a.setContents(text); a.setDefaultAppearance('Helv', size, c); a.setBorderWidth(0); a.update();
    y += size * 1.6;
  }
  return doc.saveToBuffer('compress').asUint8Array();
}
