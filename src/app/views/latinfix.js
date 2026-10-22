// Настройки: быстрый ввод латиницей (список «тв = TV») и поиск названий с перепутанной раскладкой.
import { h, openModal, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { fixLatin, fixCabinet, needsFix, DEFAULT_SHORTCUTS, shortcutsToText, shortcutsFromText, compareLabels, sameLabelClash } from '../../domain/index.js';

export const shortcutsText = () => getRepo()?.prefs?.latinShortcuts ?? shortcutsToText(DEFAULT_SHORTCUTS);
let cacheKey = null; let cacheVal = [];
export function currentShortcuts() { const t = shortcutsText(); if (t !== cacheKey) { cacheKey = t; cacheVal = shortcutsFromText(t); } return cacheVal; }

export function shortcutsModal() {
  const ta = h('textarea', { rows: 12, value: shortcutsText(), style: { width: '100%', fontFamily: 'monospace' }, autocapitalize: 'off', spellcheck: false });
  const close = openModal('⌨ Быстрый ввод латиницей', h('div', {},
    h('div', { class: 'mut', style: { marginBottom: '6px' } }, 'В полях названий точек, шкафов и в переименовании: набрал слово из левой части и нажал пробел (или дефис, цифру) — оно само станет правой. Стёр результат вручную — это слово больше не заменяется. Одна строка — одна замена: «кам = CAM».'),
    ta,
    h('div', { class: 'btns' },
      h('button', { onclick: () => { getRepo().saveUserPrefs({ latinShortcuts: ta.value }); toast('Сохранено'); close(); } }, 'Сохранить'),
      h('button', { class: 'sec', onclick: () => { ta.value = shortcutsToText(DEFAULT_SHORTCUTS); } }, '↺ Стандартные'))));
}

/** Найти названия точек (и имена в плане), где кириллица-двойник вместо латиницы; применить выбранные */
export function fixLayoutModal() {
  const pts = [...state.ctx.points.values()];
  const rows = [];
  pts.forEach((p) => {
    const to = fixLatin(p.label); const pn = typeof p.planName === 'string' ? fixLatin(p.planName) : p.planName;
    if (to !== p.label || pn !== p.planName) rows.push({ p, to, pn });
  });
  rows.sort((a, b) => compareLabels(a.p.label, b.p.label));
  // конфликты: после замены такое название уже есть в том же шкафу (у другой точки или среди исправляемых)
  const taken = new Map(); pts.forEach((p) => taken.set(`${p.cabinet || ''}\u0000${p.label}`, p.id));
  const fixedIds = new Set(rows.map((r) => r.p.id));
  const cnt = new Map(); rows.forEach((r) => { const k = `${r.p.cabinet || ''}\u0000${r.to}`; cnt.set(k, (cnt.get(k) || 0) + 1); });
  rows.forEach((r) => {
    const k = `${r.p.cabinet || ''}\u0000${r.to}`; const other = taken.get(k);
    r.bad = r.to !== r.p.label && ((other && other !== r.p.id && !fixedIds.has(other)) || cnt.get(k) > 1 || pts.some((o) => o.id !== r.p.id && sameLabelClash(o, { label: r.to, cabinet: r.p.cabinet }) && !fixedIds.has(o.id)));
    r.on = !r.bad;
  });
  const box = h('div', {});
  if (!rows.length) { box.append(h('div', { class: 'empty' }, 'Всё в порядке: названий с перепутанной раскладкой нет ✅')); openModal('🔤 Раскладка в названиях', box); return; }
  const info = h('div', { style: { margin: '6px 0', fontWeight: 600 } });
  const cnts = () => { info.textContent = `Исправить: ${rows.filter((r) => r.on).length} из ${rows.length}${rows.some((r) => r.bad) ? ` · пропущены из-за совпадения названий: ${rows.filter((r) => r.bad).length}` : ''}`; };
  const list = h('div', { class: 'picklist', style: { maxHeight: '50vh' } }, ...rows.map((r) => {
    const cb = h('input', { type: 'checkbox', checked: r.on, disabled: !!r.bad, onchange: () => { r.on = cb.checked; cnts(); } });
    return h('label', { class: 'pickrow' }, cb, h('span', {}, r.p.label !== r.to ? `${r.p.label} → ${r.to}` : `${r.p.planName} → ${r.pn} (имя в плане)`), r.bad ? h('small', { style: { color: '#e5484d' } }, 'такое название уже есть') : null);
  }));
  cnts();
  const close = openModal('🔤 Раскладка в названиях', h('div', {},
    h('div', { class: 'mut' }, 'Названия, где вместо латинской буквы стоит такая же на вид русская (С, Т, Н, К…). Исправляются только они; слова с настоящими русскими буквами не трогаются.'),
    info, list,
    h('div', { class: 'btns' }, h('button', { onclick: () => {
      const ops = rows.filter((r) => r.on).map((r) => ({ coll: 'points', id: r.p.id, data: { ...(r.to !== r.p.label ? { label: r.to } : {}), ...(r.pn !== r.p.planName ? { planName: r.pn } : {}) } }));
      if (ops.length) getRepo().save(currentProject().id, ops);
      toast(`Исправлено названий: ${ops.length}`); close();
    } }, 'Исправить отмеченные'))));
}
void needsFix; void fixCabinet;
