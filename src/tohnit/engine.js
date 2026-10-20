// Разбор тохнита без ИИ — логика (порт tools/tohnit/tohnit.py: scan → правила каталога → точки + вопросы человеку).
// На входе — результат extractPdf; на выходе — точки в формате polevoy-points-1 и вопросы по неизвестным группам.
import { segment } from './pattern.js';

const LABELISH = /^(?=.*\d)(?=.*[A-Za-z\-/])[A-Za-z0-9][A-Za-z0-9\-./_,()]{0,22}$/;
export function labelish(t) {
  t = t.trim();
  if (!LABELISH.test(t)) return false;
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(t) || /^[+-]?\d+(\.\d+)?[+-]?$/.test(t)) return false;
  if (/^H\s*=?\s*\d/i.test(t) || /^\d+(\.\d+)?(m|cm|mm|м)$/i.test(t)) return false;
  return true;
}
export const shape = (t) => t.replace(/[0-9]/g, '9').replace(/[A-Za-z]/g, 'A').replace(/[֐-׿]/g, 'א').replace(/[А-Яа-яЁё]/g, 'Б').replace(/A+/g, 'A').replace(/9+/g, '9');
const ctr = (s) => [(s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const edgeDist = (r, p) => Math.hypot(Math.max(r.x0 - p[0], 0, p[0] - r.x1), Math.max(r.y0 - p[1], 0, p[1] - r.y1));

// «GD1/» над «D-15.2» → «GD1/D-15.2»
function joinStacked(spans, key) {
  const pre = spans.filter((s) => s.t.endsWith('/') && s.t.length <= 6 && !s.font.startsWith('аннотация'));
  if (!pre.length) return spans;
  const used = new Set(); const out = [];
  for (const p of pre) {
    const cx = (p.x0 + p.x1) / 2; const h = Math.max(p.size, p.y1 - p.y0);
    const cand = spans.filter((s) => s !== p && !used.has(s) && key(s) === key(p) && !s.t.endsWith('/') && s.y0 - p.y1 >= -0.3 * h && s.y0 - p.y1 <= 0.9 * h && s.x0 - h <= cx && cx <= s.x1 + h);
    if (!cand.length) continue;
    const b = cand.reduce((m, s) => ((s.y0 - p.y1) + Math.abs((s.x0 + s.x1) / 2 - cx) * 0.2 < (m.y0 - p.y1) + Math.abs((m.x0 + m.x1) / 2 - cx) * 0.2 ? s : m));
    used.add(p); used.add(b);
    out.push({ ...b, t: p.t + b.t, x0: Math.min(p.x0, b.x0), x1: Math.max(p.x1, b.x1), y0: p.y0, y1: b.y1 });
  }
  return spans.filter((s) => !used.has(s)).concat(out);
}
// Соседние фрагменты одной строки и стиля («TV» «140») — в один; две целые подписи не склеиваются
export function mergeSpans(spans) {
  const key = (s) => `${s.color}|${s.font}|${s.size}`;
  const list = joinStacked(spans, key).slice().sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) || Math.round((a.y0 + a.y1) / 2) - Math.round((b.y0 + b.y1) / 2) || a.x0 - b.x0);
  const out = [];
  for (const s of list) {
    if (s.font.startsWith('аннотация')) { out.push({ ...s }); continue; }
    const o = out[out.length - 1];
    if (o && !o.font.startsWith('аннотация')) {
      const same = key(o) === key(s) && Math.abs((o.y0 + o.y1) / 2 - (s.y0 + s.y1) / 2) < s.size * 0.3;
      const gap = s.x0 - o.x1;
      const both = LABELISH.test(o.t.split(' ').pop()) && LABELISH.test(s.t);
      if (same && !both && gap >= -0.1 * s.size && gap <= 0.6 * s.size) {
        o.t = `${o.t} ${s.t}`; o.x1 = Math.max(o.x1, s.x1); o.y0 = Math.min(o.y0, s.y0); o.y1 = Math.max(o.y1, s.y1); continue;
      }
    }
    out.push({ ...s });
  }
  return out;
}

