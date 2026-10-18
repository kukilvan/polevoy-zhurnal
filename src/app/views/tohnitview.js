// «📐 Из чертежа»: разбор тохнита (PDF) прямо в приложении, без ИИ — по каталогу подписей.
// Незнакомые группы подписей — вопросы кнопками; ответы можно запомнить (личный каталог, общий для всех проектов).
import { pickPdf } from './pdfpick.js';
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { state, getRepo, currentProject, subscribe } from '../store.js';
import { importPreview } from './pointsfile.js';
import { learnInto, generalize } from '../../tohnit/engine.js';
import { UNSORTED_TYPE, isSystemType } from '../../domain/index.js';
import { itemForm } from './settings.js';
import { ruleEditor } from './catalogview.js';
import { cablesPicker } from './cablespick.js';
import { iconsPicker } from './planpick.js';
import { addDrawing, drawingFor, drawingsOf, drawingTitle, loadDrawing, updateDrawing } from '../drawings.js';

// кабели рядом с выбором типа: видны, когда выбран настоящий тип
export function cablesFor(onChange) {
  const p = cablesPicker({ compact: true, onChange }); const box = h('div', { style: { display: 'none', margin: '4px 0 8px' } }, h('small', { class: 'mut' }, 'Кабели каждой такой точки'), p.el);
  return { box, p, set: (t) => { const real = !!t && !t.startsWith('__') && t !== 'skip' && t !== UNSORTED_TYPE; box.style.display = real ? '' : 'none'; if (real) p.setType(t); }, own: () => (box.style.display === 'none' ? null : p.override()) };
}
import DEFAULT_CATALOG from '../../../tools/tohnit/catalog.json';
export { DEFAULT_CATALOG };

// Каталог = выученное пользователем (впереди, главнее) + встроенный каталог приложения
export function userCatalog() {
  const mine = getRepo().prefs?.tohnitLearned || {};
  return { ...DEFAULT_CATALOG, labels: [...(mine.labels || []), ...DEFAULT_CATALOG.labels], skip: [...(mine.skip || []), ...DEFAULT_CATALOG.skip], symbols: [...(mine.symbols || []), ...(DEFAULT_CATALOG.symbols || [])] };
}
export async function saveLearned(learned) {
  const mine = getRepo().prefs?.tohnitLearned || {};
  const { catalog, added } = learnInto({ labels: mine.labels || [], skip: mine.skip || [], symbols: mine.symbols || [] }, learned);
  if (added) getRepo().saveUserPrefs({ tohnitLearned: { labels: catalog.labels, skip: catalog.skip, symbols: catalog.symbols } }).catch(() => toast('Не удалось запомнить правила'));  // без ожидания: без сети запись дойдёт позже
  return added;
}

// Выбор типа: список типов проекта + «➕ Новый тип» (форма создания типа; после сохранения он сразу выбран)
export function typePicker({ extra = [], onChange }) {
  const sel = h('select', { onchange: () => onChange(sel.value) });
  const fill = (pick) => {
    const types = [...state.ctx.types.values()].filter((t) => !isSystemType(t)).map((t) => t.id);
    if (pick && !types.includes(pick)) types.push(pick);
    types.sort((a, b) => a.localeCompare(b, 'ru'));
    sel.replaceChildren(h('option', { value: '' }, '— выберите —'), ...extra.map(([v, t]) => h('option', { value: v }, t)), ...types.map((t) => h('option', { value: t }, t)));
    if (pick) { sel.value = pick; onChange(pick); }
  };
  fill();
  const add = h('button', { type: 'button', class: 'sec', style: { flex: 'none' }, onclick: () => itemForm('types', null, { onSaved: (id) => fill(id) }) }, '➕ Новый тип');
  return h('div', { style: { display: 'flex', gap: '8px' } }, h('div', { style: { flex: 1, minWidth: 0 } }, sel), add);
}

// Обмен с фоновым разборщиком
export function makeWorker() {
  const w = new Worker(new URL('../../tohnit/worker.js', import.meta.url), { type: 'module' });
  let seq = 0; const wait = new Map();
  w.onmessage = (e) => { const { id, ok, res, error } = e.data; const p = wait.get(id); wait.delete(id); ok ? p.resolve(res) : p.reject(new Error(error)); };
  const call = (cmd, args = {}, transfer = []) => new Promise((resolve, reject) => { const id = ++seq; wait.set(id, { resolve, reject }); w.postMessage({ id, cmd, ...args }, transfer); });
  return { call, stop: () => w.terminate() };
}

