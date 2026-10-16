// «📄 PDF с номерами»: чертёж + номера точек цветом по типу + страница-легенда; файл сохраняется на устройство.
import { makeWorker } from './tohnitview.js';
import { toast } from '../ui.js';

export async function exportNumberedPdf(drawing, buf, points) {
  if (!points.length) { toast('На этом чертеже нет точек'); return; }
  const wk = makeWorker();
  try {
    const out = await wk.call('numbered', { data: buf.slice(0), title: drawing.name, points: points.map((p) => ({ label: p.label, typeId: p.typeId, pos: p.pos })) });
    const name = `${drawing.name.replace(/\.pdf$/i, '')}_с_номерами.pdf`;
    const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(`Готово: ${name}`);
  } finally { wk.stop(); }
}
