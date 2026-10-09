import { h, toast } from '../ui.js';
import { getLines, clearLog, asText, info, warn } from '../../log.js';
import { state, currentProject } from '../store.js';

export function logView(ui, diag) {
  const rows = getLines().map((r) => h('div', { class: `l-${r.level}` }, `${r.t} ${r.text}`));
  const lines = [
    `Сборка: ${diag.build}`, `Устройство: ${diag.device}`, `Экран «Домой» (standalone): ${diag.standalone ? 'да' : 'нет'}`,
    `Сеть: ${state.online ? 'онлайн' : 'офлайн'}`, `Хранилище: ${diag.backend}`, `Кэш Firestore: ${diag.cacheMode}`,
    `Пользователь: ${diag.userEmail}`, `Проект: ${currentProject()?.name || '—'}`, `User-Agent: ${navigator.userAgent}`,
  ];
  const box = h('pre', { class: 'log', id: 'logBox' }, rows.length ? rows : 'Пусто');
  setTimeout(() => { box.scrollTop = box.scrollHeight; }, 0);
  return h('div', {},
    h('div', { class: 'card mut' }, lines.map((l) => h('div', {}, l))),
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      h('button', { class: 'grow', onclick: async (e) => {
        try { await navigator.clipboard.writeText(asText()); info('Журнал скопирован в буфер'); e.target.textContent = 'Скопировано ✓'; }
        catch (err) {
          warn('Буфер недоступен, выделяю текст', err);
          const r = document.createRange(); r.selectNodeContents(box); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
          toast('Текст выделен — скопируйте вручную');
        }
      } }, 'Скопировать журнал'),
      h('button', { class: 'danger', onclick: () => { clearLog(); ui.render(); } }, 'Очистить')),
    box);
}
