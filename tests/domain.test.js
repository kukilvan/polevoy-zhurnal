import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG, POINT_TYPES, CABLES, CONFIGS, UNITS, CULPRITS, DELAY_REASONS,
  generateLabels, parseSuffixes, buildContext, pointInfo, pointKey, sortNumber, comparePoints, entryLine, itogShtuk, dohHeader, doh,
} from '../src/domain/index.js';

const project = { id: 'P1', name: 'Mega Or', contractor: 'Megason', object: 'Mega Or', helper: 'Марина', helperHe: 'מרינה',
  nameHe: 'מגה אור', objectHe: 'מגה אור', defaultConfigId: 'CFG1', oneOff: false };

function make(extra = {}) {
  return buildContext({
    projects: [project], points: [], days: [], entries: [], journal: [], cabinetSettings: [],
    catalog: CATALOG, types: POINT_TYPES, cables: CABLES, configs: CONFIGS, units: UNITS, culprits: CULPRITS, delayReasons: DELAY_REASONS,
    ...extra,
  });
}
// Хелпер: день + записи с точками → строки журнала (как делает приложение при сохранении записи)
function scenario(pointsIn, daysIn, entriesIn) {
  const journal = [];
  entriesIn.forEach((e) => (e.pointIds || []).forEach((pid) => journal.push({ id: `${e.id}-${pid}`, entryId: e.id, pointId: pid })));
  return make({ points: pointsIn, days: daysIn, entries: entriesIn, journal });
}
const cam = { id: 'c1', projectId: 'P1', label: '1A-01', cabinet: '1A', typeId: 'Камера' };
const door = { id: 'd1', projectId: 'P1', label: '1A-D1', cabinet: '1A', typeId: 'Дверь', length: 20 };
const day = (id, date, extra = {}) => ({ id, projectId: 'P1', date, helper: 'Марина', helperHe: 'מרינה', ...extra });
const entry = (id, dayId, workType, workId, pointIds, extra = {}) => ({ id, dayId, workType, workId, pointIds, result: 'Работает', createdAt: Number(id.slice(1)), ...extra });

test('статус: Новая → Посчитана → Протянута → Захивучена → Установлена → Проверена', () => {
  const steps = [
    [[], 'Новая'],
    [[], 'Посчитана', { length: 10 }],
    [[entry('e1', 'D1', 'Протяжка', 'PR_PTS', ['c1'])], 'Протянута'],
    [[entry('e1', 'D1', 'Протяжка', 'PR_PTS', ['c1']), entry('e2', 'D1', 'Хивут', 'HIV_KEY', ['c1'])], 'Захивучена'],
    [[entry('e1', 'D1', 'Протяжка', 'PR_PTS', ['c1']), entry('e2', 'D1', 'Хивут', 'HIV_KEY', ['c1']), entry('e3', 'D1', 'Установка', 'INS_CAM', ['c1'])], 'Установлена'],
    [[entry('e1', 'D1', 'Протяжка', 'PR_PTS', ['c1']), entry('e3', 'D1', 'Установка', 'INS_CAM', ['c1']), entry('e4', 'D1', 'Проверка', 'CHK_FLUKE', ['c1'])], 'Проверена'],
  ];
  for (const [entries, expected, patch] of steps) {
    const ctx = scenario([{ ...cam, ...(patch || {}) }], [day('D1', '2026-10-05')], entries);
    assert.equal(pointInfo(ctx.points.get('c1'), ctx).status, expected);
  }
});

test('статус: проверка «Не работает» → Неисправна, а новая успешная проверка исправляет', () => {
  const bad = entry('e1', 'D1', 'Проверка', 'CHK_FLUKE', ['c1'], { result: 'Не работает' });
  let ctx = scenario([cam], [day('D1', '2026-10-05')], [bad]);
  assert.equal(pointInfo(ctx.points.get('c1'), ctx).status, 'Неисправна');
  assert.equal(pointInfo(ctx.points.get('c1'), ctx).statusHe, 'תקלה');
  const good = entry('e2', 'D2', 'Проверка', 'CHK_FLUKE', ['c1']);
  ctx = scenario([cam], [day('D1', '2026-10-05'), day('D2', '2026-10-06')], [bad, good]);
  assert.equal(pointInfo(ctx.points.get('c1'), ctx).status, 'Проверена');
});

test('дверь: установка по конфигурации CFG1 (коре + мануль + магнит) — k/n и «Установлено»', () => {
  const mk = (...ids) => ids.map((w, i) => entry(`e${i + 1}`, 'D1', 'Установка', w, ['d1']));
  const info = (...ids) => { const ctx = scenario([door], [day('D1', '2026-10-05')], mk(...ids)); return pointInfo(ctx.points.get('d1'), ctx); };
  assert.equal(info().install, '');
  assert.equal(info('INS_KORE').install, 'Установлено 1/3');
  assert.equal(info('INS_KORE').status, 'Установлено 1/3');
  assert.equal(info('INS_KORE').installHe, 'הותקן חלקית 1/3');
  assert.equal(info('INS_KORE', 'INS_MANUL').install, 'Установлено 2/3');
  const full = info('INS_KORE', 'INS_MANUL', 'INS_MAGNIT');
  assert.equal(full.install, 'Установлено'); assert.equal(full.status, 'Установлена'); assert.equal(full.installHe, 'הותקן');
  assert.equal(info('INS_BIO').install, ''); // компонент вне конфигурации не считается
});

test('дверь: конфигурация точки главнее конфигурации проекта; без конфигурации хватает любой установки', () => {
  const ctx = scenario([{ ...door, configId: 'CFG2' }], [day('D1', '2026-10-05')], [entry('e1', 'D1', 'Установка', 'INS_KORE', ['d1'])]);
  assert.equal(pointInfo(ctx.points.get('d1'), ctx).install, 'Установлено 1/4');
  const noCfg = buildContext({ ...{ projects: [{ ...project, defaultConfigId: undefined }], points: [door], days: [day('D1', '2026-10-05')],
    entries: [entry('e1', 'D1', 'Установка', 'INS_EMAG', ['d1'])], journal: [{ id: 'j', entryId: 'e1', pointId: 'd1' }], cabinetSettings: [],
    catalog: CATALOG, types: POINT_TYPES, cables: CABLES, configs: CONFIGS, units: UNITS, culprits: CULPRITS, delayReasons: DELAY_REASONS } });
  assert.equal(pointInfo(noCfg.points.get('d1'), noCfg).install, 'Установлено');
});

