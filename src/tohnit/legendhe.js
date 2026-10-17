// Легенда «PDF с номерами» на иврите: страница рисуется отдельно (DocumentWriter + встроенный шрифт иврита) и вставляется в документ.
// Строки справа налево: куски на иврите выводятся шрифтом иврита в обратном порядке букв, цифры и латиница — Helvetica.
import { HE_FONT_B64 } from './hefont.js';

const HE = /[֐-׿]/;
const b64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
let fonts = null;
const getFonts = (mupdf) => (fonts ??= { he: new mupdf.Font('NotoSansHebrew', b64(HE_FONT_B64)), lat: new mupdf.Font('Helvetica') });

// Упрощённый bidi для строки справа налево: буквы иврита — RTL, латиница и цифры — LTR; знаки и пробелы — по соседям
// (если с обеих сторон LTR — LTR, иначе RTL). Возвращает символы в порядке слева направо (как рисовать) со шрифтом.
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '<': '>', '>': '<' };
const LTR = /[A-Za-z0-9\u00C0-\u024F\u0400-\u04FF]/;
export function visualOrder(s) {
  const ch = [...s]; const dir = ch.map((c) => (HE.test(c) ? 'R' : LTR.test(c) ? 'L' : null));
  for (let i = 0; i < ch.length; i++) {
    if (dir[i]) continue;
    let a = null; for (let j = i - 1; j >= 0; j--) if (HE.test(ch[j]) || LTR.test(ch[j])) { a = HE.test(ch[j]) ? 'R' : 'L'; break; }
    let b = null; for (let j = i + 1; j < ch.length; j++) if (HE.test(ch[j]) || LTR.test(ch[j])) { b = HE.test(ch[j]) ? 'R' : 'L'; break; }
    dir[i] = a === 'L' && b === 'L' ? 'L' : 'R';
  }
  const runs = []; ch.forEach((c, i) => { const last = runs[runs.length - 1]; if (last && last.d === dir[i]) last.c.push(c); else runs.push({ d: dir[i], c: [c] }); });
  const out = [];
  for (const r of runs.reverse()) { if (r.d === 'R') out.push(...r.c.reverse().map((c) => MIRROR[c] || c)); else out.push(...r.c); }
  return out;
}

/** Страницы легенды: lines — [{ text, size, color:[r,g,b], swatch?:[r,g,b] }] → PDF (Uint8Array) */
export function legendPdfHe(mupdf, lines, { W = 842, H = 595 } = {}) {
  const f = getFonts(mupdf);
  const width = (font, s, size) => [...s].reduce((a, ch) => a + font.advanceGlyph(font.encodeCharacter(ch.codePointAt(0)), 0) * size, 0);
  const buf = new mupdf.Buffer(); const w = new mupdf.DocumentWriter(buf, 'pdf', '');
  let dev = null; let y = 0;
  const page = () => { if (dev) w.endPage(); dev = w.beginPage([0, 0, W, H]); y = 40; };
  for (const ln of lines) {
    if (!dev || y + ln.size * 1.7 > H - 30) page();
    let x = W - 30;
    if (ln.swatch) { const p = new mupdf.Path(); p.rect(x - ln.size, y - ln.size * 0.8, x, y + ln.size * 0.1); dev.fillPath(p, false, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, ln.swatch, 1); x -= ln.size * 1.6; }
    const t = new mupdf.Text(); const vis = visualOrder(ln.text);
    const fontOf = (c) => (HE.test(c) ? f.he : f.lat);
    let cx = x - vis.reduce((a, c) => a + width(fontOf(c), c, ln.size), 0);
    for (const c of vis) { const font = fontOf(c); t.showString(font, mupdf.Matrix.concat(mupdf.Matrix.scale(ln.size, -ln.size), mupdf.Matrix.translate(cx, y)), c); cx += width(font, c, ln.size); }
    dev.fillText(t, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, ln.color || [0, 0, 0], 1);
    y += ln.size * 1.7;
  }
  if (dev) w.endPage(); w.close();
  return buf.asUint8Array();
}
