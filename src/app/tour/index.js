// Тур по приложению: запуск (весь или по темам), предложение при первом проекте, короткое руководство для создающих проект.
import { h, openModal, toast } from '../ui.js';
import { state, getRepo, demo, ready, liveProjects } from '../store.js';
import { enterDemo, exitDemo, realRepo } from './demo.js';
import { runSteps, endTour, tourActive, closeModals } from './engine.js';
import { buildTopics } from './topics.js';

export { tourActive };
export const topicList = (ui) => buildTopics(ui).map(({ id, icon, title, steps }) => ({ id, icon, title, n: steps.length }));

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* нет доступа */ } };
const uidKey = (name) => `pz.${name}.${(realRepo() || getRepo())?.user?.uid}`;

/** ids: массив тем или 'all' */
export async function startTour(ui, ids = 'all') {
  if (tourActive()) return;
  const all = buildTopics(ui);
  const chosen = ids === 'all' ? all : ids.map((id) => all.find((t) => t.id === id)).filter(Boolean);
  if (!chosen.length) return;
  enterDemo();
  ui.go('project');
  // ждём, пока демо-проект загрузится
  for (let i = 0; i < 40 && !ready(); i++) await new Promise((r) => setTimeout(r, 100));
  const steps = chosen.flatMap((t) => t.steps);
  runSteps(steps, {
    onEnd: (done) => {
      closeModals();
      exitDemo();
      lsSet(uidKey('tourSeen'), '1');
      ui.go('project');
      setTimeout(() => ui.open('guide'), 0);
      if (done) toast('Тур пройден. Демо-проект удалён, ваши данные не тронуты');
    },
  });
}

/** Предложение пройти тур, когда в аккаунте появился первый проект */
let offered = false;
export function maybeOfferTour(ui) {
  if (offered || demo.on || !ready() || tourActive()) return;
  if (!liveProjects().length) return;
  if (lsGet(uidKey('tourSeen')) || lsGet(uidKey('tourOffered')) || getRepo()?.prefs?.tourOffered) return;
  try { if (sessionStorage.getItem('pz.tourLater')) return; } catch { /* ok */ }
  offered = true;
  setTimeout(() => {
    if (document.querySelector('.backdrop') || demo.on) { offered = false; return; }
    const close = openModal('Хотите пройти обучение?', h('div', {},
      h('p', {}, 'Покажу на примере, как устроено приложение: от добавления точек до отчёта за день. Это займёт несколько минут, можно остановиться в любой момент.'),
      h('div', { class: 'mut' }, 'Тур идёт на отдельном демо-проекте, ваши данные не пострадают. Позже его можно пройти в меню ☰ → Руководства.'),
      h('div', { class: 'btns' },
        h('button', { onclick: () => { close(); startTour(ui, 'all'); } }, '🎓 Пройти обучение'),
        h('button', { class: 'sec', onclick: () => { close(); try { sessionStorage.setItem('pz.tourLater', '1'); } catch { /* ok */ } } }, 'Позже'),
        h('button', { class: 'sec', onclick: () => { close(); lsSet(uidKey('tourOffered'), '1'); getRepo()?.saveUserPrefs({ tourOffered: true }); } }, 'Не напоминать'))), { sticky: true });
  }, 1800);
}

/** Короткое руководство для создающего проект — один раз, перед мастером */
export function withCreatorGuide(fn) {
  const key = uidKey('creatorGuide');
  if (demo.on || lsGet(key) || getRepo()?.prefs?.creatorGuideSeen) { fn(); return; }
  const close = openModal('Новый проект: коротко', h('div', {},
    h('ol', { style: { paddingLeft: '20px', lineHeight: 1.5 } },
      h('li', {}, 'Впишите название проекта и объект.'),
      h('li', {}, 'Отметьте типы точек, устройства, кабели и работы из общего набора. Лишнее потом можно добавить в «Ещё».'),
      h('li', {}, 'Остальные шаги (участники, чертежи, точки) необязательны. Их можно пропустить и вернуться позже.'),
      h('li', {}, 'Коллег приглашают по почте Google: меню ☰ → Участники.')),
    h('div', { class: 'btns' }, h('button', { onclick: () => { close(); lsSet(key, '1'); getRepo()?.saveUserPrefs({ creatorGuideSeen: true }); fn(); } }, 'Понятно, создаём'))));
}
