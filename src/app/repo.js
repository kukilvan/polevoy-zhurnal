// Репозиторий данных проекта. Две реализации хранилища с одним интерфейсом:
//  - Firestore (боевая, с офлайн-кэшем и очередью записи);
//  - память (для автотестов интерфейса, включается адресом ?mem=1).
// Общая логика здесь: кто и когда изменил, история изменений, мягкое удаление.
import {
  collection, doc, onSnapshot, setDoc, query, where, writeBatch, serverTimestamp, getDocs, getDocsFromCache, orderBy, limit as fbLimit, Timestamp,
} from 'firebase/firestore';
import { info, error } from '../log.js';
import { DELTA_MARGIN, decideMode, maxMillis } from '../domain/sync.js';
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

// Счётчик записей, отправленных в базу, но ещё не подтверждённых сервером (офлайн они ждут связи)
let ownPending = 0; const pendingSubs = new Set();
export const ownPendingCount = () => ownPending;
export const onPendingChange = (fn) => { pendingSubs.add(fn); return () => pendingSubs.delete(fn); };
const track = (promise, n) => {
  if (!promise?.then) return promise;
  ownPending += n; pendingSubs.forEach((f) => f());
  const done = () => { ownPending = Math.max(0, ownPending - n); pendingSubs.forEach((f) => f()); };
  promise.then(done, done);
  return promise;
};

const clean = (obj) => JSON.parse(JSON.stringify(obj, (k, v) => (v === undefined ? null : v)));
const strip = (obj) => { const c = clean(obj); delete c._pending; return c; };

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
    async loadHistory(pid, since, max) {
      return [...bucket(pid, 'history').values()].filter((x) => x.at >= since).sort((a, b) => b.at - a.at).slice(0, max);
    },
    listenInvitations(email, uid, cb) {
      const run = () => cb([...projects.values()].filter((p) => (p.invitedEmails || []).includes(email) && !(p.memberUids || []).includes(uid)).map((p) => ({ ...p })));
      listeners.add(run); run(); return () => listeners.delete(run);
    },
    listenColl(pid, name, cb) {
      const run = () => cb([...bucket(pid, name).values()].map((d) => ({ ...d })));
      listeners.add(run); run(); return () => listeners.delete(run);
    },
    listenUserPrefs(uid, cb) { const run = () => cb({ ...settings }); listeners.add(run); run(); return () => listeners.delete(run); },
    async saveUserPrefs(uid, patch) { settings = { ...settings, ...patch }; notify(); },
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

// ---------- экономия чтений Firestore ----------
// Firestore заново читает ВСЮ коллекцию, если слушатель был отключён дольше 30 минут (каждый такой запуск = тысячи чтений).
// Поэтому после первой полной загрузки читаем только изменившееся: документы, у которых updatedAtServer новее последней отметки.
// Остальное берём из кэша телефона. Раз в неделю и при подозрении, что кэш неполный, делаем полную загрузку.
const metaGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const metaSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* нет доступа к хранилищу */ } };
const srvMillis = (d) => { const v = d.get('updatedAtServer'); return v && typeof v.toMillis === 'function' ? v.toMillis() : 0; };
let serverReads = 0; // сколько документов прочитано с сервера за этот запуск (для проверки экономии)
export const readsCount = () => serverReads;

