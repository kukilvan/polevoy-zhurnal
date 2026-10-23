// Мастер «своя база Firebase»: по одному шагу, у каждого — кнопка «Открыть страницу» (сразу нужная страница консоли вашего проекта)
// и «Проверить» (приложение само спрашивает у Google, что сделано, и объясняет, что не так). Черновик хранится на устройстве.
import { h, toast } from './ui.js';
import qrcode from 'qrcode-generator';
import { APP_NAME, parseFirebaseConfig, saveConnection, connection, connectLink, isMobile, setLocalMode } from '../edition.js';
import { checkConfig, checkGoogle, checkDomain, checkFirestore } from '../domain/fbcheck.js';
import OPEN_RULES from '../../firestore.open.rules?raw';   // = openRules(firestore.rules), сверяется тестом

export { OPEN_RULES };
export const siteUrl = () => `${location.origin}${location.pathname}`;

export async function copy(text, what = 'Скопировано') {
  try { await navigator.clipboard.writeText(text); toast(what); } catch {
    const t = h('textarea', { style: { position: 'fixed', opacity: 0 } }); t.value = text; document.body.append(t); t.select();
    try { document.execCommand('copy'); toast(what); } catch { toast('Не удалось скопировать — выделите текст вручную'); } t.remove();
  }
}

/** QR-код ссылки (svg) */
export function qr(text, size = 200) {
  const q = qrcode(0, 'L'); q.addData(text); q.make();
  const el = h('div', { style: { background: '#fff', padding: '8px', borderRadius: '10px', width: `${size}px`, margin: '8px auto' } });
  el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  return el;
}

const DRAFT = 'pm.setupDraft';
const draft = () => { try { return JSON.parse(localStorage.getItem(DRAFT) || 'null') || { step: 0 }; } catch { return { step: 0 }; } };
const saveDraft = (d) => { try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch { /* ok */ } };
const fc = (pid, path) => `https://console.firebase.google.com/project/${encodeURIComponent(pid)}/${path}`;