test('кабели и метраж: значения типа, переопределение по шкафу, метраж = длина × кабелей', () => {
  let ctx = make({ points: [{ ...cam, length: 15 }, door] });
  assert.deepEqual([pointInfo(ctx.points.get('c1'), ctx).cable, pointInfo(ctx.points.get('c1'), ctx).cables, pointInfo(ctx.points.get('c1'), ctx).metrage], ['cat7', 1, 15]);
  assert.deepEqual([pointInfo(ctx.points.get('d1'), ctx).cable, pointInfo(ctx.points.get('d1'), ctx).cables, pointInfo(ctx.points.get('d1'), ctx).metrage], ['6005', 3, 60]);
  const bakar = { id: 'b1', projectId: 'P1', label: '1A-B1', cabinet: '1A', typeId: 'Бакар', length: 10 };
  ctx = make({ points: [bakar, { ...bakar, id: 'b2', cabinet: '1B' }], cabinetSettings: [{ id: 's', projectId: 'P1', cabinet: '1A', typeId: 'Бакар', cables: 4, cable: 'cat7' }] });
  assert.equal(pointInfo(ctx.points.get('b1'), ctx).cables, 4); assert.equal(pointInfo(ctx.points.get('b1'), ctx).metrage, 40);
  assert.equal(pointInfo(ctx.points.get('b2'), ctx).cables, 2); // другой шкаф — по умолчанию типа
});

test('естественная сортировка точек: 2 раньше 10, подномера, шкаф и тип', () => {
  const labels = ['1A-10', '1A-2', '1A-2.5', '1A-1', '1B-1'];
  const sorted = labels.map((label) => ({ label, cabinet: label.slice(0, 2), typeId: 'Камера' })).sort(comparePoints).map((p) => p.label);
  assert.deepEqual(sorted, ['1A-1', '1A-2', '1A-2.5', '1A-10', '1B-1']);
  assert.equal(sortNumber('1A-01-02'), 2); assert.equal(sortNumber('без цифр'), 0);
  assert.equal(pointKey('1A-12'), '1A||00012|000');
});

test('строки записей RU/HE по формулам Приложения А', () => {
  const p1 = { ...cam, id: 'c1', length: 10 }; const p2 = { ...cam, id: 'c2', label: '1A-02', length: 12 };
  const d = day('D1', '2026-10-05');
  const mk = (e) => scenario([p1, p2], [d], [e]);
  let e = entry('e1', 'D1', 'Установка', 'INS_CAM', ['c1', 'c2']);
  assert.equal(entryLine(e, mk(e)), 'Установка камеры 2 шт');
  assert.equal(entryLine(e, mk(e), 'he'), "התקנת מצלמה 2 יח'");
  e = entry('e1', 'D1', 'Проверка', 'CHK_FLUKE', ['c1'], { result: 'Не работает' });
  assert.equal(entryLine(e, mk(e)), 'Проверка кабеля Fluke 1 шт (не работает)');
  assert.equal(entryLine(e, mk(e), 'he'), "בדיקת כבל Fluke 1 יח' (לא תקין)");
  e = entry('e1', 'D1', 'Протяжка', 'PR_PTS', ['c1', 'c2'], { cableId: 'cat7' }); // cat7 — считаем точки
  assert.equal(entryLine(e, mk(e)), 'Протяжка cat7: 2 точек');
  assert.equal(entryLine(e, mk(e), 'he'), 'השחלת כבל CAT7: 2 נקודות');
  e = entry('e1', 'D1', 'Протяжка', 'PR_PTS', ['d1'], { cableId: '6005', minutes: 30, note: 'через потолок' });
  const ctxD = scenario([door], [d], [e]); // 6005 — метры: 3 кабеля × 20 м = 60 м
  assert.equal(entryLine(e, ctxD), 'Протяжка 6005: 3 каб., 60 м, 30 мин. через потолок');
  assert.equal(entryLine(e, ctxD, 'he'), 'השחלת כבל 6005: 3 כבלים, 60 מטר, 30 דקות. через потолок');
  e = entry('e1', 'D1', 'Протяжка', 'PR_MAN', [], { cableId: '6005', quantity: 4, meters: 80 });
  assert.equal(entryLine(e, mk(e)), 'Протяжка 6005: 4 каб., 80 м');
  e = entry('e1', 'D1', 'Время', 'T_WAIT', [], { minutes: 45, culprit: 'Электрики', note: 'нет доступа' });
  assert.equal(entryLine(e, mk(e)), 'Ожидание 45 мин (Электрики). нет доступа');
  assert.equal(entryLine(e, mk(e), 'he'), 'המתנה 45 דקות (חשמלאים). нет доступа');
  e = entry('e1', 'D1', 'Доп. работа', 'EX_TAALA', [], { quantity: 12.5 });
  assert.equal(entryLine(e, mk(e)), 'Установка таалы 12.5 м');
  assert.equal(itogShtuk(e, mk(e)), 12.5);
  e = entry('e1', 'D1', 'Доп. работа', 'EX_ARON_HIV', [], { quantity: 1, minutes: 90 }); // единица «мин» → строка времени
  assert.equal(entryLine(e, mk(e)), 'Хивут арона бакары 90 мин'); assert.equal(itogShtuk(e, mk(e)), 0);
  e = entry('e1', 'D1', 'Текст', undefined, [], { note: 'Продолжение протяжки оптики' }); // свободная строка
  assert.equal(entryLine(e, mk(e)), 'Продолжение протяжки оптики');
});

test('дох дня: шапка (сам / с помощником / разовый) и строки работ', () => {
  const p1 = { ...cam, length: 10 };
  const d = day('D1', '2026-10-05');
  const e1 = entry('e1', 'D1', 'Хивут', 'HIV_KEY', ['c1']); const e2 = entry('e2', 'D1', 'Время', 'T_SIYUR', [], { minutes: 20 });
  const ctx = scenario([p1], [d], [e1, e2]);
  assert.equal(dohHeader(d, ctx), '05.10.2026 Megason Mega Or с Марина');
  assert.equal(dohHeader(d, ctx, 'he'), '05.10.2026 מגה אור מגה אור עם מרינה');
  assert.equal(doh(d, ctx), '05.10.2026\nMegason Mega Or с Марина\n\nХивут кистона 1 шт\n\nСиюр 20 мин');
  const solo = { ...d, helper: 'сам', helperHe: 'сам', comment: 'всё по плану' };
  const ctx2 = scenario([p1], [solo], [e1]);
  assert.equal(doh(solo, ctx2), '05.10.2026\nMegason Mega Or сам\n\nХивут кистона 1 шт\n\nвсё по плану');
  assert.match(doh(solo, ctx2, 'he'), /לבד/);
  const oneOff = { ...d, object: 'Склад Хайфа' };
  const ctx3 = buildContext({ ...{ projects: [{ ...project, oneOff: true }], points: [p1], days: [oneOff], entries: [e1], journal: [], cabinetSettings: [],
    catalog: CATALOG, types: POINT_TYPES, cables: CABLES, configs: CONFIGS, units: UNITS, culprits: CULPRITS, delayReasons: DELAY_REASONS } });
  assert.equal(dohHeader(oneOff, ctx3), '05.10.2026 Склад Хайфа с Марина');
});

