// «📐 Из чертежа»: разбор тохнита (PDF) прямо в приложении, без ИИ — по каталогу подписей.
// Незнакомые группы подписей — вопросы кнопками; ответы можно запомнить (личный каталог, общий для всех проектов).
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { state, getRepo, currentProject, subscribe } from '../store.js';
import { importPreview } from './pointsfile.js';
import { learnInto, generalize } from '../../tohnit/engine.js';
import { UNSORTED_TYPE, isSystemType } from '../../domain/index.js';
import { itemForm } from './settings.js';
import DEFAULT_CATALOG from '../../../tools/tohnit/catalog.json';

// Каталог = выученное пользователем (впереди, главнее) + встроенный каталог приложения
export function userCatalog() {
  const mine = getRepo().prefs?.tohnitLearned || {};
  return { ...DEFAULT_CATALOG, labels: [...(mine.labels || []), ...DEFAULT_CATALOG.labels], skip: [...(mine.skip || []), ...DEFAULT_CATALOG.skip], symbols: [...(mine.symbols || []), ...(DEFAULT_CATALOG.symbols || [])] };
}
export async function saveLearned(learned) {
  const mine = getRepo().prefs?.tohnitLearned || {};
  const { catalog, added } = learnInto({ labels: mine.labels || [], skip: mine.skip || [], symbols: mine.symbols || [] }, learned);
  if (added) await getRepo().saveUserPrefs({ tohnitLearned: { labels: catalog.labels, skip: catalog.skip, symbols: catalog.symbols } });
  return added;
}

// Выбор типа: список типов проекта + «➕ Новый тип» (форма создания типа; после сохранения он сразу выбран)
function typePicker({ extra = [], onChange }) {
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
    status, out), { sticky: true, onClose: () => wk?.stop() });

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
    const qBox = h('div', {});
    for (const q of r.questions) {
      const sel = typePicker({ extra: [['__skip', '🚫 Не точки'], ['__later', '⏳ Разобрать потом']],
        onChange: (v) => { if (v) answers[q.cluster] = v === '__skip' ? 'skip' : v === '__later' ? UNSORTED_TYPE : v; else delete answers[q.cluster]; } });
      const rem = h('input', { type: 'checkbox', checked: true, onchange: () => { rem.checked ? remember.add(q.cluster) : remember.delete(q.cluster); } }); remember.add(q.cluster);
      const imgs = h('div', { style: { display: 'grid', gap: '6px', margin: '6px 0' } });
      qBox.append(h('div', { class: 'card', style: { margin: '8px 0' } },
        h('b', {}, `Что это? ${q.n} шт.`), h('div', { class: 'mut' }, `Например: ${q.samples.slice(0, 6).join('  ·  ')}`), imgs,
        h('label', { class: 'field' }, h('span', {}, 'Это…'), sel), h('label', { class: 'pickrow' }, rem, h('span', {}, 'Запомнить для следующих чертежей'))));
      Promise.all(q.examples.slice(0, 3).map((ex) => cropImg(ex, r.scale))).then((els) => imgs.append(...els)).catch(() => {});
    }
    const again = h('button', { onclick: async () => { again.disabled = true; try { await parse(); } catch (e) { status.textContent = e.message; } } }, '🔄 Разобрать с ответами');
    const next = h('button', { class: r.questions.length ? 'sec' : '', onclick: () => {
      const keep = r.learned.filter((e) => remember.has(e.cluster) && e.type !== UNSORTED_TYPE).map(({ project: _p, ...e }) => e);  // запоминается для всех проектов
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
      const picker = typePicker({ extra: [['__skip', '🚫 Не точки (удалить)']], onChange: (v) => { choice = v; label(); } });
      const rows = h('div', { class: 'picklist', style: { maxHeight: '220px', display: 'none' } }, list.map((p) => {
        const cb = h('input', { type: 'checkbox', checked: true, onchange: () => { cb.checked ? on.add(p.id) : on.delete(p.id); label(); } });
        return h('label', { class: 'pickrow' }, cb, h('span', {}, p.label, p.cabinet ? h('small', {}, ` · шкаф ${p.cabinet}`) : null, p.pos?.sheet ? h('small', {}, ` · ${p.pos.sheet}`) : null));
      }));
      const toggle = h('button', { type: 'button', class: 'sec', onclick: () => { open = !open; rows.style.display = open ? '' : 'none'; toggle.textContent = open ? '▲ Скрыть список' : `▼ По одной (${list.length})`; } }, `▼ По одной (${list.length})`);
      go.onclick = async () => {
        const chosen = list.filter((p) => on.has(p.id)); const repo = getRepo();
        if (choice === '__skip') {
          if (!(await confirmDialog(`Удалить точек: ${chosen.length}? Вернуть можно из истории.`, { yes: 'Удалить', danger: true }))) return;
          redraw = state.ctx; chosen.forEach((p) => repo.remove(pid, 'points', p.id));
        } else { redraw = state.ctx; repo.save(pid, chosen.map((p) => ({ coll: 'points', id: p.id, data: { typeId: choice } }))); }
        let n = 0;
        if (rem.checked) {
          const re = generalize([...new Set(chosen.map((p) => base(p.label)))]);
          if (re) try { n = await saveLearned([choice === '__skip' ? { kind: 'skip', re, learned: true } : { kind: 'labels', re, type: choice, learned: true }]); } catch { /* не страшно */ }
        }
        toast(`${choice === '__skip' ? 'Удалено' : `Тип «${choice}»`}: ${chosen.length}${n ? ' · правило запомнено' : ''}`);
      };
      label();
      return h('div', { class: 'card', style: { margin: '8px 0' } },
        h('b', {}, `${uniq.length <= 3 ? uniq.join(', ') : k} — ${list.length} шт.`), uniq.length > 3 ? h('div', { class: 'mut' }, uniq.slice(0, 8).join('  ·  ')) : null,
        h('label', { class: 'field' }, h('span', {}, 'Это…'), picker),
        h('label', { class: 'pickrow' }, rem, h('span', {}, 'Запомнить для следующих чертежей')),
        h('div', { class: 'btns' }, toggle, go), rows);
    }));
  }
  draw();
  void close;
}
