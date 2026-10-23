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

// ---------- записи, не принятые сервером ----------
// Код ошибки Firestore → что случилось и что делать (по-русски)
export function rejectReason(code) {
  const c = String(code || '').replace(/^firestore\//, '');
  if (c === 'permission-denied') return { title: 'Нет прав на запись', fix: 'Возможно, вас убрали из проекта (попросите создателя пригласить снова), не опубликованы правила базы для этого раздела (создатель публикует firestore.rules в консоли Firebase) или истёк вход — выйдите из аккаунта и войдите снова. Потом нажмите «Повторить».' };
  if (c === 'resource-exhausted') return { title: 'Исчерпан суточный лимит записей', fix: 'Подождите сброса лимита (10:00 по Израилю) и нажмите «Повторить».' };
  if (c === 'unauthenticated') return { title: 'Нет входа в аккаунт', fix: 'Выйдите из аккаунта и войдите снова, затем нажмите «Повторить».' };
  if (c === 'invalid-argument' || c === 'out-of-range') return { title: 'Запись не подошла серверу (слишком большая или с неверными данными)', fix: 'Это ошибка приложения. Нажмите «Скопировать журнал» и пришлите мне — исправлю.' };
  if (c === 'not-found') return { title: 'Документ не найден', fix: 'Проект или запись удалены на сервере. Обновите приложение и повторите; если не помогло — пришлите журнал.' };
  return { title: `Ошибка сервера (${c || 'неизвестно'})`, fix: 'Проверьте связь и нажмите «Повторить». Если повторяется — «Скопировать журнал» и пришлите мне.' };
}
// Суточный лимит бесплатных записей Firestore
export const DAILY_WRITE_LIMIT = 20000;
/** На каких порогах предупреждать о записях (доля от лимита) */
export const WRITE_WARN_LEVELS = [0.8, 0.95];
export const writeWarnLevel = (before, after, limit = DAILY_WRITE_LIMIT) => WRITE_WARN_LEVELS.filter((l) => before < limit * l && after >= limit * l).pop() || 0;
