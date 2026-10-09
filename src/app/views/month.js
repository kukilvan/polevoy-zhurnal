// Экран «Месяц»: рабочие дни месяца по всем проектам (дата и место, как в дохе), копирование и отправка.
import { h, toast } from '../ui.js';
import { allDays, liveProjects } from '../store.js';
import { workdaysReport, monthTitle } from '../../domain/index.js';
import { copyText, shortcutUrl, todayIso } from './doh.js';

let ym = null;
const shift = (v, d) => { const [y, m] = v.split('-').map(Number); const t = new Date(y, m - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; };

export function monthView(ui) {
  if (!ym) ym = todayIso().slice(0, 7);
  const rep = workdaysReport(allDays(), liveProjects(), ym);
  return h('div', {},
    h('div', { class: 'btns', style: { marginTop: 0, alignItems: 'center' } },
      h('button', { class: 'sec', onclick: () => { ym = shift(ym, -1); ui.render(); } }, '‹'),
      h('div', { style: { flex: 1, textAlign: 'center', fontWeight: 700 } }, monthTitle(ym)),
      h('button', { class: 'sec', onclick: () => { ym = shift(ym, 1); ui.render(); } }, '›')),
    h('div', { class: 'card' }, `Дней: ${rep.count}`),
    rep.count ? h('div', { class: 'card' }, h('b', {}, 'Рабочие дни:'),
      h('pre', { class: 'dohtext' }, rep.text),
      h('div', { class: 'btns' },
        h('button', { onclick: async () => toast((await copyText(rep.text)) ? 'Скопировано' : 'Не удалось скопировать') }, '📋 Копировать'),
        h('a', { class: 'btnlink', href: shortcutUrl(rep.text) }, '➡️ Отправить')))
      : h('div', { class: 'empty' }, 'В этом месяце дней с дохами нет.'));
}
