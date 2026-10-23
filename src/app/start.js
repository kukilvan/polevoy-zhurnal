// Первый запуск чистого приложения: приветствие → значок на главном экране (на телефоне) → «Как будете работать»:
// на этом устройстве (без настройки) или своя база Firebase (мастер), либо подключение по ссылке-приглашению.
import { h, toast } from './ui.js';
import { APP_NAME, isMobile, isIOS, isStandalone, saveConnection, parseConnect, setLocalMode } from '../edition.js';
import { LANGS, lang, setLang } from '../i18n/index.js';

// Android/Chrome: системное окно «Установить приложение» (событие приходит до показа экрана — ловим сразу при загрузке)
let installEvent = null;
if (typeof window !== 'undefined') window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });

const card = (...kids) => h('div', { class: 'card' }, ...kids);
const p = (text, style = {}) => h('div', { style: { margin: '6px 0', lineHeight: 1.45, ...style } }, text);

export function startView({ onLocal, onFirebase, onConnected }) {
  const root = h('div', { class: 'wrap' });
  const show = (...kids) => { root.replaceChildren(...kids.filter(Boolean)); window.scrollTo(0, 0); };

  function welcome() {
    show(
      h('div', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '6px' }, 'data-notr': '' }, ...LANGS.map(([k, name]) => h('button', { class: k === lang() ? '' : 'sec', style: { padding: '6px 10px' }, onclick: () => k !== lang() && setLang(k) }, name))),
      h('h1', {}, APP_NAME),
      card(p('Приложение для монтажников слаботочных систем: точки проекта, чертежи, протяжки, метраж, шкафы и шильют, ежедневные отчёты на русском и иврите. Работает без интернета.')),
      h('div', { class: 'btns' }, h('button', { onclick: () => (isMobile() && !isStandalone() ? installGate() : how()) }, '▶ Начать')),
      card(h('b', {}, '🔗 Вас пригласили?'),
        p('Если коллега прислал ссылку — просто откройте её. Или вставьте сюда:', { color: 'var(--mut)' }),
        inviteBox()));
  }

  function inviteBox() {
    const inp = h('input', { type: 'text', placeholder: 'Ссылка-приглашение', style: { width: '100%' } });
    return h('div', {}, inp, h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => {
      try { const u = new URL(inp.value.trim()); const c = u.searchParams.get('connect'); if (!c) throw new Error('в ссылке нет данных подключения'); saveConnection(parseConnect(c)); setLocalMode(false); onConnected(); }
      catch (e) { toast(`Ссылка не подходит: ${e.message}`); }
    } }, 'Подключиться')));
  }

  function installGate() {
    const ios = isIOS();
    show(
      h('h1', {}, 'Значок на главном экране'),
      card(h('b', {}, 'Зачем'),
        p('Приложение хранит данные прямо в телефоне. Если открывать его из браузера, телефон может через какое-то время очистить данные сайта — и всё пропадёт. У приложения со значка своё постоянное хранилище, и работает оно как обычная программа: на весь экран и без интернета.')),
      ios ? card(h('b', {}, 'iPhone / iPad'),
        p('1) Внизу Safari нажмите «Поделиться» (квадрат со стрелкой вверх). В Chrome — «⋯» или значок «Поделиться» вверху.'),
        p('2) Пролистайте и выберите «На экран “Домой”» (Add to Home Screen) → «Добавить».'),
        p('3) Закройте браузер и откройте приложение со значка «Проекты» на главном экране.'))
        : card(h('b', {}, 'Android'),
          installEvent ? h('button', { onclick: async () => { installEvent.prompt(); const r = await installEvent.userChoice.catch(() => null); if (r?.outcome === 'accepted') toast('Готово — откройте приложение со значка'); installEvent = null; } }, '📲 Установить приложение') : null,
          p(installEvent ? 'Или вручную:' : '1) В Chrome нажмите «⋮» (три точки) вверху справа.'),
          p(installEvent ? '«⋮» → «Установить приложение» или «Добавить на главный экран».' : '2) «Установить приложение» или «Добавить на главный экран».'),
          p('Затем откройте приложение со значка «Проекты».')),
      card(p('Когда откроете со значка, приложение продолжит с этого места. Эту страницу в браузере можно закрыть.', { color: 'var(--mut)' })),
      h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: welcome }, '← Назад')));
  }

  function how() {
    show(
      h('h1', {}, 'Как будете работать?'),
      card(h('b', {}, `📱 Только на ${isMobile() ? 'этом телефоне' : 'этом устройстве'}`),
        p('Начать можно сразу, ничего настраивать не нужно. Все данные хранятся на устройстве.'),
        h('ul', { style: { paddingInlineStart: '20px', lineHeight: 1.5, margin: '4px 0' } },
          h('li', {}, 'Google Диск подключается кнопкой: чертежи, резервные копии, таблицы.'),
          h('li', {}, 'Работать вместе с коллегами нельзя.'),
          h('li', {}, 'Данные только на этом устройстве — делайте резервную копию на Диск.')),
        h('div', { class: 'btns' }, h('button', { onclick: () => { setLocalMode(true); onLocal(); } }, 'Работать на устройстве'))),
      card(h('b', {}, '☁️ Своя база в облаке (Firebase)'),
        p('Около 10 минут настройки, лучше с компьютера. Приложение ведёт по шагам и само проверяет каждый шаг.'),
        h('ul', { style: { paddingInlineStart: '20px', lineHeight: 1.5, margin: '4px 0' } },
          h('li', {}, 'Работа вместе: приглашайте коллег в проекты.'),
          h('li', {}, 'Одни данные на телефоне и компьютере, изменения видны сразу.'),
          h('li', {}, 'Надёжное хранение у Google в вашем личном проекте, бесплатно.')),
        h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: onFirebase }, 'Настроить свою базу'))),
      p('Начали на устройстве — свою базу можно настроить и позже: проекты перенесутся в неё.', { color: 'var(--mut)', margin: '6px 2px' }),
      card(h('b', {}, '🔗 Есть ссылка-приглашение?'), inviteBox()),
      isMobile() && !isStandalone() ? null : h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: welcome }, '← Назад')));
  }

  welcome();
  return { el: root, how, install: installGate };
}

/** Телефон, открыт не со значка: экран-подсказка (для режима «на устройстве» — обязательно) */
export function needsInstallGate() { return isMobile() && !isStandalone(); }