// Уже отмеченные значки этого чертежа (точки проекта с пометкой «значок без номера») — группами по типу и буквам номера
function iconGroupsOf(drawing) {
  const pts = [...state.ctx.points.values()].filter((p) => p.pos && drawingFor(p)?.id === drawing.id && String(p.note || '').includes('значок без номера'));
  const by = new Map();
  for (const p of pts) { const k = `${p.typeId}|${p.label.replace(/\d+$/, '')}`; if (!by.has(k)) by.set(k, []); by.get(k).push(p); }
  return [...by.values()].map((list) => ({ what: 'отмечено раньше', typeId: list[0].typeId,
    points: list.sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true })).map((p) => ({ id: p.id, label: p.label, typeId: p.typeId, cabinet: p.cabinet || '', floor: p.floor || '', note: p.note, pos: { ...p.pos }, cableOverride: p.cableOverride ?? null })) }));
}

// drawing + buf — правка уже сохранённого чертежа (из «🗺 План» → «✏️ Редактировать»): без выбора файла; значки — уже отмеченные
export function pointsFromDrawing({ drawing = null, buf: preBuf = null, file = null, onDone = null } = {}) {  // file: { name, buf, fileId } — уже выбранный PDF
  const input = h('input', { type: 'file', accept: '.pdf,application/pdf', style: { display: 'none' } });
  const floorIn = h('input', { placeholder: 'Этаж (например 0, -3.50)' });
  const status = h('div', { class: 'mut', style: { margin: '6px 0' } });
  const out = h('div', {});
  let wk = null; let fileName = ''; let theFile = null;
  const keepPdf = h('input', { type: 'checkbox', checked: true });
  const close = openModal(drawing ? `✏️ ${drawing.title || drawing.name}` : 'Точки из чертежа (PDF)', h('div', {},
    h('div', { class: 'mut' }, drawing ? 'Чертёж разобран заново по каталогу: новые подписи можно добавить (существующие точки пропускаются); значки без номеров — поправить: добавить пропущенные, убрать лишние, номера пересчитаются.'
      : 'Тохнит в PDF (из AutoCAD, с текстом). Приложение само найдёт подписи точек по каталогу; что не знает — спросит. Чертёж никуда не отправляется. Первый раз загружается модуль чтения PDF (≈4 МБ).'),
    h('label', { class: 'field' }, h('span', {}, 'Этаж'), floorIn),
    drawing ? null : h('div', { class: 'btns' }, h('button', { onclick: async () => { const r = await pickPdf({ title: 'Тохнит для разбора' }); if (r) useFile(r); } }, '📂 Выбрать PDF'), input),
    status, out), { sticky: true, onClose: () => wk?.stop() });

  const answers = {}; const remember = new Set();
  let lastQuestions = []; let iconGroups = []; let lastR = null; let pagesInfo = [];  // значки без номеров (добавлены на плане)
  const iconPts = () => iconGroups.flatMap((gr) => gr.points).filter((p) => !p.id);  // новые значки (у существующих точек есть id)
  const origIcons = drawing ? iconGroupsOf(drawing) : []; const origIds = new Set(origIcons.flatMap((g) => g.points.map((p) => p.id)));
  // правка значков существующих точек: что поменять и что удалить
  const iconDiff = () => {
    const now = iconGroups.flatMap((gr) => gr.points).filter((p) => p.id); const ids = new Set(now.map((p) => p.id));
    const upd = now.filter((p) => { const o = state.ctx.points.get(p.id); return o && (o.label !== p.label || o.typeId !== p.typeId || JSON.stringify(o.cableOverride ?? null) !== JSON.stringify(p.cableOverride ?? null) || Math.abs((o.pos?.x || 0) - p.pos.x) > 0.5 || Math.abs((o.pos?.y || 0) - p.pos.y) > 0.5); });
    return { upd, del: [...origIds].filter((id) => !ids.has(id)) };
  };
  async function parse() {
    status.textContent = 'Разбираю…';
    const project = currentProject()?.name || '';
    const r = await wk.call('parse', { catalog: userCatalog(), opts: { floor: floorIn.value.trim(), project, answers: { ...answers }, sheet: fileName } });
    status.textContent = '';
    lastQuestions = r.questions; lastR = r;
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
    const pts = [...r.data.points, ...iconPts()]; const byType = {};
    pts.forEach((p) => { byType[p.typeId] = (byType[p.typeId] || 0) + 1; });
    const qBox = h('div', {});
    for (const q of r.questions) {
      let tv = '';
      const setAns = () => { if (!tv) { delete answers[q.cluster]; return; } const t = tv === '__skip' ? 'skip' : tv === '__later' ? UNSORTED_TYPE : tv; const own = cab.own(); answers[q.cluster] = own ? { type: t, cables: own } : t; };
      const cab = cablesFor(() => setAns());
      const sel = typePicker({ extra: [['__skip', '🚫 Не точки'], ['__later', '⏳ Разобрать потом']],
        onChange: (v) => { tv = v; cab.set(v); setAns(); } });
      const tune = h('button', { type: 'button', class: 'sec', onclick: () => {  // своё правило по частям подписи → в каталог → разобрать заново
        const cur = answers[q.cluster]; const ct = typeof cur === 'object' ? cur.type : cur; const t = ct === 'skip' ? '__skip' : ct === UNSORTED_TYPE ? '' : (ct || '');
        ruleEditor({ samples: q.samples, type: t, onSaved: () => { delete answers[q.cluster]; parse().catch((e) => { status.textContent = e.message; }); } });
      } }, '⚙️ Настроить шаблон');
      const rem = h('input', { type: 'checkbox', checked: false, onchange: () => { rem.checked ? remember.add(q.cluster) : remember.delete(q.cluster); } });
      const imgs = h('div', { style: { display: 'grid', gap: '6px', margin: '6px 0' } });
      qBox.append(h('div', { class: 'card', style: { margin: '8px 0' } },
        h('b', {}, `Что это? ${q.n} шт.`), h('div', { class: 'mut' }, `Например: ${q.samples.slice(0, 6).join('  ·  ')}`), imgs,
        h('label', { class: 'field' }, h('span', {}, 'Это…'), sel), cab.box, h('label', { class: 'pickrow' }, rem, h('span', {}, 'Запомнить для следующих чертежей')),
        h('div', { class: 'btns' }, tune, h('small', { class: 'mut', style: { alignSelf: 'center' } }, 'что значит каждая часть подписи'))));
      Promise.all(q.examples.slice(0, 3).map((ex) => cropImg(ex, r.scale))).then((els) => imgs.append(...els)).catch(() => {});
    }
    const again = h('button', { onclick: async () => { again.disabled = true; try { await parse(); } catch (e) { status.textContent = e.message; } } }, '🔄 Разобрать с ответами');
    const next = h('button', { class: r.questions.length ? 'sec' : '', onclick: async () => {
      if (drawing) {  // сначала правка уже существующих точек-значков (номера, место, тип), потом — добавление нового
        const { upd, del } = iconDiff();
        if (upd.length || del.length) {
          if (!(await confirmDialog(`Значки этого чертежа: изменить точек — ${upd.length}${upd.length ? ` (${upd.slice(0, 4).map((p) => `${state.ctx.points.get(p.id)?.label}→${p.label}`).join(', ')}${upd.length > 4 ? '…' : ''})` : ''}, удалить — ${del.length}. История работ у точек сохраняется (номер меняется, точка та же).`, { yes: 'Применить' }))) return;
          const repo = getRepo(); const pid = currentProject().id; const before = state.ctx;
          if (upd.length) repo.save(pid, upd.map((p) => ({ coll: 'points', id: p.id, data: { label: p.label, typeId: p.typeId, cableOverride: p.cableOverride ?? null, pos: { ...state.ctx.points.get(p.id)?.pos, ...p.pos, sheet: drawing.name } } })));
          del.forEach((id) => repo.remove(pid, 'points', id));
          await new Promise((res) => { const t = setTimeout(res, 1500); const un = subscribe(() => { if (state.ctx !== before) { clearTimeout(t); un(); res(); } }); });
          toast(`Изменено: ${upd.length}, удалено: ${del.length}`);
        }
        const byL = new Map([...state.ctx.points.values()].map((x) => [x.label, x]));
        const unplaced = r.data.points.filter((p) => byL.has(p.label) && byL.get(p.label).pos?.sheet !== drawing.name && !(drawing.aliases || []).includes(byL.get(p.label).pos?.sheet));
        if (!iconPts().length && r.data.points.every((p) => byL.has(p.label)) && !unplaced.length) { toast('Новых точек нет — все уже на чертеже'); markScanned(drawing); onDone?.(); close(); return; }
      }
      const keep = r.learned.filter((e) => remember.has(e.cluster) && e.type !== UNSORTED_TYPE).map(({ project: _p, ...e }) => e);  // запоминается для всех проектов
      out.replaceChildren(importPreview({ ...r.data, points: [...r.data.points, ...iconPts()] }, fileName, async () => {
        try { const n = await saveLearned(keep); if (n) toast(`Запомнено правил: ${n}`); } catch { /* не страшно */ }
        if (drawing) markScanned(drawing);
        if (keepPdf.checked && theFile && !drawing) {  // чертёж — в проект: план и «📍 На чертеже»
          scannedNow.add(fileName);
          theFile.arrayBuffer().then((buf) => addDrawing(buf, { name: fileName, floor: floorIn.value.trim(), pages: pagesInfo, fileId: theFile.fileId || null }))
            .then((d) => { if (d?.id) { scannedNow.add(d.id); setTimeout(() => markScanned(d), 1500); } return d; })
            .then((d) => toast(d?.fileId ? 'Чертёж сохранён в проект и на Диск' : 'Чертёж сохранён в проект (на Диск — кнопка «⬆ На Диск» в плане)'))
            .catch((e) => toast(`Чертёж сохранён на этом устройстве; на Диск — не получилось: ${e.message}`));
        }
        onDone?.(); close();
      }));
    } }, `Дальше → проверить и добавить (${pts.length})`);
    out.replaceChildren(...[
      h('div', { class: 'card', style: { margin: '10px 0' } }, h('b', {}, `Найдено точек: ${pts.length}`),
        h('div', { style: { fontSize: '14px', marginTop: '6px' } }, Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => h('div', {}, `${t}: ${n}`))),
        r.hiddenLayers.length ? h('div', { class: 'mut', style: { marginTop: '6px' } }, `Скрыто слоёв-мусора: ${r.hiddenLayers.length}`) : null),
      r.questions.length ? h('div', {}, h('b', { class: 'l-warn' }, `Вопросы (${r.questions.length}) — ответьте и нажмите «Разобрать с ответами»`), qBox, h('div', { class: 'btns' }, again)) : null,
      h('div', { class: 'card', style: { margin: '10px 0' } }, h('b', {}, '🔎 Значки без номеров'),
        h('div', { class: 'mut', style: { margin: '4px 0' } }, iconGroups.length ? `Добавлено: ${iconGroups.map((gr) => `${gr.typeId} ${gr.points.length}`).join(', ')}` : 'Если точки на чертеже — только значки (без подписей), отметьте их на плане: нажали на значок → нашлись такие же → номера по порядку.'),
        h('div', { class: 'btns' }, h('button', { class: pts.length ? 'sec' : '', onclick: () => iconsPicker({ wk, pages: pagesInfo, floor: floorIn.value.trim(), sheet: fileName, groups: iconGroups,
          onDone: (gs) => { iconGroups = gs; render(lastR); } }) }, iconGroups.length ? '✏️ Изменить значки' : '🔎 Отметить значки на плане'))),
      drawing ? null : h('label', { class: 'pickrow', style: { margin: '8px 0' } }, keepPdf, h('span', {}, '📌 Сохранить чертёж в проект — «🗺 План» и «📍 На чертеже» в карточке точки')),
      h('div', { class: 'btns' }, next)].filter(Boolean));
  }

  async function load(buf) {
    Object.keys(answers).forEach((k) => delete answers[k]); remember.clear();
    out.replaceChildren(); status.textContent = 'Читаю чертёж… (первый раз — дольше, загружается модуль)';
    try {
      wk?.stop(); wk = makeWorker();
      const o = await wk.call('open', { data: buf }, [buf]);
      pagesInfo = o.pages; iconGroups = drawing ? iconGroupsOf(drawing) : [];
      status.textContent = `Прочитано за ${(o.ms / 1000).toFixed(1)} с, листов: ${o.pages.length}`;
      await parse();
    } catch (e) { status.textContent = `Не получилось прочитать: ${e.message}`; }
  }
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; if (!file) return;
    fileName = file.name; theFile = file; if (!floorIn.value.trim()) floorIn.value = (fileName.match(/(-?\d+(?:\.\d+)?)/) || [])[1] || '';
    load(await file.arrayBuffer());
  });
  // выбранный PDF (из проекта, с Диска или с устройства); тохнит этого проекта — сразу режим «✏️ Редактировать»
  function useFile(r) {
    if (r.drawing) { close(); pointsFromDrawing({ drawing: r.drawing, buf: r.buf, onDone }); return; }
    fileName = r.name; theFile = { name: r.name, fileId: r.fileId || null, arrayBuffer: async () => r.buf.slice(0) };
    if (!floorIn.value.trim()) floorIn.value = (fileName.match(/(-?\d+(?:\.\d+)?)/) || [])[1] || '';
    load(r.buf.slice(0));
  }
  if (file) useFile(file);
  if (drawing) { fileName = drawing.name; floorIn.value = drawing.floor || ''; load(preBuf.slice(0)); }
  void lastQuestions;
}

