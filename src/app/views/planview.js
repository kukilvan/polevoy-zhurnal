// Просмотр листа чертежа: перетаскивание, увеличение пальцами/колесом/кнопками, чёткая картинка при приближении.
// Рисует поверх свои отметки (overlay), сообщает о нажатиях (onTap) и рамке (onRect, когда rectMode() истина).
import { h } from '../ui.js';

export function createViewer({ wk, pages, height = '58vh', onTap, onRect, rectMode = () => false, overlay }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let page = 0; let base = null; let baseZ = 1; let tile = null; let tileTimer = null; let rectNow = null;
  const view = { s: 1, ox: 0, oy: 0 };
  const wrap = h('div', { style: { position: 'relative', height, overflow: 'hidden', background: '#fff', borderRadius: '8px', touchAction: 'none', userSelect: 'none' } });
  const cv = h('canvas', { style: { position: 'absolute', inset: 0, width: '100%', height: '100%' } }); wrap.append(cv);
  const g = cv.getContext('2d');
  const msg = h('div', { style: { position: 'absolute', left: '8px', top: '8px', color: '#555', font: '13px system-ui' } }, 'Загружаю лист…'); wrap.append(msg);

  const toScr = (x, y) => [(x - view.ox) * view.s, (y - view.oy) * view.s];
  const toPt = (sx, sy) => [sx / view.s + view.ox, sy / view.s + view.oy];
  function size() { const r = wrap.getBoundingClientRect(); cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); return r; }
  function draw() {
    if (!cv.width) size();
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    if (base) g.drawImage(base, -view.ox * view.s, -view.oy * view.s, (base.width / baseZ) * view.s, (base.height / baseZ) * view.s);
    if (tile && tile.page === page) { const [x0, y0] = toScr(tile.clip[0], tile.clip[1]); g.drawImage(tile.img, x0, y0, (tile.clip[2] - tile.clip[0]) * view.s, (tile.clip[3] - tile.clip[1]) * view.s); }
    overlay?.(g, api);
    if (rectNow) { g.strokeStyle = '#ff453a'; g.setLineDash([6, 4]); g.lineWidth = 2; g.strokeRect(rectNow[0], rectNow[1], rectNow[2] - rectNow[0], rectNow[3] - rectNow[1]); g.setLineDash([]); }
  }
  async function render(p, clip, zoom) { const r = await wk.call('crop', { page: p, clip, zoom, raw: true }); return createImageBitmap(new ImageData(r.data, r.w, r.h)); }
  function fit() { const r = wrap.getBoundingClientRect(); const pg = pages[page]; view.s = Math.min(r.width / pg.w, r.height / pg.h); view.ox = -(r.width / view.s - pg.w) / 2; view.oy = -(r.height / view.s - pg.h) / 2; draw(); schedTile(); }
  async function load(p = page) {
    page = p; tile = null; base = null; msg.style.display = ''; draw();
    const pg = pages[page]; baseZ = Math.min(1, 2400 / Math.max(pg.w, pg.h));
    base = await render(page, [0, 0, pg.w, pg.h], baseZ); msg.style.display = 'none'; fit();
  }
  // чёткая картинка видимой части: с запасом по краям (небольшой сдвиг не требует перерисовки); старая остаётся на месте, пока не готова новая
  let busy = false; let again = false;
  function schedTile() { clearTimeout(tileTimer); tileTimer = setTimeout(renderTile, 70); }
  async function renderTile() {
    if (busy) { again = true; return; }
    const r = wrap.getBoundingClientRect(); const z = Math.min(8, view.s * dpr);
    if (z <= baseZ * 1.2) { if (tile) { tile = null; draw(); } return; }
    const pg = pages[page]; const [x0, y0] = toPt(0, 0); const [x1, y1] = toPt(r.width, r.height);
    if (tile && tile.page === page && tile.z >= z * 0.9 && tile.z <= z * 1.6 && tile.clip[0] <= Math.max(0, x0) && tile.clip[1] <= Math.max(0, y0) && tile.clip[2] >= Math.min(pg.w, x1) && tile.clip[3] >= Math.min(pg.h, y1)) return;
    const mx = (x1 - x0) * 0.25; const my = (y1 - y0) * 0.25;
    const clip = [Math.max(0, x0 - mx), Math.max(0, y0 - my), Math.min(pg.w, x1 + mx), Math.min(pg.h, y1 + my)]; if (clip[2] <= clip[0] || clip[3] <= clip[1]) return;
    busy = true;
    try { const img = await render(page, clip, z); tile = { page, clip, img, z }; draw(); } catch { /* не страшно */ }
    busy = false; if (again) { again = false; renderTile(); }
  }
  function zoomAt(sx, sy, f) { const [px, py] = toPt(sx, sy); view.s = Math.min(20, Math.max(0.05, view.s * f)); view.ox = px - sx / view.s; view.oy = py - sy / view.s; draw(); schedTile(); }
  const zoomBy = (f) => { const r = wrap.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); };
  // показать место листа крупно (например, точку из карточки)
  async function focus(x, y, p = page, s = 2.5) {
    if (p !== page || !base) await load(p);
    const r = wrap.getBoundingClientRect(); view.s = s; view.ox = x - r.width / 2 / s; view.oy = y - r.height / 2 / s; tile = null; draw(); schedTile();
  }

  const ptrs = new Map(); let downAt = null; let moved = false; let pinch = null;
  const local = (e) => { const r = wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  wrap.addEventListener('pointerdown', (e) => { wrap.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, local(e)); downAt = local(e); moved = false;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: view.s, c: toPt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) }; } });
  wrap.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return; const prev = ptrs.get(e.pointerId); const cur = local(e); ptrs.set(e.pointerId, cur);
    if (Math.hypot(cur[0] - downAt[0], cur[1] - downAt[1]) > 6) moved = true;
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const mx = (a[0] + b[0]) / 2; const my = (a[1] + b[1]) / 2;
      view.s = Math.min(20, Math.max(0.05, pinch.s * d / pinch.d)); view.ox = pinch.c[0] - mx / view.s; view.oy = pinch.c[1] - my / view.s; draw(); return;
    }
    if (rectMode()) { rectNow = [Math.min(downAt[0], cur[0]), Math.min(downAt[1], cur[1]), Math.max(downAt[0], cur[0]), Math.max(downAt[1], cur[1])]; draw(); return; }
    view.ox -= (cur[0] - prev[0]) / view.s; view.oy -= (cur[1] - prev[1]) / view.s; draw(); schedTile();
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
    if (pinch) { if (!ptrs.size) { pinch = null; schedTile(); } return; }
    if (rectNow) { const [a0, b0] = toPt(rectNow[0], rectNow[1]); const [a1, b1] = toPt(rectNow[2], rectNow[3]); rectNow = null; onRect?.([a0, b0, a1, b1], page); draw(); return; }
    if (moved) { schedTile(); return; }
    const [sx, sy] = local(e); const [x, y] = toPt(sx, sy); onTap?.(x, y, page, sx, sy);
  };
  wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
  wrap.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = local(e); zoomAt(x, y, e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
  const onResize = () => { if (wrap.isConnected) { size(); draw(); } else window.removeEventListener('resize', onResize); };
  window.addEventListener('resize', onResize);

  const zoomBtns = () => [
    h('button', { type: 'button', class: 'sec', style: { padding: '6px 12px' }, onclick: () => zoomBy(1.5) }, '＋'),
    h('button', { type: 'button', class: 'sec', style: { padding: '6px 12px' }, onclick: () => zoomBy(1 / 1.5) }, '－'),
    h('button', { type: 'button', class: 'sec', style: { padding: '6px 10px' }, onclick: () => fit() }, '⤢ Весь лист')];
  const api = { el: wrap, view, toScr, toPt, draw, fit, load, focus, zoomBy, zoomBtns, get page() { return page; }, start: () => new Promise((res) => requestAnimationFrame(() => { size(); res(load(page)); })) };
  return api;
}

// Отметка на плане: кружок + подпись
export function mark(g, api, it, color, label, { crossed = false, fill = false, minR = 6, rPt = null } = {}) {
  const [x, y] = api.toScr(it.x, it.y); const r = Math.max(minR, (rPt ?? (Math.max(it.w || 8, it.h || 8) / 2 + 2)) * api.view.s);
  g.lineWidth = 2; g.strokeStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { g.fillStyle = `${color}33`; g.fill(); }
  g.stroke();
  if (crossed) { g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke(); }
  if (label && api.view.s > 0.35) { g.font = 'bold 12px system-ui'; const w = g.measureText(label).width; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(x + r, y - r - 12, w + 4, 14); g.fillStyle = color; g.fillText(label, x + r + 2, y - r); }
}
