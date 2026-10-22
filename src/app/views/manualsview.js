// Карточка «Инструкции» в руководстве: список по разделам, добавление (название, раздел, файл), просмотр фото и PDF в приложении.
import { h, openModal, formModal, confirmDialog, toast } from '../ui.js';
import { getRepo } from '../store.js';
import { startManuals, onManuals, myManuals, addManual, pushManual, loadManual, updateManual, removeManual, canEditManual } from '../manuals.js';
import { groupManuals, manualKind, manualIcon, sectionsIn } from '../../domain/index.js';

const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
const ACCEPT = 'image/*,.pdf,.xls,.xlsx,.csv,.doc,.docx,.txt';

async function openViewer(m) {
  const body = h('div', { class: 'mut' }, 'Загружаю…');
  let zoom = 1; const imgs = []; const blobs = [];
  const apply = () => imgs.forEach((i) => { i.style.width = `${zoom * 100}%`; });
  const bar = h('div', { class: 'btns', style: { position: 'sticky', top: 0, background: 'var(--bg, #fff)', zIndex: 2 } },
    h('button', { class: 'sec', onclick: () => { zoom = Math.max(0.5, zoom - 0.5); apply(); } }, '➖'),
    h('button', { class: 'sec', onclick: () => { zoom = Math.min(5, zoom + 0.5); apply(); } }, '➕'));
  const close = openModal(`${manualIcon(m)} ${m.title}`, h('div', {}, bar, h('div', { style: { overflow: 'auto', maxHeight: '70vh' } }, body)), { wide: true, onClose: () => { blobs.forEach((u) => URL.revokeObjectURL(u)); wk?.stop(); } });
  let wk = null;
  try {
    const buf = await loadManual(m); const kind = manualKind(m);
    const blobOf = (data, type) => { const u = URL.createObjectURL(new Blob([data], { type })); blobs.push(u); return u; };
    if (kind === 'image') {
      const im = h('img', { src: blobOf(buf, m.mime || 'image/jpeg'), style: { width: '100%', display: 'block' } }); imgs.push(im); body.replaceChildren(im);
    } else if (kind === 'pdf') {
      const { makeWorker } = await import('./tohnitview.js'); wk = makeWorker();
      const { pages } = await wk.call('openDoc', { data: buf.slice(0) }); body.replaceChildren();
      for (let i = 0; i < pages.length; i++) {
        const { w, h: hh } = pages[i];
        const png = await wk.call('crop', { page: i, clip: [0, 0, w, hh], zoom: Math.min(4, Math.max(1, 1600 / w)) });
        const im = h('img', { src: blobOf(png, 'image/png'), style: { width: `${zoom * 100}%`, display: 'block', marginBottom: '6px', background: '#fff' } }); imgs.push(im); body.appendChild(im);
      }
    } else {
      body.replaceChildren(h('div', { class: 'mut' }, `Файл ${m.fileName} (${mb(m.size || buf.byteLength)}) показать здесь нельзя — откройте его в другом приложении.`));
    }
    const file = new File([buf], m.fileName || 'file', { type: m.mime || 'application/octet-stream' });
    bar.appendChild(h('button', { class: 'sec', onclick: async () => {
      try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: m.title }); return; } } catch (e) { if (e.name === 'AbortError') return; }
      const a = h('a', { href: URL.createObjectURL(file), download: file.name }); document.body.appendChild(a); a.click(); a.remove();
    } }, kind === 'other' ? '📤 Открыть в приложении…' : '📤 Поделиться'));
  } catch (e) { body.replaceChildren(h('div', { class: 'err' }, e.message)); }
  return close;
}

