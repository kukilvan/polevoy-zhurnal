// Репозиторий данных проекта. Две реализации хранилища с одним интерфейсом:
//  - Firestore (боевая, с офлайн-кэшем и очередью записи);
//  - память (для автотестов интерфейса, включается адресом ?mem=1).
// Общая логика здесь: кто и когда изменил, история изменений, мягкое удаление.
import {
  collection, doc, onSnapshot, query, where, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { info, error } from '../log.js';
import {
  CATALOG, POINT_TYPES, CABLES, CONFIGS, UNITS, CULPRITS, DELAY_REASONS,
} from '../domain/index.js';

// Подколлекции проекта, которые приложение читает целиком (журнал изменений читается отдельно)
export const COLLECTIONS = ['points', 'days', 'entries', 'journal', 'catalog', 'types', 'cables', 'configs',
  'units', 'culprits', 'delayReasons', 'cabinetSettings', 'todos', 'notes'];

// В id документа Firestore нельзя '/', а у справочников id = название («Поставка / склад»)
export const docKey = (id) => String(id).replace(/\//g, '_');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function newId(len = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const clean = (obj) => JSON.parse(JSON.stringify(obj, (k, v) => (v === undefined ? null : v)));

// ---------- хранилище: память ----------
export function createMemoryBackend() {
  const projects = new Map(); // pid -> doc
  const colls = new Map();    // `${pid}/${name}` -> Map(key -> doc)
  const listeners = new Set();
  let settings = {};
  const bucket = (pid, name) => {
    const k = `${pid}/${name}`;
    if (!colls.has(k)) colls.set(k, new Map());
    return colls.get(k);
  };
  const notify = () => listeners.forEach((fn) => fn());
  return {
    kind: 'memory',
    listenProjects(uid, cb) {
      const run = () => cb([...projects.values()].filter((p) => (p.memberUids || []).includes(uid)).map((p) => ({ ...p })));
      listeners.add(run); run(); return () => listeners.delete(run);
    },
    listenInvitations(email, uid, cb) {
      const run = () => cb([...projects.values()].filter((p) => (p.invitedEmails || []).includes(email) && !(p.memberUids || []).includes(uid)).map((p) => ({ ...p })));
      listeners.add(run); run(); return () => listeners.delete(run);
    },
    listenColl(pid, name, cb) {
      const run = () => cb([...bucket(pid, name).values()].map((d) => ({ ...d })));
      listeners.add(run); run(); return () => listeners.delete(run);
    },
    async commit(pid, writes) {
      for (const w of writes) {
        if (w.coll === 'projects') { projects.set(w.id, { ...(projects.get(w.id) || {}), ...w.data }); continue; }
        const b = bucket(pid, w.coll); const key = docKey(w.id);
        b.set(key, { ...(b.get(key) || {}), ...w.data });
      }
      notify();
    },
    async loadSettings() { return { ...settings }; },
    async saveSettings(patch) { settings = { ...settings, ...patch }; },
    dump: () => ({ projects: [...projects.values()], colls: [...colls.entries()].map(([k, v]) => [k, [...v.values()]]) }),
  };
}

// ---------- хранилище: Firestore ----------
export function createFirestoreBackend(db, uid) {
  return {
    kind: 'firestore',
    listenProjects(_uid, cb) {
      const q = query(collection(db, 'projects'), where('memberUids', 'array-contains', uid));
      return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ ...d.data(), _pending: d.metadata.hasPendingWrites }))),
        (e) => error('Чтение проектов', `${e.code || ''} ${e.message || e}`));
    },
    listenInvitations(email, uid, cb) {
      const q = query(collection(db, 'projects'), where('invitedEmails', 'array-contains', email));
      return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data()).filter((p) => !(p.memberUids || []).includes(uid))),
        (e) => error('Чтение приглашений', `${e.code || ''} ${e.message || e}`));
    },
    listenColl(pid, name, cb) {
      // Если проект ещё не дошёл до сервера, чтение отклоняется — повторяем попытку
      let unsub = () => {}; let stopped = false; let tries = 0; let timer = null;
      const start = () => {
        unsub = onSnapshot(collection(db, 'projects', pid, name),
          (snap) => { tries = 0; cb(snap.docs.map((d) => ({ ...d.data(), _pending: d.metadata.hasPendingWrites }))); },
          (e) => {
            if (stopped) return;
            if (e.code === 'permission-denied' && tries < 15) { tries++; timer = setTimeout(() => { if (!stopped) start(); }, 1500); return; }
            error(`Чтение ${name}`, `${e.code || ''} ${e.message || e}`);
          });
      };
      start();
      return () => { stopped = true; clearTimeout(timer); unsub(); };
    },
    // Запись пачками (в одной пачке до 500 операций). Не ждём ответа сервера: офлайн запись остаётся в очереди.
    commit(pid, writes) {
      const CHUNK = 400;
      const chunks = [];
      for (let i = 0; i < writes.length; i += CHUNK) {
        const batch = writeBatch(db);
        writes.slice(i, i + CHUNK).forEach((w) => {
          const ref = w.coll === 'projects' ? doc(db, 'projects', w.id) : doc(db, 'projects', pid, w.coll, docKey(w.id));
          batch.set(ref, { ...w.data, updatedAtServer: serverTimestamp() }, { merge: true });
        });
        chunks.push(batch);
      }
      return Promise.all(chunks.map((b) => b.commit())); // порядок отправки сохраняется
    },
    async loadSettings() { return {}; },
    async saveSettings() {},
  };
}

const emailOf = (u) => String(u.email || '').toLowerCase();

