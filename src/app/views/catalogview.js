// «🧩 Каталог подписей»: правила, по которым разбор чертежа узнаёт точки. Мои правила (выученные из ответов) — смотреть, исправлять, удалять,
// добавлять по примерам, сохранять в файл и загружать. Встроенные — только посмотреть. «Проверить подпись» — какое правило сработает.
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { getRepo, currentProject } from '../store.js';
import { matchLabel, prettyRule, learnInto } from '../../tohnit/engine.js';
import { segment, defaultRoles, buildPattern, describeParts, ROLES } from '../../tohnit/pattern.js';
import { userCatalog, typePicker, DEFAULT_CATALOG } from './tohnitview.js';
import { cablesPicker } from './cablespick.js';

const FORMAT = 'polevoy-tohnit-catalog-1';
let cache = null;  // своё сохранённое — сразу (без сети запись дойдёт позже)
const mine = () => { const m = cache || getRepo().prefs?.tohnitLearned || {}; return { labels: [...(m.labels || [])], skip: [...(m.skip || [])], symbols: [...(m.symbols || [])] }; };
// с другого телефона могли добавить правила, пока окно было открыто: чужие новые (которых не было при открытии) добавляем к сохраняемому
const sig = (m) => JSON.stringify([m.labels, m.skip, m.symbols]);
let baseSig = null; let baseKeys = new Set();
const keyOf = (kind, e) => `${kind}|${e.re || e.symbol || JSON.stringify(e)}|${e.project || ''}`;
const allKeys = (m) => new Set(['labels', 'skip', 'symbols'].flatMap((k) => (m[k] || []).map((e) => keyOf(k, e))));
const saveMine = async (m0) => {
  const remote = getRepo().prefs?.tohnitLearned;
  let m = m0;
  if (remote && baseSig !== null && sig({ labels: remote.labels || [], skip: remote.skip || [], symbols: remote.symbols || [] }) !== baseSig) {
    const have = allKeys(m); m = { labels: [...m.labels], skip: [...m.skip], symbols: [...m.symbols] };
    for (const k of ['labels', 'skip', 'symbols']) for (const e of (remote[k] || [])) { const key = keyOf(k, e); if (!baseKeys.has(key) && !have.has(key)) m[k].push(e); }
  }
  baseSig = sig(m); allKeys(m).forEach((k) => baseKeys.add(k));  // уже виденные ключи не забываем (удалённые не воскресают)
  cache = m; getRepo().saveUserPrefs({ tohnitLearned: { labels: m.labels, skip: m.skip, symbols: m.symbols } }).catch(() => toast('Не удалось сохранить каталог')); };
const validRe = (re) => { try { new RegExp(re); return true; } catch { return false; } };
const same = (a) => (b) => b.re === a.re && (b.project || '') === (a.project || '');
// правило по-человечески: по частям (если настроено по примерам), иначе — из шаблона
const ruleText = (e) => { if (e.parts && e.samples) { const sg = segment(e.samples); if (sg.ok && sg.segs.length === e.parts.length) return describeParts(sg.segs, e.parts); } return prettyRule(e.re); };
const what = (kind, e) => (kind === 'skip' ? '🚫 не точки' : `→ ${e.type}`);

