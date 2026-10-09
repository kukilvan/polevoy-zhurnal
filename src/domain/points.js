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

// Кабель/число кабелей: настройка шкафа (проект + шкаф + тип), иначе значения типа точки.
export function cableOf(point, ctx) {
  const s = ctx.cabinetSettings.find((x) => x.projectId === point.projectId && x.cabinet === point.cabinet
    && x.typeId === point.typeId && !blank(x.cable));
  return s ? s.cable : ctx.types.get(point.typeId)?.defaultCable;
}
export function cablesCountOf(point, ctx) {
  const s = ctx.cabinetSettings.find((x) => x.projectId === point.projectId && x.cabinet === point.cabinet
    && x.typeId === point.typeId && !blank(x.cables));
  return Number(s ? s.cables : ctx.types.get(point.typeId)?.defaultCables ?? 0);
}
// Метраж = длина на 1 кабель × число кабелей; без длины — 0
export const metrageOf = (point, ctx) => round2((Number(point.length) || 0) * cablesCountOf(point, ctx));