test('журнал: правки без записи, мягкое удаление записи/точки убирает вклад в статусы', () => {
  const j = [{ id: 'x1', pointId: 'c1', editDate: '2026-10-03', editWorkId: 'HIV_KEY' }];
  let ctx = make({ points: [cam], journal: j });
  assert.equal(pointInfo(ctx.points.get('c1'), ctx).status, 'Захивучена'); assert.equal(pointInfo(ctx.points.get('c1'), ctx).hived, '2026-10-03');
  const e = entry('e1', 'D1', 'Проверка', 'CHK_FLUKE', ['c1']);
  ctx = make({ points: [cam], days: [day('D1', '2026-10-05')], entries: [{ ...e, deleted: true }], journal: [{ id: 'j1', entryId: 'e1', pointId: 'c1' }] });
  assert.equal(pointInfo(ctx.points.get('c1'), ctx).status, 'Новая'); // удалённая запись не считается
  ctx = make({ points: [{ ...cam, deleted: true }], journal: j });
  assert.equal(ctx.points.size, 0);
});

test('даты этапов: берётся максимальная дата, а не порядок ввода', () => {
  const es = [entry('e1', 'D2', 'Хивут', 'HIV_KEY', ['c1']), entry('e2', 'D1', 'Хивут', 'HIV_KEY', ['c1'])];
  const ctx = scenario([cam], [day('D1', '2026-10-01'), day('D2', '2026-10-07')], es);
  assert.equal(pointInfo(ctx.points.get('c1'), ctx).hived, '2026-10-07');
});

test('генератор точек: диапазон, шаг, ведущие нули, пара, суффиксы', () => {
  assert.deepEqual(generateLabels({ prefix: '1A-', from: 1, to: 3 }), ['1A-1', '1A-2', '1A-3']);
  assert.deepEqual(generateLabels({ prefix: '1A-', from: 1, to: 6, step: 2, digits: 2 }), ['1A-01', '1A-03', '1A-05']);
  assert.deepEqual(generateLabels({ prefix: '1A-', from: 1, to: 5, step: 2, digits: 2, pair: true }), ['1A-01-02', '1A-03-04', '1A-05-06']);
  assert.deepEqual(generateLabels({ prefix: 'C', from: 7, to: 8, suffixes: parseSuffixes(' A, B ,, ') }), ['C7A', 'C7B', 'C8A', 'C8B']);
  assert.deepEqual(generateLabels({ from: 5, to: 1 }), []); // «до» меньше «от»
  assert.equal(generateLabels({ from: 1, to: 999999 }).length, 2000); // защита от случайного миллиона точек
});

test('месячный отчёт: дохи подряд, часы и сводка протяжки', async () => {
  const { buildContext, monthReportRu, monthSummary, monthReportHe, CATALOG, CABLES, CULPRITS, UNITS, POINT_TYPES } = await import('../src/domain/index.js');
  const mk = (a) => a.map((x) => ({ ...x }));
  const data = {
    projects: [{ id: 'p', name: 'P', contractor: 'Мегасон', object: 'Модиин', helper: 'Мариной', nameHe: 'מגה', objectHe: 'מודיעין', helperHe: 'מרינה' }],
    points: [], catalog: mk(CATALOG), cables: mk(CABLES), culprits: mk(CULPRITS), units: mk(UNITS), types: mk(POINT_TYPES), configs: [], delayReasons: [], cabinetSettings: [], journal: [],
    days: [{ id: 'd1', projectId: 'p', date: '2026-09-01' }, { id: 'd2', projectId: 'p', date: '2026-09-02' }, { id: 'd3', projectId: 'p', date: '2026-10-01' }],
    entries: [
      { id: 'e1', dayId: 'd1', workType: 'Протяжка', workId: 'PR_MAN', cableId: '6005', quantity: 5, meters: 60 },
      { id: 'e2', dayId: 'd1', workType: 'Время', workId: 'T_WAIT', minutes: 90 },
      { id: 'e3', dayId: 'd2', workType: 'Протяжка', workId: 'PR_MAN', cableId: '6005', quantity: 2, meters: 120 },
      { id: 'e4', dayId: 'd2', workType: 'Доп. работа', workId: 'EX_MERIRON', quantity: 16 },
      { id: 'e5', dayId: 'd3', workType: 'Время', workId: 'T_WAIT', minutes: 600 },
    ],
  };
  const ctx = buildContext(data);
  const ru = monthReportRu(ctx, '2026-09');
  assert.ok(ru.startsWith('Дохот\n\n\n01.09.2026\nМегасон Модиин с Мариной'));
  assert.ok(!ru.includes('01.10.2026'));
  const s = monthSummary(ctx, '2026-09');
  assert.equal(s.days, 2); assert.equal(s.hours, 1.5);
  assert.deepEqual(s.pulls.map((p) => [p.cableId, p.count, p.meters]), [['6005', 7, 180]]);
  assert.equal(s.works[0].qty, 16);
  assert.ok(monthReportHe(ctx, '2026-09').includes('דוח חודשי – ספטמבר 2026'));
});

test('рабочие дни месяца по всем проектам: только дата и место', async () => {
  const { workdaysReport } = await import('../src/domain/index.js');
  const projects = [
    { id: 'a', name: 'A', contractor: 'Мегасон', object: 'Модиин', helper: 'Мариной' },
    { id: 'b', name: 'B', contractor: 'Электра', object: 'Тель-Авив', helper: 'Лешей и Ильёй' },
  ];
  const days = [
    { id: '3', projectId: 'a', date: '2026-09-23', comment: 'не должен попасть' },
    { id: '1', projectId: 'b', date: '2026-09-22', helper: 'Лешей и Ильёй' },
    { id: '2', projectId: 'a', date: '2026-10-01' },
    { id: '4', projectId: 'a', date: '2026-09-01', deleted: true },
  ];
  const r = workdaysReport(days, projects, '2026-09');
  assert.equal(r.count, 2);
  assert.equal(r.text, 'Рабочие дни за сентябрь 2026\n\n22.09.2026\nЭлектра Тель-Авив с Лешей и Ильёй\n\n23.09.2026\nМегасон Модиин с Мариной');
});

