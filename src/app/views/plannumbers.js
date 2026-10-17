// «📄 PDF с номерами»: чертёж как план в приложении (рамки цвета статуса, подписи без наложений, скрытое — белым) + легенда.
// Скачать на устройство — отдельно; на Google Диск — отдельно («☁️ На Диск»), дальше сервер обновляет его каждую ночь, если что-то поменялось.
import { makeWorker } from './tohnitview.js';
import { toast } from '../ui.js';
import { state, currentProject, getRepo } from '../store.js';
import { drawingTitle, putNumbered, shareWithServer, updateDrawing } from '../drawings.js';
import { numberedInput, numberedHash } from '../../domain/index.js';

export const numberedName = (d) => `${drawingTitle(d).replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_')}_с_номерами.pdf`;
export async function build(drawing, buf, { title = drawingTitle(drawing), lang = 'ru', quiet = false } = {}) {
  const input = numberedInput(state.ctx.points.values(), state.ctx, drawing);
  if (!input.length) { if (!quiet) toast('На этом чертеже нет точек'); return null; }
  const icons = currentProject()?.typeIcons || {};
  const typeNames = Object.fromEntries([...state.ctx.types.values()].map((t) => [t.id, t.nameHe || t.id]));
  const updated = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' });
  const wk = makeWorker();
  try {
    const out = await wk.call('numbered', { data: buf.slice(0), title, points: input, icons, hidden: drawing.hidden || [], lang, typeNames, updated });
    return { out, hash: numberedHash(input, { ...drawing, title }, icons, lang) };
  } finally { wk.stop(); }
}

/** Скачать на это устройство */
export async function exportNumberedPdf(drawing, buf) {
  toast('Готовлю PDF…');
  const r = await build(drawing, buf); if (!r) return;
  const name = numberedName(drawing);
  const url = URL.createObjectURL(new Blob([r.out], { type: 'application/pdf' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast(`Готово: ${name}`);
}

/** На Google Диск (папка проекта «Чертежи с номерами»), без скачивания; открыть доступ серверу для ночного обновления */
export async function publishNumbered(drawing, buf) {
  toast('Готовлю PDF для Диска…');
  const r = await build(drawing, buf); if (!r) return;
  const p = currentProject(); const name = numberedName(drawing);
  const id = await putNumbered(name, r.out, p, drawing.numberedFileId || '');
  if (!id) { toast('На iPhone сначала дайте доступ к Google Диску (например, «💾 Резервная копия на Диск»), потом повторите'); return; }
  const patch = { numberedFileId: id, numberedHash: r.hash, numberedAt: new Date().toISOString() };
  if (p.serverEmail && drawing.numberedServer !== p.serverEmail) {
    try { await shareWithServer(id, p.serverEmail, 'writer'); await shareWithServer(drawing.fileId, p.serverEmail, 'reader'); patch.numberedServer = p.serverEmail; } catch (e) { console.warn('share server', e); }
  }
  updateDrawing(drawing.id, patch);
  toast(`«${name}» на Google Диске (Чертежи с номерами). Дальше он обновляется сам каждую ночь, если что-то поменялось.`);
  void getRepo;
}
