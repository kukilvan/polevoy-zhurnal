// Значки без номеров: нажал на значок → нашлись такие же (по тексту внутри или по форме) → нумерация цепочкой по соседям.
import { shapeSig, findSymbols } from './engine.js';

const ctr = (s) => [(s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2];
const near = (s, x, y, pad) => x >= s.x0 - pad && x <= s.x1 + pad && y >= s.y0 - pad && y <= s.y1 + pad;

/**
 * Что под пальцем и где ещё такое же.
 * spans — из scanPages (с bg), pages — extractPdf().pages, hidden(layer) — мусорные слои.
 * → { kind: 'text'|'shape', what, items: [{ page, x, y, w, h }] } или null
 */
export function pickSimilar(spans, pages, page, x, y, { hidden = () => false, pad = 3 } = {}) {
  // 1) короткий текст под пальцем (буква в квадратике, «1» в треугольнике…) — все такие же надписи того же вида
  const hit = spans.filter((s) => s.page === page && !s.c?.startsWith?.('sym:') && s.t.trim().length <= 5 && !/\s/.test(s.t.trim()) && near(s, x, y, pad))
    .sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0];
  if (hit) {
    const t = hit.t.trim();
    const same = spans.filter((s) => s.t.trim() === t && s.font === hit.font && Math.abs((s.size || 0) - (hit.size || 0)) <= 0.6 && (s.color || '') === (hit.color || '') && (s.bg || '') === (hit.bg || ''));
    return { kind: 'text', what: `надпись «${t}»${hit.bg ? ' на цветном фоне' : ''}`, text: t,
      items: same.map((s) => ({ page: s.page, x: +ctr(s)[0].toFixed(1), y: +ctr(s)[1].toFixed(1), w: +(s.x1 - s.x0).toFixed(1), h: +(s.y1 - s.y0).toFixed(1) })) };
  }
  // 2) векторный значок: связные линии одного цвета под пальцем
  const pg = pages[page]; if (!pg) return null;
  const R = 40;
  const cand = pg.paths.filter((p) => !hidden(p.layer) && p.bbox[0] <= x + R && p.bbox[2] >= x - R && p.bbox[1] <= y + R && p.bbox[3] >= y - R && Math.max(p.bbox[2] - p.bbox[0], p.bbox[3] - p.bbox[1]) <= 60);
  if (!cand.length) return null;
  const par = cand.map((_, i) => i); const f = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
    const a = cand[i].bbox; const b = cand[j].bbox;
    if (cand[i].color === cand[j].color && b[0] <= a[2] + 1.5 && a[0] <= b[2] + 1.5 && b[1] <= a[3] + 1.5 && a[1] <= b[3] + 1.5) par[f(i)] = f(j);
  }
  const comps = new Map(); cand.forEach((p, i) => { const r = f(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(p); });
  const box = (c) => [Math.min(...c.map((q) => q.bbox[0])), Math.min(...c.map((q) => q.bbox[1])), Math.max(...c.map((q) => q.bbox[2])), Math.max(...c.map((q) => q.bbox[3]))];
  const under = [...comps.values()].map((c) => ({ c, b: box(c) })).filter(({ b }) => x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad && Math.max(b[2] - b[0], b[3] - b[1]) <= 60)
    .sort((p, q) => (p.b[2] - p.b[0]) * (p.b[3] - p.b[1]) - (q.b[2] - q.b[0]) * (q.b[3] - q.b[1]));
  if (!under.length) return null;
  const { c, b } = under[0];
  const sg = shapeSig(c.flatMap((q) => q.pts)); if (!sg) return null;
  const size = Math.max(b[2] - b[0], b[3] - b[1]);
  const sig = { color: c[0].color, L: sg.L, rg: sg.rg, el: sg.el, size };
  const items = [];
  pages.forEach((p, pi) => { for (const [cx, cy] of findSymbols(p.paths, sig, 0.12, hidden)) items.push({ page: pi, x: +cx.toFixed(1), y: +cy.toFixed(1), w: +size.toFixed(1), h: +size.toFixed(1) }); });
  return { kind: 'shape', what: `значок (#${sig.color}, ${Math.round(size)} pt)`, sig, items };
}

