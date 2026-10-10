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

// Сравнение точек: шкаф → тип → ключ точки → обозначение (как в таблице руководителя).
export function comparePoints(a, b) {
  const c = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  return c(a.cabinet ?? '', b.cabinet ?? '') || c(a.typeId ?? '', b.typeId ?? '')
    || c(pointKey(a.label), pointKey(b.label)) || c(a.label ?? '', b.label ?? '');
}

// Кабели точки. Основной кабель и их число: настройка шкафа (проект + шкаф + тип), иначе значения типа точки.
// Дополнительные кабели других видов (extraCables: [{ cable, count }]) — например, интерком: 6005×1 + cat7×1.
const settingOf = (point, ctx, pred) => ctx.cabinetSettings.find((x) => x.projectId === point.projectId && x.cabinet === point.cabinet
  && x.typeId === point.typeId && pred(x));
export function cableOf(point, ctx) {
  const s = settingOf(point, ctx, (x) => !blank(x.cable));
  return s ? s.cable : ctx.types.get(point.typeId)?.defaultCable;
}
// Число кабелей основного вида
export function mainCablesCountOf(point, ctx) {
  const s = settingOf(point, ctx, (x) => !blank(x.cables));
  return Number(s ? s.cables : ctx.types.get(point.typeId)?.defaultCables ?? 0);
}
const cleanList = (list) => (Array.isArray(list) ? list : [])
  .filter((c) => c && !blank(c.cable) && Number(c.count) > 0).map((c) => ({ cable: String(c.cable), count: Number(c.count) }));
export function extraCablesOf(point, ctx) {
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
