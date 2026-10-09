// Экран «Месяц»: сумма всех дохов месяца (RU) и «דוח חודשי» (HE), копирование и отправка.
import { h, toast } from '../ui.js';
import { state } from '../store.js';
import { monthReportRu, monthReportHe, monthSummary, monthTitle, monthDays } from '../../domain/index.js';
import { copyText, shortcutUrl, todayIso } from './doh.js';

let ym = null;
const shift = (v, d) => { const [y, m] = v.split('-').map(Number); const t = new Date(y, m - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; };

export function monthView(ui) {
  const ctx = state.ctx;
  if (!ym) ym = todayIso().slice(0, 7);
  const s = monthSummary(ctx, ym);
  const ru = monthReportRu(ctx, ym); const he = monthReportHe(ctx, ym);
  const has = monthDays(ctx, ym).length > 0;
  const block = (title, text, rtl, copyLabel) => h('div', { class: 'card' }, h('b', {}, title),
    h('pre', { class: 'dohtext', dir: rtl ? 'rtl' : 'ltr' }, text),
    h('div', { class: 'btns' },
      h('button', { onclick: async () => toast((await copyText(text)) ? 'Скопировано' : 'Не удалось скопировать') }, copyLabel),
      h('a', { class: 'btnlink', href: shortcutUrl(text) }, '➡️ Отправить')));
  return h('div', {},
    h('div', { class: 'btns', style: { marginTop: 0, alignItems: 'center' } },
      h('button', { class: 'sec', onclick: () => { ym = shift(ym, -1); ui.render(); } }, '‹'),
      h('div', { style: { flex: 1, textAlign: 'center', fontWeight: 700 } }, monthTitle(ym)),
      h('button', { class: 'sec', onclick: () => { ym = shift(ym, 1); ui.render(); } }, '›')),
    h('div', { class: 'card' },
      h('div', {}, `Дней: ${s.days} · часов (по минутам в записях): ${s.hours}`),
      s.pulls.length ? h('div', { class: 'mut', style: { marginTop: '6px' } }, s.pulls.map((p) =>
        `Протяжка ${p.cableId}: ${p.count}${p.accounting === 'Метры' ? ` каб., ${p.meters} м` : ' точек'}`).join(' · ')) : null),
    has ? [block('Отчёт начальнику (все дохи месяца, русский)', ru, false, '📋 Копировать RU'),
      block('דוח חודשי (иврит)', he, true, '📋 Копировать HE')]
      : h('div', { class: 'empty' }, 'В этом месяце дней с дохами нет.'));
}