export function catalogModal() {
  const box = h('div', {}); cache = null; { const m0 = mine(); baseSig = sig(m0); baseKeys = allKeys(m0); }
  const close = openModal('🧩 Каталог подписей', box, { sticky: true, onClose: () => { cache = null; } });
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
      h('div', { class: 'mut' }, `Правило: ${ruleText(r.rule)} · ${own ? 'моё' : 'встроенное'}${r.rule.project ? ` · только «${r.rule.project}»` : ''}${extra}`));
  };
  testIn.addEventListener('input', runTest);

  const ruleForm = (kind, rule) => ruleEditor({ kind, rule, onSaved: draw });
  const addForm = () => ruleEditor({ onSaved: draw });

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
    h('div', { class: 'name' }, ruleText(e), h('div', { class: 'sub' }, `${what(kind === 'skip' ? 'skip' : 'label', e)}${e.project ? ` · только «${e.project}»` : ''}${e.expand ? ' · диапазон' : ''}${e.by_icon ? ' · по значку' : ''}${e.near_text ? ' · по тексту рядом' : ''}${e.cables ? ` · кабели ${e.cables.map((c) => `${c.cable}×${c.count}`).join(' + ')}` : ''}`)));

  let showBuiltin = false;
  function draw() {
    const m = mine(); const n = m.labels.length + m.skip.length;
    const builtin = h('div', { class: 'card', style: { padding: 0, display: showBuiltin ? '' : 'none' } },
      ...DEFAULT_CATALOG.labels.map((e) => ruleRow('label', e, false)), ...DEFAULT_CATALOG.skip.map((e) => ruleRow('skip', e, false)));
    const tgl = h('button', { class: 'sec', onclick: () => { showBuiltin = !showBuiltin; draw(); } }, `${showBuiltin ? '▲' : '▼'} Встроенные правила (${DEFAULT_CATALOG.labels.length + DEFAULT_CATALOG.skip.length})`);
    box.replaceChildren(
      h('div', { class: 'mut' }, 'По этим правилам «📐 Добавить точки из чертежа» узнаёт точки. Мои правила — из ваших ответов («Запомнить») и добавленные здесь; они главнее встроенных. Каталог общий для всех проектов.'),
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

// ---- редактор правила: примеры → части подписи → что значит каждая часть → шаблон ----
// rule — своё правило (правка) или нет (новое); samples/type — из вопроса при разборе чертежа
export function ruleEditor({ kind = 'labels', rule = null, samples = null, type = '', onSaved } = {}) {
  if (!rule) cache = null;  // из вопроса при разборе — каталог берём свежий
  let skip = kind === 'skip'; let choice = skip ? '__skip' : (rule?.type || type || '');
  let seg = null; let roles = [];
  const ex = h('textarea', { rows: 4, placeholder: 'Примеры подписей, по одной в строке:\nC2/04\nC2/05\nC2/12' });
  ex.value = (samples || rule?.samples || []).join('\n');
  const partsBox = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '8px 0' } });
  const summary = h('div', { style: { margin: '6px 0', fontWeight: 600 } });
  const testIn = h('input', { type: 'text', placeholder: 'Проверить другую подпись', autocomplete: 'off', autocapitalize: 'characters' });
  const testOut = h('span', { style: { marginInlineStart: '8px' } });
  const reIn = h('input', { type: 'text', value: rule?.re || '', autocomplete: 'off', autocapitalize: 'off' }); let manual = false;
  reIn.addEventListener('input', () => { manual = true; check(); });
  const projIn = h('input', { type: 'text', value: rule?.project || '', placeholder: 'пусто — для всех проектов' });
  const err = h('div', { class: 'err' });
  const current = () => {
    if (manual || !seg?.ok) return { re: reIn.value.trim(), cab: rule?.cab, parts: manual ? undefined : rule?.parts };
    return { ...buildPattern(seg.segs, roles), parts: roles };
  };
  function check() {
    const { re, cab } = current(); let rx = null; try { rx = re ? new RegExp(re) : null; } catch { /* ошибка */ }
    const t = testIn.value.trim();
    testOut.textContent = !t ? '' : !rx ? '⚠️ шаблон с ошибкой' : rx.test(t) ? `✅ подходит${cab ? (() => { const m = t.match(new RegExp(cab)); return m ? ` · шкаф ${m[1]}` : ''; })() : ' · без шкафа'}` : '❌ не подходит';
  }
  testIn.addEventListener('input', check);
  function drawParts(keepRoles) {
    seg = segment(ex.value.split(/[\n,;]+/));
    if (!seg.ok) { partsBox.replaceChildren(h('div', { class: seg.samples ? 'l-warn' : 'mut' }, seg.samples ? seg.error : (rule ? 'Впишите примеры подписей — тогда шаблон можно настроить по частям. Без примеров остаётся текущий шаблон.' : seg.error))); summary.textContent = rule && !seg.samples ? `Сейчас: ${ruleText(rule)}` : ''; check(); return; }
    if (!keepRoles || roles.length !== seg.segs.length) roles = rule?.parts?.length === seg.segs.length && !manual ? [...rule.parts] : defaultRoles(seg.segs);
    partsBox.replaceChildren(...seg.segs.map((sg, i) => {
      const vals = sg.values.length > 4 ? `${sg.values.slice(0, 3).join(' ')} …` : sg.values.join(' ');
      const chip = h('div', { style: { fontFamily: 'monospace', fontSize: '18px', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: '8px', textAlign: 'center', whiteSpace: 'nowrap' } }, sg.kind === 'S' ? '␣' : vals);
      const opts = ROLES[sg.kind];
      const ctl = opts ? h('select', { style: { fontSize: '13px', maxWidth: '170px' }, onchange: (e) => { roles[i] = e.target.value; manual = false; upd(); } },
        ...opts.filter(([v]) => v !== 'const' || sg.values.length <= 6).map(([v, t]) => h('option', { value: v, selected: roles[i] === v }, t)))
        : h('small', { class: 'mut' }, sg.kind === 'S' ? 'пробел' : 'знак — на месте');
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' } }, chip, ctl);
    }));
    upd();
  }
  function upd() {
    if (seg?.ok && !manual) { const { re } = buildPattern(seg.segs, roles); reIn.value = re; summary.textContent = `Шаблон: ${describeParts(seg.segs, roles)}${roles.includes('cab') ? '' : ' · без шкафа'}`; }
    check();
  }
  ex.addEventListener('input', () => drawParts(true));
  const cp = cablesPicker({ compact: true, value: rule?.cables ?? null });
  const cabBox = h('div', { style: { display: 'none', margin: '4px 0 8px' } }, h('small', { class: 'mut' }, 'Кабели каждой такой точки'), cp.el);
  const showCab = (v) => { const real = !!v && v !== '__skip'; cabBox.style.display = real ? '' : 'none'; if (real) cp.setType(v); };
  const pick = typePicker({ extra: [['__skip', '🚫 Не точки']], onChange: (v) => { choice = v; showCab(v); } });
  if (choice) { const sel = pick.querySelector('select'); if (![...sel.options].some((o) => o.value === choice)) sel.append(h('option', { value: choice }, choice)); sel.value = choice; }
  showCab(choice);
  const save = async () => {
    const { re, cab, parts } = current();
    if (!re || !validRe(re)) { err.textContent = 'Нет шаблона — впишите примеры'; return; }
    if (!choice) { err.textContent = 'Выберите тип или «Не точки»'; return; }
    skip = choice === '__skip';
    const smp = seg?.samples || rule?.samples;
    const e = { re, learned: true, ...(cab != null ? { cab } : {}), ...(parts ? { parts } : {}), ...(smp?.length ? { samples: smp.slice(0, 8) } : {}), ...(projIn.value.trim() ? { project: projIn.value.trim() } : {}) };
    const m = mine();
    if (rule) { m.labels = m.labels.filter((x) => !same(rule)(x)); m.skip = m.skip.filter((x) => !same(rule)(x)); }
    if ((skip ? m.skip : m.labels).some(same(e))) { err.textContent = 'Такое правило уже есть'; return; }
    const own = skip ? null : cp.override();
    (skip ? m.skip : m.labels).unshift(skip ? e : { ...e, type: choice, ...(own ? { cables: own } : {}) });
    await saveMine(m); toast(rule ? 'Сохранено' : 'Правило добавлено'); c(); onSaved?.();
  };
  const del = rule ? h('button', { class: 'danger', onclick: async () => {
    if (!(await confirmDialog(`Удалить правило «${ruleText(rule)}»? Такие подписи снова будут спрашиваться.`, { yes: 'Удалить', danger: true }))) return;
    const m = mine(); m.labels = m.labels.filter((x) => !same(rule)(x)); m.skip = m.skip.filter((x) => !same(rule)(x));
    await saveMine(m); toast('Удалено'); c(); onSaved?.();
  } }, 'Удалить') : null;
  const c = openModal(rule ? `Правило: ${ruleText(rule)}` : '➕ Правило по примерам', h('div', {},
    h('label', { class: 'field' }, h('span', {}, 'Примеры подписей'), ex, h('small', {}, 'Подпись делится на части: буквы, цифры, знаки. Под каждой частью выберите, что она значит.')),
    partsBox, summary,
    h('div', { style: { display: 'flex', alignItems: 'center' } }, testIn, testOut),
    h('label', { class: 'field' }, h('span', {}, 'Это…'), pick), cabBox,
    h('label', { class: 'field' }, h('span', {}, 'Только для проекта (часть названия)'), projIn),
    h('details', { style: { margin: '8px 0' } }, h('summary', { class: 'mut' }, 'Шаблон для специалиста'), reIn, h('small', { class: 'mut' }, 'Если поменять здесь вручную, настройка по частям не используется.')),
    err,
    h('div', { class: 'row' }, h('button', { class: 'grow', onclick: save }, rule ? 'Сохранить' : 'Добавить'), del)), { sticky: true });
  drawParts(false);
  return c;
}
