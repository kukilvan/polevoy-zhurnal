// Текст «отчёта» (отчёт за день) на русском, иврите и английском (раздел 3.5, Приложение А).
// Английские названия работ, кабелей, единиц и т. п. берутся из словаря интерфейса (setNameTranslator).
import { round2, cableCountFor } from './points.js';
import { taskQty } from './compose.js';

// Формат отчёта как в настоящих дохах Ивана (WhatsApp): дата, на следующей строке объект и помощник,
// затем каждая работа отдельным абзацем. Однострочная шапка (дата объект помощник) — для месячного списка.
export const DOH_FORMAT = { headerSep: '\n', blockSep: '\n\n', oneLineSep: ' ' };

let trName = (s) => s;
/** Перевод названий для английского отчёта (по-русски хранится в данных) */
export const setNameTranslator = (fn) => { trName = fn || ((s) => s); };
const en = (s) => (blank(s) ? s : trName(String(s)));

const blank = (v) => v === undefined || v === null || v === '';
const num = (v) => (blank(v) ? 0 : Number(v));

export function dateText(iso) { // 'YYYY-MM-DD' → 'ДД.ММ.ГГГГ'
  const [y, m, d] = String(iso).split('-');
  return `${d}.${m}.${y}`;
}

const isTime = (entry, work) => entry.workType === 'Время' || work?.unit === 'мин';
const entryPoints = (entry, ctx) => (entry.pointIds || []).map((id) => ctx.points.get(id)).filter(Boolean);

// «Итог шт»: сколько единиц работы (0 для времени)
export function itogShtuk(entry, ctx) {
  const work = ctx.catalog.get(entry.workId);
  if (isTime(entry, work)) return 0;
  const pts = entryPoints(entry, ctx);
  // точка из устройств: столько единиц, сколько задач этой работы (две двери с двумя коре — 4); иначе 1 на точку
  const portsOf = (p) => (Array.isArray(entry.portQty) ? entry.portQty.find((q) => q && q.id === p.id)?.v : undefined);   // шилют части портов точки
  const base = pts.length ? pts.reduce((n, p) => n + (portsOf(p) ?? taskQty(p, ctx, entry) ?? 1), 0) : num(entry.quantity);
  return round2(base * (blank(work?.multiplier) ? 1 : Number(work.multiplier)));
}

export function pullFigures(entry, ctx) {
  const pts = entryPoints(entry, ctx);
  const cablesIn = (p) => taskQty(p, ctx, entry) ?? cableCountFor(p, ctx, entry.cableId);
  if (pts.length) {
    return {
      // только кабели вида этой записи (у точки их может быть несколько видов)
      count: round2(pts.reduce((s, p) => s + cablesIn(p), 0)),
      meters: round2(pts.reduce((s, p) => s + (Number(p.length) || 0) * cablesIn(p), 0)),
    };
  }
  return { count: num(entry.quantity), meters: num(entry.meters) };
}

const tail = (entry, ctx, he, eng = false) => ({
  minutes: !blank(entry.minutes) ? (he ? `, ${entry.minutes} דקות` : eng ? `, ${entry.minutes} min` : `, ${entry.minutes} мин`) : '',
  note: !blank(entry.note) ? `. ${entry.note}` : '',
  culprit: !blank(entry.culprit)
    ? ` (${he ? (ctx.culprits.get(entry.culprit)?.he ?? entry.culprit) : eng ? en(entry.culprit) : entry.culprit})` : '',
});

// Задержка к работе: «Задержка: нет доступа, Электрики, ждали ключ — 40 мин» (иврит: «עיכוב: …»). Пусто, если ничего не указано.
export function delayLine(entry, ctx, lang = 'ru') {
  if (!entry || entry.workType === 'Текст') return '';
  const he = lang === 'he'; const eng = lang === 'en';
  const loc = (v, list) => (he ? (list.get(v)?.he || v) : eng ? en(v) : v);
  const reason = blank(entry.delayReason) ? '' : loc(entry.delayReason, ctx.delayReasons);
  const culprit = blank(entry.delayCulprit) ? '' : loc(entry.delayCulprit, ctx.culprits);
  const note = blank(entry.delayNote) ? '' : String(entry.delayNote);
  const mins = blank(entry.delayMinutes) ? '' : (he ? `${entry.delayMinutes} דקות` : eng ? `${entry.delayMinutes} min` : `${entry.delayMinutes} мин`);
  const parts = [reason, culprit, note].filter(Boolean);
  if (!parts.length && !mins) return '';
  const head = he ? 'עיכוב' : eng ? 'Delay' : 'Задержка';
  return `${head}: ${parts.join(', ')}${parts.length && mins ? ' — ' : ''}${mins}`;
}

