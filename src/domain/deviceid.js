// Серийный номер и MAC устройства: разбор считанных штрихкодов/QR, нормализация, дубли.

// Типы точек, у которых есть серийный номер/MAC (по умолчанию камеры и вайфай; можно включить в справочнике типов)
export const hasDeviceId = (type) => (type ? (type.scanId ?? ['Камера', 'Вайфай'].includes(type.id)) : false);

const MAC_RE = /(?<![0-9A-Fa-f])[0-9A-Fa-f]{2}(?:[:\-.]?[0-9A-Fa-f]{2}){5}(?![0-9A-Fa-f])/g;

// MAC к виду AA:BB:CC:DD:EE:FF; не MAC — пустая строка
export function normalizeMac(text) {
  const hex = String(text ?? '').replace(/[^0-9A-Fa-f]/g, '');
  if (hex.length !== 12 || /[^0-9A-Fa-f]/.test(String(text).replace(/[:\-.\s]/g, ''))) return '';
  return hex.toUpperCase().match(/../g).join(':');
}

// Все MAC внутри строки (в т.ч. 12 шестнадцатеричных символов подряд)
export function macsIn(text) {
  const out = [];
  String(text ?? '').replace(MAC_RE, (m) => { const n = normalizeMac(m); if (n && !out.includes(n)) out.push(n); return m; });
  return out;
}

const SN_LABEL = /(?:\bS\/?N\b|\bSerial(?:\s*(?:No\.?|Number|#))?)\s*[:=#]?\s*([A-Za-z0-9][A-Za-z0-9\-_.]{3,})/gi;
const URL_PARAM = /[?&](?:sn|serial|serialno|serialnumber)=([^&#\s]+)/gi;

// Серийные номера, названные в тексте («SN: …», «S/N …», «?sn=…»)
export function labeledSerials(text) {
  const out = [];
  const add = (v) => { const t = String(v).trim(); if (t && !out.includes(t)) out.push(t); };
  String(text ?? '').replace(SN_LABEL, (_, v) => { add(v); return _; });
  String(text ?? '').replace(URL_PARAM, (_, v) => { try { add(decodeURIComponent(v)); } catch { add(v); } return _; });
  return out;
}

// Варианты значения для поля: kind = 'mac' | 'serial'. Возвращает [{value, note, sure}]; sure — уверенный вариант
export function candidatesFor(kind, texts) {
  const raws = [...new Set((texts || []).map((t) => String(t).trim()).filter(Boolean))];
  const out = []; const seen = new Set();
  const add = (value, note, sure) => { if (!value || seen.has(value)) return; seen.add(value); out.push({ value, note, sure }); };
  if (kind === 'mac') {
    raws.forEach((r) => macsIn(r).forEach((m) => add(m, 'MAC', true)));
    raws.forEach((r) => add(r, 'как считано', false));
    return out;
  }
  raws.forEach((r) => labeledSerials(r).forEach((s) => add(s, 'серийный номер', true)));
  const macLike = (r) => !!normalizeMac(r);
  raws.filter((r) => !macLike(r)).forEach((r) => add(r, 'как считано', false));
  raws.filter(macLike).forEach((r) => add(r, 'похоже на MAC', false));
  return out;
}

// Другая точка с тем же серийным номером / MAC (без учёта регистра и разделителей)
export function findDuplicate(points, point, kind, value) {
  const key = (v) => (kind === 'mac' ? normalizeMac(v) || String(v).trim().toUpperCase() : String(v).trim().toUpperCase());
  const k = key(value); if (!k) return null;
  const field = kind === 'mac' ? 'mac' : 'serial';
  return [...points].find((p) => p.id !== point?.id && !p.deleted && p[field] && key(p[field]) === k) || null;
}
