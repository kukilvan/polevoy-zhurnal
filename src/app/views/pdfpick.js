// Выбор тохнита (PDF): из этого проекта, с Google Диска (папки «Чертежи» проектов приложения) или с устройства.
// Возвращает { name, buf, drawing?, fileId? } или null.
import { h, openModal, toast } from '../ui.js';
import { drawingsOf, drawingTitle, loadDrawing, listDrivePdfs, downloadDriveFile } from '../drawings.js';

export function pickPdf({ title = 'Тохнит (PDF)', project = true, extra = [] } = {}) {  // extra — только что добавленные чертежи (могли ещё не дойти до списка проекта)
  return new Promise((resolve) => {
    let done = false; const finish = (v) => { if (done) return; done = true; c(); resolve(v); };
    const drive = h('div', {});
    const input = h('input', { type: 'file', accept: '.pdf,application/pdf', style: { display: 'none' }, onchange: async () => { const f = input.files?.[0]; if (f) finish({ name: f.name, buf: await f.arrayBuffer() }); } });
    const own = project ? [...drawingsOf(), ...extra] : [];
    const seen = new Set(); for (let i = own.length - 1; i >= 0; i--) { const k = own[i].id || own[i].name; if (seen.has(k)) own.splice(i, 1); else seen.add(k); }
    const showDrive = async () => {
      drive.replaceChildren(h('div', { class: 'mut' }, 'Ищу на Google Диске…'));
      try {
        const files = await listDrivePdfs();
        drive.replaceChildren(files.length ? h('div', { class: 'card', style: { padding: 0, maxHeight: '40vh', overflow: 'auto' } }, files.map((x) => h('div', { class: 'item', onclick: async () => {
          toast('Скачиваю с Диска…'); try { finish({ name: x.name, buf: await downloadDriveFile(x.id), fileId: x.id }); } catch (e) { toast(`Не получилось: ${e.message}`); }
        } }, h('div', { class: 'name' }, x.name, h('div', { class: 'sub' }, `${x.project ? `проект «${x.project}»` : ''}${x.size ? ` · ${(x.size / 1048576).toFixed(1)} МБ` : ''}`)))))
          : h('div', { class: 'mut' }, 'На Диске в папках приложения тохнитов нет'));
      } catch (e) { drive.replaceChildren(h('div', { class: 'mut' }, `Не получилось: ${e.message}`)); }
    };
    const c = openModal(title, h('div', {},
      own.length ? h('div', {}, h('div', { class: 'group', style: { padding: '4px 0' } }, 'В этом проекте'),
        h('div', { class: 'card', style: { padding: 0 } }, own.map((d) => h('div', { class: 'item', onclick: async () => {
          try { finish({ name: d.name, buf: await loadDrawing(d), drawing: d, fileId: d.fileId || null }); } catch (e) { toast(e.message); }
        } }, h('div', { class: 'name' }, drawingTitle(d), h('div', { class: 'sub' }, `${d.floor ? `этаж ${d.floor} · ` : ''}${d.name}`)))))) : null,
      h('div', { class: 'group', style: { padding: '8px 0 4px' } }, 'Google Диск'), drive,
      h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: showDrive }, '☁️ Показать тохниты с Диска'), h('button', { onclick: () => input.click() }, '📂 С устройства'), input)),
      { onClose: () => { if (!done) { done = true; resolve(null); } } });
  });
}