/** Строка работы и сразу под ней — задержка (если есть) */
export function entryLine(entry, ctx, lang = 'ru') {
  const main = workLine(entry, ctx, lang); const d = delayLine(entry, ctx, lang);
  return d ? `${main}${main ? '\n' : ''}${d}` : main;
}

function workLine(entry, ctx, lang = 'ru') {
  const he = lang === 'he'; const eng = lang === 'en';
  const work = ctx.catalog.get(entry.workId);
  const name = he ? work?.nameHe : eng ? en(work?.name) : work?.name;
  const t = tail(entry, ctx, he, eng);
  const unit = ctx.units.get(work?.unit);

  if (entry.workType === 'Текст') return String(entry.note ?? ''); // свободная строка без цифр

  if (isTime(entry, work)) { // «Время» и любые работы в минутах
    return he
      ? `${name} ${entry.minutes ?? ''} דקות${t.culprit}${t.note}`
      : `${name} ${entry.minutes ?? ''} ${eng ? 'min' : 'мин'}${t.culprit}${t.note}`;
  }
  if (entry.workType === 'Протяжка') {
    const cable = ctx.cables.get(entry.cableId);
    const { count, meters } = pullFigures(entry, ctx);
    const meterMode = cable?.accounting === 'Метры';
    if (he) {
      return `השחלת ${cable?.nameHe ?? entry.cableId ?? ''}: ${count}${meterMode ? ` כבלים, ${meters} מטר` : ' נקודות'}${t.minutes}${t.culprit}${t.note}`;
    }
    if (eng) return `Cable pull ${en(entry.cableId ?? '')}: ${count}${meterMode ? ` cables, ${meters} m` : ' points'}${t.minutes}${t.culprit}${t.note}`;
    return `Протяжка ${entry.cableId ?? ''}: ${count}${meterMode ? ` каб., ${meters} м` : ' точек'}${t.minutes}${t.culprit}${t.note}`;
  }
  const bad = entry.result === 'Не работает' ? (he ? ' (לא תקין)' : eng ? ' (not working)' : ' (не работает)') : '';
  return `${name} ${itogShtuk(entry, ctx)} ${he ? (unit?.he ?? work?.unit) : eng ? en(work?.unit) : work?.unit}${bad}${t.minutes}${t.culprit}${t.note}`;
}

const helperIsSelf = (h) => blank(h) || h === 'сам';

function headerParts(day, ctx, lang) {
  const he = lang === 'he';
  const p = ctx.projects.get(day.projectId) || {};
  const where = p.oneOff ? day.object
    : he ? `${p.nameHe || p.name} ${p.objectHe ?? ''}`.trim() : `${p.contractor ?? ''} ${p.object ?? ''}`.trim();
  const helper = he ? (day.helperHe ?? p.helperHe) : (day.helper ?? p.helper);
  const who = helperIsSelf(helper) ? (he ? ' לבד' : lang === 'en' ? ' alone' : ' сам') : (he ? ` עם ${helper}` : lang === 'en' ? ` with ${helper}` : ` с ${helper}`);
  return { date: dateText(day.date), place: `${where ?? ''}${who}` };
}

// Однострочная шапка «ДД.ММ.ГГГГ Подрядчик Объект сам/с Помощником» (месячный список)
export function dohHeader(day, ctx, lang = 'ru') {
  const { date, place } = headerParts(day, ctx, lang);
  return `${date}${DOH_FORMAT.oneLineSep}${place}`;
}

export function dayEntries(day, ctx) {
  return [...ctx.entries.values()].filter((e) => e.dayId === day.id)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function doh(day, ctx, lang = 'ru') {
  const { date, place } = headerParts(day, ctx, lang);
  const lines = dayEntries(day, ctx).map((e) => entryLine(e, ctx, lang)).filter((l) => l !== '');
  const blocks = [`${date}${DOH_FORMAT.headerSep}${place}`, ...lines];
  if (!blank(day.comment)) blocks.push(String(day.comment));
  return blocks.join(DOH_FORMAT.blockSep);
}

// Две первые строки отчёта: дата и место работы (для списка рабочих дней месяца)
export function dohTop(day, ctx, lang = 'ru') {
  const { date, place } = headerParts(day, ctx, lang);
  return `${date}${DOH_FORMAT.headerSep}${place}`;
}