// Слои-мусор: серые (архитектура «в подложке»), штриховки, рамки колонн, сетка осей. Слои систем не трогаем.
const CLUTTER_STRONG = /KOTERET|HATCH|GRID|AXIS|COLUMN|ZIRIM/i;
const SYSTEM_LAYERS = /CCTV|CTV|CAM|ACC|ACS|COMM|TEL|DATA|ALR|ALARM|INT|SEC|BITACHON|LOW|WIFI|AP\b|FIBER|TV/i;
export function clutterLayers(layers) {
  const out = [];
  for (const [name, e] of Object.entries(layers)) {
    if (name === '—' || SYSTEM_LAYERS.test(name)) continue;
    const main = Object.entries(e.colors).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const gray = main.length === 6 && main.slice(0, 2) === main.slice(2, 4) && main.slice(2, 4) === main.slice(4, 6) && parseInt(main.slice(0, 2), 16) >= 0x60 && parseInt(main.slice(0, 2), 16) <= 0xf0;
    if (gray || CLUTTER_STRONG.test(name)) out.push(name);
  }
  return out;
}

/** Скан: склейка, дубли аннотаций, фон под коротким текстом, группы по стилю → { spans, clusters } */
export function scanPages(pages) {
  const all = [];
  pages.forEach((pg, pi) => {
    const pageTxt = pg.spans.filter((x) => !x.font.startsWith('аннотация'));
    const dup = (a) => {
      const k = a.t.replace(/ /g, ''); const ac = ctr(a); const ah = Math.max(1, Math.min(a.x1 - a.x0, a.y1 - a.y0));
      return pageTxt.some((x) => {
        if (x.t.replace(/ /g, '') !== k) return false;
        const xc = ctr(x); const xh = Math.max(1, Math.min(x.x1 - x.x0, x.y1 - x.y0));
        return Math.abs(ac[0] - xc[0]) <= Math.max(2, 0.4 * ah) && Math.abs(ac[1] - xc[1]) <= Math.max(2, 0.4 * ah) && ah / xh >= 0.5 && ah / xh <= 2;
      });
    };
    const spans = pageTxt.concat(pg.spans.filter((a) => a.font.startsWith('аннотация') && !dup(a)));
    const grid = new Map(); const gk = (x, y) => `${Math.floor(x / 50)},${Math.floor(y / 50)}`;
    for (const f of pg.fills) for (let gx = Math.floor(f[0] / 50); gx <= Math.floor(f[2] / 50); gx++) for (let gy = Math.floor(f[1] / 50); gy <= Math.floor(f[3] / 50); gy++) { const k = `${gx},${gy}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(f); }
    for (const s of mergeSpans(spans)) {
      s.page = pi;
      if (s.t.length <= 6) {
        const [cx, cy] = ctr(s); const inside = (grid.get(gk(cx, cy)) || []).filter((f) => f[0] <= cx && cx <= f[2] && f[1] <= cy && cy <= f[3]);
        if (inside.length) s.bg = inside.reduce((m, f) => ((f[2] - f[0]) * (f[3] - f[1]) < (m[2] - m[0]) * (m[3] - m[1]) ? f : m))[4];
      }
      all.push(s);
    }
  });
  const groups = new Map();
  for (const s of all) { const k = `${s.color}|${s.font}|${s.size}|${s.bg || ''}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  const clusters = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, lst], i) => {
    const id = `c${String(i + 1).padStart(2, '0')}`; lst.forEach((s) => { s.c = id; });
    const [color, font, size, bg] = k.split('|');
    return { id, color, font, size: +size, bg, n: lst.length, labelish: lst.filter((s) => labelish(s.t)).length, samples: [...new Set(lst.map((s) => s.t))].slice(0, 14) };
  });
  return { spans: all, clusters };
}

