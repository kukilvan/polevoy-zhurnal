// Журнал событий для отладки: хранится в памяти и в localStorage (последние 300 строк),
// показывается на экране «Журнал событий».
const KEY = 'pz.log.v1';
const MAX = 300;
let lines = [];
const listeners = new Set();

try {
  lines = JSON.parse(localStorage.getItem(KEY) || '[]');
  if (!Array.isArray(lines)) lines = [];
} catch { lines = []; }

function stamp() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(lines.slice(-MAX))); } catch { /* переполнено/запрещено */ }
}

export function log(level, msg, extra) {
  let text = String(msg);
  if (extra !== undefined) {
    try { text += ' ' + (extra instanceof Error ? `${extra.name}: ${extra.message}` : JSON.stringify(extra)); }
    catch { text += ' ' + String(extra); }
  }
  const row = { t: stamp(), level, text };
  lines.push(row);
  if (lines.length > MAX) lines = lines.slice(-MAX);
  persist();
  (console[level === 'error' ? 'error' : 'log'])(`[${row.t}] ${text}`);
  listeners.forEach((fn) => fn(row));
}

export const info = (m, e) => log('info', m, e);
export const warn = (m, e) => log('warn', m, e);
export const error = (m, e) => log('error', m, e);
export const getLines = () => lines.slice();
export function clearLog() { lines = []; persist(); listeners.forEach((fn) => fn(null)); }
export function onLog(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function asText() { return lines.map((r) => `${r.t} ${r.level.toUpperCase()} ${r.text}`).join('\n'); }

window.addEventListener('error', (e) => error('window.error', e.message));
window.addEventListener('unhandledrejection', (e) => error('unhandledrejection', e.reason));
