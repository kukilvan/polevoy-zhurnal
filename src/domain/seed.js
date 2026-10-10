// Начальные справочники для нового проекта (раздел 4 описания функционала).
// Цены не переносятся. Справочники лежат внутри проекта, чтобы все участники видели одно и то же.

const ALL = 'Камера,Дверь,Галай,Вайфай,Бакар,Точка,TV,Оптика,Другое';

// id | работа RU | работа HE | тип работы | единица | для типов точек ('*' = все, '' = без точек) | компонент двери (1/0)
const CATALOG_ROWS = `
PR_PTS|Протяжка по точкам|השחלת כבלים|Протяжка|по кабелю|*|0
PR_MAN|Протяжка без точек|השחלת כבלים|Протяжка|по кабелю||0
RE_PULL|Перетяжка точки|השחלה חוזרת של נקודה|Перетяжка|точка|*|0
MOVE_CAM|Перенос камеры|העתקת מצלמה|Перенос|шт|Камера|0
MOVE_PT|Перенос точки|העתקת נקודה|Перенос|шт|*|0
HIV_KEY|Хивут кистона|חיווט קיסטון|Хивут|шт|Камера,Вайфай,Бакар,Точка,TV|0
HIV_DEV|Подключение в шкафу|חיווט בארון|Хивут|шт|*|0
INS_CAM|Установка камеры|התקנת מצלמה|Установка|шт|Камера|0
INS_GALAI|Установка галая|התקנת גלאי|Установка|шт|Галай|0
INS_AP|Установка вайфая|התקנת נקודת Wi-Fi|Установка|шт|Вайфай|0
INS_BAKAR|Установка бакара|התקנת בקר|Установка|шт|Бакар|0
INS_INT|Установка интеркома|התקנת אינטרקום|Установка|шт||0
INS_OB|Установка тревожной кнопки|התקנת לחצן מצוקה|Установка|шт||0
INS_KORE|Коре картисим|קורא כרטיסים|Установка|шт|Дверь|1
INS_BIO|Коре биометри|קורא ביומטרי|Установка|шт|Дверь|1
INS_KEYB|Киборд|התקנת קיבורד|Установка|шт|Дверь|1
INS_MANUL|Мануль хашмали|חיבור מנעול חשמלי|Установка|шт|Дверь|1
INS_MAGNIT|Магнит индикация|התקנת מגנט אינדיקציה|Установка|шт|Дверь|1
INS_LNIPUTZ|Лахцан нипуц|התקנת לחצן ניפוץ|Установка|шт|Дверь|1
INS_LPTIHA|Лахцан птиха|התקנת לחצן פתיחה|Установка|шт|Дверь|1
INS_EMAG|Электромагнит|התקנת אלקטרומגנט|Установка|шт|Дверь|1
CHK_FLUKE|Проверка кабеля Fluke|בדיקת כבל Fluke|Проверка|шт|Камера,Вайфай,Бакар,Точка,TV|0
CHK_DOOR|Проверка двери|בדיקת דלת|Проверка|шт|Дверь|0
CHK_GALAI|Проверка галая|בדיקת גלאי|Проверка|шт|Галай|0
SHL|Шилют|שילוט|Шилют|мин|Камера,Вайфай,Бакар,Точка,TV,Оптика|0
EX_MERIRON|Установка мерирона|התקנת מרירון|Доп. работа|м||0
EX_TAALA|Установка таалы|התקנת תעלה|Доп. работа|м||0
EX_COBRA|Установка кобры|התקנת צינור קוברה|Доп. работа|м||0
EX_KIDUAH|Кидуах|קידוח|Доп. работа|шт||0
EX_KIDUAH_D|Кидуах для двери|קידוח לדלת|Доп. работа|шт||0
EX_KUFSAT|Установка куфсат хибурим|התקנת קופסת חיבורים|Доп. работа|шт||0
EX_KUFSAT_H|Хивут куфсат хибурим|חיווט קופסת חיבורים|Доп. работа|шт||0
EX_TBOX|Установка тикшоретной коробки|התקנת קופסת תקשורת|Доп. работа|шт||0
EX_PANEL|Установка панели|התקנת פאנל|Доп. работа|шт||0
EX_OPANEL|Установка оптической панели|התקנת פאנל אופטי|Доп. работа|шт||0
EX_BRUSH|Установка панели сеарот|התקנת פאנל שערות|Доп. работа|шт||0
EX_CABINET|Установка шкафа|התקנת ארון|Доп. работа|шт||0
EX_BATT|Установка аккумуляторов|התקנת מצברים|Доп. работа|шт||0
EX_PAS|Установка пас хашмаль|התקנת פס חשמל|Доп. работа|шт||0
EX_SIREN|Установка сирены|התקנת צופר|Доп. работа|шт||0
EX_SHARSHUR|Установка шаршура|התקנת שרשרת|Доп. работа|м||0
EX_ARON_HIV|Хивут арона бакары|חיווט ארון בקרה|Доп. работа|мин||0
EX_ARON_MEG|Подключение арона бакары мегашером|חיבור ארון בקרה במגשר|Доп. работа|шт||0
EX_SW_MEG|Подключение точек мегашерами к свитчу|חיבור נקודות למתג במגשרים|Доп. работа|шт||0
T_WAIT|Ожидание|המתנה|Время|мин||0
T_MATERIAL|Получение материала|קבלת חומרים|Время|мин||0
T_SIYUR|Сиюр|סיור|Время|мин||0
T_ADRAHA|Адраха|הדרכה|Время|мин||0
T_FAULT|Поиск неисправности|איתור תקלה|Время|мин||0
T_REQUEST|Просьбы менахеля проекта|ביצוע בקשות מנהל הפרויקט|Время|мин||0
T_DOCS|Таблицы и документация|מילוי טבלאות ותיעוד|Время|мин||0
T_KIVUN|Кивун камер|כיוון מצלמות|Время|мин||0
T_DOOR|Затяжка кабелей в двери|השחלת כבלים לדלתות|Время|мин||0
T_CABINET|Сидур шкафа|סידור ארון|Время|мин||0
T_TASHTIT|Таштит|הכנת תשתית|Время|мин||0
T_OTHER|Другое|אחר|Время|мин||0
`.trim();

