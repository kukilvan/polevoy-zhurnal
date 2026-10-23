// Название конфигурации двери плашками: запирание — заливкой, остальное — цветной рамкой, количество «×2» сверху, кабели серым в конце.
// И выбор цвета устройства: основные цвета → оттенки → палитра.
import { h } from '../ui.js';
import { state } from '../store.js';
import { doorTokens, doorShortColor, doorCfgShort } from '../../domain/index.js';

const chip = (t, big) => h('span', { style: {
  display: 'inline-flex', alignItems: 'baseline', gap: '1px', padding: big ? '2px 8px' : '1px 6px', borderRadius: '6px', fontWeight: 700, fontSize: big ? '15px' : '13px', lineHeight: 1.35, whiteSpace: 'nowrap',
  ...(t.lock ? { background: t.color, color: '#fff', border: `1px solid ${t.color}` } : { color: t.color, border: `1.5px solid ${t.color}`, background: `${t.color}1f` }),
} }, t.text, t.count > 1 ? h('sup', { style: { fontSize: '10px', marginInlineStart: '1px' } }, `×${t.count}`) : null);

/** Плашки конфигурации (cfg — запись конфигурации) */
export function doorChips(cfg, { big = false } = {}) {
  const { items, cables } = doorTokens(state.ctx, cfg);
  if (!items.length && !cables.length) return h('span', { class: 'mut' }, cfg?.name || '—');
  return h('span', { style: { display: 'inline-flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' } },
    ...items.map((t) => chip(t, big)),
    cables.length ? h('span', { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: big ? '13px' : '12px', color: 'var(--mut)', marginInlineStart: '2px', whiteSpace: 'nowrap' } },
      cables.map((c) => `${c.cable}×${c.count}`).join(' + ')) : null);
}
/** Короткое ЭМ / МХ плашкой (список точек) */
export function doorShortChip(cfg) {
  const t = doorCfgShort(state.ctx, cfg); if (!t) return null;
  const c = doorShortColor(state.ctx, cfg) || '#8e8e93';
  return h('span', { style: { marginInlineStart: '6px', padding: '0 6px', borderRadius: '5px', background: c, color: '#fff', fontSize: '12px', fontWeight: 700 } }, t);
}

// ---- выбор цвета ----
const BASES = [['Красный', 0, 78], ['Оранжевый', 28, 90], ['Жёлтый', 48, 95], ['Зелёный', 135, 60], ['Бирюзовый', 175, 75], ['Голубой', 200, 85], ['Синий', 220, 85], ['Фиолетовый', 265, 75], ['Розовый', 325, 75], ['Коричневый', 25, 45], ['Серый', 220, 8]];
const LIGHT = [72, 60, 50, 40, 30];
function hsl2hex(hh, s, l) {
  s /= 100; l /= 100; const k = (n) => (n + hh / 30) % 12; const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
  return `#${f(0)}${f(8)}${f(4)}`;
}
/** Поле формы «Цвет»: основные цвета → оттенки выбранного → палитра; «по умолчанию» — пусто. fallback(v) — цвет по умолчанию для подсказки */
export function colorField(key, label, { hint, fallback } = {}) {
  return { key, label, hint, type: 'custom', build: (api) => {
    let val = api.value || ''; let base = null;
    const el = h('div', {});
    const sw = (c, on, onclick, title) => h('button', { type: 'button', title, onclick, style: { width: '34px', height: '34px', padding: 0, borderRadius: '8px', background: c, border: on ? '3px solid var(--txt)' : '1px solid var(--line)', flex: 'none' } });
    const paint = () => {
      let def = '#8e8e93'; try { def = fallback?.(api.values()) || def; } catch { /* форма ещё строится */ }
      const pal = h('input', { type: 'color', value: val || def, style: { width: '56px', height: '36px', padding: '2px', flex: 'none', borderRadius: '8px' }, oninput: (e) => { val = e.target.value; api.changed(); paint(); } });
      el.replaceChildren(
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } },
          h('span', { style: { display: 'inline-block', width: '22px', height: '22px', borderRadius: '6px', background: val || def, border: '1px solid var(--line)' } }),
          h('span', {}, val ? `свой: ${val}` : 'по умолчанию (по части двери)'),
          val ? h('button', { type: 'button', class: 'sec', style: { padding: '2px 10px' }, onclick: () => { val = ''; base = null; api.changed(); paint(); } }, '↺ По умолчанию') : null),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } }, ...BASES.map((b, i) => sw(hsl2hex(b[1], b[2], 50), base === i, () => { base = base === i ? null : i; paint(); }, b[0]))),
        base !== null ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px', alignItems: 'center' } },
          h('small', { class: 'mut' }, `${BASES[base][0]}, оттенки:`),
          ...LIGHT.map((l) => { const c = hsl2hex(BASES[base][1], BASES[base][2], l); return sw(c, val === c, () => { val = c; api.changed(); paint(); }, c); })) : null,
        h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' } }, h('small', { class: 'mut' }, '🎨 Палитра:'), pal));
    };
    paint();
    return { el, get: () => val || undefined };
  } };
}
