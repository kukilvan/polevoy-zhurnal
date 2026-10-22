// Генератор точек пачкой (раздел 2.4): Префикс + номер (+ «-» следующий номер для пары) (+ суффикс).
const pad = (n, digits) => String(n).padStart(Math.max(0, Number(digits) || 0), '0');

export const parseSuffixes = (text) => [...new Set(String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean))];  // повторы убираем

export const MAX_GENERATED = 2000;

export function generateLabels({ prefix = '', from, to, step = 1, digits = 0, suffixes = [], pair = false }) {
  const a = Number(from); const b = Number(to); let st = Number(step) || 1;
  if (pair && st < 2) st = 2;  // пара «01-02» занимает два номера: следующая начинается с 03, а не с 02
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || st < 1) return [];
  const out = [];
  for (let n = a; n <= b && out.length < MAX_GENERATED; n += st) {
    const base = `${prefix}${pad(n, digits)}${pair ? `-${pad(n + 1, digits)}` : ''}`;
    if (suffixes.length) suffixes.forEach((s) => out.push(`${base}${s}`)); else out.push(base);
  }
  return [...new Set(out)].slice(0, MAX_GENERATED);
}

// Сколько точек получилось бы без ограничения (чтобы предупредить об обрезке до MAX_GENERATED)
export function generatedTotal({ from, to, step = 1, suffixes = [], pair = false }) {
  const a = Number(from); const b = Number(to); let st = Number(step) || 1;
  if (pair && st < 2) st = 2;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || st < 1) return 0;
  return (Math.floor((b - a) / st) + 1) * (suffixes.length || 1);
}