export const CATALOG = CATALOG_ROWS.split('\n').map((line) => {
  const [id, name, nameHe, workType, unit, forTypes, door] = line.split('|');
  return {
    id, name, nameHe, workType, unit, multiplier: 1,
    forTypes: forTypes === '*' ? ALL.split(',') : forTypes ? forTypes.split(',') : [],
    isDoorComponent: door === '1', active: true,
  };
});

// Этапы типов точек: Протяжка / Хивут / Установка / Проверка / Шилют
export const POINT_TYPES = [
  { id: 'Камера', installMode: 'works', installWorkIds: ['INS_CAM'], nameHe: 'מצלמה', defaultCable: 'cat7', defaultCables: 1, stages: ['Протяжка', 'Хивут', 'Установка', 'Проверка', 'Шилют'], isDoor: false },
  { id: 'Дверь', installMode: 'config', installWorkIds: [], nameHe: 'דלת', defaultCable: '6005', defaultCables: 3, stages: ['Протяжка', 'Хивут', 'Установка', 'Проверка'], isDoor: true },
  { id: 'Галай', installMode: 'works', installWorkIds: ['INS_GALAI'], nameHe: 'גלאי', defaultCable: '6005', defaultCables: 1, stages: ['Протяжка', 'Хивут', 'Установка'], isDoor: false },
  { id: 'Вайфай', installMode: 'works', installWorkIds: ['INS_AP'], nameHe: 'נקודת גישה', defaultCable: 'cat7', defaultCables: 1, stages: ['Протяжка', 'Хивут', 'Установка', 'Проверка', 'Шилют'], isDoor: false },
  { id: 'Бакар', installMode: 'none', installWorkIds: [], nameHe: 'בקר', defaultCable: 'cat7', defaultCables: 2, stages: ['Протяжка', 'Хивут', 'Установка', 'Проверка'], isDoor: false },
  { id: 'Точка', installMode: 'none', installWorkIds: [], nameHe: 'נקודת תקשורת', defaultCable: 'cat7', defaultCables: 1, stages: ['Протяжка', 'Хивут', 'Проверка', 'Шилют'], isDoor: false },
  { id: 'TV', installMode: 'none', installWorkIds: [], nameHe: 'נקודת TV', defaultCable: 'cat7', defaultCables: 1, stages: ['Протяжка', 'Хивут', 'Проверка', 'Шилют'], isDoor: false },
  { id: 'Оптика', installMode: 'none', installWorkIds: [], nameHe: 'סיב אופטי', defaultCable: 'Оптика', defaultCables: 1, stages: ['Протяжка', 'Хивут', 'Проверка'], isDoor: false },
  { id: 'Другое', installMode: 'none', installWorkIds: [], nameHe: 'אחר', defaultCable: 'cat7', defaultCables: 1, stages: ['Протяжка', 'Хивут', 'Установка', 'Проверка'], isDoor: false },
];

