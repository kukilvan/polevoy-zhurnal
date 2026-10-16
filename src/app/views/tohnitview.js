// «📐 Из чертежа»: разбор тохнита (PDF) прямо в приложении, без ИИ — по каталогу подписей.
// Незнакомые группы подписей — вопросы кнопками; ответы можно запомнить (личный каталог, общий для всех проектов).
import { h, openModal, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { importPreview } from './pointsfile.js';
import { learnInto } from '../../tohnit/engine.js';
import DEFAULT_CATALOG from '../../../tools/tohnit/catalog.json';

// Каталог = выученное пользователем (впереди, главнее) + встроенный каталог приложения
export function userCatalog() {
  const mine = getRepo().prefs?.tohnitLearned || {};
  return { ...DEFAULT_CATALOG, labels: [...(mine.labels || []), ...DEFAULT_CATALOG.labels], skip: [...(mine.skip || []), ...DEFAULT_CATALOG.skip], symbols: [...(mine.symbols || []), ...(DEFAULT_CATALOG.symbols || [])] };
}
async function saveLearned(learned) {
  const mine = getRepo().prefs?.tohnitLearned || {};
  const { catalog, added } = learnInto({ labels: mine.labels || [], skip: mine.skip || [], symbols: mine.symbols || [] }, learned);
  if (added) await getRepo().saveUserPrefs({ tohnitLearned: { labels: catalog.labels, skip: catalog.skip, symbols: catalog.symbols } });
  return added;
}

// Обмен с фоновым разборщиком
function makeWorker() {
  const w = new Worker(new URL('../../tohnit/worker.js', import.meta.url), { type: 'module' });
  let seq = 0; const wait = new Map();
  w.onmessage = (e) => { const { id, ok, res, error } = e.data; const p = wait.get(id); wait.delete(id); ok ? p.resolve(res) : p.reject(new Error(error)); };
  const call = (cmd, args = {}, transfer = []) => new Promise((resolve, reject) => { const id = ++seq; wait.set(id, { resolve, reject }); w.postMessage({ id, cmd, ...args }, transfer); });
  return { call, stop: () => w.terminate() };
}

export function pointsFromDrawing() {
  const input = h('input', { type: 'file', accept: '.pdf,application/pdf', style: { display: 'none' } });
  const floorIn = h('input', { placeholder: 'Этаж (например 0, -3.50)' });
  const status = h('div', { class: 'mut', style: { margin: '6px 0' } });
  const out = h('div', {});
  let wk = null; let fileName = '';
  const close = openModal('Точки из чертежа (PDF)', h('div', {},
    h('div', { class: 'mut' }, 'Тохнит в PDF (из AutoCAD, с текстом). Приложение само найдёт подписи точек по каталогу; что не знает — спросит. Чертёж никуда не отправляется. Первый раз загружается модуль чтения PDF (≈4 МБ).'),
    h('label', { class: 'field' }, h('span', {}, 'Этаж'), floorIn),
    h('div', { class: 'btns' }, h('button', { onclick: () => input.click() }, '📂 Выбрать PDF'), input),
    status, out), { onClose: () => wk?.stop() });

  const answers = {}; const remember = new Set();
  let lastQuestions = [];
  async function parse() {
    status.textContent = 'Разбираю…';
    const project = currentProject()?.name || '';
    const r = await wk.call('parse', { catalog: userCatalog(), opts: { floor: floorIn.value.trim(), project, answers: { ...answers }, sheet: fileName } });
    status.textContent = '';
    lastQuestions = r.questions;
    render(r);
  }
  async function cropImg(ex, scale) {  // кусок чертежа вокруг подписи; сама подпись — в розовой рамке
    const pad = 22 * scale; const w = ex.x1 - ex.x0 + 2 * pad; const zoom = Math.min(8, 320 / w);
    const png = await wk.call('crop', { page: ex.page, clip: [ex.x0 - pad, ex.y0 - pad, ex.x1 + pad, ex.y1 + pad], zoom });
    const img = new Image(); img.src = URL.createObjectURL(new Blob([png], { type: 'image/png' })); await img.decode();
    const cv = h('canvas', { width: img.width, height: img.height, style: { maxWidth: '100%', borderRadius: '6px', background: '#fff' } });
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0); g.strokeStyle = '#e0007a'; g.lineWidth = 3;
    g.strokeRect(pad * zoom - 4, pad * zoom - 4, (ex.x1 - ex.x0) * zoom + 8, (ex.y1 - ex.y0) * zoom + 8);
    return cv;
  }
  function render(r) {
    const pts = r.data.points; const byType = {};
    pts.forEach((p) => { byType[p.typeId] = (byType[p.typeId] || 0) + 1; });
    const types = [...state.ctx.types.keys()].sort((a, b) => a.localeCompare(b, 'ru'));
    const qBox = h('div', {});
    for (const q of r.questions) {
      const sel = h('select', { onchange: () => { if (sel.value) answers[q.cluster] = sel.value === '__skip' ? 'skip' : sel.value; else delete answers[q.cluster]; } },
        h('option', { value: '' }, '— выберите —'), h('option', { value: '__skip' }, '🚫 Не точки'), ...types.map((t) => h('option', { value: t }, t)));
      const rem = h('input', { type: 'checkbox', checked: true, onchange: () => { rem.checked ? remember.add(q.cluster) : remember.delete(q.cluster); } }); remember.add(q.cluster);
      const imgs = h('div', { style: { display: 'grid', gap: '6px', margin: '6px 0' } });
      qBox.append(h('div', { class: 'card', style: { margin: '8px 0' } },
        h('b', {}, `Что это? ${q.n} шт.`), h('div', { class: 'mut' }, `Например: ${q.samples.slice(0, 6).join('  ·  ')}`), imgs,
        h('label', { class: 'field' }, h('span', {}, 'Это…'), sel), h('label', { class: 'pickrow' }, rem, h('span', {}, 'Запомнить для следующих чертежей'))));
      Promise.all(q.examples.slice(0, 3).map((ex) => cropImg(ex, r.scale))).then((els) => imgs.append(...els)).catch(() => {});
    }
    const again = h('button', { onclick: async () => { again.disabled = true; try { await parse(); } catch (e) { status.textContent = e.message; } } }, '🔄 Разобрать с ответами');
    const next = h('button', { class: r.questions.length ? 'sec' : '', onclick: () => {
      const keep = r.learned.filter((e) => remember.has(e.cluster)).map(({ project: _p, ...e }) => e);  // запоминается для всех проектов
      out.replaceChildren(importPreview(r.data, fileName, async () => {
        try { const n = await saveLearned(keep); if (n) toast(`Запомнено правил: ${n}`); } catch { /* не страшно */ }
        close();
      }));
    } }, `Дальше → проверить и добавить (${pts.length})`);
    out.replaceChildren(
      h('div', { class: 'card', style: { margin: '10px 0' } }, h('b', {}, `Найдено точек: ${pts.length}`),
        h('div', { style: { fontSize: '14px', marginTop: '6px' } }, Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => h('div', {}, `${t}: ${n}`))),
        r.hiddenLayers.length ? h('div', { class: 'mut', style: { marginTop: '6px' } }, `Скрыто слоёв-мусора: ${r.hiddenLayers.length}`) : null),
      r.questions.length ? h('div', {}, h('b', { class: 'l-warn' }, `Вопросы (${r.questions.length}) — ответьте и нажмите «Разобрать с ответами»`), qBox, h('div', { class: 'btns' }, again)) : null,
      h('div', { class: 'btns' }, next));
  }

  input.addEventListener('change', async () => {
    const file = input.files?.[0]; if (!file) return;
    fileName = file.name; if (!floorIn.value.trim()) floorIn.value = (fileName.match(/(-?\d+(?:\.\d+)?)/) || [])[1] || '';
    Object.keys(answers).forEach((k) => delete answers[k]); remember.clear();
    out.replaceChildren(); status.textContent = 'Читаю чертёж… (первый раз — дольше, загружается модуль)';
    try {
      wk?.stop(); wk = makeWorker();
      const buf = await file.arrayBuffer();
      const o = await wk.call('open', { data: buf }, [buf]);
      status.textContent = `Прочитано за ${(o.ms / 1000).toFixed(1)} с, листов: ${o.pages.length}`;
      await parse();
    } catch (e) { status.textContent = `Не получилось прочитать: ${e.message}`; }
  });
  void lastQuestions;
}