test('привязка установки: бакар без установки, вайфай по работе, переопределение проектом', async () => {
  const { buildContext, pointInfo, POINT_TYPES, CATALOG, CONFIGS, installBinding } = await import('../src/domain/index.js');
  const mk = (types) => buildContext({
    projects: [{ id: 'p', defaultConfigId: 'CFG1' }], types, catalog: CATALOG, configs: CONFIGS,
    points: [{ id: 'b', projectId: 'p', label: 'B-1', typeId: 'Бакар', length: 5 }, { id: 'w', projectId: 'p', label: 'W-1', typeId: 'Вайфай', length: 5 }, { id: 'c', projectId: 'p', label: 'C-1', typeId: 'Камера', length: 5 }],
    journal: [{ id: 'j1', pointId: 'w', editDate: '2026-10-01', editWorkId: 'INS_AP' }, { id: 'j2', pointId: 'b', editDate: '2026-10-01', editWorkId: 'CHK_FLUKE' }, { id: 'j3', pointId: 'c', editDate: '2026-10-01', editWorkId: 'INS_CAM' }],
  });
  const ctx = mk(POINT_TYPES);
  assert.equal(pointInfo(ctx.points.get('w'), ctx).install, 'Установлено');
  assert.equal(pointInfo(ctx.points.get('b'), ctx).status, 'Проверена');
  assert.equal(pointInfo(ctx.points.get('b'), ctx).install, '');
  // старые данные без полей привязки: берётся стандартная по названию типа
  const legacy = mk(POINT_TYPES.map(({ installMode, installWorkIds, ...t }) => t));
  assert.equal(installBinding(legacy.types.get('Бакар')).mode, 'none');
  // проект переопределил: камеры только протягиваем — установка не требуется
  const noCam = mk(POINT_TYPES.map((t) => (t.id === 'Камера' ? { ...t, installMode: 'none', installWorkIds: [] } : t)));
  assert.equal(installBinding(noCam.types.get('Камера')).mode, 'none');
  // несколько работ: частично → k/n
  const two = mk(POINT_TYPES.map((t) => (t.id === 'Камера' ? { ...t, installMode: 'works', installWorkIds: ['INS_CAM', 'HIV_KEY'] } : t)));
  assert.equal(pointInfo(two.points.get('c'), two).install, 'Установлено 1/2');
});


// ---- таблицы для руководства (профили и сборка) ----
const reportData = async () => {
  const { buildContext, POINT_TYPES, CONFIGS, CATALOG } = await import('../src/domain/index.js');
  const data = {
    projects: [{ id: 'p1', name: 'Mega Or', contractor: 'Megason', object: 'Mega Or', nameHe: 'מגה אור', objectHe: 'מגה אור', defaultConfigId: 'CFG1' }],
    points: [
      { id: 'a', projectId: 'p1', label: '1A-C01', typeId: 'Камера', cabinet: '1A', length: 70, planName: 'C-71' },
      { id: 'b', projectId: 'p1', label: '1A-D01', typeId: 'Дверь', cabinet: '1A' },
      { id: 'c', projectId: 'p1', label: '2B-C01', typeId: 'Камера', cabinet: '2B' },
      { id: 'd', projectId: 'p1', label: 'G-01', typeId: 'Галай' },
    ],
    types: POINT_TYPES, configs: CONFIGS, catalog: CATALOG, cables: [{ id: 'cat7', nameHe: 'כבל CAT7' }],
    journal: [
      { id: 'j1', pointId: 'a', editDate: '2026-10-03', editWorkId: 'PR_PTS', createdBy: 'u1' },
      { id: 'j2', pointId: 'a', editDate: '2026-10-04', editWorkId: 'CHK_FLUKE', createdBy: 'u1' },
      { id: 'j3', pointId: 'b', editDate: '2026-10-05', editWorkId: 'INS_KORE' },
    ],
  };
  return { ctx: buildContext(data), project: data.projects[0], data };
};

test('таблица: профиль выбирает шкафы, типы, столбцы и их порядок', async () => {
  const { buildReport, defaultTables, sheetSerial } = await import('../src/domain/index.js');
  const { ctx, project } = await reportData();
  const ext = { ...defaultTables()[1], columns: ['planName', 'label', 'pulled'], cabinets: ['1A'], types: ['Камера'] };
  const r = buildReport(project, ctx, ext);
  const sh = r.sheets[0];
  assert.equal(r.pointCount, 1);
  assert.deepEqual(sh.rows[sh.headerRow], ['Имя в плане', 'Обозначение', 'Протянуто']);
  assert.deepEqual(sh.rows[sh.headerRow + 1], ['C-71', '1A-C01', sheetSerial('2026-10-03')]);
  // без шкафа выбирается отдельным значением
  const none = buildReport(project, ctx, { ...ext, cabinets: ['__none'], types: [] });
  assert.equal(none.pointCount, 1); assert.equal(none.sheets[0].rows[none.sheets[0].headerRow + 1][1], 'G-01');
  assert.throws(() => buildReport(project, ctx, { ...ext, columns: [] }), /ни один столбец/);
});

test('таблица: язык, «—» для этапов, которых у типа нет, частичная установка и итоги', async () => {
  const { buildReport, defaultTables } = await import('../src/domain/index.js');
  const { ctx, project } = await reportData();
  const he = buildReport(project, ctx, { ...defaultTables()[0], columns: ['label', 'type', 'installed', 'checked', 'shilut', 'status'] });
  const sh = he.sheets[0]; const rows = sh.rows.slice(sh.headerRow);
  assert.deepEqual(rows[0], ['נקודה', 'סוג', 'הותקן', 'נבדק', 'שילוט', 'סטטוס']);
  assert.equal(he.sheets[0].rtl, true);
  const byLabel = Object.fromEntries(rows.slice(1).map((r) => [r[0], r]));
  assert.equal(byLabel['G-01'][3], '—'); assert.equal(byLabel['G-01'][4], '—'); // у галая нет проверки и шилюта
  assert.equal(byLabel['1A-D01'][2], 'הותקן חלקית 1/3'); // дверь: 1 из 3 устройств
  assert.equal(byLabel['1A-C01'][5], 'נבדק');
  const ru = buildReport(project, ctx, { ...defaultTables()[1], columns: ['label', 'installed', 'status', 'checkResult'] });
  const rr = Object.fromEntries(ru.sheets[0].rows.slice(ru.sheets[0].headerRow + 1).map((r) => [r[0], r]));
  assert.equal(rr['1A-D01'][1], 'частично 1/3'); assert.equal(rr['1A-D01'][2], 'Установлено 1/3'); assert.equal(rr['1A-C01'][3], 'Работает');
  // итоги сверху: всего 4, протянуто 1, проверено 1
  assert.deepEqual(ru.sheets[0].rows[3].slice(0, 6), [4, 1, 0, 0, 1, 1]);
  assert.ok(!JSON.stringify(ru.sheets[0].rows).includes('=')); // формул нет
});