// ---------- хранилище: Firestore ----------
export function createFirestoreBackend(db, uid) {
  return {
    kind: 'firestore',
    listenProjects(_uid, cb) {
      const q = query(collection(db, 'projects'), where('memberUids', 'array-contains', uid));
      return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ ...d.data(), _pending: d.metadata.hasPendingWrites }))),
        (e) => error('Чтение проектов', `${e.code || ''} ${e.message || e}`));
    },
    async loadHistory(pid, since, max) {
      const q = query(collection(db, 'projects', pid, 'history'), where('at', '>=', since), orderBy('at', 'desc'), fbLimit(max));
      const snap = await getDocs(q); serverReads += snap.size;
      return snap.docs.map((d) => d.data());
    },
    listenInvitations(email, uid, cb) {
      const q = query(collection(db, 'projects'), where('invitedEmails', 'array-contains', email));
      return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data()).filter((p) => !(p.memberUids || []).includes(uid))),
        (e) => error('Чтение приглашений', `${e.code || ''} ${e.message || e}`));
    },
    listenColl(pid, name, cb) {
      // Если проект ещё не дошёл до сервера, чтение отклоняется — повторяем попытку
      const col = collection(db, 'projects', pid, name);
      const key = `pz.sync.${uid}.${pid}.${name}`;
      let unsub = () => {}; let stopped = false; let tries = 0; let timer = null;
      const shape = (d) => ({ ...d.data(), _pending: d.metadata.hasPendingWrites });
      const onErr = (restart) => (e) => {
        if (stopped) return;
        if (e.code === 'permission-denied' && tries < 15) { tries++; timer = setTimeout(() => { if (!stopped) restart(); }, 1500); return; }
        error(`Чтение ${name}`, `${e.code || ''} ${e.message || e}`);
      };
      // как раньше: слушаем всю коллекцию (первый запуск, раз в неделю, при неполном кэше)
      const startFull = () => {
        let stamped = false; // отметка времени полной загрузки ставится один раз за запуск
        unsub = onSnapshot(col, (snap) => {
          tries = 0;
          if (!snap.metadata.fromCache) {
            serverReads += snap.docChanges().length;
            const prev = metaGet(key) || {};
            const last = maxMillis([prev.last, ...snap.docs.map(srvMillis)]);
            if (last > 0 && !snap.metadata.hasPendingWrites) { metaSet(key, { last, full: stamped ? prev.full : Date.now(), n: snap.size }); stamped = true; }
          }
          cb(snap.docs.map(shape));
        }, onErr(startFull));
      };
      // экономный режим: кэш телефона + только изменения с прошлой отметки
      const startDelta = (meta) => {
        const map = new Map();
        const q = query(col, where('updatedAtServer', '>', Timestamp.fromMillis(meta.last - DELTA_MARGIN)));
        unsub = onSnapshot(q, (snap) => {
          tries = 0;
          if (!snap.metadata.fromCache) serverReads += snap.docChanges().length;
          snap.docChanges().forEach((ch) => { if (ch.type === 'removed') map.delete(ch.doc.id); else map.set(ch.doc.id, shape(ch.doc)); });
          const prev = metaGet(key) || meta;
          if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) {
            metaSet(key, { ...prev, last: maxMillis([prev.last, ...snap.docs.map(srvMillis)]), n: Math.max(prev.n || 0, map.size) });
          }
          cb([...map.values()]);
        }, onErr(() => startDelta(meta)));
        return map;
      };
      const start = async () => {
        const meta = metaGet(key);
        if (!meta) { startFull(); return; }
        try {
          const cached = await getDocsFromCache(col);
          if (stopped) return;
          if (decideMode(meta, cached.size) !== 'delta') { startFull(); return; }
          // сначала сразу показываем всё, что есть в кэше, затем подключаем слушатель изменений
          const map = startDelta(meta);
          cached.docs.forEach((d) => map.set(d.id, shape(d)));
          cb([...map.values()]);
        } catch { if (!stopped) startFull(); }
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
    // Личные настройки пользователя (например, привязки установки по умолчанию для новых проектов)
    listenUserPrefs(_uid, cb) {
      return onSnapshot(doc(db, 'users', uid, 'prefs', 'main'), (snap) => cb(snap.data() || {}),
        (e) => error('Чтение настроек пользователя', `${e.code || ''} ${e.message || e}`));
    },
    saveUserPrefs(_uid, patch) { return setDoc(doc(db, 'users', uid, 'prefs', 'main'), patch, { merge: true }); },
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
      before: existing ? strip(existing) : null, after: strip({ ...existing, ...stamped }),
    };
    return [{ coll, id, data: clean(stamped) }, { coll: 'history', id: history.id, data: history }];
  }

  const api = {
    backend, user, by,
    listenProjects: (cb) => backend.listenProjects(user.uid, cb),
    listenUserPrefs: (cb) => backend.listenUserPrefs(user.uid, (p) => { api.prefs = p || {}; cb(api.prefs); }),
    saveUserPrefs: (patch) => backend.saveUserPrefs(user.uid, patch),
    prefs: {},
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
      track(backend.commit(pid, writes), ops.length)?.catch?.((e) => error('Запись отклонена', `${e.code || ''} ${e.message || e}`));
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
      const inst = api.prefs?.installDefaults || {}; // личные привязки установки по умолчанию
      const types = POINT_TYPES.map((t) => (inst[t.id] ? { ...t, installMode: inst[t.id].mode, installWorkIds: inst[t.id].workIds || [] } : t));
      add('catalog', CATALOG); add('types', types); add('cables', CABLES); add('configs', CONFIGS);
      add('units', UNITS); add('culprits', CULPRITS); add('delayReasons', DELAY_REASONS);
      info(`Создаю проект «${data.name}», справочников: ${seed.length}`);
      backend.commit(pid, [{ coll: 'projects', id: pid, data: project }, ...seed.map((w) => ({ ...w, data: clean(w.data) }))])
        ?.catch?.((e) => error('Создание проекта отклонено', `${e.code || ''} ${e.message || e}`));
      return pid;
    },
    saveProject(pid, patch) {
      const now = Date.now();
      const data = clean({ ...patch, id: pid, updatedBy: by.uid, updatedByName: by.name, updatedAt: now });
      track(backend.commit(pid, [{ coll: 'projects', id: pid, data }]), 1)?.catch?.((e) => error('Запись проекта отклонена', `${e.code || ''} ${e.message || e}`));
    },
    // История изменений и откат. Откат сам записывается в историю, поэтому его тоже можно отменить.
    loadHistory: (pid, since, max = 2000) => backend.loadHistory(pid, since, max),
    // Вернуть запись к состоянию «до» указанного события (before === null → запись была создана этим событием → убрать)
    revertTo(pid, coll, docId, before) {
      if (!before) { api.remove(pid, coll, docId); return; }
      const now = api.cacheGet(pid, coll, docId) || {};
      const data = { ...before };
      Object.keys(now).forEach((k) => { if (!(k in before) && !['id', 'projectId', 'updatedAt', 'updatedBy', 'updatedByName'].includes(k)) data[k] = null; });
      delete data._pending;
      api.save(pid, [{ coll, id: docId, action: 'rollback', data }]);
    },
    cacheGet: (pid, coll, id) => cache.get(keyOf(pid, coll, id)),
    // Приглашения по почте Google: приглашённый видит проект и сам вступает (правила базы это проверяют)
    listenInvitations: (cb) => backend.listenInvitations(emailOf(user), user.uid, cb),
    invite(project, email) {
      const e = String(email).trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error('Некорректная почта');
      const list = [...new Set([...(project.invitedEmails || []), e])];
      api.saveProject(project.id, { invitedEmails: list });
    },
    // Подпись участника (видна всем в проекте). Ключ — почта без точек, т.к. точка в ключе Firestore неудобна
    renameMember(project, email, name) {
      api.saveProject(project.id, { memberNames: { [String(email).toLowerCase().replace(/\./g, '_')]: String(name || '').trim() } });
    },
    // Убрать участника: он теряет доступ; его прежние правки остаются, а uid запоминается для отката в «Истории»
    removeMember(project, email) {
      const e = String(email).toLowerCase();
      const emails = project.memberEmails || []; const uids = project.memberUids || [];
      const i = emails.findIndex((x) => String(x).toLowerCase() === e);
      if (i < 0 || emails.length !== uids.length) throw new Error('Не удалось определить участника');
      if (uids[i] === user.uid) throw new Error('Себя убрать нельзя');
      const uid = uids[i];
      api.saveProject(project.id, {
        memberUids: uids.filter((_, k) => k !== i), memberEmails: emails.filter((_, k) => k !== i),
        removedMembers: { ...(project.removedMembers || {}), [uid]: e },
      });
      return uid;
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
