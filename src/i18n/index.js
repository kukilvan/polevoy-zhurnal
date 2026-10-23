// Языки интерфейса: русский (исходный), английский, иврит (справа налево).
// Код приложения пишет тексты по-русски; перевод накладывается на экран: каждый текст сверяется со словарём
// (точное совпадение или шаблон с «{}» на месте чисел и названий). Данные (точки, работы, типы) не меняются.
import en from './en.json';
import he from './he.json';

export const LANGS = [['ru', 'Русский'], ['en', 'English'], ['he', 'עברית']];
const KEY = 'pm.lang';
// Язык по умолчанию — по языку телефона, но только для новых людей: кто уже пользовался приложением
// (есть сохранённые настройки), остаётся на русском, пока сам не сменит язык.
const DICTS = { en, he };
function detect() {
  let used = false;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^(pm|pz)\./.test(k)) used = true; } } catch { return 'ru'; }
  if (used) return 'ru';
  const nav = String(navigator.language || '').slice(0, 2);
  return nav === 'he' || nav === 'iw' ? 'he' : nav === 'ru' || nav === 'uk' || nav === 'be' ? 'ru' : 'en';
}
export function lang() {
  let l = null; try { l = localStorage.getItem(KEY); } catch { /* ok */ }
  if (l && (l === 'ru' || DICTS[l])) return l;
  l = detect();
  try { localStorage.setItem(KEY, l); } catch { /* ok */ }
  return l;
}
export function setLang(l) { try { localStorage.setItem(KEY, l); } catch { /* ok */ } location.reload(); }
export const isRtl = () => lang() === 'he';

// ---------- словарь ----------
const CYR = /[А-Яа-яЁё]/;
const ICON = /^((?:\p{Extended_Pictographic}|[\d#*]️?⃣|[️‍]|[^\p{L}\p{N}\s«"(])+\s+)([\s\S]+)$/u;
let exact = null; let patterns = null; let extra = new Map();
const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/[{}]/g, (c) => `\\${c}`);
function build() {
  const d = DICTS[lang()] || {};
  exact = new Map(); patterns = [];
  for (const [ru0, tr0] of Object.entries(d)) {
    if (!tr0) continue;
    // пробелы по краям ключа не важны: tr() сравнивает текст без них и возвращает их на место
    const ru = ru0.trim(); const tr = ru0 !== ru ? tr0.trim() : tr0;
    if (ru.includes('{}')) {
      const parts = ru.split('{}');
      patterns.push({ re: new RegExp(`^${parts.map(esc).join('([\\s\\S]*?)')}$`), reG: new RegExp(`^${parts.map(esc).join('([\\s\\S]*)')}$`), tr, head: parts[0], n: parts.length - 1 });
    } else exact.set(ru, tr);
  }
  // длинные шаблоны первыми: «Шкаф {} · {}» раньше, чем «{} · {}»
  const lit = (p) => p.re.source.replace(/\(\[\\s\\S\]\*\?\)/g, '').length;
  patterns.sort((a, b) => b.head.length - a.head.length || lit(b) - lit(a));
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
  // значок перед текстом («👋 Знакомство», «1️⃣ Шаг 1…»): перевести текст без значка
  const icon = core.match(ICON);
  if (icon) { const hit2 = exact.get(icon[2]) ?? extra.get(icon[2]); if (hit2 !== undefined) return lead + icon[1] + hit2 + trail; }
  for (const p of patterns) {
    if (p.head && !core.startsWith(p.head)) continue;
    let m = core.match(p.re); if (!m) continue;
    // «Проект «Офис»» — кавычки внутри названия: берём разбиение, где кавычки в каждой части парные
    const odd = (a) => (a.match(/«/g) || []).length !== (a.match(/»/g) || []).length;
    if (m.slice(1).some(odd)) { const g = core.match(p.reG); if (g && !g.slice(1).some(odd)) m = g; }
    const args = m.slice(1).map((a) => tr(a, depth + 1));
    let i = 0;
    const out = p.tr.replace(/\{(\d*)\}/g, (_, k) => (k === '' ? args[i++] : args[Number(k)]) ?? '');
    return lead + out + trail;
  }
  if (icon) { const rest = tr(icon[2], depth + 1); if (rest !== icon[2]) return lead + icon[1] + rest + trail; }
  // число в скобках в конце («Установка камеры (8)»)
  const cnt = core.match(/^([\s\S]+?)(\s*\(\d+\))$/);
  if (cnt) { const a = tr(cnt[1], depth + 1); if (a !== cnt[1]) return lead + a + cnt[2] + trail; }
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
  // кнопка «←» (назад) справа налево смотрит в другую сторону
  if (isRtl() && (cur === '←' || cur === '→')) { const out = cur === '←' ? '→' : '←'; orig.set(node, { src: cur, out }); node.nodeValue = out; return; }
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
  // значок на главном экране — с названием на языке приложения
  const man = document.querySelector('link[rel="manifest"]');
  if (man) man.href = man.href.replace(/manifest(-\w+)?\.webmanifest/, `manifest-${l}.webmanifest`);
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', tr('Проекты'));
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
