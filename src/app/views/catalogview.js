// «🧩 Каталог подписей»: правила, по которым разбор чертежа узнаёт точки. Мои правила (выученные из ответов) — смотреть, исправлять, удалять,
// добавлять по примерам, сохранять в файл и загружать. Встроенные — только посмотреть. «Проверить подпись» — какое правило сработает.
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { getRepo, currentProject } from '../store.js';
import { matchLabel, prettyRule, generalize, learnInto } from '../../tohnit/engine.js';
import { userCatalog, typePicker, DEFAULT_CATALOG } from './tohnitview.js';

const FORMAT = 'polevoy-tohnit-catalog-1';
let cache = null;  // своё сохранённое — сразу (без сети запись дойдёт позже)
const mine = () => { const m = cache || getRepo().prefs?.tohnitLearned || {}; return { labels: [...(m.labels || [])], skip: [...(m.skip || [])], symbols: [...(m.symbols || [])] }; };
const saveMine = async (m) => { cache = m; getRepo().saveUserPrefs({ tohnitLearned: { labels: m.labels, skip: m.skip, symbols: m.symbols } }).catch(() => toast('Не удалось сохранить каталог')); };
const validRe = (re) => { try { new RegExp(re); return true; } catch { return false; } };
const same = (a) => (b) => b.re === a.re && (b.project || '') === (a.project || '');
const what = (kind, e) => (kind === 'skip' ? '🚫 не точки' : `→ ${e.type}`);

