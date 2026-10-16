// Фоновый разбор чертежа (Web Worker): тяжёлое чтение PDF не тормозит экран. Команды:
// open {data} → {pages, ms}; parse {catalog, opts} → результат autoParse; crop {page, clip, zoom} → PNG (Uint8Array); pick {page, x, y} → такие же значки
import { extractPdf, loadMupdf } from './extract.js';
import { autoParse, scanPages } from './engine.js';
import { pickSimilar } from './icons.js';
import { numberedPdf } from './numbered.js';

let extracted = null; let doc = null; let hiddenSet = null; let scanned = null;
let lists = new Map();  // страница → готовый «список рисования» (рисовать куски листа в 2–3 раза быстрее)

self.onmessage = async (e) => {
  const { id, cmd, ...a } = e.data;
  try {
    let res;
    if (cmd === 'open') {
      const t0 = Date.now(); const mupdf = await loadMupdf();
      const bytes = new Uint8Array(a.data);
      extracted = await extractPdf(bytes.slice());
      doc = mupdf.Document.openDocument(bytes, 'application/pdf'); hiddenSet = null; scanned = null; lists = new Map();
      res = { pages: extracted.pages.map((p) => ({ w: p.w, h: p.h })), ms: Date.now() - t0 };
    } else if (cmd === 'openDoc') {  // только показать (план): без разбора текста
      const mupdf = await loadMupdf(); doc = mupdf.Document.openDocument(new Uint8Array(a.data), 'application/pdf'); extracted = null; scanned = null; hiddenSet = null; lists = new Map();
      res = { pages: Array.from({ length: doc.countPages() }, (_, i) => { const b = doc.loadPage(i).getBounds(); return { w: b[2] - b[0], h: b[3] - b[1] }; }) };
    } else if (cmd === 'parse') {
      res = autoParse(extracted, a.catalog, a.opts);
      if (doc && JSON.stringify(res.hiddenLayers) !== JSON.stringify(hiddenSet)) {  // мусорные слои — скрыть и на картинках
        hiddenSet = res.hiddenLayers; const pdf = doc.asPDF?.() || doc; const hs = new Set(hiddenSet);
        try { for (let i = 0; i < pdf.countLayers(); i++) pdf.setLayerVisible(i, !hs.has(pdf.getLayerName(i))); } catch { /* без слоёв */ }
        lists = new Map();
      }
      delete res.report.taken; delete res.report.unknown;
    } else if (cmd === 'pick') {  // что под пальцем и где ещё такое же
      scanned ??= scanPages(extracted.pages).spans;
      const hs = new Set(hiddenSet || []);
      res = pickSimilar(scanned, extracted.pages, a.page, a.x, a.y, { hidden: (l) => hs.has(l), pad: a.pad ?? 3 });
    } else if (cmd === 'numbered') {  // PDF с номерами
      res = numberedPdf(await loadMupdf(), new Uint8Array(a.data), a.points, { title: a.title });
    } else if (cmd === 'crop') {
      const mupdf = await loadMupdf(); const z = a.zoom || 4;
      if (!lists.has(a.page)) lists.set(a.page, doc.loadPage(a.page).toDisplayList());
      const M = mupdf.Matrix.scale(z, z); const [x0, y0, x1, y1] = a.clip;
      const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [Math.floor(x0 * z), Math.floor(y0 * z), Math.ceil(x1 * z), Math.ceil(y1 * z)], !!a.raw);
      pix.clear(255); const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix); lists.get(a.page).run(dev, M); dev.close();
      if (a.raw) {  // сырые пиксели RGBA: без сжатия в PNG и распаковки — быстрее
        const px = pix.getPixels(); const out = new Uint8ClampedArray(px.length); out.set(px);
        self.postMessage({ id, ok: true, res: { w: pix.getWidth(), h: pix.getHeight(), data: out } }, [out.buffer]); return;
      }
      res = pix.asPNG();
    }
    self.postMessage({ id, ok: true, res });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
