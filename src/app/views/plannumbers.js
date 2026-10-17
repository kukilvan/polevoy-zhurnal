// «📄 PDF с номерами»: чертёж + номера точек цветом по типу + страница-легенда; файл сохраняется на устройство.
import { makeWorker } from './tohnitview.js';
import { toast } from '../ui.js';
import { currentProject } from '../store.js';
import { drawingTitle, putNumbered } from '../drawings.js';

export async function exportNumberedPdf(drawing, buf, points) {
  if (!points.length) { toast('На этом чертеже нет точек'); return; }
  const wk = makeWorker();
  try {
    const out = await wk.call('numbered', { data: buf.slice(0), title: drawingTitle(drawing), points: points.map((p) => ({ label: p.label, typeId: p.typeId, pos: p.pos })), icons: currentProject()?.typeIcons || {} });
    const name = `${drawingTitle(drawing).replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_')}_с_номерами.pdf`;
    const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(`Готово: ${name}`);
    // и на Диск — в папку проекта «Чертежи с номерами» (заменяет прошлую версию)
    putNumbered(name, out).then((id) => { if (id) toast(`«${name}» обновлён на Google Диске (Чертежи с номерами)`); }).catch((e) => toast(`На Диск не получилось: ${e.message}`));
  } finally { wk.stop(); }
}
