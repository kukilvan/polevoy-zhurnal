// Инструкции в руководстве: фото схем, PDF, таблицы. Запись: { id, title, section, fileId, fileName, mime, size, addedBy, addedAt, deleted }
export const MANUAL_SECTIONS = ['Замки и двери', 'Хивут', 'Проверка', 'Установка', 'Шилют', 'Камеры и WiFi', 'Другое'];

/** 'image' | 'pdf' | 'other' — по типу файла или расширению */
export function manualKind(m) {
  const mime = String(m?.mime || '').toLowerCase(); const name = String(m?.fileName || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|bmp)$/.test(name)) return 'image';
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  return 'other';
}
export const manualIcon = (m) => ({ image: '🖼', pdf: '📄', other: '📎' })[manualKind(m)];

/** Что показывать этому человеку: не удалённые; без файла на Диске — только тому, кто добавил (ему ещё нужно отправить на Диск) */
export function visibleManuals(list, myEmail = '') {
  const me = String(myEmail).toLowerCase();
  return (list || []).filter((m) => !m.deleted && (m.fileId || String(m.addedBy || '').toLowerCase() === me));
}
/** Фильтр по словам (в названии, разделе, имени файла) и группы по разделам; разделы — в порядке MANUAL_SECTIONS, свои — после, внутри — по названию */
export function groupManuals(list, query = '') {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const items = list.filter((m) => { const s = `${m.title} ${m.section} ${m.fileName}`.toLowerCase(); return words.every((w) => s.includes(w)); });
  const by = new Map();
  for (const m of items) { const k = m.section || 'Другое'; if (!by.has(k)) by.set(k, []); by.get(k).push(m); }
  const rank = (k) => { const i = MANUAL_SECTIONS.indexOf(k); return i < 0 ? 100 : i; };
  return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'ru'))
    .map(([section, arr]) => ({ section, items: arr.sort((x, y) => String(x.title).localeCompare(String(y.title), 'ru', { numeric: true })) }));
}
export const sectionsIn = (list) => [...new Set([...MANUAL_SECTIONS, ...(list || []).map((m) => m.section).filter(Boolean)])];
