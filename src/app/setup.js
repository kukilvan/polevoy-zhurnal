// Мастер настройки открытой версии: человек создаёт свой проект Firebase, вставляет его настройки — и приложение работает на его базе.
// Коллеги подключаются по ссылке-приглашению (там уже есть настройки), мастер им не нужен.
import { h, toast } from './ui.js';
import { APP_NAME, parseFirebaseConfig, saveConnection, parseConnect, connection } from '../edition.js';
import OPEN_RULES from '../../firestore.open.rules?raw';   // = openRules(firestore.rules), сверяется тестом

export { OPEN_RULES };
export const siteUrl = () => `${location.origin}${location.pathname}`;

export async function copy(text, what = 'Скопировано') {
  try { await navigator.clipboard.writeText(text); toast(what); } catch {
    const t = h('textarea', { style: { position: 'fixed', opacity: 0 } }); t.value = text; document.body.append(t); t.select();
    try { document.execCommand('copy'); toast(what); } catch { toast('Не удалось скопировать — выделите текст вручную'); } t.remove();
  }
}

const link = (url, text = url) => h('a', { href: url, target: '_blank', rel: 'noopener' }, text);
const code = (text) => h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0' } },
  h('code', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere', background: 'var(--inset)', padding: '6px 8px', borderRadius: '8px' } }, text),
  h('button', { class: 'sec', onclick: () => copy(text) }, '📋'));

/** Шаги настройки: [{ title, body: [узлы] }] — тот же список показывается в руководстве */
export function setupSteps() {
  const host = location.hostname;
  return [
    { title: 'Создайте проект Firebase', body: [
      'Firebase — бесплатный сервис Google, в нём будут храниться ваши данные. Карта не нужна.',
      h('div', {}, 'Откройте ', link('https://console.firebase.google.com', 'console.firebase.google.com'), ' под своим Google-аккаунтом → «Создать проект» (Create a project). Название любое. Google Analytics можно выключить.'),
    ] },
    { title: 'Включите базу данных', body: [
      'В проекте слева: «Создание» (Build) → «Firestore Database» → «Создать базу данных» (Create database).',
      'Регион — ближайший к вам (например, europe-west). Режим — «рабочий» (Production mode).',
    ] },
    { title: 'Включите вход через Google', body: [
      '«Создание» (Build) → «Authentication» → «Начать» (Get started) → вкладка «Способ входа» (Sign-in method) → «Google» → включить (Enable) → укажите свою почту → «Сохранить».',
      'Там же вкладка «Настройки» (Settings) → «Разрешённые домены» (Authorized domains) → «Добавить домен» и вставьте:', code(host),
    ] },
    { title: 'Вставьте правила базы', body: [
      '«Firestore Database» → вкладка «Правила» (Rules) → сотрите всё, что там написано, вставьте правила кнопкой ниже → «Опубликовать» (Publish).',
      h('button', { class: 'sec', onclick: () => copy(OPEN_RULES, 'Правила скопированы') }, '📋 Скопировать правила'),
      h('div', { class: 'mut' }, 'Правила защищают данные: каждый видит только свои проекты и проекты, куда его пригласили.'),
    ] },
    { title: 'Скопируйте настройки подключения', body: [
      '⚙ (рядом с «Обзор проекта») → «Настройки проекта» (Project settings) → внизу «Ваши приложения» (Your apps) → значок </> (Web).',
      'Название любое, галочку Hosting не ставьте → «Зарегистрировать» (Register app). Появится код с блоком firebaseConfig — скопируйте его целиком и вставьте в поле ниже.',
    ] },
    { title: 'Google Диск и Таблицы (можно позже)', body: [
      'Нужно для чертежей, резервных копий на Диск и таблиц для руководства. Без этого приложение работает, но эти кнопки не сработают.',
      h('div', {}, '1) Откройте ', link('https://console.cloud.google.com/apis/library', 'Google Cloud → Библиотека API'), ', сверху выберите ваш проект и включите (Enable) «Google Drive API» и «Google Sheets API».'),
      h('div', {}, '2) ', link('https://console.cloud.google.com/apis/credentials/consent', 'Экран согласия OAuth'), ' (OAuth consent screen): тип External, название и почта. В «Тестовые пользователи» (Test users / Audience) добавьте почты всех, кто будет пользоваться приложением (до 100).'),
      h('div', {}, '3) ', link('https://console.cloud.google.com/apis/credentials', 'Учётные данные'), ' (Credentials) → «Web client (auto created by Google Service)». В «Authorized JavaScript origins» добавьте первую строку, в «Authorized redirect URIs» — вторую:'),
      code(location.origin), code(siteUrl()),
      'Скопируйте оттуда «Client ID» (заканчивается на .apps.googleusercontent.com) и вставьте во второе поле ниже.',
      h('div', { class: 'mut' }, 'При первом доступе к Диску Google покажет «Приложение не проверено» — нажмите «Дополнительно» → «Перейти». Это ваше собственное подключение.'),
    ] },
  ];
}