// Отметка «разобран» у тохнита проекта (зелёная птичка в окне «📐 Из чертежа»). scannedNow — на случай, если запись чертежа ещё не дошла
const scannedNow = new Set();
function markScanned(d) {
  scannedNow.add(d.id); scannedNow.add(d.name);
  if ((currentProject()?.drawings || []).some((x) => x.id === d.id)) updateDrawing(d.id, { scannedAt: new Date().toISOString() });
}
const isScanned = (d) => !!d.scannedAt || scannedNow.has(d.id) || scannedNow.has(d.name);

/** «📐 Из чертежа»: список тохнитов проекта с отметкой «разобран», другой тохнит — с Диска или с устройства.
 *  onNext (мастер нового проекта) — кнопка «Дальше» внизу; extra — только что добавленные чертежи */
export function drawingsHub({ onNext = null, extra = [] } = {}) {
  const box = h('div', {});
  let close = null;
  const unsub = subscribe(() => draw());
  const open = async (d) => { try { pointsFromDrawing({ drawing: d, buf: await loadDrawing(d), onDone: draw }); } catch (e) { toast(e.message); } };
  const other = async () => { const r = await pickPdf({ title: 'Другой тохнит', project: false }); if (r) pointsFromDrawing({ file: r, onDone: draw }); };
  function draw() {
    const list = [...drawingsOf(), ...extra]; const seen = new Set();
    const ds = list.filter((d) => { const k = d.id || d.name; if (seen.has(k)) return false; seen.add(k); return !d.deleted; });
    const done = ds.filter(isScanned).length;
    box.replaceChildren(...[
      h('div', { class: 'mut' }, 'Нажмите на тохнит — приложение найдёт на нём точки по каталогу, что не знает — спросит. Разобранные отмечены ✅. Тохнит можно разбирать повторно: уже добавленные точки пропускаются.'),
      ds.length ? h('div', {}, h('div', { class: 'group', style: { padding: '8px 0 4px' } }, `В этом проекте${ds.length ? ` (разобрано ${done} из ${ds.length})` : ''}`),
        h('div', { class: 'card', style: { padding: 0 } }, ds.map((d) => h('div', { class: 'item', style: { alignItems: 'center' }, onclick: () => open(d) },
          h('div', { class: 'name', style: { flex: 1 } }, drawingTitle(d), h('div', { class: 'sub' }, `${d.floor ? `этаж ${d.floor} · ` : ''}${d.name}`)),
          h('span', { title: isScanned(d) ? 'Разобран' : 'Ещё не разобран', style: { fontSize: '22px', minWidth: '28px', textAlign: 'center', pointerEvents: 'none', color: '#30d158' } }, isScanned(d) ? '✅' : '◻️')))))
        : h('div', { class: 'empty' }, 'В проекте пока нет тохнитов'),
      h('div', { class: 'btns' }, h('button', { class: ds.length ? 'sec' : '', onclick: other }, '➕ Другой тохнит (Google Диск / устройство)')),
      onNext ? h('div', { class: 'btns' }, h('button', { onclick: () => { close(); onNext(); } }, 'Дальше')) : null].filter(Boolean));
  }
  close = openModal('📐 Точки из чертежа', box, { sticky: true, onClose: () => unsub() });
  draw();
  return close;
}

