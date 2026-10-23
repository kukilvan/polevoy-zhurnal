// Перенос проектов из режима «на устройстве» в базу Firebase (после настройки своей базы или входа по приглашению).
// Данные на устройстве не удаляются: перенесённые проекты просто помечаются, чтобы не предлагать их снова.
import { h, openModal, toast } from './ui.js';
import { localSnapshot } from './localdb.js';
import { info, error } from '../log.js';

const KEY = 'pm.migrated';
const done = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const mark = (pid) => { try { localStorage.setItem(KEY, JSON.stringify({ ...done(), [pid]: Date.now() })); } catch { /* ok */ } };
const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === undefined ? null : v)));

/** Проекты на устройстве, ещё не перенесённые: [{ project, docs: [{coll, id, doc}] }] */
export async function localProjects() {
  let rows = []; try { rows = await localSnapshot(); } catch { return []; }
  const projects = new Map(); const docs = new Map();
  for (const [k, v] of rows) {
    if (k.startsWith('P|')) projects.set(v.id, v);
    else if (k.startsWith('D|')) {
      const [, pid, coll, ...rest] = k.split('|'); if (pid === '_pool') continue;
      if (!docs.has(pid)) docs.set(pid, []);
      docs.get(pid).push({ coll, id: v?.id ?? rest.join('|'), doc: v });
    }
  }
  const skip = done();
  return [...projects.values()].filter((p) => !p.deleted && !skip[p.id]).map((p) => ({ project: p, docs: docs.get(p.id) || [] }));
}

async function moveOne(backend, user, { project, docs }) {
  const pid = project.id; const email = String(user.email || '').toLowerCase(); const name = user.displayName || email;
  const pdoc = clean({ ...project, memberUids: [user.uid], memberEmails: [email], invitedEmails: [], removedMembers: null, createdBy: user.uid, createdByName: name, updatedBy: user.uid, updatedByName: name, updatedAt: Date.now() });
  await backend.commit(pid, [{ coll: 'projects', id: pid, data: pdoc }]);   // сначала проект: правила пускают в подколлекции только участников
  await backend.commit(pid, docs.map((d) => ({ coll: d.coll, id: d.id, data: clean(d.doc) })));
  mark(pid);
  info(`Перенесён проект «${project.name}»: записей ${docs.length}`);
}

/** Предложить перенос (вызывается после входа в базу Firebase) */
export async function offerMigration(repo, user) {
  const list = await localProjects(); if (!list.length) return;
  const total = list.reduce((n, x) => n + x.docs.length, 0);
  const status = h('div', { class: 'mut', style: { margin: '6px 0' } });
  const go = h('button', { onclick: async () => {
    go.disabled = true;
    try {
      for (let i = 0; i < list.length; i++) { status.textContent = `Переношу «${list[i].project.name}» (${i + 1} из ${list.length})…`; await moveOne(repo.backend, user, list[i]); }
      close(); toast(`Перенесено проектов: ${list.length}`);
    } catch (e) { error('Перенос проектов', e); status.textContent = `Не получилось: ${e.message || e}. Попробуйте позже — данные на устройстве не тронуты.`; go.disabled = false; }
  } }, '☁️ Перенести');
  const close = openModal('Проекты на этом устройстве', h('div', {},
    h('div', { style: { lineHeight: 1.45 } }, `На этом устройстве есть проекты, которые вы вели без базы: ${list.map((x) => `«${x.project.name}»`).join(', ')} (записей: ${total}). Перенести их в базу? Тогда они будут видны на всех ваших устройствах, и в них можно приглашать коллег.`),
    h('div', { class: 'mut', style: { margin: '6px 0' } }, 'Копия на устройстве останется.'),
    status,
    h('div', { class: 'btns' }, go, h('button', { class: 'sec', onclick: () => { list.forEach((x) => mark(x.project.id)); close(); toast('Хорошо, не переносим. Вернуться к ним можно, выбрав режим «на устройстве»'); } }, 'Не переносить'))), { sticky: true });
}