// ---------------------------------------------------------------- значки по форме (подпись формы не зависит от поворота и разбивки линий)
export function shapeSig(pts, step = 0.3) {
  const cells = new Set(); const xs = []; const ys = [];
  for (const [x, y] of pts) { const k = `${Math.round(x / step)},${Math.round(y / step)}`; if (!cells.has(k)) { cells.add(k); xs.push(Math.round(x / step) * step); ys.push(Math.round(y / step) * step); } }
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  sxx /= n; syy /= n; sxy /= n;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  return { L: n * step, rg: Math.sqrt(tr), el: l1 > 0 ? l2 / l1 : 1, cx: mx, cy: my };
}
/** Все значки формы sig {color, L, rg, el, size}; hidden — функция «слой скрыт» */
export function findSymbols(paths, sig, tol = 0.15, hidden = () => false) {
  const size = sig.size;
  const L = paths.filter((p) => p.color === sig.color && !hidden(p.layer) && p.bbox[2] - p.bbox[0] <= size * 1.5 + 2 && p.bbox[3] - p.bbox[1] <= size * 1.5 + 2);
  const par = L.map((_, i) => i);
  const f = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const idx = L.map((_, i) => i).sort((a, b) => L[a].bbox[0] - L[b].bbox[0]); const gap = 1.5;
  for (let a = 0; a < idx.length; a++) {
    const i = idx[a];
    for (let b = a + 1; b < idx.length; b++) {
      const j = idx[b];
      if (L[j].bbox[0] > L[i].bbox[2] + gap) break;
      if (L[j].bbox[1] <= L[i].bbox[3] + gap && L[i].bbox[1] <= L[j].bbox[3] + gap) par[f(i)] = f(j);
    }
  }
  const comp = new Map(); L.forEach((p, i) => { const r = f(i); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(p); });
  const found = [];
  for (const c of comp.values()) {
    const bx0 = Math.min(...c.map((q) => q.bbox[0])), by0 = Math.min(...c.map((q) => q.bbox[1])), bx1 = Math.max(...c.map((q) => q.bbox[2])), by1 = Math.max(...c.map((q) => q.bbox[3]));
    if (Math.max(bx1 - bx0, by1 - by0) > size * 1.6 + 2) continue;
    const sg = shapeSig(c.flatMap((q) => q.pts)); if (!sg) continue;
    const dL = Math.abs(sg.L - sig.L) / sig.L, dR = Math.abs(sg.rg - sig.rg) / Math.max(0.5, sig.rg), dE = Math.abs(sg.el - sig.el);
    if (dL <= tol && dR <= tol && dE <= 0.15) found.push([sg.cx, sg.cy]);
  }
  return found;
}

// ---------------------------------------------------------------- шаблон по примерам (для «запомнить» ответа)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
export function generalize(samples) {
  const items = samples.map((x) => (x || '').replace(/ /g, '')).filter(Boolean);
  if (!items.length) return null;
  const shapes = new Map();
  for (const x of items) {
    const m = x.match(/^([A-Za-z]+\d*)\/(.*)$/); const pre = !!m; const tail = m ? m[2] : x;
    const toks = tail.match(/[A-Za-z]+|\d+|[^A-Za-z\d]/g) || [];
    const k = `${pre}|${toks.map((t) => (/[A-Za-z]/.test(t[0]) ? 'A' : /\d/.test(t[0]) ? '9' : t)).join('\u0001')}`;
    if (!shapes.has(k)) shapes.set(k, { pre, toks: [] }); shapes.get(k).toks.push(toks);
  }
  const pats = [];
  for (const { pre, toks } of [...shapes.values()].sort((a, b) => b.toks.length - a.toks.length).slice(0, 4)) {
    if (toks.length < Math.max(1, 0.05 * items.length)) continue;
    const parts = toks[0].map((t, i) => {
      if (/[A-Za-z]/.test(t[0])) { const vals = [...new Set(toks.map((q) => q[i]))].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)); return vals.length === 1 ? esc(vals[0]) : vals.length <= 4 ? `(?:${vals.map(esc).join('|')})` : '[A-Za-z]+'; }
      if (/\d/.test(t[0])) return '\\d+';
      return esc(t);
    });
    pats.push((pre ? '[A-Za-z]+\\d*\\/' : '') + parts.join(''));
  }
  const uniq = [...new Set(pats)];
  return uniq.length ? `^${uniq.length === 1 ? uniq[0] : `(?:${uniq.join('|')})`}$` : null;
}

// ---------------------------------------------------------------- сборка точек по правилам
function splitGlued(s) {
  const toks = [...s.t.matchAll(/\S+/g)]; const out = []; let pre = ''; const n = Math.max(1, s.t.length); const w = s.x1 - s.x0;
  for (const m of toks) {
    const tok = m[0];
    if (tok.endsWith('/') && tok.length <= 6) { pre = tok; continue; }
    out.push({ ...s, t: pre + tok, x0: s.x0 + w * m.index / n, x1: s.x0 + w * (m.index + tok.length) / n, splitFrom: s.t });
  }
  return out.length >= 2 || (out.length === 1 && pre) ? out : null;
}

