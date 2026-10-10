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
