// Разовый импорт данных проекта из файла (подготовлен из таблицы AppSheet).
import { h, confirmDialog, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';

const COLLS = ['points', 'journal', 'days', 'entries', 'cabinetSettings', 'todos', 'notes'];

export function parseImport(text) {
  const data = JSON.parse(text);
  if (data.format !== 'polevoy-import-1') throw new Error('Это не файл импорта этого приложения');
  COLLS.forEach((c) => { if (!Array.isArray(data[c])) data[c] = []; });
  data.points.forEach((p) => { if (!p.id || !p.label || !p.typeId) throw new Error(`Некорректная точка: ${JSON.stringify(p).slice(0, 80)}`); });
  return data;
}

// replace: все текущие данные проекта уходят в «удалённые» (их можно вернуть через историю), затем записывается содержимое файла
export function runImport(repo, pid, data, { replace }) {
  const now = Date.now();
  const incoming = new Set(COLLS.flatMap((c) => data[c].map((d) => `${c}/${d.id}`)));
  const ops = [];
  let removed = 0;
  if (replace) {
    COLLS.forEach((c) => (state.data[c] || []).filter((d) => !d.deleted && !incoming.has(`${c}/${d.id}`)).forEach((d) => {
      ops.push({ coll: c, id: d.id, action: 'delete', data: { deleted: true, deletedAt: now, deletedBy: repo.by.uid, deletedByName: repo.by.name } });
      removed += 1;
    }));
  }
  COLLS.forEach((c) => data[c].forEach((d) => ops.push({ coll: c, id: d.id, action: 'import', data: { ...d, deleted: false } })));
  repo.save(pid, ops);
  if (data.project) repo.saveProject(pid, data.project);
  return { removed, added: ops.length - removed };
}

export function importView() {
  const p = currentProject();
  const out = h('div', { class: 'mut', style: { marginTop: '10px', whiteSpace: 'pre-wrap' } });
  const input = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; if (!file) return;
    let data;
    try { data = parseImport(await file.text()); } catch (e) { out.textContent = `Не удалось прочитать файл: ${e.message}`; return; }
    const live = COLLS.reduce((n, c) => n + (state.data[c] || []).filter((d) => !d.deleted).length, 0);
    out.textContent = `В файле: проект «${data.project?.name || '—'}», точек ${data.points.length}, строк журнала ${data.journal.length}.\nСейчас в проекте «${p.name}» записей: ${live}.`;
    const go = h('button', { class: 'danger', onclick: async () => {
      if (!(await confirmDialog(`Заменить данные проекта «${p.name}»? Текущие точки, дни, записи и журнал будут убраны (их можно вернуть через «История и откат»), и загрузится содержимое файла.`, { yes: 'Заменить', danger: true }))) return;
      go.disabled = true; out.textContent = 'Загружаю…';
      const r = runImport(getRepo(), p.id, data, { replace: true });
      out.textContent = `Готово. Убрано старых записей: ${r.removed}, загружено: ${r.added}.\nДанные отправятся на сервер, как только будет интернет.`;
      toast('Импорт выполнен');
    } }, `Заменить данные проекта «${p.name}»`);
    out.append(h('div', { class: 'btns' }, go));
  });
  return h('div', {},
    h('div', { class: 'card' },
      h('b', {}, 'Импорт данных'),
      h('div', { class: 'mut', style: { margin: '6px 0' } }, 'Загрузка проекта из файла импорта. Выберите файл .json (он сохранён у вас в «Файлах»). Справочники не меняются.'),
      h('div', { class: 'btns' }, h('button', { onclick: () => input.click() }, '📥 Выбрать файл'), input),
      out));
}
