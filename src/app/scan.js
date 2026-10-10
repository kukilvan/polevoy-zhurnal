// Сканер штрихкодов и QR для серийного номера / MAC: живая камера или фото из галереи.
// Библиотека (zxing) подгружается только при первом открытии сканера.
import { h, openModal } from './ui.js';
import { candidatesFor, normalizeMac } from '../domain/index.js';

async function lib() {
  const [z, b] = await Promise.all([import('@zxing/library'), import('@zxing/browser')]);
  const hints = new Map();
  hints.set(z.DecodeHintType.TRY_HARDER, true);
  // только форматы, которыми печатают серийники и MAC; лишние форматы дают случайные «числа» из шума
  hints.set(z.DecodeHintType.POSSIBLE_FORMATS, [z.BarcodeFormat.QR_CODE, z.BarcodeFormat.CODE_128, z.BarcodeFormat.DATA_MATRIX]);
  return { z, b, hints };
}

// Читаем код, закрашиваем его белым и ищем следующий: так находятся и штрихкод, и QR на одной наклейке
function decodeAll(c, reader, L, found) {
  const g = c.getContext('2d');
  for (let n = 0; n < 5; n += 1) {
    let res = null;
    for (const inv of [false, true]) {
      try {
        const src = new L.z.HTMLCanvasElementLuminanceSource(c);
        res = reader.decode(new L.z.BinaryBitmap(new L.z.HybridBinarizer(inv ? src.invert() : src))); break;
      } catch { res = null; }
    }
    if (!res) return;
    const t = res.getText(); if (t && !found.includes(t)) found.push(t);
    const pts = res.getResultPoints() || [];
    if (!pts.length) return;
    const xs = pts.map((q) => q.getX()); const ys = pts.map((q) => q.getY());
    const len = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const pad = Math.max(12, len * 0.3);
    g.fillStyle = '#fff';
    g.fillRect(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad);
  }
}
const newReader = (L) => { const r = new L.z.MultiFormatReader(); r.setHints(L.hints); return r; };

// Все коды на фотографии: целиком и по частям
async function decodePhoto(file, L) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Не удалось открыть фото')); i.src = url; });
    const scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    const W = Math.round(img.naturalWidth * scale); const H = Math.round(img.naturalHeight * scale);
    const reader = newReader(L); const found = [];
    const tile = (x, y, w, hh) => {
      const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(hh);
      c.getContext('2d').drawImage(img, x / scale, y / scale, w / scale, hh / scale, 0, 0, c.width, c.height);
      decodeAll(c, reader, L, found);
    };
    const tiles = [[0, 0, W, H], [0, 0, W / 2, H], [W / 2, 0, W / 2, H], [0, 0, W, H / 2], [0, H / 2, W, H / 2],
      [0, 0, W / 2, H / 2], [W / 2, 0, W / 2, H / 2], [0, H / 2, W / 2, H / 2], [W / 2, H / 2, W / 2, H / 2],
      [W / 4, H / 4, W / 2, H / 2]];
    for (const t of tiles) { tile(...t); await new Promise((r) => setTimeout(r, 0)); }
    return found;
  } finally { URL.revokeObjectURL(url); }
}

