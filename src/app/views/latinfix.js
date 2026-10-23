// Настройки: быстрый ввод латиницей (список «тв = TV») и поиск названий с перепутанной раскладкой.
import { h, openModal, toast, confirmDialog } from '../ui.js';
import { printedPortsOf } from '../../domain/rack.js';
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

void needsFix; void fixCabinet;