export function catalogModal() {
  const box = h('div', {}); cache = null;
  const close = openModal('🧩 Каталог подписей', box, { sticky: true });
  void close;

  // проверка подписи
  const testIn = h('input', { type: 'text', placeholder: 'Например: GA1/C-57 или TV140', autocomplete: 'off', autocapitalize: 'characters' });
  const testOut = h('div', { style: { marginTop: '6px', fontSize: '14px' } });
  const runTest = () => {
    const t = testIn.value.trim(); if (!t) { testOut.textContent = ''; return; }
    const m = mine(); const project = currentProject()?.name || '';
    const r = matchLabel(t, userCatalog(), project);
    if (!r) { testOut.replaceChildren(h('span', { class: 'l-warn' }, '❓ Не знаю — при разборе будет вопрос')); return; }
    const own = (r.kind === 'skip' ? m.skip : m.labels).some(same(r.rule));
    const extra = r.kind === 'label' && (r.rule.by_icon || r.rule.near_text) ? ' (тип может уточниться по значку или тексту рядом)' : '';
    testOut.replaceChildren(h('b', {}, r.kind === 'skip' ? '🚫 Не точка' : `✅ ${r.rule.type}${r.rule.expand ? ' (диапазон разворачивается)' : ''}`),
      h('div', { class: 'mut' }, `Правило: ${prettyRule(r.rule.re)} · ${own ? 'моё' : 'встроенное'}${r.rule.project ? ` · только «${r.rule.project}»` : ''}${extra}`));
  };
  testIn.addEventListener('input', runTest);

  function ruleForm(kind, rule) {  // правка своего правила
    let type = rule.type || ''; let skip = kind === 'skip';
    const reIn = h('input', { type: 'text', value: rule.re, autocomplete: 'off', autocapitalize: 'off' });
    const projIn = h('input', { type: 'text', value: rule.project || '', placeholder: 'пусто — для всех проектов' });
    const err = h('div', { class: 'err' });
    const pick = typePicker({ extra: [['__skip', '🚫 Не точки']], onChange: (v) => { skip = v === '__skip'; type = skip ? '' : v; } });
    pick.querySelector('select').value = skip ? '__skip' : type;
    const c = openModal(`Правило: ${prettyRule(rule.re)}`, h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'Это…'), pick),
      h('label', { class: 'field' }, h('span', {}, 'Шаблон подписи (регулярное выражение)'), reIn, h('small', {}, 'Менять, только если понимаете. Проще удалить правило и добавить заново по примерам.')),
      h('label', { class: 'field' }, h('span', {}, 'Только для проекта (часть названия)'), projIn),
      err,
      h('div', { class: 'row' },
        h('button', { class: 'grow', onclick: async () => {
          const re = reIn.value.trim(); if (!validRe(re)) { err.textContent = 'Шаблон с ошибкой'; return; }
          if (!skip && !type) { err.textContent = 'Выберите тип'; return; }
          const m = mine(); m.labels = m.labels.filter((x) => !same(rule)(x)); m.skip = m.skip.filter((x) => !same(rule)(x));
          const e = { re, learned: true, ...(projIn.value.trim() ? { project: projIn.value.trim() } : {}) };
          (skip ? m.skip : m.labels).unshift(skip ? e : { ...e, type });
          await saveMine(m); toast('Сохранено'); c(); draw();
        } }, 'Сохранить'),
        h('button', { class: 'danger', onclick: async () => {
          if (!(await confirmDialog(`Удалить правило «${prettyRule(rule.re)}»? Такие подписи снова будут спрашиваться.`, { yes: 'Удалить', danger: true }))) return;
          const m = mine(); m.labels = m.labels.filter((x) => !same(rule)(x)); m.skip = m.skip.filter((x) => !same(rule)(x));
          await saveMine(m); toast('Удалено'); c(); draw();
        } }, 'Удалить'))));
  }

  function addForm() {  // новое правило по примерам подписей
    let choice = '';
    const ex = h('textarea', { rows: 3, placeholder: 'Примеры подписей, по одной в строке:\nGA1/R-01\nGB/R-12' });
    const projIn = h('input', { type: 'text', placeholder: 'пусто — для всех проектов' });
    const prev = h('div', { class: 'mut', style: { margin: '6px 0' } });
    const err = h('div', { class: 'err' });
    const samples = () => ex.value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const upd = () => { const re = generalize(samples()); prev.textContent = re ? `Шаблон: ${prettyRule(re)}` : ''; };
    ex.addEventListener('input', upd);
    const pick = typePicker({ extra: [['__skip', '🚫 Не точки']], onChange: (v) => { choice = v; } });
    const c = openModal('➕ Правило по примерам', h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'Примеры подписей'), ex, h('small', {}, 'Приложение само поймёт, что меняется (шкаф, номер), а что постоянно.')), prev,
      h('label', { class: 'field' }, h('span', {}, 'Это…'), pick),
      h('label', { class: 'field' }, h('span', {}, 'Только для проекта (часть названия)'), projIn),
      err,
      h('div', { class: 'row' }, h('button', { class: 'grow', onclick: async () => {
        const re = generalize(samples()); if (!re) { err.textContent = 'Введите примеры подписей'; return; }
        if (!choice) { err.textContent = 'Выберите тип или «Не точки»'; return; }
        const e = { re, learned: true, ...(projIn.value.trim() ? { project: projIn.value.trim() } : {}) };
        const { catalog, added } = learnInto(mine(), [choice === '__skip' ? { kind: 'skip', ...e } : { kind: 'labels', ...e, type: choice }]);
        if (!added) { err.textContent = 'Такое правило уже есть'; return; }
        await saveMine(catalog); toast('Правило добавлено'); c(); draw();
      } }, 'Добавить'))));
  }

  function exportFile() {
    const m = mine();
    const blob = new Blob([JSON.stringify({ format: FORMAT, saved: new Date().toISOString(), labels: m.labels, skip: m.skip, symbols: m.symbols }, null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `каталог_подписей_${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
  }
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0]; fileIn.value = ''; if (!f) return;
    let d; try { d = JSON.parse(await f.text()); } catch { toast('Файл не читается'); return; }
    if (d?.format !== FORMAT) { toast('Это не файл каталога подписей'); return; }
    const items = [...(d.skip || []).map((e) => ({ kind: 'skip', ...e })), ...(d.labels || []).map((e) => ({ kind: 'labels', ...e })), ...(d.symbols || []).map((e) => ({ kind: 'symbols', ...e }))]
      .filter((e) => e.kind === 'symbols' || (e.re && validRe(e.re)));
    const { catalog, added } = learnInto(mine(), items.reverse());  // reverse: unshift вернёт исходный порядок
    if (added) await saveMine(catalog);
    toast(added ? `Добавлено правил: ${added}` : 'Новых правил нет'); draw();
  });

  const ruleRow = (kind, e, editable) => h('div', { class: 'item', onclick: editable ? () => ruleForm(kind, e) : null },
    h('div', { class: 'name' }, prettyRule(e.re), h('div', { class: 'sub' }, `${what(kind === 'skip' ? 'skip' : 'label', e)}${e.project ? ` · только «${e.project}»` : ''}${e.expand ? ' · диапазон' : ''}${e.by_icon ? ' · по значку' : ''}${e.near_text ? ' · по тексту рядом' : ''}`)));

  let showBuiltin = false;
  function draw() {
    const m = mine(); const n = m.labels.length + m.skip.length;
    const builtin = h('div', { class: 'card', style: { padding: 0, display: showBuiltin ? '' : 'none' } },
      ...DEFAULT_CATALOG.labels.map((e) => ruleRow('label', e, false)), ...DEFAULT_CATALOG.skip.map((e) => ruleRow('skip', e, false)));
    const tgl = h('button', { class: 'sec', onclick: () => { showBuiltin = !showBuiltin; draw(); } }, `${showBuiltin ? '▲' : '▼'} Встроенные правила (${DEFAULT_CATALOG.labels.length + DEFAULT_CATALOG.skip.length})`);
    box.replaceChildren(
      h('div', { class: 'mut' }, 'По этим правилам «📐 Из чертежа» узнаёт точки. Мои правила — из ваших ответов («Запомнить») и добавленные здесь; они главнее встроенных. Каталог общий для всех проектов.'),
      h('label', { class: 'field' }, h('span', {}, '🔎 Проверить подпись'), testIn), testOut,
      h('div', { class: 'btns' }, h('button', { onclick: addForm }, '➕ Правило по примерам'),
        h('button', { class: 'sec', onclick: exportFile, disabled: !n }, '💾 Сохранить в файл'), h('button', { class: 'sec', onclick: () => fileIn.click() }, '📂 Загрузить из файла'), fileIn),
      h('div', { class: 'group', style: { margin: '12px 2px 6px' } }, `Мои правила (${n}) — нажмите, чтобы исправить или удалить`),
      h('div', { class: 'card', style: { padding: 0 } }, n ? [...m.labels.map((e) => ruleRow('label', e, true)), ...m.skip.map((e) => ruleRow('skip', e, true))] : h('div', { class: 'empty' }, 'Пока нет — появятся, когда ответите на вопросы с галкой «Запомнить».')),
      h('div', { class: 'btns' }, tgl), builtin);
    runTest();
  }
  draw();
}