// kind: 'mac' | 'serial'; onPick(value) вызывается при выборе значения
export function scanDevice({ kind, onPick, title }) {
  const texts = [];
  let controls = null; let closed = false;
  const status = h('div', { class: 'mut', style: { margin: '8px 0' } }, 'Запускаю камеру…');
  const list = h('div', {});
  const video = h('video', { playsinline: true, muted: true, autoplay: true, style: { width: '100%', maxHeight: '45vh', background: '#000', borderRadius: '10px', objectFit: 'cover' } });
  video.setAttribute('playsinline', ''); video.muted = true;
  const fileIn = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  const pick = (value) => { stop(); close(); onPick(value); };
  const refresh = () => {
    const c = candidatesFor(kind, texts);
    list.replaceChildren(...c.map((x) => h('button', { type: 'button', class: x.sure ? '' : 'sec', style: { display: 'block', width: '100%', textAlign: 'left', margin: '6px 0' }, onclick: () => pick(x.value) },
      x.value, h('small', { style: { display: 'block', opacity: 0.7 } }, x.note))));
    return c;
  };
  const add = (t, live = false) => {
    if (!t || texts.includes(t)) return;
    texts.push(t);
    const c = refresh();
    status.textContent = `Считано кодов: ${texts.length}. Нажмите нужное значение${kind === 'mac' ? '' : ' (или наведите на другой код)'}.`;
    // серийный номер с камеры: код вида «GE4198747» подставляем сразу, остальное выбирается нажатием
    if (live && kind === 'serial' && /^[A-Za-z0-9\-_.]{6,32}$/.test(t) && !normalizeMac(t)) { pick(t); return; }
    if (kind === 'mac' && c[0]?.sure && c.filter((x) => x.sure).length === 1) pick(c[0].value); // MAC найден однозначно
  };
  function stop() { try { controls?.stop(); } catch { /* уже остановлена */ } controls = null; }
  const photoBtn = h('button', { type: 'button', class: 'sec', onclick: () => fileIn.click() }, '🖼 Из фото');
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0]; if (!f) return;
    status.textContent = 'Ищу коды на фото…';
    try {
      const L = await lib(); const res = await decodePhoto(f, L);
      res.forEach(add);
      if (!res.length) status.textContent = 'На фото код не найден. Снимите ближе и ровнее или введите вручную.';
    } catch (e) { status.textContent = String(e.message || e); }
    fileIn.value = '';
  });
  const close = openModal(title || (kind === 'mac' ? 'Сканировать MAC' : 'Сканировать серийный номер'),
    h('div', {}, video, status, list, h('div', { class: 'btns' }, photoBtn, h('button', { type: 'button', class: 'sec', onclick: () => { stop(); close(); } }, 'Закрыть')), fileIn),
    { onClose: () => { closed = true; stop(); } });
  (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера недоступна. Используйте «Из фото» или введите вручную.');
      const L = await lib();
      if (closed) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      if (closed) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream; await video.play().catch(() => {});
      try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* не поддерживается */ }
      const reader = newReader(L); const cv = document.createElement('canvas'); let busy = false; let frame = 0; const votes = new Map();
      const timer = setInterval(() => {
        if (busy || closed || !video.videoWidth) return;
        busy = true;
        try {
          const k = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
          cv.width = Math.round(video.videoWidth * k); cv.height = Math.round(video.videoHeight * k);
          cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
          const found = []; decodeAll(cv, reader, L, found);
          // каждый второй кадр — центральная часть кадра в полном разрешении (мелкий штрихкод читается лучше)
          frame += 1;
          if (frame % 2 === 0 || !found.length) {
            const cw = Math.round(video.videoWidth * 0.6); const ch = Math.round(video.videoHeight * 0.6);
            const k2 = Math.min(1, 1600 / Math.max(cw, ch)); cv.width = Math.round(cw * k2); cv.height = Math.round(ch * k2);
            cv.getContext('2d').drawImage(video, (video.videoWidth - cw) / 2, (video.videoHeight - ch) / 2, cw, ch, 0, 0, cv.width, cv.height);
            decodeAll(cv, reader, L, found);
          }
          // код принимаем, только если он прочитан в двух кадрах (защита от случайных чтений)
          found.filter((t) => t.length >= 5).forEach((t) => { votes.set(t, (votes.get(t) || 0) + 1); if (votes.get(t) >= 2) add(t, true); });
        } finally { busy = false; }
      }, 350);
      controls = { stop: () => { clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; } };
      status.textContent = 'Наведите камеру на штрихкод или QR на наклейке.';
    } catch (e) {
      status.textContent = e?.name === 'NotAllowedError' ? 'Нет доступа к камере. Разрешите его в настройках или используйте «Из фото».'
        : e?.name === 'NotFoundError' ? 'Камера не найдена. Используйте «Из фото» или введите вручную.' : String(e.message || e);
    }
  })();
}
