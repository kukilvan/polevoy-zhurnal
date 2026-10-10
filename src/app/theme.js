// Тема оформления: тёмная (по умолчанию), светлая или как в телефоне. Хранится на этом устройстве.
const KEY = 'pz.theme';
export const THEMES = [['dark', 'Тёмная'], ['light', 'Светлая'], ['auto', 'Как в телефоне']];

export function getTheme() {
  try { const v = localStorage.getItem(KEY); return THEMES.some(([id]) => id === v) ? v : 'dark'; } catch { return 'dark'; }
}
const effective = (t) => (t === 'auto' ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t);

export function applyTheme(t = getTheme()) {
  document.documentElement.setAttribute('data-theme', effective(t));
}
export function setTheme(t) {
  try { localStorage.setItem(KEY, t); } catch { /* нет доступа к хранилищу */ }
  applyTheme(t);
}
export const themeLabel = (t = getTheme()) => THEMES.find(([id]) => id === t)?.[1] || 'Тёмная';
// следующая тема по кругу: тёмная → светлая → как в телефоне
export function nextTheme() { const i = THEMES.findIndex(([id]) => id === getTheme()); return THEMES[(i + 1) % THEMES.length][0]; }

applyTheme();
try { window.matchMedia?.('(prefers-color-scheme: light)').addEventListener('change', () => { if (getTheme() === 'auto') applyTheme(); }); } catch { /* старый браузер */ }