/** spans + rules (как в map.json) → { points, report }. Поддержано: clusters/match/style/area/page, skip, near, by_icon, near_text, expand, dedupe #2, cabinet_regex. */
export function buildPoints(spans, rules, opts = {}) {
  const compiled = rules.map((r) => ({ ...r, rx: r.match ? new RegExp(r.match) : null }));
  const pick = (s, t) => compiled.find((r) => (!r.clusters || r.clusters.includes(s.c)) && (!r.rx || r.rx.test(t)) && (r.page == null || s.page === r.page)
    && (!r.area || ((s.x0 + s.x1) / 2 >= r.area[0] && (s.x0 + s.x1) / 2 <= r.area[2] && (s.y0 + s.y1) / 2 >= r.area[1] && (s.y0 + s.y1) / 2 <= r.area[3]))
    && (!r.style || Object.entries(r.style).every(([k, v]) => String(s[k] ?? '') === String(v)))) || null;
  const usedClusters = new Set(rules.flatMap((r) => r.clusters || []));
  const pts = []; const unknown = []; const skipped = {}; const nears = []; const byicon = []; const log = { split: [], expand: [], icon: [], near: [], nearText: [] };
  const queue = spans.slice(); const taken = [];
  while (queue.length) {
    const s = queue.shift(); const t = s.t.trim();
    let rule = pick(s, t);
    if (!rule && /\s/.test(t) && !s.splitFrom) {
      const parts = splitGlued(s);
      if (parts && parts.every((q) => { const r = pick(q, q.t); return r && !r.skip; })) { log.split.push(`«${t}» → ${parts.map((q) => q.t).join(', ')}`); queue.unshift(...parts); continue; }
    }
    if (!rule) { if (usedClusters.has(s.c) && labelish(t)) unknown.push(s); continue; }
    taken.push(s);
    if (rule.skip) { const k = rule.why || 'skip'; skipped[k] = (skipped[k] || 0) + 1; continue; }
    if (rule.near) { nears.push([s, rule]); continue; }
    const label = t.replace(/ /g, '');
    if (rule.by_icon) { byicon.push({ label, orig: t, s, rule }); continue; }
    const m = rule.expand ? label.match(/^(.*?[A-Za-z])(\d+)-(\d+)$/) : null;
    if (m && +m[2] < +m[3] && +m[3] <= +m[2] + 99) {
      const w = m[2].length; log.expand.push(`${label} → ${+m[3] - +m[2] + 1} точек`);
      for (let n = +m[2]; n <= +m[3]; n++) pts.push({ label: `${m[1]}${String(n).padStart(w, '0')}`, orig: t, typeId: rule.type, s, rule, note: `из подписи ${label} на чертеже` });
      continue;
    }
    pts.push({ label, orig: t, typeId: rule.type, s, rule });
  }
  // тип по значку рядом: каждый значок — одной подписи (ближайшей)
  if (byicon.length) {
    const groups = new Set(byicon.flatMap((b) => Object.keys(b.rule.by_icon)));
    const icn = spans.filter((x) => groups.has(x.c));
    const pairs = [];
    byicon.forEach((b, i) => { const md = b.rule.icon_dist ?? 60; icn.forEach((x, j) => { if (x.page === b.s.page && b.rule.by_icon[x.c]) { const d = edgeDist(b.s, ctr(x)); if (d <= md) pairs.push([d, i, j]); } }); });
    pairs.sort((a, b) => a[0] - b[0]);
    const got = new Map(); const used = new Set();
    for (const [d, i, j] of pairs) { if (got.has(i) || used.has(j)) continue; got.set(i, [j, d]); used.add(j); }
    byicon.forEach((b, i) => {
      if (got.has(i)) { const [j] = got.get(i); taken.push(icn[j]); b.typeId = b.rule.by_icon[icn[j].c]; pts.push(b); return; }
      if (!b.rule.type) { unknown.push(b.s); return; }
      log.icon.push(`⚠️ ${b.label}: значка рядом нет → «${b.rule.type}» по умолчанию — проверить`); b.typeId = b.rule.type; b.check = true; pts.push(b);
    });
  }
  // тип по тексту рядом (табличка двери)
  for (const p of pts) {
    const nt = p.rule.near_text; if (!nt) continue;
    for (const cond of nt) {
      const rx = new RegExp(cond.re); const dmax = cond.dist ?? 60;
      const hit = spans.find((x) => x.page === p.s.page && rx.test(x.t) && edgeDist(p.s, ctr(x)) <= dmax);
      if (hit) { p.typeId = cond.type; log.nearText.push(`${p.label} → ${cond.type}`); break; }
    }
  }
  // значок рядом с точкой другого типа (APA у интеркома): обозначение = точка + суффикс
  const used = {};
  for (const [s, r] of nears) {
    const cand = pts.filter((p) => p.typeId === r.near && p.s.page === s.page && !p.derived).sort((a, b) => dist(ctr(a.s), ctr(s)) - dist(ctr(b.s), ctr(s)));
    const best = cand[0]; const d1 = best ? dist(ctr(best.s), ctr(s)) : Infinity;
    if (!best || d1 > (r.max_dist ?? 120)) { log.near.push(`⚠️ ${s.t}: рядом нет «${r.near}» — не взято`); unknown.push(s); continue; }
    const base = best.label + (r.suffix || ''); used[base] = (used[base] || 0) + 1;
    pts.push({ label: used[base] === 1 ? base : `${base}${used[base]}`, orig: s.t, typeId: r.type, s, rule: r, derived: true, near: best.label });
  }
  // шкаф
  const cabRx = opts.cabinetRegex ? new RegExp(opts.cabinetRegex) : null;
  for (const p of pts) {
    if (p.rule.cabinet != null) { p.cabinet = p.rule.cabinet; continue; }
    if (p.rule.cab != null) { let m = null; try { m = p.rule.cab ? (p.near || p.label).match(new RegExp(p.rule.cab)) : null; } catch { /* плохой шаблон */ } p.cabinet = m?.[1] || ''; continue; }  // шкаф по своему шаблону правила ('' — шкафа нет)
    let cab = '';
    const src = p.near || p.label; const m = cabRx && src.match(cabRx); if (m) cab = m[1];
    p.cabinet = cab;
  }
  // дубли: одно обозначение в разных местах → #2; в одном месте — склеиваем
  const byl = new Map(); for (const p of pts) { const k = `${p.cabinet || ''}\u0000${p.label}`; if (!byl.has(k)) byl.set(k, []); byl.get(k).push(p); }   // одно обозначение в разных шкафах — разные точки
  const final = []; const dups = [];
  for (const lst of byl.values()) {
    const lab = lst[0].label;
    const keep = [lst[0]];
    for (const p of lst.slice(1)) if (keep.every((k) => Math.abs(p.s.x0 - k.s.x0) > 3 || Math.abs(p.s.y0 - k.s.y0) > 3 || p.s.page !== k.s.page)) keep.push(p);
    if (keep.length > 1) dups.push(`${lab}: ${keep.length} раза`);
    final.push(keep[0]);
    keep.slice(1).forEach((p, i) => final.push({ ...p, label: `${lab}#${i + 2}`, dup: true }));
  }
  const natkey = (l) => l.replace(/\d+/g, (d) => d.padStart(6, '0'));
  final.sort((a, b) => (a.cabinet || '').localeCompare(b.cabinet || '') || a.typeId.localeCompare(b.typeId) || natkey(a.label).localeCompare(natkey(b.label)));
  const floor = opts.floor || '';
  const points = final.map((p) => {
    const d = { label: p.label, typeId: p.typeId, cabinet: p.cabinet, floor };
    if (Array.isArray(p.rule.cables) && p.typeId === p.rule.type) d.cableOverride = p.rule.cables;  // свои кабели из правила (например «X2» — 2 кабеля)
    if (p.orig && p.orig.replace(/ /g, '') !== p.label && !p.note) d.planName = p.orig;
    const notes = [p.note, p.dup && 'повтор обозначения на чертеже — проверить', p.check && 'тип по умолчанию (значка рядом нет) — проверить'].filter(Boolean);
    if (notes.length) d.note = notes.join('; ');
    d.pos = { page: p.s.page, x: +((p.s.x0 + p.s.x1) / 2).toFixed(1), y: +((p.s.y0 + p.s.y1) / 2).toFixed(1), w: +(p.s.x1 - p.s.x0).toFixed(1), h: +(p.s.y1 - p.s.y0).toFixed(1) };
    return d;
  });
  return { points, unknown, skipped, dups, log, taken };
}

