// Выбор тохнита (PDF): из этого проекта, с Google Диска (папки «Чертежи» проектов приложения) или с устройства.
// Возвращает { name, buf, drawing?, fileId? } или null; с multiple: true — массив таких (несколько с Диска галочками или с устройства).
import { h, openModal, toast } from '../ui.js';
import { drawingsOf, drawingTitle, loadDrawing, listDrivePdfs, downloadDriveFile } from '../drawings.js';

export function pickPdf({ title = 'Тохнит (PDF)', project = true, extra = [], multiple = false } = {}) {  // extra — только что добавленные чертежи (могли ещё не дойти до списка проекта)
  return new Promise((resolve) => {
    let done = false; const finish = (v) => { if (done) return; done = true; c(); resolve(v); };
    const drive = h('div', {});
    const input = h('input', { type: 'file', accept: '.pdf,application/pdf', multiple, style: { display: 'none' }, onchange: async () => {
      const fs = [...(input.files || [])]; if (!fs.length) return;
      const got = await Promise.all(fs.map(async (f) => ({ name: f.name, buf: await f.arrayBuffer() })));
      finish(multiple ? got : got[0]);
    } });
    const own = project ? [...drawingsOf(), ...extra] : [];
    const seen = new Set(); for (let i = own.length - 1; i >= 0; i--) { const k = own[i].id || own[i].name; if (seen.has(k)) own.splice(i, 1); else seen.add(k); }
    const showDrive = async () => {
      drive.replaceChildren(h('div', { class: 'mut' }, 'Ищу на Google Диске…'));
      try {
        const files = await listDrivePdfs();
        if (multiple && files.length) {  // несколько: галочки + «Добавить отмеченные»
          const on = new Set(); const go = h('button', { disabled: true, onclick: async () => {
            go.disabled = true; const sel = files.filter((x) => on.has(x.id)); const got = [];
            for (const [i, x] of sel.entries()) { go.textContent = `Скачиваю ${i + 1} из ${sel.length}…`; try { got.push({ name: x.name, buf: await downloadDriveFile(x.id), fileId: x.id }); } catch (e) { toast(`«${x.name}»: ${e.message}`); } }
            finish(got);
          } }, 'Добавить отмеченные (0)');
          const label = () => { go.textContent = `Добавить отмеченные (${on.size})`; go.disabled = !on.size; };
          drive.replaceChildren(h('div', { class: 'picklist', style: { maxHeight: '40vh' } }, files.map((x) => {
            const cb = h('input', { type: 'checkbox', onchange: () => { cb.checked ? on.add(x.id) : on.delete(x.id); label(); } });
            return h('label', { class: 'pickrow' }, cb, h('span', {}, x.name, h('small', { class: 'mut' }, `${x.project ? `  · проект «${x.project}»` : ''}${x.size ? ` · ${(x.size / 1048576).toFixed(1)} МБ` : ''}`)));
          })), h('div', { class: 'btns' }, go));
          return;
        }
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
      h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: showDrive }, '☁️ Показать тохниты с Диска'), h('button', { onclick: () => input.click() }, multiple ? '📂 С устройства (можно несколько)' : '📂 С устройства'), input)),
      { onClose: () => { if (!done) { done = true; resolve(null); } } });
  });
}