// accounting: 'Точки' — в доху считаются точки, 'Метры' — кабели и метры
export const CABLES = [
  { id: 'cat7', nameHe: 'כבל CAT7', accounting: 'Точки', workIds: ['HIV_KEY', 'HIV_DEV', 'CHK_FLUKE', 'SHL'] },
  { id: '6005', nameHe: 'כבל 6005', accounting: 'Метры', workIds: ['HIV_DEV'] },
  { id: 'Оптика', nameHe: 'סיב אופטי', accounting: 'Метры', workIds: ['HIV_DEV'] },
];

// Устройства (составляющие точек): кабели + работы авизара. id | RU | HE | кабели (кабель*кол-во через +) | работы
const DEVICE_ROWS = `
DV_CAM|Камера|מצלמה|cat7*1|INS_CAM
DV_AP|Вайфай (аксэспоинт)|אקסס פוינט|cat7*1|INS_AP
DV_GALAI|Галай|גלאי|6005*1|INS_GALAI,CHK_GALAI
DV_BAKAR|Бакар|בקר|cat7*2|INS_BAKAR
DV_POINT|Точка связи|נקודת תקשורת|cat7*1|
DV_TV|Точка TV|נקודת TV|cat7*1|
DV_FIBER|Оптика|סיב אופטי|Оптика*1|
DV_KORE|Коре картисим|קורא כרטיסים|6005*1|INS_KORE
DV_BIO|Коре биометри|קורא ביומטרי|6005*1+cat7*1|INS_BIO
DV_KEYB|Киборд|קיבורד|6005*1|INS_KEYB
DV_MANUL|Мануль хашмали|מנעול חשמלי|6005*1|INS_MANUL
DV_MAGNIT|Магнит индикация|מגנט אינדיקציה|6005*1|INS_MAGNIT
DV_EMAG|Электромагнит|אלקטרומגנט|6005*1|INS_EMAG
DV_LPTIHA|Лахцан птиха|לחצן פתיחה|6005*1|INS_LPTIHA
DV_LNIPUTZ|Лахцан нипуц|לחצן ניפוץ||INS_LNIPUTZ
DV_OB|Тревожная кнопка|לחצן מצוקה|6005*1|INS_OB
DV_INT|Интерком|אינטרקום|6005*1+cat7*1|INS_INT
`.trim();
export const DEVICES = DEVICE_ROWS.split('\n').map((line) => {
  const [id, name, nameHe, cables, works] = line.split('|');
  return { id, name, nameHe,
    cables: cables ? cables.split('+').map((c) => { const [cable, count] = c.split('*'); return { cable, count: Number(count) }; }) : [],
    workIds: works ? works.split(',') : [] };
});