// ---------------------------------------------------------------- автономный разбор по каталогу
const inScope = (e, project) => !e.project || (!!project && String(project).toLowerCase().includes(e.project.toLowerCase()));

/** extracted (extractPdf) + каталог + ответы человека → { points, questions, learned, scale, hiddenLayers } */
export function autoParse(extracted, catalog, { floor = '', project = '', answers = {}, sheet = '' } = {}) {
  const { pages } = extracted;
  const { spans, clusters } = scanPages(pages);
  const cat = { labels: [], skip: [], symbols: [], ...catalog };
  // слои-мусор (для поиска значков и картинок)
  const layerStats = {}; pages.forEach((p) => Object.entries(p.layers).forEach(([n, e]) => { const t = (layerStats[n] ??= { n: 0, colors: {} }); t.n += e.n; Object.entries(e.colors).forEach(([c, k]) => { t.colors[c] = (t.colors[c] || 0) + k; }); }));
  const hiddenLayers = new Set(clutterLayers(layerStats)); const hidden = (l) => hiddenLayers.has(l);
  // масштаб: медиана высоты подписей, которые узнал каталог, относительно text_ref
  const labRx = cat.labels.filter((e) => inScope(e, project)).map((e) => new RegExp(e.re));
  const hs = spans.filter((x) => !x.c.startsWith?.('sym:') && labRx.some((r) => r.test(x.t.trim()))).map((x) => Math.min(x.x1 - x.x0, x.y1 - x.y0)).sort((a, b) => a - b);
  let k = hs.length >= 5 ? hs[Math.floor(hs.length / 2)] / (cat.text_ref || 7.8) : 1; if (!(k >= 0.2 && k <= 8)) k = 1;
  // значки из каталога
  for (const sym of cat.symbols.filter((e) => inScope(e, project))) {
    const sig = { ...sym, L: sym.L * k, rg: sym.rg * k, size: sym.size * k };
    pages.forEach((pg, pi) => {
      for (const [cx, cy] of findSymbols(pg.paths, sig, sym.tol ?? 0.15, hidden)) {
        const h = sig.size / 2; spans.push({ t: sym.name, x0: cx - h, y0: cy - h, x1: cx + h, y1: cy + h, color: sym.color, font: 'значок', size: 0, page: pi, c: `sym:${sym.name}` });
      }
    });
  }
  // правила каталога: мусор → подписи
  const catRules = [];
  for (const e of cat.skip.filter((x) => inScope(x, project))) catRules.push({ match: e.re, skip: true, why: e.why || 'каталог: не точка', ...(e.style ? { style: e.style } : {}) });
  for (const e of cat.labels.filter((x) => inScope(x, project))) {
    const { re, project: _p, note: _n, learned: _l, samples: _s, parts: _pp, ...r } = e;
    for (const kk of ['icon_dist', 'max_dist']) if (kk in r) r[kk] *= k;
    if (r.near_text) r.near_text = r.near_text.map((c) => ({ ...c, dist: (c.dist ?? 60) * k }));
    catRules.push({ ...r, match: re });
  }
  // незнакомое в каждой группе (то, о чём спрашиваем; ответ относится только к этим подписям)
  const ruleRx = catRules.filter((r) => r.match).map((r) => new RegExp(r.match));
  const known = (t) => ruleRx.some((r) => r.test(t.trim()));
  const bycl = new Map(); for (const s of spans) { if (!bycl.has(s.c)) bycl.set(s.c, []); bycl.get(s.c).push(s); }
  const freeOf = (cid) => (bycl.get(cid) || []).filter((s) => labelish(s.t) && !known(s.t));
  const rules = [];
  for (const [cid, ans] of Object.entries(answers)) {
    const texts = [...new Set(freeOf(cid).map((s) => s.t.trim()))]; if (!texts.length) continue;
    const a = typeof ans === 'object' ? ans : (ans === 'skip' ? { skip: true, why: 'ответ: не точки' } : { type: ans });
    rules.push({ ...a, clusters: [cid], match: `^(?:${texts.map((t) => esc(t)).join('|')})$` });
  }
  rules.push(...catRules);
  const res = buildPoints(spans, rules, { floor, cabinetRegex: cat.cabinet_regex });
  // вопросы: группы, где много «похожего на обозначения», а каталог узнал меньше 80%
  const questions = [];
  for (const c of clusters) {
    if (answers[c.id] != null) continue;
    const lst = bycl.get(c.id) || []; const lab = lst.filter((s) => labelish(s.t));
    if (lab.length < 3 || lab.length < 0.3 * lst.length) continue;
    const free = freeOf(c.id);
    if (lab.length - free.length >= 0.8 * lab.length) continue;
    questions.push({ cluster: c.id, n: free.length, samples: [...new Set(free.map((s) => s.t))].slice(0, 12), pattern: generalize(free.map((s) => s.t)),
      style: { color: c.color, size: c.size }, examples: free.slice(0, 6).map((s) => ({ page: s.page, x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 })) });
  }
  questions.sort((a, b) => b.n - a.n);
  // что запомнить: ответы → записи каталога (шаблон по примерам группы)
  const learned = [];
  for (const [cid, ans] of Object.entries(answers)) {
    const texts = freeOf(cid).map((s) => s.t.trim());
    if (!segment(texts).ok) continue;  // подписи разного вида (Z7, M24, 30x20(h)…) — общий шаблон был бы «сборной солянкой»: не запоминаем
    const pat = generalize(texts); if (!pat) continue;  // только незнакомые подписи — чтобы выученное не перебивало каталог
    const a = typeof ans === 'object' ? ans : (ans === 'skip' ? { skip: true } : { type: ans });
    const e = { re: pat, learned: true, samples: [...new Set(freeOf(cid).map((s) => s.t.trim()))].slice(0, 8), ...(project ? { project } : {}) };
    if (a.skip) learned.push({ kind: 'skip', cluster: cid, ...e }); else learned.push({ kind: 'labels', cluster: cid, ...e, ...a });
  }
  const data = { format: 'polevoy-points-1', source: sheet ? `${sheet}${floor ? `, этаж ${floor}` : ''}` : '', floor, points: res.points,
    sheet: { pdf: sheet, pages: pages.map((p) => ({ w: p.w, h: p.h })) } };
  return { data, questions, learned, scale: k, hiddenLayers: [...hiddenLayers], report: res };
}

