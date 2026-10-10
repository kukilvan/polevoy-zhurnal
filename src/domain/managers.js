// Таблицы для руководства: общие мелочи (названия файлов, даты для Google Sheets, хэш данных).
export const TITLE_PREFIX = 'סטטוס נקודות – ';
const s = (v) => (v === undefined || v === null ? '' : String(v).trim());

// Дата ISO → серийный номер Google Sheets (формулы MAXIFS работают с числами)
export function sheetSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(iso));
  if (!m) return '';
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
}

// Название файла: «סטטוס נקודות – <название HE|название> – <подрядчик> – <объект HE|объект>» без повторов
export function managerNames(p) {
  const parts = [s(p.nameHe) || s(p.name), s(p.contractor), s(p.objectHe) || s(p.object)].filter(Boolean);
  const display = parts.filter((x, i) => parts.indexOf(x) === i).join(' – ');
  return { display, title: TITLE_PREFIX + display };
}

// Хэш данных: если не менялся — файл руководителя не перезаписываем
export function hashOf(obj) {
  const str = JSON.stringify(obj); let h1 = 0xdeadbeef ^ str.length; let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
