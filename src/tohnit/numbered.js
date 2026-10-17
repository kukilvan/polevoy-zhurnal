// PDF с номерами: исходный чертёж + у каждой точки кружок и номер цветом по типу (пометки PDF — можно скрыть/удалить в любом просмотрщике)
// + последняя страница «Легенда номеров»: по типам — сколько и какие.
export const TYPE_COLORS = ['#e0007a', '#0a84ff', '#ff9f0a', '#30a14e', '#bf5af2', '#ff453a', '#0fb5ae', '#8e6c00', '#5856d6', '#c2185b'];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** mupdf — модуль; data — PDF; points — [{ label, typeId, pos:{page,x,y,w,h} }] → Uint8Array */
export function numberedPdf(mupdf, data, points, { title = '', icons = {} } = {}) {
  const doc = mupdf.Document.openDocument(data, 'application/pdf').asPDF();
  const types = [...new Set(points.map((p) => p.typeId))].sort((a, b) => a.localeCompare(b, 'ru'));
  const colorOf = (t) => rgb(TYPE_COLORS[types.indexOf(t) % TYPE_COLORS.length]);
  // слой на каждый тип «Номера: Камера» — в просмотрщике PDF можно оставить только нужные
  const layerOf = new Map();
  try {
    const root = doc.getTrailer().get('Root'); let ocp = root.get('OCProperties'); if (ocp.isNull()) { ocp = doc.newDictionary(); root.put('OCProperties', ocp); }
    let ocgs = ocp.get('OCGs'); if (ocgs.isNull()) { ocgs = doc.newArray(); ocp.put('OCGs', ocgs); }
    let D = ocp.get('D'); if (D.isNull()) { D = doc.newDictionary(); ocp.put('D', D); }
    let order = D.get('Order'); if (order.isNull()) { order = doc.newArray(); D.put('Order', order); }
    for (const t of types) { const o = doc.newDictionary(); o.put('Type', doc.newName('OCG')); o.put('Name', doc.newString(`Номера: ${t}`)); const ref = doc.addObject(o); ocgs.push(ref); order.push(ref); layerOf.set(t, ref); }
  } catch { /* без слоёв — просто пометки */ }
  const inLayer = (annot, t) => { const ref = layerOf.get(t); if (ref) try { annot.getObject().put('OC', ref); } catch { /* ok */ } };
  const pages = new Map();
  // значки точек, добавленных на объекте (их нет на исходном чертеже): картинка значка типа на слое «Добавлено на объекте»
  let addedLayer = null;
  const b64 = (s) => { const bin = atob(String(s).split(',')[1] || ''); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const imgs = new Map();
  if (points.some((p) => p.pos?.icon && icons[p.typeId])) {
    try {
      const root = doc.getTrailer().get('Root'); let ocp = root.get('OCProperties'); if (ocp.isNull()) { ocp = doc.newDictionary(); root.put('OCProperties', ocp); }
      let ocgs = ocp.get('OCGs'); if (ocgs.isNull()) { ocgs = doc.newArray(); ocp.put('OCGs', ocgs); }
      let D = ocp.get('D'); if (D.isNull()) { D = doc.newDictionary(); ocp.put('D', D); }
      let order = D.get('Order'); if (order.isNull()) { order = doc.newArray(); D.put('Order', order); }
      const o = doc.newDictionary(); o.put('Type', doc.newName('OCG')); o.put('Name', doc.newString('Добавлено на объекте')); addedLayer = doc.addObject(o); ocgs.push(addedLayer); order.push(addedLayer);
    } catch { /* без слоя */ }
  }
  const stampOf = (t) => { if (!icons[t]) return null; if (!imgs.has(t)) { try { imgs.set(t, new mupdf.Image(b64(icons[t].png))); } catch { imgs.set(t, null); } } return imgs.get(t); };
  for (const p of points) {
    if (!p.pos) continue; const pi = p.pos.page || 0; if (pi >= doc.countPages()) continue;
    if (!pages.has(pi)) pages.set(pi, doc.loadPage(pi));
    const page = pages.get(pi); const c = colorOf(p.typeId);
    const img = p.pos.icon ? stampOf(p.typeId) : null;
    if (img) { const iw = icons[p.typeId].w || 12; const ih = icons[p.typeId].h || 12; const st = page.createAnnotation('Stamp'); st.setRect([p.pos.x - iw / 2, p.pos.y - ih / 2, p.pos.x + iw / 2, p.pos.y + ih / 2]); st.setStampImage(img); st.setContents(`${p.label} — ${p.typeId} (добавлено на объекте)`); st.update(); if (addedLayer) try { st.getObject().put('OC', addedLayer); } catch { /* ok */ } }
    const r = Math.max(5, Math.min(p.pos.h || 8, 12) * 0.8); const fs = Math.max(6, Math.min(14, (p.pos.h || 8)));
    const ci = page.createAnnotation('Circle'); ci.setRect([p.pos.x - r, p.pos.y - r, p.pos.x + r, p.pos.y + r]); ci.setColor(c); ci.setBorderWidth(1.2); ci.setContents(`${p.label} — ${p.typeId}`); ci.update(); inLayer(ci, p.typeId);
    const tw = p.label.length * fs * 0.62 + 4;
    const ft = page.createAnnotation('FreeText'); ft.setRect([p.pos.x + r + 1, p.pos.y - fs * 0.7, p.pos.x + r + 1 + tw, p.pos.y + fs * 0.7]);
    ft.setContents(p.label); ft.setDefaultAppearance('Helv', fs, c); ft.setBorderWidth(0); ft.update(); inLayer(ft, p.typeId);
  }
  // легенда
  const W = 842; const H = 595; const lines = [];
  lines.push([`Легенда номеров${title ? ` - ${title}` : ''}`, 14, [0, 0, 0]]);
  for (const t of types) {
    const ls = points.filter((p) => p.typeId === t).map((p) => p.label);
    lines.push([`${t}: ${ls.length}`, 11, colorOf(t)]);
    let cur = '';
    for (const l of ls) { const nxt = cur ? `${cur}, ${l}` : l; if (nxt.length * 9 * 0.55 > W - 60) { lines.push([cur, 9, [0.2, 0.2, 0.2]]); cur = l; } else cur = nxt; }
    if (cur) lines.push([cur, 9, [0.2, 0.2, 0.2]]);
  }
  let lp = null; let y = 0;
  for (const [text, fs, c] of lines) {
    if (!lp || y + fs * 1.6 > H - 30) { const obj = doc.addPage([0, 0, W, H], 0, doc.addObject(doc.newDictionary()), ''); doc.insertPage(-1, obj); lp = doc.loadPage(doc.countPages() - 1); y = 30; }
    const a = lp.createAnnotation('FreeText'); a.setRect([30, y, W - 30, y + fs * 1.4]); a.setContents(text); a.setDefaultAppearance('Helv', fs, c); a.setBorderWidth(0); a.update();
    y += fs * 1.6;
  }
  return doc.saveToBuffer('compress').asUint8Array();
}
