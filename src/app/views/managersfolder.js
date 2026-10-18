// «Для руководства» — папка проекта на Google Диске с общей ссылкой (любой, у кого есть ссылка, может смотреть):
// в ней выбранные таблицы для руководства и выбранные тохниты с номерами (отдельные копии со своими названиями, легенда на иврите).
// Обновляет кнопка «🔄 Обновить всё сейчас» и сервер каждую ночь (если что-то поменялось).
import { h, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { tablesOf, withTable } from '../../domain/index.js';
import { getToken, realApi, clearToken, storedTokenValid } from '../google.js';
import { syncTable } from '../managers.js';
import { syncRackTable, rackAuto, RACK_TITLE } from '../racktablecore.js';
import { memberNameByUid } from './members.js';
import { drawingsOf, drawingTitle, loadDrawing, putNumbered, shareWithServer, updateDrawing } from '../drawings.js';
import { build } from './plannumbers.js';

// Легенда на иврите для папки руководства
export const HE_LEGEND = true;  // переводы проверены Иваном 2026-10-17
const D = 'https://www.googleapis.com/drive/v3/files';
const mgr = (p) => p.managers || {};
const when = (iso) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
export const managerName = (d, m) => (m?.name || '').trim() || drawingTitle(d).replace(/\.pdf$/i, '');

function saveMgr(patch) { const p = currentProject(); getRepo().saveProject(p.id, { managers: { ...mgr(p), ...patch } }); }
function saveMgrDrawing(id, patch) { const p = currentProject(); const ds = { ...(mgr(p).drawings || {}) }; ds[id] = { ...(ds[id] || {}), ...patch }; saveMgr({ drawings: ds }); }

// Тихо открыть серверу (ночное обновление) доступ к файлам, выложенным раньше, чем сервер записал свой адрес в проект
// (например, проект создан мастером и папка для руководства сделана в тот же день). Только если разрешение Google уже есть.
const accessDone = new Set();
export async function ensureServerAccess(p = currentProject()) {
  if (!p?.serverEmail || !storedTokenValid()) return;
  const key = `${p.id}:${p.serverEmail}`; if (accessDone.has(key)) return;
  const ds = drawingsOf(p); const mds = { ...(mgr(p).drawings || {}) };
  const needNum = ds.filter((d) => d.numberedFileId && d.numberedServer !== p.serverEmail);
  const needMgr = ds.filter((d) => mds[d.id]?.fileId && mds[d.id].server !== p.serverEmail);
  accessDone.add(key); if (!needNum.length && !needMgr.length) return;
  let changed = false;
  for (const d of needNum) { try { await shareWithServer(d.numberedFileId, p.serverEmail, 'writer'); await shareWithServer(d.fileId, p.serverEmail, 'reader'); updateDrawing(d.id, { numberedServer: p.serverEmail }); } catch (e) { console.warn('server access', e); } }
  for (const d of needMgr) { try { await shareWithServer(mds[d.id].fileId, p.serverEmail, 'writer'); await shareWithServer(d.fileId, p.serverEmail, 'reader'); mds[d.id] = { ...mds[d.id], server: p.serverEmail }; changed = true; } catch (e) { console.warn('server access', e); } }
  if (changed) getRepo().saveProject(p.id, { managers: { ...mgr(currentProject()), drawings: mds } });
}

let busy = false;
export async function updateManagersFolder(retried = false) {
  const p = currentProject(); if (!p || busy) return; busy = true;
  try {
    toast('Обновляю папку для руководства…');
    const api = realApi(await getToken('mfolder'));
    // папка и общая ссылка
    const folder = await api.projectFolder(p, 'managers');
    const m = { ...mgr(p) };
    if (m.folderId !== folder || !m.shared) { await api.req('POST', `${D}/${folder}/permissions?fields=id`, { role: 'reader', type: 'anyone' }); m.shared = true; }
    m.folderId = folder; m.link = `https://drive.google.com/drive/folders/${folder}`;
    getRepo().saveProject(p.id, { managers: m });
    // таблицы
    let nt = 0;
    for (const t of tablesOf(p)) {
      if (!t.inFolder && !t.fileId) continue;
      if (!t.inFolder && (t.placedKind ?? '') !== 'managers') continue;
      try {
        const res = await syncTable(api, p, state.ctx, t, { uid: getRepo().user.uid, nameOf: (u) => memberNameByUid(p, u), shareWith: p.serverEmail || '' });
        getRepo().saveProject(p.id, { tables: withTable(currentProject(), t.id, { ...res.patch, serverError: '' }) }); if (t.inFolder) nt++;
      } catch (e) { toast(`Таблица «${t.name}»: ${e.message}`); }
    }
    // таблица шкафов и шильюта (план + шильют)
    let nr = 0;
    if (rackAuto(currentProject())) {
      try {
        const cur = currentProject(); const pf = getRepo().prefs || {};
        const rt = { ...cur.rackTable, prefs: { models: pf.panelModels || [], colors: pf.shilutColors || [] } };
        const r = await syncRackTable(api, { ...cur, rackTable: rt }, state.ctx, { uid: getRepo().user.uid, shareWith: cur.serverEmail || '' });
        getRepo().saveProject(p.id, { rackTable: { ...rt, ...r.patch, serverError: '' } }); nr = 1;
      } catch (e) { if (e.patch) getRepo().saveProject(p.id, { rackTable: { ...currentProject().rackTable, ...e.patch } }); toast(`«${RACK_TITLE}»: ${e.message}`); }
    }
    // тохниты
    let nd = 0; const ds = { ...(m.drawings || {}) };
    for (const d of drawingsOf(p)) {
      const md = ds[d.id]; if (!md?.on) continue;
      try {
        const name = managerName(d, md); const buf = await loadDrawing(d);
        const r = await build(d, buf, { title: name, lang: HE_LEGEND ? 'he' : 'ru', quiet: true }); if (!r) continue;
        const id = await putNumbered(`${name}.pdf`, r.out, p, md.fileId || '', 'managers');
        const patch = { fileId: id, hash: r.hash, at: new Date().toISOString(), error: '', lang: HE_LEGEND ? 'he' : 'ru' };
        if (p.serverEmail && md.server !== p.serverEmail) { try { await shareWithServer(id, p.serverEmail, 'writer'); await shareWithServer(d.fileId, p.serverEmail, 'reader'); patch.server = p.serverEmail; } catch (e) { console.warn('share', e); } }
        ds[d.id] = { ...md, ...patch }; nd++;
      } catch (e) { ds[d.id] = { ...md, error: String(e.message || e).slice(0, 200) }; toast(`«${drawingTitle(d)}»: ${e.message}`); }
    }
    saveMgr({ ...m, drawings: ds });
    toast(`Папка для руководства обновлена: таблиц ${nt}${nr ? ' + шкафы и шильют' : ''}, тохнитов ${nd}`);
  } catch (e) {
    if (e.status === 401 && retried !== true) { clearToken(); busy = false; return updateManagersFolder(true); }
    toast(`Не получилось: ${e.message || e}`); console.error('managers folder', e);
  } finally { busy = false; }
}

/** Блок на экране «Для руководства» */
export function managersFolderCard(ui) {
  const p = currentProject(); const m = mgr(p);
  const copy = async () => { try { await navigator.clipboard.writeText(m.link); toast('Ссылка скопирована'); } catch { prompt('Скопируйте ссылку', m.link); } };
  const rows = drawingsOf(p).map((d) => {
    const md = (m.drawings || {})[d.id] || {};
    const cb = h('input', { type: 'checkbox', checked: !!md.on, disabled: !d.fileId, onchange: () => saveMgrDrawing(d.id, { on: cb.checked }) });
    const name = h('input', { value: md.name || '', placeholder: drawingTitle(d).replace(/\.pdf$/i, ''), style: { flex: 1, minWidth: '160px' }, onchange: () => saveMgrDrawing(d.id, { name: name.value.trim() }) });
    return h('div', { style: { padding: '8px 0', borderTop: '1px solid var(--line)' } },
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, h('label', { class: 'pickrow', style: { margin: 0 } }, cb, h('span', {}, drawingTitle(d))), name),
      h('small', { class: md.error ? '' : 'mut', style: md.error ? { color: '#ff453a' } : {} },
        !d.fileId ? 'Сначала отправьте чертёж на Диск (в плане «⬆ На Диск»)' : md.error ? `Ошибка: ${md.error}` : md.at ? `В папке, обновлён ${when(md.at)}` : md.on ? 'Появится в папке после «🔄 Обновить всё сейчас»' : 'Не в папке'));
  });
  return h('div', {},
    h('div', { class: 'card' },
      h('div', { style: { fontWeight: 700, fontSize: '16px' } }, '📁 Папка для руководства'),
      h('div', { class: 'mut', style: { margin: '4px 0' } }, 'Одна ссылка на папку Google Диска: в ней отмеченные ниже таблицы и тохниты с номерами. Смотреть может любой, у кого есть ссылка. Каждую ночь сервер обновляет их, если что-то поменялось.'),
      m.link ? h('div', { style: { wordBreak: 'break-all', margin: '6px 0', fontSize: '13px' } }, m.link) : h('div', { class: 'mut' }, 'Папка появится после первого «🔄 Обновить всё сейчас».'),
      h('div', { class: 'btns' },
        h('button', { onclick: () => updateManagersFolder() }, '🔄 Обновить всё сейчас'),
        m.link ? h('button', { class: 'sec', onclick: copy }, '📋 Скопировать ссылку') : null,
        m.link ? h('button', { class: 'sec', onclick: () => window.open(m.link, '_blank') }, '🔗 Открыть') : null)),
    h('div', { class: 'card' },
      h('div', { style: { fontWeight: 700 } }, '🗺 Тохниты в папке'),
      h('div', { class: 'mut', style: { margin: '4px 0' } }, 'Отметьте, какие тохниты с номерами положить в папку, и задайте им название (можно на иврите). Это отдельные копии — ваши «Чертежи с номерами» не меняются.'),
      rows.length ? rows : h('div', { class: 'mut' }, 'В проекте пока нет чертежей')),
    p.rackTable?.fileId ? h('div', { class: 'card' }, h('div', { style: { fontWeight: 700 } }, `🗄 ${RACK_TITLE}`),
      h('div', { class: 'mut', style: { margin: '4px 0' } }, `Планы шкафов и шильют (создаётся в «Настройки → Шкафы и шильют»). ${p.rackTable.auto === false ? 'Автообновление выключено.' : 'Обновляется вместе с папкой и каждую ночь.'}${p.rackTable.at ? ` Обновлена ${when(p.rackTable.at)}.` : ''}`),
      p.rackTable.serverError ? h('div', { style: { color: '#ff453a', fontSize: '13px' } }, `Сервер: ${p.rackTable.serverError}`) : null,
      h('div', { class: 'btns' }, h('button', { class: 'sec', onclick: () => window.open(p.rackTable.link, '_blank') }, '🔗 Открыть'))) : null,
    h('div', { style: { fontWeight: 700, margin: '14px 2px 6px' } }, '📊 Таблицы'),
    void ui);
}
export const toggleTableInFolder = (t, on) => { const p = currentProject(); getRepo().saveProject(p.id, { tables: withTable(p, t.id, { inFolder: on }) }); };
