// Кириллица ↔ латиница в названиях точек: буквы-двойники (С108 кириллицей → C108 латиницей), поиск без учёта раскладки,
// быстрый ввод («тв » → «TV »), как T9.
const LOOK = { 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x' };
const CYR = /[Ѐ-ӿ]/;

/** Название с буквами-двойниками → латиница. Если в названии есть настоящая русская буква без двойника (Щит, Б12) — не трогаем */
export function fixLatin(s) {
  if (typeof s !== 'string' || !CYR.test(s)) return s;
  for (const ch of s) if (CYR.test(ch) && !(ch in LOOK)) return s;
  return [...s].map((ch) => LOOK[ch] || ch).join('');
}
/** Ключ для поиска: без регистра, двойники сведены к латинице (в любом слове) */
export const latinKey = (s) => [...String(s ?? '').toLowerCase()].map((ch) => LOOK[ch] || LOOK[ch.toUpperCase()]?.toLowerCase() || ch).join('');
/** Есть ли у названия кириллица, которую можно исправить */
export const needsFix = (s) => typeof s === 'string' && fixLatin(s) !== s;

/** Шкаф: если такой уже есть (с точностью до раскладки) — берём существующее написание, иначе исправляем */
export function fixCabinet(c, existing) {
  if (typeof c !== 'string' || !c) return c;
  if (existing.has(c)) return c;
  const k = latinKey(c); for (const e of existing) if (latinKey(e) === k) return e;
  return fixLatin(c);
}

// быстрый ввод
export const DEFAULT_SHORTCUTS = [['тв', 'TV'], ['кам', 'CAM'], ['ап', 'AP'], ['инт', 'INT'], ['ср', 'CR'], ['дв', 'DR'], ['г', 'G'], ['д', 'D']];
export const shortcutsToText = (list) => list.map(([k, v]) => `${k} = ${v}`).join('\n');
export function shortcutsFromText(text) {
  return String(text || '').split('\n').map((l) => l.split('=')).filter((p) => p.length >= 2)
    .map((p) => [p[0].trim().toLowerCase(), p.slice(1).join('=').trim()]).filter(([k, v]) => k && v);
}
const LETTER = /[A-Za-zЀ-ӿ]/;
/**
 * Только что набран символ ch в позиции caret-1. Если до него целое слово из букв, совпавшее с ключом, — заменить на значение.
 * → { text, caret, from, to } или null
 */
export function expandShortcut(text, caret, dict) {
  if (caret < 2) return null;
  const ch = text[caret - 1]; if (LETTER.test(ch)) return null;
  let i = caret - 1; while (i > 0 && LETTER.test(text[i - 1])) i--;
  const word = text.slice(i, caret - 1); if (!word) return null;
  const hit = dict.find(([k]) => k === word.toLowerCase()); if (!hit) return null;
  const out = text.slice(0, i) + hit[1] + text.slice(caret - 1);
  return { text: out, caret: i + hit[1].length + 1, from: i, to: i + hit[1].length };
}