// «❓ Не разобрано»: точки, отложенные при разборе чертежа. Группы однотипных подписей → тип всей группе или выбранным; правило — в каталог.
const shapeOf = (label) => label.replace(/#\d+$/, '').replace(/^[A-Za-z]+\d*\//, '…/').replace(/\d+/g, '#');
export function unsortedModal(ui) {
  const pid = currentProject().id;
  const box = h('div', {});
  let redraw = null; const unsub = subscribe(() => { if (redraw && state.ctx !== redraw) { redraw = null; draw(); } });  // перерисовать, когда изменения дошли до данных
  const close = openModal('❓ Не разобрано', h('div', {},
    h('div', { class: 'mut' }, 'Точки, отложенные при разборе чертежа. Выберите тип для группы (или снимите галочки с лишних точек) и нажмите «Применить». «🚫 Не точки» — удалить их (вернуть можно из истории).'), box), { sticky: true, onClose: () => { unsub(); ui?.render?.(); } });
  function draw() {
    const pts = [...state.ctx.points.values()].filter((p) => p.typeId === UNSORTED_TYPE).sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }));
    if (!pts.length) { box.replaceChildren(h('div', { class: 'empty' }, 'Всё разобрано 👍')); return; }
    const groups = new Map(); pts.forEach((p) => { const k = shapeOf(p.label); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
    box.replaceChildren(...[...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, list]) => {
      const on = new Set(list.map((p) => p.id)); let choice = ''; let open = false;
      const base = (l) => l.replace(/#\d+$/, ''); const uniq = [...new Set(list.map((p) => base(p.label)))];
      const rem = h('input', { type: 'checkbox', checked: true });
      const go = h('button', { disabled: true });
      const label = () => { go.textContent = `✔ Применить (${on.size})`; go.disabled = !choice || !on.size; };
      const cab = cablesFor(() => {});
      const picker = typePicker({ extra: [['__skip', '🚫 Не точки (удалить)']], onChange: (v) => { choice = v; cab.set(v); label(); } });
      const rows = h('div', { class: 'picklist', style: { maxHeight: '220px', display: 'none' } }, list.map((p) => {
        const cb = h('input', { type: 'checkbox', checked: true, onchange: () => { cb.checked ? on.add(p.id) : on.delete(p.id); label(); } });
        const pin = p.pos && drawingFor(p) ? h('button', { type: 'button', class: 'sec', style: { padding: '2px 8px', marginLeft: 'auto' }, onclick: (e) => { e.preventDefault(); e.stopPropagation(); import('./planmodal.js').then((m) => m.planModal({ point: p })); } }, '📍') : null;
        return h('label', { class: 'pickrow' }, cb, h('span', {}, p.label, p.cabinet ? h('small', {}, ` · шкаф ${p.cabinet}`) : null, p.pos?.sheet ? h('small', {}, ` · ${p.pos.sheet}`) : null), pin);
      }));
      const toggle = h('button', { type: 'button', class: 'sec', onclick: () => { open = !open; rows.style.display = open ? '' : 'none'; toggle.textContent = open ? '▲ Скрыть список' : `▼ По одной (${list.length})`; } }, `▼ По одной (${list.length})`);
      go.onclick = async () => {
        const chosen = list.filter((p) => on.has(p.id)); const repo = getRepo();
        if (choice === '__skip') {
          if (!(await confirmDialog(`Удалить точек: ${chosen.length}? Вернуть можно из истории.`, { yes: 'Удалить', danger: true }))) return;
          redraw = state.ctx; chosen.forEach((p) => repo.remove(pid, 'points', p.id));
        } else { redraw = state.ctx; const own = cab.own(); repo.save(pid, chosen.map((p) => ({ coll: 'points', id: p.id, data: { typeId: choice, cableOverride: own } }))); }
        let n = 0;
        if (rem.checked) {
          const re = generalize([...new Set(chosen.map((p) => base(p.label)))]);
          if (re) try { n = await saveLearned([choice === '__skip' ? { kind: 'skip', re, learned: true } : { kind: 'labels', re, type: choice, learned: true, ...(cab.own() ? { cables: cab.own() } : {}) }]); } catch { /* не страшно */ }
        }
        toast(`${choice === '__skip' ? 'Удалено' : `Тип «${choice}»`}: ${chosen.length}${n ? ' · правило запомнено' : ''}`);
      };
      label();
      return h('div', { class: 'card', style: { margin: '8px 0' } },
        h('b', {}, `${uniq.length <= 3 ? uniq.join(', ') : k} — ${list.length} шт.`), uniq.length > 3 ? h('div', { class: 'mut' }, uniq.slice(0, 8).join('  ·  ')) : null,
        h('label', { class: 'field' }, h('span', {}, 'Это…'), picker), cab.box,
        h('label', { class: 'pickrow' }, rem, h('span', {}, 'Запомнить для следующих чертежей')),
        h('div', { class: 'btns' }, toggle, go), rows);
    }));
  }
  draw();
  void close;
}
