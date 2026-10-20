// «🔗 Связать точки с чертежом»: разбор чертежа по каталогу → у точек проекта с такими же обозначениями появляется место на чертеже.
// Похожие названия (1A-01-02 ↔ 1A/01-02, Solar-B3-4 ↔ B/03-04) — спросить с картинкой: та же точка? заменить название?
// Что на чертеже осталось без пары — «Не размеченые» (видны в плане по фильтру; там же скрыть или связать вручную).
import { h, openModal, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { posOf, sameLabelClash } from '../../domain/index.js';
import { makeWorker, userCatalog } from './tohnitview.js';
import { importPreview } from './pointsfile.js';
import { drawingFor, updateDrawing, posKey } from '../drawings.js';
import { matchLabels } from '../../tohnit/linking.js';

export async function linkPoints(d, buf, { onDone } = {}) {
  const wk = makeWorker(); let closed = false;
  try {
    toast('Ищу точки проекта на чертеже…');
    await wk.call('open', { data: buf.slice(0) });
    const r = await wk.call('parse', { catalog: userCatalog(), opts: { floor: d.floor || '', project: currentProject()?.name || '', answers: {}, sheet: d.name } });
    const sheet = { pdf: d.name, pages: r.data.sheet.pages };
    const pts = [...state.ctx.points.values()];
    const onThis = (p) => p.pos?.sheet === d.name || (d.aliases || []).includes(p.pos?.sheet);
    const elsewhere = (p) => p.pos?.sheet && !onThis(p) && drawingFor(p);  // уже на другом чертеже проекта — не трогаем
    const cand = pts.filter((p) => !elsewhere(p));
    const { exact, similar, unlinked } = matchLabels(cand, r.data.points);
    // подписи, которых не знает каталог (например, ответы на вопросы не запомнены): точное совпадение с названием точки проекта — тоже связываем
    const usedIds = new Set([...exact, ...similar].map((x) => x.p.id));
    const taken = new Set(r.data.points.map((f) => posKey(f.pos)));
    const texts = (await wk.call('texts')).filter((t) => !taken.has(posKey(t.pos)));
    const extra = matchLabels(cand.filter((p) => !usedIds.has(p.id)), texts).exact;
    exact.push(...extra);
    const ops = []; let already = 0;
    for (const { p, f } of exact) { if (onThis(p)) { already++; continue; } ops.push({ coll: 'points', id: p.id, data: { pos: posOf(f, { sheet }) } }); }
    if (ops.length) getRepo().save(currentProject().id, ops);
    const hiddenKeys = new Set((d.hidden || []).map((x) => posKey(x.pos)));
    const saveUnlinked = (list) => updateDrawing(d.id, { unlinked: list.filter((f) => !hiddenKeys.has(posKey(f.pos))).map((f) => ({ label: f.label, typeId: f.typeId || '', pos: posOf(f, { sheet }) })) });
    const fresh = unlinked; let freshLeft = fresh;  // после «Добавить как новые» — пусто

    // похожие пары: подтвердить
    const rows = similar.map((s) => {
      const same = h('input', { type: 'checkbox', checked: s.kind === 'same' });
      const canRename = !pts.some((x) => x.id !== s.p.id && sameLabelClash(x, { label: s.f.label, cabinet: s.p.cabinet }));
      const ren = h('input', { type: 'checkbox', checked: false, disabled: !canRename });
      const img = h('div', { style: { minHeight: '40px' } });
      const pad = 40; const p0 = s.f.pos; const clip = [p0.x - p0.w / 2 - pad, p0.y - p0.h / 2 - pad, p0.x + p0.w / 2 + pad, p0.y + p0.h / 2 + pad]; const zoom = Math.min(6, 300 / (clip[2] - clip[0]));
      wk.call('crop', { page: p0.page || 0, clip, zoom }).then(async (png) => {
        const im = new Image(); im.src = URL.createObjectURL(new Blob([png], { type: 'image/png' })); await im.decode();
        const cv = h('canvas', { width: im.width, height: im.height, style: { maxWidth: '100%', background: '#fff', borderRadius: '6px' } }); const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
        g.strokeStyle = '#e0007a'; g.lineWidth = 3; g.strokeRect(pad * zoom - 4, pad * zoom - 4, p0.w * zoom + 8, p0.h * zoom + 8); img.replaceChildren(cv);
      }).catch(() => {});
      return { s, same, ren, el: h('div', { class: 'card', style: { margin: '6px 0' } },
        h('div', { style: { fontWeight: 600 } }, `${s.p.label}  ↔  ${s.f.label} (на чертеже)`), img,
        h('label', { class: 'pickrow' }, same, h('span', {}, 'Это одна и та же точка')),
        h('label', { class: 'pickrow' }, ren, h('span', {}, canRename ? `Переименовать точку в «${s.f.label}» (как на чертеже)` : `Переименовать нельзя — «${s.f.label}» уже есть в этом шкафу`))) };
    });
    const msg = `Связано с чертежом: ${ops.length}${already ? `, уже были связаны: ${already}` : ''}. Похожих названий: ${similar.length}. Не размеченых на чертеже: ${fresh.length}.`;
    const box = h('div', {});
    const finish = () => {
      const ops2 = []; const left = [...freshLeft];
      for (const { s, same, ren } of rows) {
        if (!same.checked) { left.push(s.f); continue; }
        const data = { pos: posOf(s.f, { sheet }) };
        if (ren.checked && !ren.disabled) { data.label = s.f.label; data.planName = s.p.label; } else if (s.p.label !== s.f.label) data.planName = s.f.label;
        ops2.push({ coll: 'points', id: s.p.id, data });
      }
      if (ops2.length) getRepo().save(currentProject().id, ops2);
      saveUnlinked(left);
      toast(`Связано ещё: ${ops2.length}. Не размеченые (${left.length}) — в плане, фильтр «Не размеченые»`);
      closed = true; close(); wk.stop(); onDone?.();
    };
    const close = openModal('🔗 Точки и чертёж', h('div', {},
      h('div', { style: { fontWeight: 600, margin: '4px 0 8px' } }, msg),
      rows.length ? h('div', {}, h('div', { class: 'mut' }, 'Похожие названия: в проекте и на чертеже по-разному написано (разделители, лишнее начало). Отметьте, где это одна и та же точка; можно сразу переименовать точку как на чертеже — номер изменится, история работ у точки останется.'), ...rows.map((x) => x.el)) : null,
      fresh.length ? h('div', { class: 'mut', style: { margin: '8px 0 4px' } }, `Есть на чертеже, нет в проекте: ${fresh.slice(0, 12).map((p) => p.label).join(', ')}${fresh.length > 12 ? '…' : ''}. Они останутся «Не размечеными» — в плане их можно скрыть или связать с точкой вручную, или добавить как новые:`) : null,
      fresh.length ? h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => box.replaceChildren(importPreview({ ...r.data, points: fresh }, d.name, () => { freshLeft = []; box.replaceChildren(h('div', { class: 'mut' }, 'Добавлено. Нажмите «Готово».')); })) }, `➕ Добавить как новые точки (${fresh.length})`)) : null,
      box, h('div', { class: 'btns' }, h('button', { onclick: finish }, 'Готово'))), { sticky: true, onClose: () => { if (!closed) { saveUnlinked([...freshLeft, ...similar.map((x) => x.f)]); wk.stop(); onDone?.(); } } });
  } catch (e) { wk.stop(); throw e; }
}
