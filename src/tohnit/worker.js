// Фоновый разбор чертежа (Web Worker): тяжёлое чтение PDF не тормозит экран. Команды:
// open {data} → {pages, ms}; parse {catalog, opts} → результат autoParse; crop {page, clip, zoom} → PNG (Uint8Array)
import { extractPdf, loadMupdf } from './extract.js';
import { autoParse } from './engine.js';

let extracted = null; let doc = null; let hiddenSet = null;

self.onmessage = async (e) => {
  const { id, cmd, ...a } = e.data;
  try {
    let res;
    if (cmd === 'open') {
      const t0 = Date.now(); const mupdf = await loadMupdf();
      const bytes = new Uint8Array(a.data);
      extracted = await extractPdf(bytes.slice());
      doc = mupdf.Document.openDocument(bytes, 'application/pdf'); hiddenSet = null;
      res = { pages: extracted.pages.map((p) => ({ w: p.w, h: p.h })), ms: Date.now() - t0 };
    } else if (cmd === 'parse') {
      res = autoParse(extracted, a.catalog, a.opts);
      if (doc && JSON.stringify(res.hiddenLayers) !== JSON.stringify(hiddenSet)) {  // мусорные слои — скрыть и на картинках
        hiddenSet = res.hiddenLayers; const pdf = doc.asPDF?.() || doc; const hs = new Set(hiddenSet);
        try { for (let i = 0; i < pdf.countLayers(); i++) pdf.setLayerVisible(i, !hs.has(pdf.getLayerName(i))); } catch { /* без слоёв */ }
      }
      delete res.report.taken; delete res.report.unknown;
    } else if (cmd === 'crop') {
      const mupdf = await loadMupdf(); const page = doc.loadPage(a.page); const z = a.zoom || 4;
      const M = mupdf.Matrix.scale(z, z); const [x0, y0, x1, y1] = a.clip;
      const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [Math.floor(x0 * z), Math.floor(y0 * z), Math.ceil(x1 * z), Math.ceil(y1 * z)], false);
      pix.clear(255); const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix); page.run(dev, M); dev.close();
      res = pix.asPNG();
    }
    self.postMessage({ id, ok: true, res });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