export function setupView({ onDone, onBack }) {
  const root = h('div', { class: 'wrap' });
  let d = draft();
  const host = location.hostname;
  const set = (patch) => { d = { ...d, ...patch }; saveDraft(d); draw(); };
  const open = (url) => window.open(url, '_blank', 'noopener');
  const result = (r) => h('div', { style: { margin: '8px 0', padding: '8px 10px', borderRadius: '10px', background: 'var(--inset)', color: r.ok ? 'var(--ok, #22c55e)' : 'var(--err)' } }, `${r.ok ? '✅' : '❌'} ${r.msg}`);

  // Шаги: title, text[], url (открыть), check (async → {ok,msg}), extra (узлы)
  const STEPS = [
    {
      title: 'Проект и настройки подключения',
      text: [
        'Откройте консоль Firebase под своим Google-аккаунтом и нажмите «Создать проект» (Create a project). Название любое, Google Analytics можно выключить.',
        'В новом проекте на главной странице нажмите значок </> (Web, «Добавить приложение»). Название любое, Hosting не отмечайте → «Зарегистрировать».',
        'Появится код с блоком firebaseConfig. Скопируйте его целиком и вставьте ниже.',
      ],
      url: () => 'https://console.firebase.google.com/',
      extra: () => {
        const ta = h('textarea', { rows: 6, placeholder: 'const firebaseConfig = {\n  apiKey: "…",\n  authDomain: "…",\n  projectId: "…",\n  …\n};', style: { width: '100%' } });
        ta.value = d.cfg ? JSON.stringify(d.cfg, null, 1) : '';
        ta.addEventListener('change', () => { try { d.cfg = parseFirebaseConfig(ta.value); saveDraft(d); } catch { /* проверит кнопка */ } });
        ta.dataset.cfg = '1';
        return [ta];
      },
      check: async () => {
        const ta = root.querySelector('textarea[data-cfg]');
        let cfg; try { cfg = parseFirebaseConfig(ta.value); } catch (e) { return { ok: false, msg: e.message }; }
        d.cfg = cfg; saveDraft(d);
        return checkConfig(cfg);
      },
    },
    {
      title: 'Включите вход через Google',
      text: [
        'На открывшейся странице Authentication нажмите «Начать» (Get started), если есть такая кнопка.',
        'Во вкладке «Способ входа» (Sign-in method) выберите Google → переключатель «Включить» (Enable) → выберите свою почту → «Сохранить» (Save).',
      ],
      url: () => fc(d.cfg.projectId, 'authentication/providers'),
      check: () => checkGoogle(d.cfg, siteUrl()),
    },
    {
      title: 'Разрешите адрес приложения',
      text: ['Authentication → вкладка «Настройки» (Settings) → «Разрешённые домены» (Authorized domains) → «Добавить домен» (Add domain) → вставьте строку ниже → «Добавить».'],
      url: () => fc(d.cfg.projectId, 'authentication/settings'),
      extra: () => [h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        h('code', { style: { flex: 1, background: 'var(--inset)', padding: '8px', borderRadius: '8px' } }, host),
        h('button', { class: 'sec', onclick: () => copy(host) }, '📋 Скопировать'))],
      check: () => checkDomain(d.cfg, host),
    },
    {
      title: 'Создайте базу данных',
      text: [
        'Firestore Database → «Создать базу данных» (Create database).',
        'Выпуск (Edition) — Standard, если спросит. Регион — ближайший (например, europe-west). Режим — «Рабочий» (Start in production mode) → «Создать».',
        'Создание занимает около минуты.',
      ],
      url: () => fc(d.cfg.projectId, 'firestore'),
      check: async () => (await checkFirestore(d.cfg)).db,
    },
    {
      title: 'Вставьте правила базы',
      text: [
        'Нажмите «Скопировать правила». Откройте страницу базы → вкладка «Правила» (Rules). Сотрите всё, что там написано, вставьте скопированное → «Опубликовать» (Publish).',
        'Правила защищают данные: каждый видит только свои проекты и те, куда его пригласили.',
      ],
      url: () => fc(d.cfg.projectId, 'firestore/rules'),
      extra: () => [h('button', { onclick: () => copy(OPEN_RULES, 'Правила скопированы') }, '📋 Скопировать правила')],
      check: async () => (await checkFirestore(d.cfg)).rules,
    },
  ];

  function intro() {
    const mobile = isMobile();
    const here = `${siteUrl()}?setup=1`;
    return [
      h('h1', {}, 'Своя база'),
      h('div', { class: 'card' },
        h('b', {}, 'Что это даёт'),
        h('ul', { style: { paddingLeft: '20px', lineHeight: 1.5 } },
          h('li', {}, 'Работа вместе: приглашайте коллег в проекты.'),
          h('li', {}, 'Одни и те же данные на телефоне и компьютере, изменения видны сразу.'),
          h('li', {}, 'Данные надёжно хранятся у Google в вашем личном проекте. Потеря телефона ничего не стирает.'),
          h('li', {}, 'Бесплатно, без карты.')),
        h('div', { class: 'mut' }, '5 шагов, около 10 минут. На каждом шаге приложение откроет нужную страницу и само проверит, что всё сделано.')),
      mobile ? h('div', { class: 'card' },
        h('b', {}, '💻 Удобнее на компьютере'),
        h('div', { class: 'mut', style: { margin: '4px 0' } }, 'Страницы Google плохо видны на телефоне. Отправьте себе ссылку и откройте её на компьютере. Когда закончите, компьютер покажет QR-код: отсканируйте его камерой телефона, и телефон подключится к базе.'),
        h('div', { class: 'btns' },
          h('button', { class: 'sec', onclick: () => copy(here, 'Ссылка на мастер скопирована') }, '📋 Скопировать ссылку'),
          h('button', { class: 'sec', onclick: () => open(`https://wa.me/?text=${encodeURIComponent(`${APP_NAME}: настройка своей базы — ${here}`)}`) }, '💬 Отправить себе в WhatsApp'),
          h('button', { class: 'sec', onclick: () => open(`mailto:?subject=${encodeURIComponent(APP_NAME)}&body=${encodeURIComponent(here)}`) }, '✉️ На почту'))) : null,
      h('div', { class: 'btns' },
        onBack ? h('button', { class: 'sec', onclick: onBack }, '← Назад') : null,
        h('button', { onclick: () => set({ step: 1 }) }, mobile ? 'Всё равно здесь, на телефоне' : 'Начать')),
    ];
  }

  function stepView(n) {
    const st = STEPS[n - 1];
    const res = h('div', {});
    const nextBtn = h('button', { style: { display: d.done?.[n] ? '' : 'none' }, onclick: () => set({ step: n + 1 }) }, n === STEPS.length ? 'Готово →' : 'Дальше →');
    const checkBtn = h('button', { class: 'sec', onclick: async () => {
      checkBtn.disabled = true; checkBtn.textContent = '⏳ Проверяю…';
      const r = await st.check();
      checkBtn.disabled = false; checkBtn.textContent = '🔎 Проверить';
      res.replaceChildren(result(r));
      d.done = { ...(d.done || {}), [n]: !!r.ok }; saveDraft(d);
      nextBtn.style.display = r.ok ? '' : 'none';
    } }, '🔎 Проверить');
    const canOpen = n === 1 || d.cfg;
    return [
      h('div', { class: 'mut', style: { margin: '6px 2px' } }, `Шаг ${n} из ${STEPS.length}`),
      h('div', { style: { display: 'flex', gap: '4px', margin: '0 2px 10px' } }, ...STEPS.map((_, i) => h('div', { style: { flex: 1, height: '4px', borderRadius: '2px', background: i < n ? 'var(--acc)' : 'var(--line)' } }))),
      h('div', { class: 'card' },
        h('b', { style: { fontSize: '17px' } }, st.title),
        ...st.text.map((t, i) => h('div', { style: { margin: '8px 0', lineHeight: 1.45 } }, `${st.text.length > 1 ? `${i + 1}) ` : ''}${t}`)),
        canOpen ? h('button', { style: { margin: '6px 0' }, onclick: () => open(st.url()) }, '↗ Открыть страницу') : null,
        ...(st.extra ? st.extra() : []),
        res,
        h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => set({ step: n - 1 }) }, '←'), checkBtn, nextBtn)),
      d.done?.[n] ? null : h('div', { class: 'mut', style: { margin: '6px 2px' } }, 'Сделали? Нажмите «Проверить» — приложение скажет, всё ли в порядке.'),
    ];
  }

  function finish() {
    const c = { firebase: d.cfg, clientId: '' };
    const link = connectLink(c, siteUrl());
    return [
      h('h1', {}, '🎉 База готова'),
      h('div', { class: 'card' },
        h('div', {}, 'Нажмите «Войти» — войдите своим Google-аккаунтом. Вы станете администратором этой базы.'),
        h('div', { class: 'btns' }, h('button', { onclick: () => { saveConnection(c); setLocalMode(false); try { localStorage.removeItem(DRAFT); } catch { /* ok */ } onDone(); } }, 'Войти'))),
      h('div', { class: 'card' },
        h('b', {}, '📱 Подключить телефон'),
        h('div', { class: 'mut', style: { margin: '4px 0' } }, 'Отсканируйте камерой телефона — приложение на телефоне подключится к этой базе. Эту же ссылку потом можно отправлять коллегам.'),
        qr(link),
        h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => copy(link, 'Ссылка скопирована') }, '📋 Скопировать ссылку'))),
    ];
  }

  function draw() {
    const n = d.step || 0;
    root.replaceChildren(...(n === 0 ? intro() : n > STEPS.length ? finish() : stepView(n)).filter(Boolean));
    window.scrollTo(0, 0);
  }
  draw();
  return root;
}

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
      h('div', { class: 'mut', style: { margin: '4px 0' } }, 'Необязательно: Client ID своего OAuth-клиента Google. Пусто — используется общий клиент приложения.'), cid,
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

/** Мастер своей базы поверх приложения (из режима «на устройстве»): после входа проекты с устройства предложат перенести */
export function openWizardScreen() {
  const app = document.getElementById('app');
  app.replaceChildren(setupView({ onDone: () => location.replace(location.pathname), onBack: () => location.reload() }));
  window.scrollTo(0, 0);
}
