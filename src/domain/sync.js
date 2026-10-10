// Решения о том, как читать данные из Firestore, не обращаясь к сети (чистые функции — проверяются тестами).
export const DELTA_MARGIN = 10 * 60 * 1000;     // запас назад от последней отметки, чтобы не потерять запись из-за гонки коммитов
// Полная сверка раз в неделю — в субботу: первый запуск приложения начиная с субботы 00:00 перечитывает всё (ловит и жёстко удалённые документы)
export const lastSaturday = (now) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); return d.getTime(); };
// 'delta' — читаем только изменения; 'full' — как раньше. meta: { last, full, n } из предыдущей загрузки, cached — число документов в кэше
export function decideMode(meta, cached, now = Date.now()) {
  if (!meta || !(meta.last > 0) || !(meta.full > 0)) return 'full';
  if (meta.full < lastSaturday(now)) return 'full';
  if (!(cached >= (meta.n || 0)) || cached === 0) return 'full'; // кэш очищен или неполон
  return 'delta';
}
export const maxMillis = (list) => list.reduce((m, v) => (v && v > m ? v : m), 0);

// ---------- хранение удалённого ----------
// Удалённое (запись или проект) хранится в базе год, затем ночная серверная задача удаляет его навсегда.
export const RETENTION_DAYS = 365;
const DAY = 24 * 3600 * 1000;
export const purgeDate = (deletedAt) => (deletedAt ? deletedAt + RETENTION_DAYS * DAY : 0);
// Пора ли удалить навсегда: помечено deleted и с момента удаления прошёл срок (без отметки времени не удаляем никогда)
export const isExpiredDeleted = (doc, now = Date.now()) => !!doc && doc.deleted === true && Number(doc.deletedAt) > 0 && now >= purgeDate(Number(doc.deletedAt));
// Записи журнала изменений старше срока (поле at — время в миллисекундах)
export const historyCutoff = (now = Date.now()) => now - RETENTION_DAYS * DAY;
