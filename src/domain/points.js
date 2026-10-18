// Точки: естественная сортировка, кабели и метраж (разделы 3.4, 3.8, Приложение А).

const pad = (s, n) => String(s).padStart(n, '0');
const blank = (v) => v === undefined || v === null || v === '';
export const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

// «Сорт»: последнее число из обозначения (EXTRACTNUMBERS + ABS), 0 если чисел нет.
export function sortNumber(label) {
  const nums = String(label ?? '').match(/\d+(?:\.\d+)?/g);
  return nums ? Number(nums[nums.length - 1]) : 0;
}

// «Ключ точки» = <до первого "-"> | <буквы перед номером> | <целая часть номера, 5 цифр> | <дробная часть, 3 цифры>
// Для «1A-01-02»: код точки = «01-02», номер берём как ведущее число кода.
// ДОПУЩЕНИЕ: в описании не сказано, как брать номер из кода вида «01-02»; берём ведущее число (1).
export function pointKey(label) {
  const s = String(label ?? '');
  const dash = s.indexOf('-');
  const prefix = dash >= 0 ? s.slice(0, dash) : '';
  const code = dash >= 0 ? s.slice(dash + 1) : s;
  const lead = /^\D*/.exec(code)[0]; // начальные нецифровые символы
  const rest = code.slice(lead.length);
  const m = /^(\d+)(?:\.(\d+))?/.exec(rest);
  const whole = m ? m[1] : '0';
  const frac = m && m[2] ? m[2] : '0';
  return `${prefix}|${lead}|${pad(whole, 5)}|${pad(frac.slice(0, 3), 3)}`;
}

// Естественное сравнение обозначений: числа внутри сравниваются как числа в любом месте (D2/2 < D2/10, GA1/C-9 < GA1/C-10, 07.In-3 < 07.In-12)
// Разделители («-», «/», «_», «.», пробел) и ведущие нули не влияют: «1A/01-02» < «1A-09-10», «AP-3» = «AP03» по порядку.
const natCollator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
const labelTokens = (x) => (String(x ?? '').match(/\d+|[^\d\s\-/_.\\|,:;]+/g) || []).map((t) => (/^\d+$/.test(t) ? Number(t) : t));
export function compareLabels(x, y) {
  const a = labelTokens(x); const b = labelTokens(y);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const p = a[i]; const q = b[i];
    if (typeof p === 'number' && typeof q === 'number') { if (p !== q) return p - q; continue; }
    if (typeof p === 'number') return -1;
    if (typeof q === 'number') return 1;
    const c = natCollator.compare(p, q); if (c) return c;
  }
  if (a.length !== b.length) return a.length - b.length;
  return natCollator.compare(String(x ?? ''), String(y ?? '')) || (String(x ?? '') < String(y ?? '') ? -1 : String(x ?? '') > String(y ?? '') ? 1 : 0);
}

// Сравнение точек: шкаф → тип → обозначение (естественно, по числам).
export function comparePoints(a, b) {
  return compareLabels(a.cabinet ?? '', b.cabinet ?? '') || compareLabels(a.typeId ?? '', b.typeId ?? '') || compareLabels(a.label, b.label);
}

// Кабели точки. Основной кабель и их число: настройка шкафа (проект + шкаф + тип), иначе значения типа точки.
// Дополнительные кабели других видов (extraCables: [{ cable, count }]) — например, интерком: 6005×1 + cat7×1.
const settingOf = (point, ctx, pred) => ctx.cabinetSettings.find((x) => x.projectId === point.projectId && x.cabinet === point.cabinet
  && x.typeId === point.typeId && pred(x));
const cleanList = (list) => (Array.isArray(list) ? list : [])
  .filter((c) => c && !blank(c.cable) && Number(c.count) > 0).map((c) => ({ cable: String(c.cable), count: Number(c.count) }));