export function setupView({ onDone }) {
  const cfgBox = h('textarea', { rows: 7, placeholder: 'const firebaseConfig = {\n  apiKey: "…",\n  authDomain: "…",\n  projectId: "…",\n  …\n};', style: { width: '100%' } });
  const cid = h('input', { type: 'text', placeholder: '…apps.googleusercontent.com (можно позже)', style: { width: '100%' } });
  const cur = connection(); if (cur) { cfgBox.value = JSON.stringify(cur.firebase, null, 2); cid.value = cur.clientId || ''; }
  const err = h('div', { style: { color: 'var(--err)', margin: '6px 0' } });
  const invite = h('input', { type: 'text', placeholder: 'Вставьте ссылку-приглашение', style: { width: '100%' } });
  const save = () => {
    try {
      const firebase = parseFirebaseConfig(cfgBox.value);
      const c = cid.value.trim();
      if (c && !/\.apps\.googleusercontent\.com$/.test(c)) throw new Error('Client ID должен заканчиваться на .apps.googleusercontent.com');
      saveConnection({ firebase, clientId: c }); onDone();
    } catch (e) { err.textContent = e.message; }
  };
  const join = () => {
    try { const u = new URL(invite.value.trim()); const p = u.searchParams.get('connect'); if (!p) throw new Error('В ссылке нет данных подключения'); saveConnection(parseConnect(p)); onDone(); }
    catch (e) { toast(`Ссылка не подходит: ${e.message}`); }
  };
  const steps = setupSteps();
  return h('div', { class: 'wrap' },
    h('h1', {}, APP_NAME),
    h('div', { class: 'card' },
      h('b', {}, 'Вас пригласили?'),
      h('div', { class: 'mut', style: { margin: '4px 0 8px' } }, 'Если коллега прислал ссылку — просто откройте её. Или вставьте сюда:'),
      invite, h('div', { class: 'btns' }, h('button', { onclick: join }, 'Подключиться'))),
    h('div', { class: 'card' },
      h('b', {}, 'Своя база: настройка за 10 минут'),
      h('div', { class: 'mut', style: { marginTop: '4px' } }, 'Приложение хранит данные в вашем собственном бесплатном проекте Firebase (Google). Никто, кроме вас и тех, кого вы пригласите, их не видит. Делается один раз, удобнее с компьютера.')),
    ...steps.map((s, i) => h('div', { class: 'card' },
      h('b', {}, `${i + 1}. ${s.title}`),
      ...s.body.map((x) => (typeof x === 'string' ? h('div', { style: { margin: '6px 0' } }, x) : x)))),
    h('div', { class: 'card' },
      h('b', {}, 'Настройки подключения'),
      h('div', { class: 'mut', style: { margin: '4px 0' } }, 'Блок firebaseConfig из шага 5:'), cfgBox,
      h('div', { class: 'mut', style: { margin: '8px 0 4px' } }, 'Client ID из шага 6 (необязательно):'), cid,
      err,
      h('div', { class: 'btns' }, h('button', { onclick: save }, 'Сохранить и войти'))));
}

// ☰ → Данные → «Подключение к базе»: что подключено, ссылка для коллег, Client ID для Диска, сменить базу
export async function connectionModal(onLogout) {
  const { openModal } = await import('./ui.js');
  const { adminEmail, clearConnection } = await import('../edition.js');
  const { linkCard } = await import('./views/members.js');
  const c = connection();
  const cid = h('input', { type: 'text', value: c?.clientId || '', placeholder: '…apps.googleusercontent.com', style: { width: '100%' } });
  const close = openModal('Подключение к базе', h('div', {},
    h('div', {}, 'Проект Firebase: ', h('b', {}, c?.firebase?.projectId || '—')),
    h('div', { class: 'mut', style: { margin: '4px 0 10px' } }, `Администратор базы: ${adminEmail() || 'ещё не определён'}`),
    linkCard(),
    h('div', { class: 'card' },
      h('b', {}, 'Google Диск и Таблицы'),
      h('div', { class: 'mut', style: { margin: '4px 0' } }, 'Client ID веб-клиента (шаг 6 настройки). Нужен для Диска на iPhone.'), cid,
      h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => {
        const v = cid.value.trim();
        if (v && !/\.apps\.googleusercontent\.com$/.test(v)) { toast('Client ID должен заканчиваться на .apps.googleusercontent.com'); return; }
        saveConnection({ ...c, clientId: v }); toast('Сохранено');
      } }, 'Сохранить'))),
    h('div', { class: 'card' },
      h('b', {}, 'Правила базы'),
      h('div', { class: 'mut', style: { margin: '4px 0' } }, 'Если после обновления приложения что-то не записывается — вставьте свежие правила: Firestore Database → «Правила» → «Опубликовать».'),
      h('button', { class: 'sec', onclick: () => copy(OPEN_RULES, 'Правила скопированы') }, '📋 Скопировать правила')),
    h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: async () => {
      if (!confirm('Отключиться от этой базы? Приложение откроет мастер настройки. Данные в базе останутся.')) return;
      close(); clearConnection(); try { await onLogout?.(); } catch { /* ok */ } location.reload();
    } }, '🔌 Отключиться от базы'))));
}