test('таблица: раскладка «шкаф на листе», названия листов и фильтр по статусу', async () => {
  const { buildReport, defaultTables } = await import('../src/domain/index.js');
  const { ctx, project } = await reportData();
  const t = { ...defaultTables()[1], columns: ['label'], layout: 'perCabinet' };
  const r = buildReport(project, ctx, t);
  assert.deepEqual(r.sheets.map((x) => x.title), ['1A', '2B', 'Без шкафа']);
  assert.equal(r.sheets[0].count, 2);
  const faulty = buildReport(project, ctx, { ...t, layout: 'one', statuses: ['Неисправна'] });
  assert.equal(faulty.pointCount, 0);
  assert.notEqual(r.hash, buildReport(project, ctx, { ...t, layout: 'one' }).hash);
});

test('таблица: основная всегда одна, профили по умолчанию', async () => {
  const { tablesOf, mainTable, withTable } = await import('../src/domain/index.js');
  assert.equal(tablesOf({}).length, 2); assert.equal(mainTable({}).name, 'Для руководства');
  const next = withTable({}, 't_ext', { main: true });
  assert.deepEqual(next.map((t) => t.main), [false, true]);
});

test('таблица: создание файла и пересборка листов через Google API (заглушка)', async () => {
  const { syncTable } = await import('../src/app/managers.js');
  const { defaultTables } = await import('../src/domain/index.js');
  const { ctx, project } = await reportData();
  const calls = []; const files = {};
  const api = {
    fileInfo: async (id) => files[id] || null,
    create: async (title) => { files.F1 = { id: 'F1', name: 'x' }; calls.push(['create', title]); return files.F1; },
    rename: async (id, name) => calls.push(['rename', name]),
    sheetsOf: async () => [{ sheetId: 0, title: 'Sheet1' }],
    batch: async (id, reqs) => calls.push(['batch', reqs]),
    write: async (id, data) => calls.push(['write', data]),
  };
  const table = defaultTables()[0];
  const r1 = await syncTable(api, project, ctx, table, { uid: 'u1' });
  assert.equal(r1.changed, true); assert.equal(r1.patch.fileId, 'F1'); assert.equal(r1.patch.by, 'u1');
  const reqs = calls.find((c) => c[0] === 'batch')[1];
  assert.ok(reqs[0].addSheet && reqs.some((q) => q.deleteSheet) && reqs.some((q) => q.setBasicFilter) && reqs.some((q) => q.addConditionalFormatRule));
  assert.equal(reqs[0].addSheet.properties.rightToLeft, true);
  const wr = calls.find((c) => c[0] === 'write')[1][0];
  assert.equal(wr.range, "'סטטוס'!A1");
  // повторно без изменений данных файл не трогаем; чужой файл — понятная ошибка
  const t2 = { ...table, ...r1.patch };
  calls.length = 0;
  const r2 = await syncTable(api, project, ctx, t2, { uid: 'u1' });
  assert.equal(r2.changed, false); assert.ok(!calls.some((c) => c[0] === 'batch'));
  delete files.F1;
  await assert.rejects(() => syncTable(api, project, ctx, { ...t2, by: 'u1' }, { uid: 'u2' }), /другой участник/);
});

test('сервер: ночное автообновление таблиц', async () => {
  const { updateProjectTables, applyPatches, autoTables } = await import('../scripts/server-tables-lib.mjs');
  const { defaultTables } = await import('../src/domain/index.js');
  const { project, data } = await reportData();
  const [main, ext] = defaultTables();
  const proj = { ...project, tables: [{ ...main, fileId: 'F1', by: 'u1' }, { ...ext, fileId: 'F2' }] };
  assert.deepEqual(autoTables(proj).map((t) => t.id), ['t_main']); // расширенная без галочки не обновляется
  const calls = []; const files = { F1: { id: 'F1', name: 'x' } };
  const api = {
    fileInfo: async (id) => files[id] || null, rename: async () => {}, sheetsOf: async () => [{ sheetId: 0, title: 'S' }],
    batch: async (id, reqs) => calls.push(['batch', id, reqs.length]), write: async (id) => calls.push(['write', id]),
  };
  const r = await updateProjectTables(api, proj, data, new Date('2026-10-11T00:00:00Z'));
  assert.equal(r.patches.t_main.serverError, ''); assert.ok(r.patches.t_main.hash); assert.equal(r.patches.t_main.by, undefined);
  assert.ok(calls.some((c) => c[0] === 'write' && c[1] === 'F1'));
  // файл недоступен серверу: новый не создаётся, ошибка записывается в профиль
  delete files.F1;
  const r2 = await updateProjectTables(api, proj, data, new Date());
  assert.match(r2.patches.t_main.serverError, /не видит файл/);
  assert.equal(applyPatches(proj, r2.patches)[0].fileId, 'F1');
});

test('экономия чтений: когда читать всё, а когда только изменения', async () => {
  const { decideMode, maxMillis, lastSaturday } = await import('../src/domain/sync.js');
  const now = 1_800_000_000_000; const ok = { last: now - 1000, full: now - 1000, n: 100 };
  assert.equal(decideMode(null, 100, now), 'full');                         // первый запуск
  assert.equal(decideMode(ok, 100, now), 'delta');                          // кэш полный
  assert.equal(decideMode(ok, 120, now), 'delta');                          // в кэше больше, чем помнили
  assert.equal(decideMode(ok, 80, now), 'full');                            // кэш неполон (например, очищен частично)
  assert.equal(decideMode(ok, 0, now), 'full');                             // кэш пуст
  // полная сверка раз в неделю, по субботам: 2026-10-10 суббота, 2026-10-11 воскресенье, 2026-10-16 пятница, 2026-10-17 суббота
  const at = (s) => new Date(`${s}T12:00:00`).getTime();
  assert.equal(new Date(lastSaturday(at('2026-10-10'))).getDay(), 6); assert.equal(new Date(lastSaturday(at('2026-10-14'))).getDate(), 10);
  assert.equal(decideMode({ ...ok, last: at('2026-10-10'), full: at('2026-10-10') }, 100, at('2026-10-16')), 'delta'); // пятница: всё ещё после субботней сверки
  assert.equal(decideMode({ ...ok, last: at('2026-10-10'), full: at('2026-10-10') }, 100, at('2026-10-17')), 'full');  // следующая суббота
  assert.equal(decideMode({ ...ok, last: 0 }, 100, now), 'full');           // нет отметки времени сервера
  assert.equal(maxMillis([0, 5, undefined, 9, 3]), 9);
});

