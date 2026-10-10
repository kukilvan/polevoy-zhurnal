// Экран «Месяц»: рабочие дни месяца по всем проектам (дата и место, как в дохе), копирование и отправка.
import { h, toast } from '../ui.js';
import { allDays, liveProjects, state, currentProject } from '../store.js';
import { workdaysReport, monthTitle, downtimeByCulprit, hm, dateText } from '../../domain/index.js';
import { copyText, shortcutUrl, todayIso } from './doh.js';

let ym = null;
const shift = (v, d) => { const [y, m] = v.split('-').map(Number); const t = new Date(y, m - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; };

// Простои по виновникам (текущий проект): нажатие на строку раскрывает записи
function downtimeCard() {
  const p = currentProject(); if (!p || !state.ctx) return null;
  const { list, totalMinutes } = downtimeByCulprit(state.ctx, ym);
  if (!list.length) return h('div', { class: 'card' }, h('b', {}, '⏱ Простои по виновникам'), h('div', { class: 'mut', style: { marginTop: '6px' } }, `В проекте «${p.name}» за этот месяц записей с виновником нет.`));
  const text = [`Простои – ${monthTitle(ym)}`, ...list.map((g) => `${g.culprit}: ${hm(g.minutes)}${g.count > 1 ? ` (${g.count})` : ''}`), `Всего: ${hm(totalMinutes)}`].join('\n');
  return h('div', { class: 'card' }, h('b', {}, '⏱ Простои по виновникам'), h('div', { class: 'mut' }, `Проект «${p.name}». Всего: ${hm(totalMinutes)}`),
    h('div', { style: { marginTop: '8px' } }, list.map((g) => {
      const det = h('div', { class: 'mut', style: { display: 'none', padding: '4px 0 8px 12px' } }, g.items.map((i) => h('div', {}, `${dateText(i.date)} · ${i.work}${i.minutes ? ` · ${hm(i.minutes)}` : ''}${i.note ? ` · ${i.note}` : ''}`)));
      return h('div', {}, h('button', { class: 'sec dt-row', onclick: () => { det.style.display = det.style.display === 'none' ? '' : 'none'; } },
        h('span', {}, g.culprit), h('b', { class: 'dt-num' }, `${hm(g.minutes)}${g.count > 1 ? ` · ${g.count}` : ''}`)), det);
    })),
    h('div', { class: 'btns' }, h('button', { onclick: async () => toast((await copyText(text)) ? 'Скопировано' : 'Не удалось скопировать') }, '📋 Копировать')));
}

export function monthView(ui) {
  if (!ym) ym = todayIso().slice(0, 7);
  const rep = workdaysReport(allDays(), liveProjects(), ym);
  return h('div', {},
    h('div', { class: 'monthnav' },
      h('button', { class: 'sec', onclick: () => { ym = shift(ym, -1); ui.render(); } }, '‹'),
      h('div', { class: 'monthnav-title' }, monthTitle(ym)),
      h('button', { class: 'sec', onclick: () => { ym = shift(ym, 1); ui.render(); } }, '›')),
    h('div', { class: 'card' }, `Дней: ${rep.count}`),
    downtimeCard(),
    rep.count ? h('div', { class: 'card' }, h('b', {}, 'Рабочие дни:'),
      h('pre', { class: 'dohtext' }, rep.text),
      h('div', { class: 'btns' },
        h('button', { onclick: async () => toast((await copyText(rep.text)) ? 'Скопировано' : 'Не удалось скопировать') }, '📋 Копировать'),
        h('a', { class: 'btnlink', href: shortcutUrl(rep.text) }, '➡️ Отправить')))
      : h('div', { class: 'empty' }, 'В этом месяце дней с дохами нет.'));
}
