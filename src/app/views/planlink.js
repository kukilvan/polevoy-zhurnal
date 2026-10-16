// «🔗 Связать точки с чертежом»: разбор чертежа по каталогу → у точек проекта с такими же обозначениями появляется место на чертеже.
// Нужен, когда чертёж добавлен в проект, где точки уже есть (например, внесены раньше из файла).
import { h, openModal, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { posOf } from '../../domain/index.js';
import { makeWorker, userCatalog } from './tohnitview.js';
import { importPreview } from './pointsfile.js';
import { drawingFor } from '../drawings.js';

const base = (l) => String(l || '').replace(/#\d+$/, '').replace(/\s+/g, '').toUpperCase().replace(/(^|\D)0+(\d)/g, '$1$2');  // GC/013 = GC/13

export async function linkPoints(d, buf, { quiet = false, onDone } = {}) {
  const wk = makeWorker();
  try {
    toast('Ищу точки проекта на чертеже…');
    await wk.call('open', { data: buf.slice(0) });
    const r = await wk.call('parse', { catalog: userCatalog(), opts: { floor: d.floor || '', project: currentProject()?.name || '', answers: {}, sheet: d.name } });
    const found = r.data.points; const sheet = { pdf: d.name, pages: r.data.sheet.pages };
    const pts = [...state.ctx.points.values()];
    const byLabel = new Map(); pts.forEach((p) => { [p.label, p.planName].filter(Boolean).forEach((l) => { const k = base(l); if (!byLabel.has(k)) byLabel.set(k, []); byLabel.get(k).push(p); }); });
    const ops = []; const used = new Set(); let already = 0; const fresh = [];
    for (const f of found) {
      const cand = (byLabel.get(base(f.label)) || []).filter((p) => !used.has(p.id));
      if (!cand.length) { fresh.push(f); continue; }
      // «#2» на чертеже — второй экземпляр: берём точку с тем же номером повтора, иначе первую свободную
      const p = cand.find((x) => x.label === f.label) || cand[0]; used.add(p.id);
      const other = p.pos?.sheet && p.pos.sheet !== d.name && drawingFor(p);  // уже на другом чертеже проекта — не трогаем
      if (other) continue;
      if (p.pos?.sheet === d.name || (d.aliases || []).includes(p.pos?.sheet)) { already++; continue; }
      ops.push({ coll: 'points', id: p.id, data: { pos: posOf(f, { sheet }) } });
    }
    if (ops.length) getRepo().save(currentProject().id, ops);
    const floorPts = pts.filter((p) => !used.has(p.id) && (!d.floor || String(p.floor || '') === String(d.floor)) && !p.pos);
    const msg = `Связано с чертежом: ${ops.length}${already ? `, уже были связаны: ${already}` : ''}. На чертеже, но нет в проекте: ${fresh.length}.`;
    if (quiet && !fresh.length) { toast(msg); onDone?.(); return; }
    const box = h('div', {});
    const close = openModal('🔗 Точки и чертёж', h('div', {},
      h('div', { style: { fontWeight: 600, margin: '4px 0 8px' } }, msg),
      floorPts.length ? h('div', { class: 'mut' }, `Точки проекта${d.floor ? ` этажа ${d.floor}` : ''} без места на чертеже: ${floorPts.length} (${floorPts.slice(0, 8).map((p) => p.label).join(', ')}${floorPts.length > 8 ? '…' : ''}). Их подписи на этом чертеже не нашлись — например, значки без номеров: отметьте их через «✏️ Редактировать».`) : null,
      fresh.length ? h('div', {}, h('div', { class: 'mut', style: { margin: '8px 0 4px' } }, `Есть на чертеже, нет в проекте: ${fresh.slice(0, 12).map((p) => p.label).join(', ')}${fresh.length > 12 ? '…' : ''}`),
        h('div', { class: 'btns' }, h('button', { onclick: () => box.replaceChildren(importPreview({ ...r.data, points: fresh }, d.name, () => { close(); onDone?.(); })) }, `➕ Проверить и добавить (${fresh.length})`))) : null,
      box, h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => { close(); onDone?.(); } }, 'Готово'))), { sticky: true });
  } finally { wk.stop(); }
}
