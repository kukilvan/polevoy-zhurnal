// Выгрузка проекта в .xlsx и сохранение на телефон (на iPhone — через меню «Поделиться» → «Сохранить в Файлы»).
import { state, currentProject } from './store.js';
import { exportSheets, exportFileName } from '../domain/index.js';
import { memberNameByUid } from './views/members.js';
import { toast } from './ui.js';

let busy = false;
export async function exportExcel() {
  const p = currentProject(); if (!p || !state.ctx || busy) return;
  busy = true;
  try {
    toast('Готовлю таблицу…');
    const sheets = exportSheets(p, state.ctx, { nameOf: (u) => memberNameByUid(p, u) });
    const { default: writeExcelFile } = await import('write-excel-file/browser');
    const head = (v) => ({ value: v, fontWeight: 'bold', backgroundColor: '#E5E7EB' });
    const data = sheets.map((sh) => ({
      sheet: sh.name, stickyRowsCount: 1,
      columns: sh.widths.map((width) => ({ width })),
      data: sh.rows.map((row, i) => row.map((v) => {
        if (i === 0) return head(v);
        if (v === '' || v === undefined || v === null) return null;
        return typeof v === 'number' ? { value: v, type: Number } : { value: String(v), type: String };
      })),
    }));
    const blob = await writeExcelFile(data).toBlob();
    const name = exportFileName(p);
    window.__lastExport = { name, size: blob.size, sheets: sheets.map((x) => [x.name, x.rows.length - 1]) };
    const file = new File([blob], name, { type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (!new URLSearchParams(location.search).get('mem') && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); toast('Готово'); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('Файл сохранён (папка «Загрузки»)');
  } catch (e) { toast(`Не получилось: ${e.message || e}`); console.error('excel', e); } finally { busy = false; }
}