// ---------- общий слой: автор/время, история, мягкое удаление ----------
export function createRepo(backend, user) {
  const by = { uid: user.uid, name: user.displayName || user.email || '' };
  const cache = new Map(); // `${pid}/${coll}/${key}` -> последняя известная версия (для «было»)
  const keyOf = (pid, coll, id) => `${pid}/${coll}/${docKey(id)}`;

  function audit(pid, coll, id, data, existing, action) {
    const now = Date.now();
    const stamped = { ...data, id, updatedBy: by.uid, updatedByName: by.name, updatedAt: now };
    if (!existing) Object.assign(stamped, { createdBy: by.uid, createdByName: by.name, createdAt: now });
    const history = {
      id: newId(), coll, docId: id, action, at: now, by: by.uid, byName: by.name,
      before: existing ? clean(existing) : null, after: clean({ ...existing, ...stamped }),
    };
    return [{ coll, id, data: clean(stamped) }, { coll: 'history', id: history.id, data: history }];
  }

  const api = {
    backend, user, by,
    listenProjects: (cb) => backend.listenProjects(user.uid, cb),
    listenColl(pid, name, cb) {
      return backend.listenColl(pid, name, (docs) => {
        docs.forEach((d) => cache.set(keyOf(pid, name, d.id), d));
        cb(docs);
      });
    },
    // Одна или несколько записей за раз (ops: [{coll, id?, data, action?}]); возвращает id созданных/изменённых
    save(pid, ops) {
      const writes = []; const ids = [];
      ops.forEach((op) => {
        const id = op.id || newId();
        const existing = cache.get(keyOf(pid, op.coll, id));
        const action = op.action || (existing ? 'update' : 'create');
        writes.push(...audit(pid, op.coll, id, { ...op.data, projectId: pid }, existing, action));
        cache.set(keyOf(pid, op.coll, id), { ...existing, ...op.data, id });
        ids.push(id);
      });
      info(`Запись в базу: ${ops.map((o) => `${o.coll}${o.data?.deleted ? '(удал.)' : ''}`).join(', ')}`);
      backend.commit(pid, writes)?.catch?.((e) => error('Запись отклонена', `${e.code || ''} ${e.message || e}`));
      return ids;
    },
    // Мягкое удаление: запись остаётся, помечается deleted (откат — restore)
    remove(pid, coll, id) {
      const now = Date.now();
      return api.save(pid, [{ coll, id, action: 'delete', data: { deleted: true, deletedAt: now, deletedBy: by.uid, deletedByName: by.name } }]);
    },
    restore(pid, coll, id) {
      return api.save(pid, [{ coll, id, action: 'restore', data: { deleted: false, deletedAt: null, deletedBy: null, deletedByName: null } }]);
    },
    // Новый проект: документ проекта + начальные справочники внутри него (все участники видят одно и то же)
    createProject(data) {
      const pid = newId();
      const now = Date.now();
      const project = clean({
        ...data, id: pid, active: true, memberUids: [user.uid], memberEmails: [user.email || ''],
        createdBy: by.uid, createdByName: by.name, createdAt: now, updatedBy: by.uid, updatedByName: by.name, updatedAt: now,
      });
      const seed = [];
      const add = (coll, items, idOf = (x) => x.id) => items.forEach((x) => seed.push({ coll, id: idOf(x), data: { ...x, projectId: pid, id: idOf(x), createdBy: by.uid, createdAt: now, updatedBy: by.uid, updatedAt: now } }));
      add('catalog', CATALOG); add('types', POINT_TYPES); add('cables', CABLES); add('configs', CONFIGS);
      add('units', UNITS); add('culprits', CULPRITS); add('delayReasons', DELAY_REASONS);
      info(`Создаю проект «${data.name}», справочников: ${seed.length}`);
      backend.commit(pid, [{ coll: 'projects', id: pid, data: project }, ...seed.map((w) => ({ ...w, data: clean(w.data) }))])
        ?.catch?.((e) => error('Создание проекта отклонено', `${e.code || ''} ${e.message || e}`));
      return pid;
    },
    saveProject(pid, patch) {
      const now = Date.now();
      const data = clean({ ...patch, id: pid, updatedBy: by.uid, updatedByName: by.name, updatedAt: now });
      backend.commit(pid, [{ coll: 'projects', id: pid, data }])?.catch?.((e) => error('Запись проекта отклонена', `${e.code || ''} ${e.message || e}`));
    },
    // Приглашения по почте Google: приглашённый видит проект и сам вступает (правила базы это проверяют)
    listenInvitations: (cb) => backend.listenInvitations(emailOf(user), user.uid, cb),
    invite(project, email) {
      const e = String(email).trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error('Некорректная почта');
      const list = [...new Set([...(project.invitedEmails || []), e])];
      api.saveProject(project.id, { invitedEmails: list });
    },
    cancelInvite(project, email) {
      api.saveProject(project.id, { invitedEmails: (project.invitedEmails || []).filter((x) => x !== email) });
    },
    acceptInvite(project) {
      const me = emailOf(user);
      api.saveProject(project.id, {
        memberUids: [...new Set([...(project.memberUids || []), user.uid])],
        memberEmails: [...new Set([...(project.memberEmails || []), me])],
        invitedEmails: (project.invitedEmails || []).filter((x) => x !== me),
      });
    },
    declineInvite(project) {
      api.saveProject(project.id, { invitedEmails: (project.invitedEmails || []).filter((x) => x !== emailOf(user)) });
    },
    loadSettings: () => backend.loadSettings(),
    saveSettings: (p) => backend.saveSettings(p),
  };
  return api;
}