test('срок хранения удалённого: год, затем удаление навсегда', async () => {
  const { isExpiredDeleted, purgeDate, historyCutoff, RETENTION_DAYS } = await import('../src/domain/sync.js');
  const DAY = 86400000; const now = Date.UTC(2027, 9, 10);
  assert.equal(RETENTION_DAYS, 365);
  assert.equal(isExpiredDeleted({ deleted: true, deletedAt: now - 364 * DAY }, now), false);   // ещё хранится
  assert.equal(isExpiredDeleted({ deleted: true, deletedAt: now - 366 * DAY }, now), true);    // срок вышел
  assert.equal(isExpiredDeleted({ deleted: false, deletedAt: now - 900 * DAY }, now), false);  // не удалено — не трогаем
  assert.equal(isExpiredDeleted({ deleted: true }, now), false);                               // нет даты удаления — не трогаем
  assert.equal(isExpiredDeleted(null, now), false);
  assert.equal(purgeDate(now), now + 365 * DAY); assert.equal(purgeDate(0), 0);
  assert.equal(historyCutoff(now), now - 365 * DAY);
});

test('серийный номер и MAC: разбор считанного', async () => {
  const d = await import('../src/domain/deviceid.js');
  assert.equal(d.normalizeMac('a4:14:37:0b:12:cd'), 'A4:14:37:0B:12:CD');
  assert.equal(d.normalizeMac('A414370B12CD'), 'A4:14:37:0B:12:CD');
  assert.equal(d.normalizeMac('A4-14-37-0B-12-CD'), 'A4:14:37:0B:12:CD');
  assert.equal(d.normalizeMac('DS-2CD2143G2'), '');
  assert.deepEqual(d.macsIn('SN:XYZ12345 MAC: a4:14:37:0b:12:cd'), ['A4:14:37:0B:12:CD']);
  assert.deepEqual(d.labeledSerials('S/N: DS2CD1234567 MAC 11:22:33:44:55:66'), ['DS2CD1234567']);
  assert.deepEqual(d.labeledSerials('https://x.com/p?sn=ABC123456&a=1'), ['ABC123456']);
  const mac = d.candidatesFor('mac', ['DS-2CD2143G2-I20200101AAWR', 'A414370B12CD']);
  assert.equal(mac[0].value, 'A4:14:37:0B:12:CD'); assert.equal(mac[0].sure, true);
  const sn = d.candidatesFor('serial', ['A414370B12CD', 'DS-2CD2143G2-I20200101AAWR']);
  assert.equal(sn[0].value, 'DS-2CD2143G2-I20200101AAWR');
  assert.equal(d.hasDeviceId({ id: 'Камера' }), true); assert.equal(d.hasDeviceId({ id: 'Дверь' }), false); assert.equal(d.hasDeviceId({ id: 'Дверь', scanId: true }), true);
  const pts = [{ id: 'a', mac: 'A4:14:37:0B:12:CD' }, { id: 'b', serial: 'abc1' }];
  assert.equal(d.findDuplicate(pts, { id: 'c' }, 'mac', 'a414370b12cd').id, 'a');
  assert.equal(d.findDuplicate(pts, { id: 'a' }, 'mac', 'a414370b12cd'), null);
  assert.equal(d.findDuplicate(pts, { id: 'c' }, 'serial', 'ABC1').id, 'b');
});

test('«Что осталось»: чего не хватает точке, с учётом этапов типа и привязки установки', async () => {
  const { remaining, missingStages } = await import('../src/domain/remaining.js');
  const bakar = { id: 'b1', projectId: 'P1', label: '1A-B1', cabinet: '1A', typeId: 'Бакар' };
  const cam2 = { id: 'c2', projectId: 'P1', label: '2B-01', cabinet: '2B', typeId: 'Камера' };
  const ctx = scenario([cam, bakar, cam2], [day('D1', '2026-10-05')], [
    entry('e1', 'D1', 'Хивут', 'HIV_KEY', ['c1']),
    entry('e2', 'D1', 'Хивут', 'HIV_DEV', ['b1']), entry('e3', 'D1', 'Проверка', 'CHK_FLUKE', ['b1']),
  ]);
  assert.deepEqual(missingStages(ctx.points.get('c1'), ctx), ['Установка', 'Проверка']);
  assert.deepEqual(missingStages(ctx.points.get('b1'), ctx), []); // у бакара установки нет, всё остальное сделано
  assert.deepEqual(missingStages(ctx.points.get('c2'), ctx), ['Хивут', 'Установка', 'Проверка']);
  const r = remaining(ctx);
  assert.deepEqual(r.map((g) => [g.cabinet, g.items.length]), [['1A', 1], ['2B', 1]]);
});

test('готовность по шкафам: точка завершена, когда сделаны все этапы её типа', async () => {
  const { isFinished, readinessByCabinet } = await import('../src/domain/remaining.js');
  const bakar = { id: 'b1', projectId: 'P1', label: '1A-B1', cabinet: '1A', typeId: 'Бакар' };
  const cam2 = { id: 'c2', projectId: 'P1', label: '2B-01', cabinet: '2B', typeId: 'Камера' };
  const all = (id) => [entry('e1' + id, 'D1', 'Протяжка', 'PR_PTS', [id]), entry('e2' + id, 'D1', 'Хивут', 'HIV_KEY', [id]), entry('e3' + id, 'D1', 'Установка', 'INS_CAM', [id]),
    entry('e4' + id, 'D1', 'Проверка', 'CHK_FLUKE', [id]), entry('e5' + id, 'D1', 'Шилют', 'SHL', [id])];
  const ctx = scenario([cam, bakar, cam2], [day('D1', '2026-10-05')], all('c1'));
  assert.equal(isFinished(ctx.points.get('c1'), ctx), true);
  assert.equal(isFinished(ctx.points.get('c2'), ctx), false);
  assert.deepEqual(readinessByCabinet(ctx).map((r) => [r.cabinet, r.done, r.total]), [['1A', 1, 2], ['2B', 0, 1]]);
});