/** Нумерация цепочкой по соседям: от верхнего левого (или заданного) — к ближайшему ещё не занятому */
export function chainOrder(items, start = null) {
  const left = items.map((it, i) => ({ it, i }));
  if (!left.length) return [];
  const byPage = new Map(); left.forEach((x) => { const k = x.it.page || 0; if (!byPage.has(k)) byPage.set(k, []); byPage.get(k).push(x); });
  const out = [];
  [...byPage.keys()].sort((a, b) => a - b).forEach((pg) => {
    const rest = byPage.get(pg);
    let cur = start && (start.page || 0) === pg ? rest.reduce((m, x) => (Math.hypot(x.it.x - start.x, x.it.y - start.y) < Math.hypot(m.it.x - start.x, m.it.y - start.y) ? x : m))
      : rest.reduce((m, x) => (x.it.x + x.it.y < m.it.x + m.it.y ? x : m));
    while (cur) {
      out.push(cur.it); rest.splice(rest.indexOf(cur), 1);
      const c = cur.it; cur = rest.length ? rest.reduce((m, x) => (Math.hypot(x.it.x - c.x, x.it.y - c.y) < Math.hypot(m.it.x - c.x, m.it.y - c.y) ? x : m)) : null;
    }
  });
  return out;
}

/** Обозначения: буквы + номер с ведущими нулями (W01, W02…) */
export const numberLabels = (prefix, n, { from = 1, digits = 2 } = {}) => Array.from({ length: n }, (_, i) => `${prefix}${String(from + i).padStart(digits, '0')}`);

/**
 * Нумерация по областям: значки, стоящие кучно, — одна область (связаны, если ближе 3 «обычных» расстояний между соседями).
 * Области — по порядку чтения (сверху вниз полосами, в полосе слева направо); внутри области — строками слева направо, строки сверху вниз.
 * start — значок, с области (и строки) которого начать.
 */
export function regionOrder(items, start = null) {
  const out = [];
  const pagesOf = [...new Set(items.map((it) => it.page || 0))].sort((a, b) => a - b);
  for (const pg of pagesOf) {
    const its = items.filter((it) => (it.page || 0) === pg); const n = its.length;
    if (n <= 2) { out.push(...its.sort((a, b) => a.y - b.y || a.x - b.x)); continue; }
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const nn = its.map((a) => Math.min(...its.filter((b) => b !== a).map((b) => d(a, b)))).sort((a, b) => a - b);
    const med = Math.max(1, nn[Math.floor(n / 2)]);
    const par = its.map((_, i) => i); const f = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (d(its[i], its[j]) <= 3 * med) par[f(i)] = f(j);
    const groups = new Map(); its.forEach((it, i) => { const r = f(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); });
    const rows = (list, tol) => {  // строки: близкие по высоте — одна строка, в строке слева направо
      const s = [...list].sort((a, b) => a.y - b.y); const res = []; let cur = []; let y0 = null;
      for (const it of s) { if (y0 === null || it.y - y0 <= tol) { cur.push(it); y0 ??= it.y; } else { res.push(cur); cur = [it]; y0 = it.y; } }
      if (cur.length) res.push(cur);
      return res.map((r) => r.sort((a, b) => a.x - b.x));
    };
    const regs = [...groups.values()].map((g) => ({ g, x: Math.min(...g.map((i) => i.x)), y: Math.min(...g.map((i) => i.y)), y1: Math.max(...g.map((i) => i.y)) }));
    const bandTol = Math.max(3 * med, regs.map((r) => r.y1 - r.y).sort((a, b) => a - b)[Math.floor(regs.length / 2)] / 2);
    let ordered = rows(regs.map((r) => ({ ...r, x: r.x, y: r.y })), bandTol).flat();
    if (start && (start.page || 0) === pg) { const k = ordered.findIndex((r) => r.g.includes(start)); if (k > 0) ordered = [ordered[k], ...ordered.slice(0, k), ...ordered.slice(k + 1)]; }
    for (const r of ordered) {
      let rs = rows(r.g, med * 0.6);
      if (start && r.g.includes(start)) { const k = rs.findIndex((row) => row.includes(start)); rs = [...rs.slice(k), ...rs.slice(0, k)]; const row = rs[0]; const i = row.indexOf(start); rs[0] = [...row.slice(i), ...row.slice(0, i)]; }
      out.push(...rs.flat());
    }
  }
  return out;
}
