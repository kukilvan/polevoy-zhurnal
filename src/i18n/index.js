// Языки интерфейса: русский (исходный), английский, иврит (справа налево).
// Код приложения пишет тексты по-русски; перевод накладывается на экран: каждый текст сверяется со словарём
// (точное совпадение или шаблон с «{}» на месте чисел и названий). Данные (точки, работы, типы) не меняются.
import en from './en.json';
import he from './he.json';

export const LANGS = [['ru', 'Русский'], ['en', 'English'], ['he', 'עברית']];
const KEY = 'pm.lang';
const AUTO = false;  // язык по настройкам телефона — включить, когда переводы будут готовы
const DICTS = { en, he };
export function lang() {
  let l = null; try { l = localStorage.getItem(KEY); } catch { /* ok */ }
  if (l && (l === 'ru' || DICTS[l])) return l;
  if (!AUTO) return 'ru';   // пока переводы не закончены — язык только по выбору человека
  const nav = String(navigator.language || '').slice(0, 2);
  return nav === 'he' || nav === 'iw' ? 'he' : nav === 'ru' || nav === 'uk' || nav === 'be' ? 'ru' : 'en';
}
export function setLang(l) { try { localStorage.setItem(KEY, l); } catch { /* ok */ } location.reload(); }
export const isRtl = () => lang() === 'he';

// ---------- словарь ----------
const CYR = /[А-Яа-яЁё]/;
let exact = null; let patterns = null; let extra = new Map();
const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/[{}]/g, (c) => `\\${c}`);
function build() {
  const d = DICTS[lang()] || {};
  exact = new Map(); patterns = [];
  for (const [ru, tr] of Object.entries(d)) {
    if (!tr) continue;
    if (ru.includes('{}')) {
      const parts = ru.split('{}');
      patterns.push({ re: new RegExp(`^${parts.map(esc).join('([\\s\\S]*?)')}$`), tr, head: parts[0], n: parts.length - 1 });
    } else exact.set(ru, tr);
  }
  // длинные шаблоны первыми: «Шкаф {} · {}» раньше, чем «{} · {}»
  patterns.sort((a, b) => b.head.length - a.head.length || b.re.source.length - a.re.source.length);
}
/** Добавить переводы на лету (названия из справочников: nameHe и т. п.) */
export function addTranslations(map) { if (lang() === 'ru') return; extra = new Map([...extra, ...Object.entries(map)]); }

/** Перевести строку (если перевода нет — вернуть как есть) */
export function tr(s, depth = 0) {
  if (lang() === 'ru' || typeof s !== 'string' || !CYR.test(s)) return s;
  if (!exact) build();
  const lead = s.match(/^\s*/)[0]; const trail = s.match(/\s*$/)[0]; const core = s.trim();
  if (!core) return s;
  const hit = exact.get(core) ?? extra.get(core);
  if (hit !== undefined) return lead + hit + trail;
  if (depth > 8) return s;
  for (const p of patterns) {
    if (p.head && !core.startsWith(p.head)) continue;
    const m = core.match(p.re); if (!m) continue;
    const args = m.slice(1).map((a) => tr(a, depth + 1));
    let i = 0;
    const out = p.tr.replace(/\{(\d*)\}/g, (_, k) => (k === '' ? args[i++] : args[Number(k)]) ?? '');
    return lead + out + trail;
  }
  return s;
}
export const t = tr;

// ---------- наложение на экран ----------
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
const ATTRS = ['placeholder', 'title', 'aria-label'];
const orig = new WeakMap();   // узел текста → исходный русский текст (чтобы не переводить перевод)
function doText(node) {
  const p = node.parentNode; if (!p || SKIP.has(p.nodeName) || p.closest?.('[data-notr],[contenteditable]')) return;
  const cur = node.nodeValue; const o = orig.get(node);
  if (o && o.out === cur) return;      // уже переведён
  if (!CYR.test(cur)) return;
  const out = tr(cur);
  if (out !== cur) { orig.set(node, { src: cur, out }); node.nodeValue = out; }
}
function doEl(el) {
  if (el.nodeType !== 1 || SKIP.has(el.nodeName) && el.nodeName !== 'TEXTAREA') return;
  for (const a of ATTRS) { const v = el.getAttribute?.(a); if (v && CYR.test(v)) { const out = tr(v); if (out !== v) el.setAttribute(a, out); } }
  if (el.nodeName === 'TEXTAREA' || SKIP.has(el.nodeName)) return;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.currentNode; n; n = w.nextNode()) {
    if (n.nodeType === 3) doText(n);
    else if (n !== el) for (const a of ATTRS) { const v = n.getAttribute(a); if (v && CYR.test(v)) { const out = tr(v); if (out !== v) n.setAttribute(a, out); } }
  }
}
export function startI18n() {
  const l = lang();
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'he' ? 'rtl' : 'ltr';
  if (l === 'ru') return;
  build();
  document.title = tr(document.title);
  // системные окна подтверждения/сообщения
  const c = window.confirm.bind(window); window.confirm = (m) => c(tr(String(m)));
  const a = window.alert.bind(window); window.alert = (m) => a(tr(String(m)));
  const run = (muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doEl(m.target);
      else m.addedNodes.forEach((n) => (n.nodeType === 3 ? doText(n) : doEl(n)));
    }
  };
  new MutationObserver(run).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  doEl(document.body);
}