test('exportSheets: листы выгрузки в Excel', async () => {
  const { exportSheets, buildContext } = await import('../src/domain/index.js');
  const project = { id: 'p', name: 'Мега' };
  const ctx = buildContext({ projects: [project], points: [{ id: 'a', projectId: 'p', label: '1A-01', typeId: 'Камера', cabinet: '1A', serial: 'GE1' }],
    types: [{ id: 'Камера', stages: ['Протяжка', 'Проверка'] }], days: [{ id: 'd', projectId: 'p', date: '2026-10-01', helper: 'сам' }],
    entries: [{ id: 'e', dayId: 'd', workType: 'Время', minutes: 30, note: 'ждали' }], catalog: [], cables: [], configs: [], units: [], culprits: [], delayReasons: [], journal: [] });
  const sh = exportSheets(project, ctx);
  assert.deepEqual(sh.map((x) => x.name), ['Точки', 'Журнал по точкам', 'Дни и работы', 'Справочники']);
  assert.equal(sh[0].rows[0][0], 'Обозначение'); assert.equal(sh[0].rows[1][0], '1A-01'); assert.ok(sh[0].rows[1].includes('GE1'));
  assert.equal(sh[2].rows[1][0], '2026-10-01'); assert.equal(sh[2].rows[1][8], 30);
});

test('downtimeByCulprit: простои по виновникам за месяц', async () => {
  const { downtimeByCulprit, buildContext } = await import('../src/domain/index.js');
  const ctx = buildContext({ projects: [{ id: 'p' }], points: [], types: [], catalog: [], cables: [], configs: [], units: [], delayReasons: [], journal: [],
    culprits: [{ id: 'Заказчик', he: 'לקוח' }],
    days: [{ id: 'd1', projectId: 'p', date: '2026-10-01' }, { id: 'd2', projectId: 'p', date: '2026-09-30' }],
    entries: [{ id: 'a', dayId: 'd1', workType: 'Время', minutes: 90, culprit: 'Заказчик' }, { id: 'b', dayId: 'd1', workType: 'Время', minutes: 30, culprit: 'Электрик' },
      { id: 'c', dayId: 'd1', workType: 'Время', minutes: 40, culprit: 'Заказчик' }, { id: 'd', dayId: 'd2', workType: 'Время', minutes: 99, culprit: 'Заказчик' }, { id: 'e', dayId: 'd1', workType: 'Время', minutes: 5 }] });
  const r = downtimeByCulprit(ctx, '2026-10');
  assert.deepEqual(r.list.map((g) => [g.culprit, g.minutes, g.count]), [['Заказчик', 130, 2], ['Электрик', 30, 1]]);
  assert.equal(r.totalMinutes, 160);
});

test('несколько видов кабеля: протяжка каждого вида отдельно, дох и метраж по видам', async () => {
  const { parseCables, cablesText, pullFigures, missingStages, buildReport, statusKeyOf } = await import('../src/domain/index.js');
  assert.deepEqual(parseCables('cat7×1, 6005 x 2').list, [{ cable: 'cat7', count: 1 }, { cable: '6005', count: 2 }]);
  assert.deepEqual(parseCables('cat7').bad, ['cat7']);
  const types = [...POINT_TYPES, { id: 'Интерком', nameHe: 'אינטרקום', defaultCable: '6005', defaultCables: 1, extraCables: [{ cable: 'cat7', count: 1 }], stages: ['Протяжка', 'Хивут'], installMode: 'none' }];
  const int = { id: 'i1', projectId: 'P1', label: '1A-INT1', cabinet: '1A', typeId: 'Интерком', length: 10 };
  const d = day('D1', '2026-10-05');
  const e1 = entry('E1', 'D1', 'Протяжка', 'PULL', ['i1'], { cableId: '6005' });
  let ctx = make({ types, points: [int], days: [d], entries: [e1], journal: [{ id: 'j1', entryId: 'E1', pointId: 'i1' }] });
  let info = pointInfo(ctx.points.get('i1'), ctx);
  assert.equal(cablesText(info.cableList), '6005×1 + cat7×1');
  assert.equal(info.cables, 2); assert.equal(info.metrage, 20);
  assert.equal(info.pulled, ''); assert.equal(info.status, 'Протянуто 1/2'); assert.equal(statusKeyOf(info), 'Частично протянута');
  assert.deepEqual(missingStages(ctx.points.get('i1'), ctx), ['Дотянуть', 'Хивут']);
  assert.deepEqual(pullFigures(e1, ctx), { count: 1, meters: 10 });
  const e2 = entry('E2', 'D1', 'Протяжка', 'PULL', ['i1'], { cableId: 'cat7' });
  ctx = make({ types, points: [int], days: [d], entries: [e1, e2], journal: [{ id: 'j1', entryId: 'E1', pointId: 'i1' }, { id: 'j2', entryId: 'E2', pointId: 'i1' }] });
  info = pointInfo(ctx.points.get('i1'), ctx);
  assert.equal(info.pulled, '2026-10-05'); assert.equal(info.status, 'Протянута');
  // запись протяжки без кабеля (старые данные) засчитывается всем видам
  const e0 = entry('E3', 'D1', 'Протяжка', 'PULL', ['i1']);
  ctx = make({ types, points: [int], days: [d], entries: [e0], journal: [{ id: 'j3', entryId: 'E3', pointId: 'i1' }] });
  assert.equal(pointInfo(ctx.points.get('i1'), ctx).status, 'Протянута');
  // однокабельная точка: протяжка «чужим» кабелем засчитывается (как раньше)
  const e4 = entry('E4', 'D1', 'Протяжка', 'PULL', ['c1'], { cableId: '6005' });
  ctx = make({ points: [cam], days: [d], entries: [e4], journal: [{ id: 'j4', entryId: 'E4', pointId: 'c1' }] });
  assert.equal(pointInfo(ctx.points.get('c1'), ctx).status, 'Протянута');
  // таблица руководства: кабели списком, частичная протяжка
  ctx = make({ types, points: [int], days: [d], entries: [e1], journal: [{ id: 'j1', entryId: 'E1', pointId: 'i1' }] });
  const rep = buildReport(project, ctx, { id: 't', lang: 'ru', columns: ['label', 'cable', 'cables', 'pulled', 'status'] });
  const row = rep.sheets[0].rows.at(-1);
  assert.deepEqual(row, ['1A-INT1', '6005×1 + cat7×1', 2, 'частично 1/2', 'Протянуто 1/2']);
  // настройка шкафа может убрать доп. кабели ([]) или оставить как в типе (null)
  ctx = make({ types, points: [int], cabinetSettings: [{ id: 's', projectId: 'P1', cabinet: '1A', typeId: 'Интерком', extraCables: [] }] });
  assert.equal(pointInfo(ctx.points.get('i1'), ctx).cables, 1);
});

