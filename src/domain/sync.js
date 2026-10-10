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