// Состав типов точек по умолчанию (новая схема): тип → устройства и работы на всю точку
export const TYPE_DEVICES = {
  'Камера': [['DV_CAM']], 'Дверь': [['DV_KORE'], ['DV_MANUL'], ['DV_MAGNIT']], 'Галай': [['DV_GALAI']], 'Вайфай': [['DV_AP']],
  'Бакар': [['DV_BAKAR']], 'Точка': [['DV_POINT']], 'TV': [['DV_TV']], 'Оптика': [['DV_FIBER']], 'Другое': [['DV_POINT']],
  'Коре биометри': [['DV_BIO']], 'Интерком': [['DV_INT']], 'Лахцан птиха': [['DV_LPTIHA']], 'Тревожная кнопка': [['DV_OB']],
};
export const TYPE_WORKS = { 'Дверь': ['CHK_DOOR'] };
const NEW_TYPES = [
  { id: 'Коре биометри', nameHe: 'קורא ביומטרי' }, { id: 'Интерком', nameHe: 'אינטרקום' },
  { id: 'Лахцан птиха', nameHe: 'לחצן פתיחה' }, { id: 'Тревожная кнопка', nameHe: 'לחצן מצוקה' },
];
const compose = (t) => ({ ...t, devices: (TYPE_DEVICES[t.id] || []).map(([deviceId, count = 1]) => ({ deviceId, count })), workIds: TYPE_WORKS[t.id] || [] });
// Типы для нового проекта: все в новой схеме
export const composedTypes = (types) => [...types, ...NEW_TYPES.filter((n) => !types.some((t) => t.id === n.id))].map(compose);

// Чего не хватает проекту из стандартной библиотеки (не трогая того, что уже есть): операции записи
export function libraryOps(ctx) {
  const ops = [];
  CATALOG.filter((w) => !ctx.catalog.has(w.id)).forEach((w) => ops.push({ coll: 'catalog', id: w.id, data: w }));
  CABLES.forEach((c) => {
    const cur = ctx.cables.get(c.id);
    if (!cur) ops.push({ coll: 'cables', id: c.id, data: c });
    else if (!Array.isArray(cur.workIds)) ops.push({ coll: 'cables', id: c.id, data: { workIds: c.workIds } });
  });
  DEVICES.filter((d) => !ctx.devices.has(d.id)).forEach((d) => ops.push({ coll: 'devices', id: d.id, data: d }));
  NEW_TYPES.filter((t) => !ctx.types.has(t.id)).forEach((t) => ops.push({ coll: 'types', id: t.id, data: compose(t) }));
  return ops;
}

export const CONFIGS = [
  { id: 'CFG1', name: 'Коре + мануль + магнит', components: ['INS_KORE', 'INS_MANUL', 'INS_MAGNIT'] },
  { id: 'CFG2', name: 'Коре + 2 лахцана + электромагнит', components: ['INS_KORE', 'INS_LNIPUTZ', 'INS_LPTIHA', 'INS_EMAG'] },
];

export const UNITS = [
  { id: 'шт', he: "יח'" }, { id: 'м', he: "מ'" }, { id: 'точка', he: "נק'" },
  { id: 'мин', he: "דק'" }, { id: 'по кабелю', he: 'לפי כבל' },
];

export const CULPRITS = [
  { id: 'Мы', he: 'הצוות שלנו' }, { id: 'Менахель проекта', he: 'מנהל הפרויקט' }, { id: 'Электрики', he: 'חשמלאים' },
  { id: 'Заказчик', he: 'המזמין' }, { id: 'Поставка / склад', he: 'אספקה / מחסן' },
  { id: 'Другие подрядчики', he: 'קבלנים אחרים' }, { id: 'Никто', he: 'ללא' },
];

export const DELAY_REASONS = [
  { id: 'Нет трубы', he: 'אין צינור' }, { id: 'Нет инфраструктуры', he: 'אין תשתית' }, { id: 'Нет таалы', he: 'אין תעלה' },
  { id: 'Нет кабеля', he: 'אין כבל' }, { id: 'Нет электричества', he: 'אין חשמל' }, { id: 'Нет оборудования', he: 'אין ציוד' },
  { id: 'Ждём другую бригаду', he: 'ממתין לצוות' }, { id: 'Столы', he: 'שולחנות' }, { id: 'Другое', he: 'אחר' },
];

// Что считается «установкой» точки (привязка по умолчанию): none — не требуется, works — перечисленные работы, config — набор двери (конфигурация)
export const defaultInstallBinding = (typeId) => {
  const t = POINT_TYPES.find((x) => x.id === typeId);
  return t ? { mode: t.installMode, workIds: [...t.installWorkIds] } : null;
};