/** Добавить выученное в каталог (копия) */
export function learnInto(catalog, learned) {
  const cat = { labels: [], skip: [], symbols: [], ...JSON.parse(JSON.stringify(catalog)) };
  let n = 0;
  for (const { kind, cluster: _c, ...e } of learned) {
    if (cat[kind].some((x) => (x.re ?? x.name) === (e.re ?? e.name) && x.project === e.project)) continue;
    cat[kind].unshift(e); n++;
  }
  return { catalog: cat, added: n };
}

/** Какое правило каталога сработает на подпись (порядок как в разборе: «не точки», потом подписи) → { kind: 'skip'|'label', rule, index } или null */
export function matchLabel(text, catalog, project = '') {
  const t = String(text || '').trim(); if (!t) return null;
  const test = (e) => { try { return new RegExp(e.re).test(t); } catch { return false; } };
  const si = (catalog.skip || []).findIndex((e) => inScope(e, project) && test(e));
  if (si >= 0) return { kind: 'skip', rule: catalog.skip[si], index: si };
  const li = (catalog.labels || []).findIndex((e) => inScope(e, project) && test(e));
  if (li >= 0) return { kind: 'label', rule: catalog.labels[li], index: li };
  return null;
}

/** Шаблон правила — по-человечески: ^[A-Za-z]+\d*\/C\-\d+$ → «шкаф/C-№» */
export function prettyRule(re) {
  return String(re || '').replace(/^\^/, '').replace(/\$$/, '')
    .replace(/\[A-Za-z\]\+\\d\*\\?\//g, 'шкаф/').replace(/\[A-Za-z\]\+/g, 'буквы').replace(/\\d\{(\d+)(?:,(\d+))?\}/g, (_, x, y) => `№(${y ? `${x}–${y}` : x})`).replace(/\\d\+/g, '№').replace(/\\d/g, '#')
    .replace(/\\s[*+]?/g, ' ').replace(/\(\?:/g, '(').replace(/\\(.)/g, '$1');
}
