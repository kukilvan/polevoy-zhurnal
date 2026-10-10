// Экранная клавиатура на iPhone не сжимает страницу, а накрывает её. Следим за видимой областью (visualViewport):
// пока клавиатура открыта, окна ввода подгоняются под видимую часть, а выбранное поле прокручивается в центр.
const vv = window.visualViewport;
const root = document.documentElement;
const isField = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'button';

function update() {
  if (!vv) return;
  const open = window.innerHeight - vv.height > 120; // клавиатура занимает больше 120 px
  root.classList.toggle('kb', open);
  root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
  root.style.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`);
}
const reveal = (el) => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* старый браузер */ } };

export function initKeyboard() {
  if (!vv) return;
  vv.addEventListener('resize', update); vv.addEventListener('scroll', update);
  window.addEventListener('orientationchange', () => setTimeout(update, 300));
  document.addEventListener('focusin', (e) => {
    if (!isField(e.target)) return;
    // клавиатура выезжает с задержкой — прокручиваем несколько раз
    [60, 350, 700].forEach((t) => setTimeout(() => { update(); if (document.activeElement === e.target) reveal(e.target); }, t));
  });
  document.addEventListener('focusout', () => setTimeout(update, 150));
  update();
}