const own = (point) => (Array.isArray(point?.cableOverride) ? cleanList(point.cableOverride) : null);  // свои кабели точки целиком
export function cableOf(point, ctx) {
  const o = own(point); if (o) return o[0]?.cable;
  const s = settingOf(point, ctx, (x) => !blank(x.cable));
  return s ? s.cable : ctx.types.get(point.typeId)?.defaultCable;
}
// Число кабелей основного вида
export function mainCablesCountOf(point, ctx) {
  const o = own(point); if (o) return o[0]?.count ?? 0;
  const s = settingOf(point, ctx, (x) => !blank(x.cables));
  return Number(s ? s.cables : ctx.types.get(point.typeId)?.defaultCables ?? 0);
}
export function extraCablesOf(point, ctx) {
  const o = own(point); if (o) return o.slice(1);
  const s = settingOf(point, ctx, (x) => Array.isArray(x.extraCables));
  return cleanList(s ? s.extraCables : ctx.types.get(point.typeId)?.extraCables);
}
// Все кабели точки по видам: [{ cable, count }], первый — основной; одинаковые виды складываются
export function cableListOf(point, ctx) {
  const out = [];
  const add = (cable, count) => {
    if (blank(cable) || !(count > 0)) return;
    const x = out.find((c) => c.cable === cable);
    if (x) x.count += count; else out.push({ cable, count });
  };
  add(cableOf(point, ctx), mainCablesCountOf(point, ctx));
  extraCablesOf(point, ctx).forEach((c) => add(c.cable, c.count));
  return out;
}
// Всего кабелей у точки (всех видов)
export const cablesCountOf = (point, ctx) => cableListOf(point, ctx).reduce((n, c) => n + c.count, 0) || mainCablesCountOf(point, ctx);
// Сколько кабелей вида cableId у точки; вид не указан или не найден — основной (как раньше)
export function cableCountFor(point, ctx, cableId) {
  const list = cableListOf(point, ctx);
  const x = !blank(cableId) && list.find((c) => c.cable === cableId);
  return x ? x.count : (list[0]?.count ?? mainCablesCountOf(point, ctx));
}
// «cat7×1, 6005×2» ⇄ [{ cable, count }]
export const cablesText = (list, sep = ' + ') => (list || []).map((c) => `${c.cable}×${c.count}`).join(sep);
export function parseCables(text) {
  const out = []; const bad = [];
  String(text ?? '').split(/[,;+\n]/).map((x) => x.trim()).filter(Boolean).forEach((part) => {
    const m = /^(.+?)\s*[×xхX*]\s*(\d+(?:[.,]\d+)?)$/.exec(part);
    if (m) out.push({ cable: m[1].trim(), count: Number(m[2].replace(',', '.')) }); else bad.push(part);
  });
  return { list: out, bad };
}
// Метраж = длина на 1 кабель × число кабелей (всех видов); без длины — 0
export const metrageOf = (point, ctx) => round2((Number(point.length) || 0) * cablesCountOf(point, ctx));

// Название следующей точки: последняя (по номеру) точка этого типа в этом шкафу + 1 в том же формате.
// Пары «17-18» → «19-20»; ведущие нули сохраняются (C-083 → C-084); нет таких точек — ''.
export function nextLabel(points, typeId, cabinet = '') {
  const same = [...points].filter((p) => p.typeId === typeId && (p.cabinet || '') === (cabinet || '') && !/#\d+$/.test(p.label)).sort((a, b) => compareLabels(a.label, b.label));
  const last = same[same.length - 1]?.label; if (!last) return '';
  const used = new Set([...points].map((p) => p.label));
  const pad = (n, w) => String(n).padStart(w, '0');
  const bump = (l) => {
    const pair = l.match(/^(.*?)(\d+)([-_/])(\d+)$/);
    if (pair && +pair[4] === +pair[2] + 1) { const st = +pair[4] - +pair[2] + 1; return `${pair[1]}${pad(+pair[2] + st, pair[2].length)}${pair[3]}${pad(+pair[4] + st, pair[4].length)}`; }
    const m = l.match(/^(.*?)(\d+)(\D*)$/); if (!m) return '';
    return `${m[1]}${pad(+m[2] + 1, m[2].length)}${m[3]}`;
  };
  let next = bump(last); let guard = 0;
  while (next && used.has(next) && guard++ < 500) next = bump(next);
  return next;
}

// Подпись нескольких точек на одной отметке плана: по порядку (TV13, TV14 … TV19) — «TV13-19»; вразнобой — каждая отдельно, по порядку
export function combineLabels(labels) {
  const ls = [...new Set(labels)].sort((a, b) => compareLabels(a, b));
  if (ls.length < 2) return ls;
  const ps = ls.map((l) => l.match(/^(.*?)(\d+)$/));
  if (ps.every(Boolean) && ps.every((m) => m[1] === ps[0][1])) {
    const nums = ps.map((m) => +m[2]);
    if (nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)) return [`${ls[0]}-${ps[ps.length - 1][2]}`];
  }
  return ls;
}

// Групповое переименование: заменить/убрать текст (в начале, в конце или везде), сдвинуть номер, добавить в начало/конец.
// Номер — последнее число; пара «17-18» сдвигается целиком. Ведущие нули сохраняются.
export function renameLabel(label, { find = '', replace = '', where = 'any', shift = 0, prefix = '', suffix = '' } = {}) {
  let s = String(label);
  if (find) {
    if (where === 'start') { if (s.startsWith(find)) s = replace + s.slice(find.length); }
    else if (where === 'end') { if (s.endsWith(find)) s = s.slice(0, s.length - find.length) + replace; }
    else s = s.split(find).join(replace);
  }
  const n = Math.trunc(Number(shift) || 0);
  if (n) {
    const pad = (v, w) => (v < 0 ? String(v) : String(v).padStart(w, '0'));
    const pair = s.match(/^(.*?)(\d+)([-_/])(\d+)(\D*)$/);
    if (pair && +pair[4] === +pair[2] + 1) s = `${pair[1]}${pad(+pair[2] + n, pair[2].length)}${pair[3]}${pad(+pair[4] + n, pair[4].length)}${pair[5]}`;
    else { const m = s.match(/^(.*?)(\d+)(\D*)$/); if (m) s = `${m[1]}${pad(+m[2] + n, m[2].length)}${m[3]}`; }
  }
  return `${prefix}${s}${suffix}`;
}