function manualForm(m, onDone) {
  const all = myManuals();
  let picked = null;
  const input = h('input', { type: 'file', accept: ACCEPT, style: { display: 'none' } });
  const fileLabel = h('div', { class: 'mut' }, m ? `Файл: ${m.fileName}` : 'Файл не выбран');
  input.onchange = () => { picked = input.files?.[0] || null; fileLabel.textContent = picked ? `${picked.name} · ${mb(picked.size)}` : 'Файл не выбран'; };
  formModal({
    title: m ? 'Изменить инструкцию' : 'Новая инструкция',
    fields: [
      { key: 'title', label: 'Название', required: true, placeholder: 'Например: Электрозамок Fail Safe, схема' },
      { key: 'section', label: 'Раздел', type: 'select', options: sectionsIn(all).map((s) => ({ value: s, label: s })), emptyLabel: 'Другое' },
      ...(m ? [] : [{ key: 'file', label: 'Файл (фото, схема, PDF, таблица)', type: 'custom', required: true,
        build: () => ({ el: h('div', {}, h('div', { class: 'btns' }, h('button', { type: 'button', onclick: () => input.click() }, '📂 Выбрать файл или фото'), input), fileLabel), get: () => picked }) }]),
    ],
    values: m ? { title: m.title, section: m.section } : { section: 'Другое' },
    extra: m ? [{ label: 'Удалить инструкцию', kind: 'danger', onClick: async () => {
      if (!(await confirmDialog(`Удалить инструкцию «${m.title}» у всех? Файл на Диске останется.`, { yes: 'Удалить', danger: true }))) return false;
      removeManual(m); toast('Удалено'); onDone?.(); return true; } }] : [],
    onSubmit: async (v) => {
      if (m) { updateManual(m, { title: v.title, section: v.section || 'Другое' }); toast('Сохранено'); return; }
      if (!picked) { toast('Выберите файл'); return false; }
      toast('Сохраняю…');
      const e = await addManual({ title: v.title, section: v.section, file: picked });
      toast(e.fileId ? 'Добавлено и отправлено на Диск' : e.error ? `Сохранено на телефоне, на Диск не ушло: ${e.error}` : 'Сохранено на телефоне. Нажмите «⬆ На Диск», чтобы увидели все');
    },
  });
}

export function manualsCard() {
  startManuals();
  let q = '';
  const list = h('div', {});
  const me = () => String(getRepo()?.user?.email || '').toLowerCase();
  const fill = () => {
    const groups = groupManuals(myManuals(), q);
    list.replaceChildren(...(groups.length ? groups.flatMap((g) => [
      h('div', { class: 'group', style: { padding: '8px 0 2px' } }, g.section),
      h('div', { class: 'card', style: { padding: 0 } }, g.items.map((m) => h('div', { class: 'item', onclick: () => openViewer(m) },
        h('div', { class: 'name' }, `${manualIcon(m)} ${m.title}`, h('div', { class: 'sub' }, `${m.fileName || ''}${m.size ? ` · ${mb(m.size)}` : ''}${m.fileId ? '' : ' · ещё не на Диске'}`)),
        !m.fileId && String(m.addedBy || '').toLowerCase() === me() ? h('button', { class: 'sec', style: { flex: 'none' }, onclick: async (e) => { e.stopPropagation(); try { toast('Отправляю на Диск…'); await pushManual(m); toast('Отправлено'); } catch (err) { toast(`Не получилось: ${err.message}`); } } }, '⬆ На Диск') : null,
        canEditManual(m) ? h('button', { class: 'sec', style: { flex: 'none' }, title: 'Изменить', onclick: (e) => { e.stopPropagation(); manualForm(m); } }, '✏️') : null))),
    ]) : [h('div', { class: 'empty' }, q ? 'Ничего не найдено' : 'Пока нет инструкций. Добавьте первую — схему замка, фото подключения, PDF.')]));
  };
  fill();
  onManuals(() => { if (list.isConnected) fill(); });
  return h('div', { class: 'card guide-card', id: 'guide-manuals' },
    h('div', { class: 'guide-title' }, '🗂 Инструкции'),
    h('div', { class: 'guide-short' }, 'Схемы подключения, фото примеров, таблицы и PDF (замки, хивут, проверки…). Общие для всех проектов: добавленное вами видят все, у кого есть приложение. Открытое один раз потом работает без интернета.'),
    h('div', { class: 'btns' }, h('button', { onclick: () => manualForm(null) }, '➕ Добавить инструкцию')),
    h('input', { type: 'search', placeholder: 'Найти инструкцию', oninput: (e) => { q = e.target.value; fill(); }, style: { marginTop: '8px' } }),
    h('div', { style: { marginTop: '6px' } }, list));
}