test('точка из устройств: задачи по устройствам, галочки, протяжка по видам, установка k/n, дох', async () => {
  const { pullFigures, missingStages, isFinished, buildReport, tasksOf, devicesForWork, missingDetails } = await import('../src/domain/index.js');
  const cables = [{ id: 'cat7', nameHe: 'CAT7', accounting: 'Точки', workIds: ['HIV_KEY', 'HIV_DEV', 'CHK_FLUKE', 'SHL'] },
    { id: '6005', nameHe: '6005', accounting: 'Метры', workIds: ['HIV_DEV'] }];
  const devices = [
    { id: 'DV_KORE', name: 'Коре картисим', cables: [{ cable: '6005', count: 1 }], workIds: ['INS_KORE'] },
    { id: 'DV_MAG', name: 'Магнит индикация', cables: [{ cable: '6005', count: 1 }], workIds: ['INS_MAGNIT'] },
    { id: 'DV_MAN', name: 'Мануль хашмали', cables: [{ cable: '6005', count: 1 }], workIds: ['INS_MANUL'] },
    { id: 'DV_NIP', name: 'Лахцан нипуц', cables: [], workIds: ['INS_LNIPUTZ'] },
    { id: 'DV_BIO', name: 'Коре биометри', cables: [{ cable: '6005', count: 1 }, { cable: 'cat7', count: 1 }], workIds: ['INS_BIO'] },
  ];
  const types = POINT_TYPES.map((t) => (t.id === 'Дверь' ? { ...t, devices: [{ deviceId: 'DV_KORE', count: 1 }, { deviceId: 'DV_MAG', count: 1 }, { deviceId: 'DV_MAN', count: 1 }], workIds: ['CHK_DOOR'] } : t));
  types.push({ id: 'Коре биометри', nameHe: 'קורא ביומטרי', devices: [{ deviceId: 'DV_BIO', count: 1 }] });
  const d1 = { id: 'd1', projectId: 'P1', label: '1A-1.1', cabinet: '1A', typeId: 'Дверь', length: 10 };
  const d2 = { ...d1, id: 'd2', label: '1A-1.2', devices: [{ deviceId: 'DV_KORE', count: 2 }, { deviceId: 'DV_MAN', count: 1 }, { deviceId: 'DV_NIP', count: 1 }] };
  const bio = { id: 'b1', projectId: 'P1', label: '1A-BIO1', cabinet: '1A', typeId: 'Коре биометри', length: 5 };
  const D = day('D1', '2026-10-05');
  const mk = (entries) => make({ cables, devices, types, points: [d1, d2, bio], days: [D], entries,
    journal: entries.flatMap((e) => e.pointIds.map((p) => ({ id: `${e.id}-${p}`, entryId: e.id, pointId: p }))) });
  const CAT = { ...Object.fromEntries(CATALOG.map((w) => [w.id, w])) };
  assert.ok(CAT.CHK_DOOR && CAT.INS_BIO);

  let ctx = mk([]);
  // задачи двери: 3 протяжки, 3 хивута в шкафу (по устройствам), 3 установки, проверка двери
  const t1 = tasksOf(ctx.points.get('d1'), ctx);
  assert.equal(t1.filter((t) => t.stage === 'Протяжка').length, 3);
  assert.equal(t1.filter((t) => t.workId === 'HIV_DEV').length, 3);
  assert.equal(pointInfo(ctx.points.get('d1'), ctx).cables, 3);
  assert.equal(pointInfo(ctx.points.get('d2'), ctx).cables, 3); // 2 коре + мануль; нипуц без кабеля
  assert.equal(pointInfo(ctx.points.get('b1'), ctx).cableList.map((c) => `${c.cable}×${c.count}`).join(','), '6005×1,cat7×1');
  assert.deepEqual(devicesForWork([ctx.points.get('d2')], ctx, 'INS_KORE', 'Установка').map((x) => x.deviceId), ['DV_KORE']);

  // протяжка 6005 только коре и магнита на d1
  const e1 = entry('E1', 'D1', 'Протяжка', 'PR_PTS', ['d1'], { cableId: '6005', deviceIds: ['DV_KORE', 'DV_MAG'] });
  ctx = mk([e1]);
  let info = pointInfo(ctx.points.get('d1'), ctx);
  assert.equal(info.status, 'Протянуто 2/3');
  assert.deepEqual(pullFigures(e1, ctx), { count: 2, meters: 20 });
  assert.deepEqual(missingStages(ctx.points.get('d1'), ctx), ['Дотянуть', 'Хивут', 'Установка', 'Проверка']);
  assert.deepEqual(missingDetails(info, ctx)[0], { stage: 'Протяжка', items: ['Мануль хашмали (6005)'] });

  // всё на d1 без галочек: протяжка, хивут, установки (по каждому авизару), проверка двери
  const all = ['HIV_DEV', 'INS_KORE', 'INS_MAGNIT', 'INS_MANUL', 'CHK_DOOR'].map((w, i) => entry(`E${i + 3}`, 'D1', CAT[w].workType, w, ['d1']));
  const e2 = entry('E2', 'D1', 'Протяжка', 'PR_PTS', ['d1'], { cableId: '6005' });
  ctx = mk([e1, e2, all[0], all[1], all[2]]);
  info = pointInfo(ctx.points.get('d1'), ctx);
  assert.equal(info.status, 'Установлено 2/3'); assert.equal(info.install, 'Установлено 2/3');
  ctx = mk([e1, e2, ...all]);
  info = pointInfo(ctx.points.get('d1'), ctx);
  assert.equal(info.status, 'Проверена'); assert.ok(isFinished(ctx.points.get('d1'), ctx));

  // дох: установка коре на двери с двумя коре — 2 шт; протяжка биометри по видам
  const e9 = entry('E9', 'D1', 'Установка', 'INS_KORE', ['d2']);
  const e10 = entry('E10', 'D1', 'Протяжка', 'PR_PTS', ['b1'], { cableId: 'cat7' });
  ctx = mk([e9, e10]);
  assert.equal(itogShtuk(e9, ctx), 2);
  assert.deepEqual(pullFigures(e10, ctx), { count: 1, meters: 5 });
  assert.equal(pointInfo(ctx.points.get('b1'), ctx).status, 'Протянуто 1/2');
  assert.equal(pointInfo(ctx.points.get('d2'), ctx).install, 'Установлено 1/3'); // коре (×2 одной задачей), мануль, нипуц

  // таблица: этапы составной точки, «—» для этапа, которого нет
  const rep = buildReport(project, ctx, { id: 't', lang: 'ru', columns: ['label', 'cable', 'pulled', 'shilut'] });
  const rowB = rep.sheets[0].rows.find((r) => r[0] === '1A-BIO1');
  assert.deepEqual(rowB, ['1A-BIO1', '6005×1 + cat7×1', 'частично 1/2', '']);
  const rowD = rep.sheets[0].rows.find((r) => r[0] === '1A-1.1');
  assert.equal(rowD[3], '—'); // у двери нет шилюта
});
