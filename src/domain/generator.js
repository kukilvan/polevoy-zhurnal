// Генератор точек пачкой (раздел 2.4): Префикс + номер (+ «-» следующий номер для пары) (+ суффикс).
const pad = (n, digits) => String(n).padStart(Math.max(0, Number(digits) || 0), '0');

export const parseSuffixes = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export const MAX_GENERATED = 2000;

export function generateLabels({ prefix = '', from, to, step = 1, digits = 0, suffixes = [], pair = false }) {
  const a = Number(from); const b = Number(to); const st = Number(step) || 1;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || st < 1) return [];
  const out = [];
  for (let n = a; n <= b && out.length < MAX_GENERATED; n += st) {
    const base = `${prefix}${pad(n, digits)}${pair ? `-${pad(n + 1, digits)}` : ''}`;
    if (suffixes.length) suffixes.forEach((s) => out.push(`${base}${s}`)); else out.push(base);
  }
  return out.slice(0, MAX_GENERATED);
}
