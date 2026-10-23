// «🔗 Связать точки с чертежом»: разбор чертежа по каталогу → у точек проекта с такими же обозначениями появляется место на чертеже.
// Похожие названия (1A-01-02 ↔ 1A/01-02, Solar-B3-4 ↔ B/03-04) — спросить с картинкой: та же точка? заменить название?
// Что на чертеже осталось без пары — «Не размеченые» (видны в плане по фильтру; там же скрыть или связать вручную).
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { posOf, sameLabelClash } from '../../domain/index.js';
import { makeWorker, userCatalog } from './tohnitview.js';
import { importPreview } from './pointsfile.js';
import { drawingFor, updateDrawing, posKey } from '../drawings.js';
import { matchLabels } from '../../tohnit/linking.js';
import { assignOnPlan } from './planassign.js';
import { UNSORTED_TYPE } from '../../domain/index.js';
import { newId } from '../repo.js';

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
    const { exact, similar, unlinked, ambiguous } = matchLabels(cand, r.data.points);
    // подписи, которых не знает каталог (например, ответы на вопросы не запомнены): точное совпадение с названием точки проекта — тоже связываем
    const usedIds = new Set([...exact, ...similar].map((x) => x.p.id));
    const taken = new Set(r.data.points.map((f) => posKey(f.pos)));
    const texts = (await wk.call('texts')).filter((t) => !taken.has(posKey(t.pos)));
    const extraRes = matchLabels(cand.filter((p) => !usedIds.has(p.id)), texts);
    exact.push(...extraRes.exact); ambiguous.push(...extraRes.ambiguous);
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
    const msg = `Связано с чертежом: ${ops.length}${already ? `, уже были связаны: ${already}` : ''}. Похожих названий: ${similar.length}. Не размеченых на чертеже: ${fresh.length}.${ambiguous.length ? ` Номер в нескольких шкафах: ${ambiguous.length}.` : ''}`;
    const box = h('div', {});
    // отметки с номером, который есть в нескольких шкафах: распределяются на плане (результат — [{ item, cabinet }])
    let ambDone = null;
    const ambBtn = h('button', { class: 'sec', onclick: async () => { const r2 = await assignOnPlan({ wk, pages: sheet.pages, items: ambiguous, sheet: d.name }); if (r2) { ambDone = r2; ambBtn.textContent = `🗺 Распределено: ${r2.length} (изменить)`; } } }, `🗺 Распределить на плане (${ambiguous.length})`);
    const finish = async () => {
      if (ambiguous.length && !ambDone) {   // не оставляем без шкафа: сначала распределить
        ambDone = await assignOnPlan({ wk, pages: sheet.pages, items: ambiguous, sheet: d.name });
        if (!ambDone && !(await confirmDialog(`Не распределено отметок: ${ambiguous.length}. Выйти без привязки? Они останутся «Не размечеными».`, { yes: 'Выйти без привязки', no: 'Вернуться' }))) return;
      }
      const ops2 = []; const left = [...freshLeft];
      for (const { s, same, ren } of rows) {
        if (!same.checked) { left.push(s.f); continue; }
        const data = { pos: posOf(s.f, { sheet }) };
        if (ren.checked && !ren.disabled) { data.label = s.f.label; data.planName = s.p.label; } else if (s.p.label !== s.f.label) data.planName = s.f.label;
        ops2.push({ coll: 'points', id: s.p.id, data });
      }
      // распределённые на плане: точка с таким номером в выбранном шкафу — связать; нет такой — создать (в «Не уверен» тоже)
      let created = 0; let unsure = 0;
      if (ambDone) {
        const used = new Set([...exact.map((x) => x.p.id), ...ops2.map((o) => o.id)]); const made = new Map();
        for (const { item, cabinet } of ambDone) {
          const f = item.f; const same = pts.filter((p) => p.label === f.label && (p.cabinet || '') === cabinet);
          const free = same.find((p) => !used.has(p.id) && !elsewhere(p));
          if (free) { used.add(free.id); ops2.push({ coll: 'points', id: free.id, data: { pos: posOf(f, { sheet }) } }); }
          else if (!same.length) {
            const k = `${cabinet}\u0000${f.label}`; const n = made.get(k) || 0; made.set(k, n + 1);
            ops2.push({ coll: 'points', id: newId(), data: { label: n ? `${f.label}#${n + 1}` : f.label, typeId: item.cands[0]?.typeId || f.typeId || UNSORTED_TYPE, cabinet, floor: d.floor || undefined, pos: posOf(f, { sheet }), deleted: false,
              ...(cabinet === 'Не уверен' ? { note: 'шкаф не определён — перенесите в нужный' } : {}) } });
            created++; if (cabinet === 'Не уверен') unsure++;
          } else left.push(f);   // такая точка в этом шкафу уже есть, но занята другим местом — оставим «Не размеченой»
        }
      } else left.push(...ambiguous.map((x) => x.f));
      if (ops2.length) getRepo().save(currentProject().id, ops2);
      saveUnlinked(left);
      toast(`Связано ещё: ${ops2.length}${created ? ` (новых точек: ${created}${unsure ? `, в шкафу «Не уверен»: ${unsure}` : ''})` : ''}. Не размеченые (${left.length}) — в плане, фильтр «Не размеченые»`);
      closed = true; close(); wk.stop(); onDone?.();
    };
    const close = openModal('🔗 Точки и чертёж', h('div', {},
      h('div', { style: { fontWeight: 600, margin: '4px 0 8px' } }, msg),
      ambiguous.length ? h('div', { class: 'card', style: { margin: '8px 0', borderColor: '#ff9f0a' } }, h('b', {}, `Номер есть в нескольких шкафах: ${ambiguous.length} отметок`), h('div', { class: 'mut', style: { margin: '4px 0' } }, 'Шкаф у подписи на чертеже не указан. Откройте весь план, выберите отметки (рамкой или по одной) и укажите шкаф; сомнительные можно положить в шкаф «Не уверен».'), h('div', { class: 'btns' }, ambBtn)) : null,
      rows.length ? h('div', {}, h('div', { class: 'mut' }, 'Похожие названия: в проекте и на чертеже по-разному написано (разделители, лишнее начало). Отметьте, где это одна и та же точка; можно сразу переименовать точку как на чертеже — номер изменится, история работ у точки останется.'), ...rows.map((x) => x.el)) : null,
      fresh.length ? h('div', { class: 'mut', style: { margin: '8px 0 4px' } }, `Есть на чертеже, нет в проекте: ${fresh.slice(0, 12).map((p) => p.label).join(', ')}${fresh.length > 12 ? '…' : ''}. Они останутся «Не размечеными» — в плане их можно скрыть или связать с точкой вручную, или добавить как новые:`) : null,
      fresh.length ? h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => box.replaceChildren(importPreview({ ...r.data, points: fresh }, d.name, () => { freshLeft = []; box.replaceChildren(h('div', { class: 'mut' }, 'Добавлено. Нажмите «Готово».')); })) }, `➕ Добавить как новые точки (${fresh.length})`)) : null,
      box, h('div', { class: 'btns' }, h('button', { onclick: finish }, 'Готово'))), { sticky: true, onClose: () => { if (!closed) { saveUnlinked([...freshLeft, ...similar.map((x) => x.f), ...ambiguous.map((x) => x.f)]); wk.stop(); onDone?.(); } } });
  } catch (e) { wk.stop(); throw e; }
}
