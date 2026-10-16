#!/usr/bin/env python3
"""Разбор тохнита (PDF-чертежа) в файл точек для «Полевого журнала» (формат polevoy-points-1).

Идея: обозначения точек на CAD-чертежах — это текст. Код вытаскивает ВЕСЬ текст с цветом, шрифтом, размером и
координатами и группирует его по стилю. ИИ (или человек) только решает, какие группы — точки и какого типа (map.json).
Так точки не теряются (учтён каждый фрагмент текста), а мусор (высоты H=1.20, номера помещений, размеры) отсекается
целыми группами.

Шаги:
  python3 tohnit.py scan  PLAN.pdf  WORK/            → WORK/scan.json, WORK/clusters.md, WORK/overview.png, WORK/c/<группа>.png
  python3 tohnit.py build WORK/ MAP.json OUT.json     → OUT.json (точки), WORK/report.md, WORK/check*.png (проверочная разметка)
  python3 tohnit.py merge ALL.json A.json B.json …    → один файл точек из нескольких (по этажам)
  python3 tohnit.py tiles PLAN.pdf WORK/ [3]          → крупные части чертежа (если текста в PDF нет — скан/фото)
  python3 tohnit.py crop  PLAN.pdf x0 y0 x1 y1 OUT.png [стр] → вырезать место крупно (координаты как в scan.json)
  python3 tohnit.py symbols WORK/ ИМЯ x0 y0 x1 y1 [стр]  → найти все векторные значки как в образце (значки без текста, любой поворот)
  python3 tohnit.py find WORK/ 'regex'                → где встречается текст (с координатами); list WORK/ c05 — вся группа
  python3 tohnit.py layers WORK/                      → слои чертежа (AutoCAD), сколько в каждом линий и какого цвета
  python3 tohnit.py hide WORK/ 'regex' …              → скрыть слои (рамки колонн, штриховки…) на всех картинках; без regex — показать все
  python3 tohnit.py version                           → дата версии скрипта (свежее — новее)
  python3 tohnit.py blobs WORK/                       → сам найти все цветные значки без подписей и разложить по видам (b/…png)

Нужен PyMuPDF (pip install pymupdf) или pdfplumber (обычно уже установлен) + Pillow.
"""
import json, os, re, sys, math, collections

VERSION = '2026-10-16'  # дата версии: python3 tohnit.py version

# ---------------------------------------------------------------- извлечение текста
def _color_hex(c):
    if c is None: return '000000'
    if isinstance(c, int): return '%06x' % c
    if isinstance(c, (list, tuple)):
        if len(c) == 1: c = (c[0], c[0], c[0])
        if len(c) == 4:  # CMYK → RGB
            C, M, Y, K = c; c = ((1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K))
        return ''.join('%02x' % max(0, min(255, round(float(v) * 255))) for v in c[:3])
    return '000000'

def _fitz():
    if os.environ.get('TOHNIT_BACKEND') == 'pdfplumber': return None
    try:
        import pymupdf as fitz
        return fitz
    except ImportError:
        try:
            import fitz
            return fitz
        except ImportError: return None

def extract(path):
    """→ pages: [{w, h, spans: [{t, x0, y0, x1, y1, color, font, size}], fills}]"""
    fitz = _fitz()
    pages = []
    if fitz:
        doc = fitz.open(path)
        for p in doc:
            spans = []; rm = p.rotation_matrix  # координаты текста — без учёта поворота страницы; переводим в повёрнутые
            for b in p.get_text('dict')['blocks']:
                for l in b.get('lines', []):
                    for s in l['spans']:
                        t = s['text'].strip()
                        if t:
                            r = fitz.Rect(s['bbox']) * rm; x0, y0, x1, y1 = r.x0, r.y0, r.x1, r.y1
                            spans.append(dict(t=t, x0=x0, y0=y0, x1=x1, y1=y1, color=_color_hex(s['color']), font=s['font'], size=round(s['size'], 1)))
            fills = []  # небольшие залитые фигуры (фон значков): (x0, y0, x1, y1, цвет)
            for dr in p.get_drawings():
                f = dr.get('fill')
                if f is None: continue
                r = dr['rect'] * rm
                if 0 < r.width < 40 and 0 < r.height < 40: fills.append((r.x0, r.y0, r.x1, r.y1, _color_hex(f)))
            annots = []  # пометки поверх чертежа (от руки, зачёркивания, штампы)
            for a in (p.annots() or []):
                r = a.rect * rm; kind = a.type[1]; txt = (a.info.get('content') or '').strip()
                if txt and kind in ('Square', 'FreeText', 'Circle', 'Polygon'):
                    # AutoCAD часто кладёт текст (SHX-шрифты, подписи в рамках) в аннотации — это обычный текст чертежа
                    col = (a.colors or {}).get('stroke') or (a.colors or {}).get('fill')
                    spans.append(dict(t=txt.splitlines()[0][:60], x0=r.x0, y0=r.y0, x1=r.x1, y1=r.y1, color=_color_hex(col), font=f'аннотация {kind}', size=2 * round(min(r.width, r.height) / 2)))
                    continue
                if kind in ('Ink', 'StrikeOut', 'Line', 'PolyLine', 'Polygon', 'Caret', 'Stamp', 'Highlight', 'Underline', 'Squiggly', 'Square', 'Circle'):
                    annots.append(dict(kind=kind, x0=r.x0, y0=r.y0, x1=r.x1, y1=r.y1, text=txt[:80]))
            pages.append(dict(w=p.rect.width, h=p.rect.height, spans=spans, fills=fills, annots=annots))
        return pages, 'pymupdf'
    import pdfplumber
    with pdfplumber.open(path) as pdf:
        for p in pdf.pages:
            words = p.extract_words(keep_blank_chars=False, use_text_flow=False, extra_attrs=['fontname', 'size', 'non_stroking_color'])
            rot = int(p.rotation or 0) % 360; W, H = float(p.width), float(p.height)  # p.width/height — без поворота
            def tr(x, y):
                if rot == 90: return H - y, x
                if rot == 180: return W - x, H - y
                if rot == 270: return y, W - x
                return x, y
            spans = []
            for w in words:
                if not w['text'].strip(): continue
                ax, ay = tr(w['x0'], w['top']); bx, by = tr(w['x1'], w['bottom'])
                spans.append(dict(t=w['text'], x0=min(ax, bx), y0=min(ay, by), x1=max(ax, bx), y1=max(ay, by), color=_color_hex(w.get('non_stroking_color')),
                                  font=w.get('fontname', ''), size=round(w.get('size', 0), 1)))
            fills = []
            for r in p.rects:
                if not r.get('fill'): continue
                ax, ay = tr(r['x0'], r['top']); bx, by = tr(r['x1'], r['bottom'])
                x0, y0, x1, y1 = min(ax, bx), min(ay, by), max(ax, bx), max(ay, by)
                if 0 < x1 - x0 < 40 and 0 < y1 - y0 < 40: fills.append((x0, y0, x1, y1, _color_hex(r.get('non_stroking_color'))))
            pages.append(dict(w=H if rot in (90, 270) else W, h=W if rot in (90, 270) else H, spans=spans, fills=fills))
    return pages, 'pdfplumber'

def _join_stacked(spans, key):
    """Подпись в две строки: «GD1/» над «D-15.2» → «GD1/D-15.2» (строка, кончающаяся на «/», — приставка к строке под ней)."""
    pre = [s for s in spans if s['t'].strip().endswith('/') and len(s['t'].strip()) <= 6 and not s['font'].startswith('аннотация')]
    if not pre: return spans
    used = set(); out = []
    for p in pre:
        cx = (p['x0'] + p['x1']) / 2; h = max(p['size'], p['y1'] - p['y0'])
        cand = [s for s in spans if s is not p and id(s) not in used and key(s) == key(p) and not s['t'].strip().endswith('/')
                and -0.3 * h <= s['y0'] - p['y1'] <= 0.9 * h and s['x0'] - h <= cx <= s['x1'] + h]
        if not cand: continue
        b = min(cand, key=lambda s: (s['y0'] - p['y1']) + abs((s['x0'] + s['x1']) / 2 - cx) * 0.2)
        used.add(id(p)); used.add(id(b))
        out.append(dict(b, t=p['t'].strip() + b['t'].strip(), x0=min(p['x0'], b['x0']), x1=max(p['x1'], b['x1']), y0=p['y0'], y1=b['y1']))
    return [s for s in spans if id(s) not in used] + out

def merge_spans(spans):
    """Соседние фрагменты одной строки и одного стиля («TV» «140», «ACP» «PUP-A1») склеиваются в один (через пробел)."""
    key = lambda s: (s['color'], s['font'], s['size'])
    spans = _join_stacked(spans, key)
    spans = sorted(spans, key=lambda s: (key(s), round((s['y0'] + s['y1']) / 2, 0), s['x0']))
    out = []
    for s in spans:
        if s['font'].startswith('аннотация'):  # подпись-аннотация — всегда целый текст, с соседями не склеиваем («C» «C», «H=90» «A»)
            out.append(dict(s)); continue
        if out and not out[-1]['font'].startswith('аннотация'):
            o = out[-1]
            same = key(o) == key(s) and abs((o['y0'] + o['y1']) / 2 - (s['y0'] + s['y1']) / 2) < s['size'] * 0.3
            gap = s['x0'] - o['x1']
            both = LABELISH.match(o['t'].split(' ')[-1]) and LABELISH.match(s['t'])  # две целые подписи («D-15.2» «D-14.2») не склеиваем
            if same and not both and -0.1 * s['size'] <= gap <= 0.6 * s['size']:
                o['t'] = o['t'] + ' ' + s['t']; o['x1'] = max(o['x1'], s['x1']); o['y0'] = min(o['y0'], s['y0']); o['y1'] = max(o['y1'], s['y1'])
                continue
        out.append(dict(s))
    return out

# ---------------------------------------------------------------- форма текста и группы
def shape(t):
    """1A-C154 → 9A-A999 (буквы→A, цифры→9, иврит→א)"""
    r = re.sub(r'[0-9]', '9', t)
    r = re.sub(r'[A-Za-z]', 'A', r)
    r = re.sub(r'[\u0590-\u05FF]', 'א', r)
    r = re.sub(r'[А-Яа-яЁё]', 'Б', r)
    return re.sub(r'(9)9+', r'\g<1>9', re.sub(r'(A)A+', r'\g<1>A', r))  # схлопываем повторы

LABELISH = re.compile(r'^(?=.*\d)(?=.*[A-Za-z\-/])[A-Za-z0-9][A-Za-z0-9\-./_,()]{0,22}$')
HEB = re.compile(r'[\u0590-\u05FF]')
def heb(t):
    """Иврит в CAD-PDF часто хранится задом наперёд: показываем и прямой, и обратный порядок."""
    return f'{t} (наоборот: {t[::-1]})' if HEB.search(t) else t

def labelish(t):
    """Похоже на обозначение точки: цифры + (латиница, «-» или «/»), без пробелов, коротко; не высота/размер/дата."""
    t = t.strip()
    if not LABELISH.match(t): return False
    if re.match(r'^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$', t) or re.match(r'^[+-]?\d+(\.\d+)?[+-]?$', t): return False
    if re.match(r'^H\s*=?\s*\d', t, re.I) or re.match(r'^\d+(\.\d+)?(m|cm|mm|м)$', t, re.I): return False
    return True

def scan(pdf, work):
    os.makedirs(os.path.join(work, 'c'), exist_ok=True)
    pages, backend = extract(pdf)
    allspans = []
    for pg in pages:  # подпись-аннотация, повторяющая текст страницы на том же месте, — дубль: убираем
        page_txt = [x for x in pg['spans'] if not x['font'].startswith('аннотация')]
        def dup(a):  # тот же текст на том же месте и того же размера (рядом стоящая такая же буква другого значка — не дубль)
            k = a['t'].replace(' ', ''); ac = ((a['x0'] + a['x1']) / 2, (a['y0'] + a['y1']) / 2); ah = max(1.0, min(a['x1'] - a['x0'], a['y1'] - a['y0']))
            for x in page_txt:
                if x['t'].replace(' ', '') != k: continue
                xc = ((x['x0'] + x['x1']) / 2, (x['y0'] + x['y1']) / 2); xh = max(1.0, min(x['x1'] - x['x0'], x['y1'] - x['y0']))
                if abs(ac[0] - xc[0]) <= max(2.0, 0.4 * ah) and abs(ac[1] - xc[1]) <= max(2.0, 0.4 * ah) and 0.5 <= ah / xh <= 2.0: return True
            return False
        pg['spans'] = page_txt + [a for a in pg['spans'] if a['font'].startswith('аннотация') and not dup(a)]
    for pi, pg in enumerate(pages):
        grid = collections.defaultdict(list)  # сетка 50pt для быстрого поиска фона
        for f in pg.get('fills', []):
            for gx in range(int(f[0] // 50), int(f[2] // 50) + 1):
                for gy in range(int(f[1] // 50), int(f[3] // 50) + 1): grid[(gx, gy)].append(f)
        for s in merge_spans(pg['spans']):
            s['page'] = pi
            if len(s['t']) <= 6:  # короткий текст внутри значка: цвет заливки под ним (отличает значки с одинаковыми цифрами)
                cx, cy = (s['x0'] + s['x1']) / 2, (s['y0'] + s['y1']) / 2
                inside = [f for f in grid.get((int(cx // 50), int(cy // 50)), []) if f[0] <= cx <= f[2] and f[1] <= cy <= f[3]]
                if inside: s['bg'] = min(inside, key=lambda f: (f[2] - f[0]) * (f[3] - f[1]))[4]
            allspans.append(s)
    groups = collections.defaultdict(list)
    for s in allspans: groups[(s['color'], s['font'], s['size'], s.get('bg', ''))].append(s)
    clusters = []
    for i, (k, lst) in enumerate(sorted(groups.items(), key=lambda kv: -len(kv[1]))):
        cid = 'c%02d' % (i + 1)
        shapes = collections.Counter(shape(s['t']) for s in lst)
        lab = sum(1 for s in lst if labelish(s['t']))
        for s in lst: s['c'] = cid
        clusters.append(dict(id=cid, color=k[0], font=k[1], size=k[2], bg=k[3], n=len(lst), labelish=lab,
                             shapes=shapes.most_common(6), samples=list(dict.fromkeys(s['t'] for s in lst))[:14],
                             short=sum(1 for s in lst if len(s['t']) <= 8)))
    meta = dict(pdf=os.path.abspath(pdf), backend=backend, pages=[dict(w=p['w'], h=p['h']) for p in pages],
                annots=[dict(a, page=pi) for pi, p in enumerate(pages) for a in p.get('annots', [])])
    json.dump(dict(meta=meta, clusters=clusters, spans=allspans), open(os.path.join(work, 'scan.json'), 'w'), ensure_ascii=False)
    # отчёт по группам: сначала те, где много «похожего на обозначения»
    lines = [f'# Группы текста: {os.path.basename(pdf)}', '', f'Страниц: {len(pages)}, фрагментов текста: {len(allspans)}, движок: {backend}', '',
             'Колонки: группа · цвет текста (и фона значка) · шрифт · размер · всего · похожих на обозначение · формы текста · примеры', '']
    for c in sorted(clusters, key=lambda c: (-c['labelish'], -c['n'])):
        sh = ', '.join(f'{a}×{b}' for a, b in c['shapes'])
        lines.append(f"- **{c['id']}** · #{c['color']}{' на фоне #' + c['bg'] if c['bg'] else ''} · {c['font']} · {c['size']} · {c['n']} · обозн.: {c['labelish']} · {sh}\n  примеры: {' | '.join(heb(x) for x in c['samples'])}")
    leg = [s['t'] for s in allspans if re.search(r'quantit|כמות|qty|outlets|מקרא|legend', s['t'] + s['t'][::-1], re.I)]
    if leg: lines += ['', '## Возможная легенда / количества (легенду в любом случае найди глазами на overview.png)', ''] + [f'- {heb(t)}' for t in leg[:40]]
    an = meta['annots']
    if an:
        kinds = collections.Counter(a['kind'] for a in an)
        lines += ['', f"## ⚠️ Пометки поверх чертежа (аннотации PDF): {', '.join(f'{k}×{v}' for k, v in kinds.items())}",
                  'Это могут быть рукописные исправления, зачёркивания, облака изменений — посмотри их на overview.png; точки под ними build отметит в отчёте.']
    lay = layer_stats(pdf)
    if lay:
        strong, maybe = clutter_layers(lay)
        meta['suggest_hide'] = strong
        json.dump(dict(meta=meta, clusters=clusters, spans=allspans), open(os.path.join(work, 'scan.json'), 'w'), ensure_ascii=False)
        lines += ['', f'## Слои чертежа: {len(lay)} (полный список: python3 tohnit.py layers WORK/)']
        if strong: lines += ['**Мусор (предлагаю скрыть — серые/штриховки/рамки колонн/оси):** ' + ', '.join(strong),
                             'Скрыть: python3 tohnit.py hide WORK/ auto (можно добавить свои regex через пробел). Скрытые слои пропадут и из PDF с номерами.']
        if maybe: lines += ['Можно скрыть по желанию (мебель, сантехника, размеры, отметки): ' + ', '.join(maybe)]
        lines += ['Крупнейшие слои:'] + [f'- {n}: {c} шт., цвет {col}' for n, c, col in lay[:15]]
    lines += ['', f"overview.png: 1 пиксель = {meta['pages'][0]['w'] / 2400:.3f} pt PDF (для area: x_pt = x_px × это число). Вырезать место крупно: python3 tohnit.py crop PLAN.pdf x0 y0 x1 y1 out.png"]
    open(os.path.join(work, 'clusters.md'), 'w').write('\n'.join(lines))
    render_overview(pdf, work, clusters, allspans)
    print('\n'.join(lines[:60]))
    print(f'\nГотово: {work}/clusters.md, overview*.png, c/<группа>.png (примеры групп с окружением)')

# ---------------------------------------------------------------- картинки
_DL = {}
_HIDE = []  # regex слоёв, которые не рисовать (рамки колонн, штриховки, сетка осей…)
def _hidden(name): return any(re.search(h, name or '', re.I) for h in _HIDE)
def _open_hidden(fitz, pdf):
    doc = fitz.open(pdf)
    if _HIDE:
        try:
            for u in doc.layer_ui_configs():
                if _hidden(u['text']): doc.set_layer_ui_config(u['number'], 2)  # 2 = выключить
        except Exception: pass
    return doc
def _set_hide(meta, extra=()):
    global _HIDE
    _HIDE = list(meta.get('hide', [])) + list(extra); _DL.clear()
def _dl_clip(fitz, p, dl, zoom, clip):
    # список отрисовки страницы уже в повёрнутых координатах (как scan.json)
    return dl.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=fitz.Rect(*clip), alpha=False)

def render_page(pdf, page, zoom, clip=None):
    """Картинка страницы (или области clip = (x0, y0, x1, y1) в координатах с учётом поворота)."""
    fitz = _fitz()
    from PIL import Image
    if fitz:
        key = (pdf, page)
        if key not in _DL:  # список отрисовки страницы строится один раз — вырезки потом быстрые
            doc = _open_hidden(fitz, pdf); p = doc[page]; _DL[key] = (doc, p, p.get_displaylist())
        doc, p, dl = _DL[key]
        if clip:  # clip — в координатах повёрнутой страницы (как scan.json)
            pix = p.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False, clip=fitz.Rect(*clip)) if dl is None else _dl_clip(fitz, p, dl, zoom, clip)
        else:
            pix = p.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        return Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    if clip:
        img = render_page(pdf, page, min(zoom, 2.0)); k = min(zoom, 2.0)
        return img.crop(tuple(int(v * k) for v in clip))
    import pdfplumber
    with pdfplumber.open(pdf) as d:
        return d.pages[page].to_image(resolution=72 * zoom).original.convert('RGB')

# Цвета типов: постоянные для стандартных, остальным — по порядку из запаса (все тёмные и насыщенные — читаются на белой подложке)
TYPE_COLORS = {'Камера': '#E0007A', 'Дверь': '#0040FF', 'Точка': '#E65C00', 'Вайфай': '#00A040', 'Галай': '#008C9E',
               'Бакар': '#7B1FA2', 'TV': '#C2185B', 'Оптика': '#00695C', 'Интерком': '#5D4BFF', 'Коре биометри': '#AD1457',
               'Лахцан птиха': '#D32F2F', 'Тревожная кнопка': '#B71C1C', 'Магнит индикация': '#2E7D32', 'Рамколь': '#6A1B9A', 'Другое': '#455A64'}
PALETTE = ['#1565C0', '#D81B60', '#00897B', '#F4511E', '#5E35B1', '#43A047', '#C62828', '#0277BD', '#8E24AA', '#EF6C00',
           '#00838F', '#AD1457', '#283593', '#2E7D32', '#BF360C', '#6A1B9A', '#00796B', '#E91E63', '#3949AB', '#558B2F',
           '#D84315', '#4527A0', '#0097A7', '#C2185B', '#1E88E5', '#7CB342', '#FF3D00', '#512DA8', '#009688', '#F50057']
def natkey(l):
    """Естественный порядок: 1D2 < 1D10 < 2D1, 9 < 10."""
    return [(0, int(x), '') if x.isdigit() else (1, 0, x) for x in re.findall(r'\d+|\D+', l)]
def _hex2rgb(h): h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
def type_colors(types, override=None):
    """{тип: '#rrggbb'} — постоянные цвета стандартных типов + запас (30 шт.) для остальных; override из map.json (colors)."""
    out = {}; used = set(); override = override or {}
    for t in types:
        c = override.get(t) or TYPE_COLORS.get(t)
        if c: out[t] = c; used.add(c.upper())
    free = [c for c in PALETTE if c.upper() not in used]
    for t in types:
        if t not in out: out[t] = free.pop(0) if free else PALETTE[len(out) % len(PALETTE)]
    return out

def place_labels(items, fs, measure):
    """Подписи без наложений: items — [(ключ, текст, (x0,y0,x1,y1) значка)]; пробуем места вокруг значка (справа, слева,
    сверху, снизу, по диагоналям), потом дальше. → {ключ: (рамка подписи, нужна ли выноска)}."""
    placed = []; out = {}
    boxes = [b for _, _, b in items]
    def hit(r, lst): return sum(1 for q in lst if r[0] < q[2] and r[2] > q[0] and r[1] < q[3] and r[3] > q[1])
    for key, text, b in items:
        w = measure(text) + fs * 0.4; h = fs * 1.15; cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        best = None
        for ring in (0, 1, 2, 3, 4):
            g = 1.5 + ring * fs * 1.3
            cands = [(b[2] + g, cy - h / 2), (b[0] - g - w, cy - h / 2), (cx - w / 2, b[1] - g - h), (cx - w / 2, b[3] + g),
                     (b[2] + g, b[1] - g - h), (b[2] + g, b[3] + g), (b[0] - g - w, b[1] - g - h), (b[0] - g - w, b[3] + g)]
            for ci, (x, y) in enumerate(cands):
                r = (x, y, x + w, y + h)
                score = hit(r, placed) * 10 + hit(r, [q for q in boxes if q is not b])
                if best is None or score < best[0]: best = (score, r, ring * 10 + ci)
                if score == 0: break
            if best[0] == 0: break
        placed.append(best[1]); out[key] = (best[1], best[2] > 0)
    return out

def _font(px):
    from PIL import ImageFont
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', '/Library/Fonts/Arial Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf']:
        if os.path.exists(f): return ImageFont.truetype(f, px)
    return ImageFont.load_default()

def render_overview(pdf, work, clusters, spans):
    from PIL import Image, ImageDraw
    meta = json.load(open(os.path.join(work, 'scan.json')))['meta']
    for pi, pg in enumerate(meta['pages']):
        z = 2400 / pg['w']; img = render_page(pdf, pi, z)
        img.save(os.path.join(work, f'overview{"" if pi == 0 else pi + 1}.png'))
        # примеры групп: до 6 вырезок с окружением, крупно
        big = 3.0; bimg = None
        shown = 0
        for c in sorted(clusters, key=lambda c: (-c['labelish'], -c['short'])):
            if not c['labelish'] and not c['short']: continue
            shown += 1
            if shown > 60: break
            allc = [s for s in spans if s['c'] == c['id'] and s['page'] == pi]
            ex = [allc[int(i * len(allc) / 6)] for i in range(min(6, len(allc)))] if allc else []  # примеры из разных мест
            if not ex: continue
            crops = []
            for s in ex:
                pad = max(40, s['size'] * 6)
                cr = render_page(pdf, pi, big, clip=(s['x0'] - pad, s['y0'] - pad, s['x1'] + pad, s['y1'] + pad)); d = ImageDraw.Draw(cr)
                d.rectangle([int(pad * big) - 3, int(pad * big) - 3, int((s['x1'] - s['x0'] + pad) * big) + 3, int((s['y1'] - s['y0'] + pad) * big) + 3], outline=(255, 0, 255), width=3)
                cr.thumbnail((420, 420)); crops.append(cr)
            W = sum(c.width for c in crops) + 10 * len(crops); H = max(c.height for c in crops) + 40
            sheet = Image.new('RGB', (W, H), 'white'); x = 0
            for cr in crops: sheet.paste(cr, (x, 40)); x += cr.width + 10
            ImageDraw.Draw(sheet).text((6, 6), f"{c['id']}  #{c['color']}{' / фон #' + c['bg'] if c['bg'] else ''}  {c['size']}  примеры: {' | '.join(c['samples'][:5])}", fill='black', font=_font(18))
            sheet.save(os.path.join(work, 'c', f"{c['id']}{'' if pi == 0 else '_p%d' % (pi + 1)}.png"))

# ---------------------------------------------------------------- сборка точек по map.json
def sort_num(label):
    m = re.findall(r'\d+(?:\.\d+)?', label)
    return float(m[-1]) if m else 0

def _snake(lst, start='left', strips=None):
    """Порядок нумерации: полосы поперёк направления start→другой край; в полосе — туда-обратно (змейка)."""
    out = []
    for pg in sorted({x[0]['page'] for x in lst}):
        L = [x for x in lst if x[0]['page'] == pg]
        def uv(x):  # u — вдоль направления нумерации, v — поперёк
            cx, cy = (x[0]['x0'] + x[0]['x1']) / 2, (x[0]['y0'] + x[0]['y1']) / 2
            return {'left': (cx, cy), 'right': (-cx, cy), 'top': (cy, cx), 'bottom': (-cy, cx)}.get(start, (cx, cy))
        us = [uv(x)[0] for x in L]; lo, hi = min(us), max(us); vs = [uv(x)[1] for x in L]
        cell = 2.5 * math.sqrt(max(1.0, (hi - lo)) * max(1.0, max(vs) - min(vs)) / len(L))  # ширина полосы ~ по плотности точек
        k = int(strips) if strips else max(1, round((hi - lo) / cell))
        w = (hi - lo) / k or 1
        band = lambda x: min(k - 1, int((uv(x)[0] - lo) / w))
        out += sorted(L, key=lambda x: (band(x), uv(x)[1] * (1 if band(x) % 2 == 0 else -1)))
    return out

def _zones(lst, mp, r0):
    """Деление значков на части чертежа: вручную (zones: [[x0,y0,x1,y1], …] по порядку) или автоматически —
    группы значков, между которыми большой пустой промежуток (zone_gap pt; по умолчанию 3.5 × обычного расстояния до соседа)."""
    ctr = lambda x: ((x[0]['x0'] + x[0]['x1']) / 2, (x[0]['y0'] + x[0]['y1']) / 2)
    zones = r0.get('zones', mp.get('zones'))
    if zones == 'off' or zones is False or len(lst) < 4: return [lst]
    if isinstance(zones, list) and zones:
        out = [[] for _ in zones] + [[]]
        for x in lst:
            cx, cy = ctr(x)
            i = next((i for i, z in enumerate(zones) if z[0] <= cx <= z[2] and z[1] <= cy <= z[3]), len(zones))
            out[i].append(x)
        return [z for z in out if z]
    P = [ctr(x) for x in lst]; n = len(P)
    nn = sorted(min(math.dist(P[i], P[j]) for j in range(n) if j != i) for i in range(n))
    gap = float(r0.get('zone_gap', mp.get('zone_gap', 0)) or 3.5 * nn[n // 2])
    par = list(range(n))
    def f(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    for i in range(n):
        for j in range(i + 1, n):
            if lst[i][0]['page'] == lst[j][0]['page'] and math.dist(P[i], P[j]) <= gap: par[f(i)] = f(j)
    g = collections.defaultdict(list)
    for i in range(n): g[f(i)].append(lst[i])
    return list(g.values())

def _zoned(lst, mp, r0, start):
    """Нумерация по частям чертежа: часть целиком, потом следующая — ближайшая к концу предыдущей (без прыжков через лист)."""
    zs = _zones(lst, mp, r0)
    if len(zs) == 1: return _path(lst, start)
    ctr = lambda x: ((x[0]['x0'] + x[0]['x1']) / 2, (x[0]['y0'] + x[0]['y1']) / 2)
    key = {'left': lambda c: c[0], 'right': lambda c: -c[0], 'top': lambda c: c[1], 'bottom': lambda c: -c[1]}.get(start, lambda c: c[0])
    manual = isinstance(r0.get('zones', mp.get('zones')), list)
    out = []; rest = list(zs)
    cur = rest.pop(0) if manual else rest.pop(min(range(len(rest)), key=lambda i: min(key(ctr(x)) for x in rest[i])))
    opp = {'left': 'right', 'right': 'left', 'top': 'bottom', 'bottom': 'top'}
    while True:
        d = start
        if out:  # следующая часть — с того её края, который ближе к концу предыдущей, и дальше к другому краю
            last = ctr(out[-1])
            a1 = min(cur, key=lambda x: key(ctr(x))); a2 = max(cur, key=lambda x: key(ctr(x)))
            d = start if math.dist(last, ctr(a1)) <= math.dist(last, ctr(a2)) else opp.get(start, 'right')
        out += _path(cur, d)
        if not rest: break
        last = ctr(out[-1])
        cur = rest.pop(0) if manual else rest.pop(min(range(len(rest)), key=lambda i: min(math.dist(last, ctr(x)) for x in rest[i])))
    return out

def _path(lst, start='left', entry=None):
    """Порядок нумерации «цепочкой»: от крайней точки со стороны start к ближайшей следующей; шаг назад (к start) штрафуется,
    поэтому номера идут подряд по соседям и в целом от start к другому краю. Потом цепочка распрямляется (2-opt)."""
    out = []
    for pg in sorted({x[0]['page'] for x in lst}):
        L = [x for x in lst if x[0]['page'] == pg]
        def uv(x):
            cx, cy = (x[0]['x0'] + x[0]['x1']) / 2, (x[0]['y0'] + x[0]['y1']) / 2
            return {'left': (cx, cy), 'right': (-cx, cy), 'top': (cy, cx), 'bottom': (-cy, cx)}.get(start, (cx, cy))
        P = [uv(x) for x in L]; n = len(P)
        cost = lambda i, j: math.dist(P[i], P[j]) + 2.0 * max(0.0, P[i][0] - P[j][0])
        if entry is not None:  # продолжение с предыдущей части: начинаем с ближайшего к ней значка
            e = uv(({'x0': entry[0], 'x1': entry[0], 'y0': entry[1], 'y1': entry[1]},))
            cur = min(range(n), key=lambda i: math.dist(P[i], e))
        else: cur = min(range(n), key=lambda i: (P[i][0], P[i][1]))
        seq = [cur]; left = set(range(n)) - {cur}
        while left:
            cur = min(left, key=lambda j: cost(seq[-1], j)); seq.append(cur); left.remove(cur)
        if 3 < n <= 200:  # 2-opt: убрать перекрёстки цепочки (первая точка остаётся первой)
            total = lambda s: sum(cost(s[i], s[i + 1]) for i in range(len(s) - 1))
            best = total(seq); improved = True; it = 0
            while improved and it < 20:
                improved = False; it += 1
                for i in range(1, n - 1):
                    for j in range(i + 1, n):
                        cand = seq[:i] + seq[i:j + 1][::-1] + seq[j + 1:]
                        c = total(cand)
                        if c < best - 1e-6: seq, best, improved = cand, c, True
        out += [L[i] for i in seq]
    return out

def _load_prev(path, meta):
    """Прошлый файл точек (ревизия чертежа): [{label, typeId, page, x, y}] — только точки с координатами."""
    if not path: return None
    try: d = json.load(open(path))
    except Exception as e: print(f'previous не прочитан: {e}'); return []
    out = []
    old_pages = (d.get('sheet') or {}).get('pages') or meta['pages']
    for q in d.get('points', []):
        ps = q.get('pos')
        if not ps: continue
        pg = ps.get('page', 0); ow = old_pages[min(pg, len(old_pages) - 1)]; nw = meta['pages'][min(pg, len(meta['pages']) - 1)]
        kx, ky = nw['w'] / ow['w'], nw['h'] / ow['h']  # лист другого размера — пересчёт
        out.append(dict(label=q['label'], typeId=q['typeId'], page=pg, x=ps['x'] * kx, y=ps['y'] * ky, size=max(ps.get('w', 8), ps.get('h', 8))))
    return out

def _keep_numbers(lst, prefix, digits, prev, log):
    """Номера придуманных точек: если есть прошлая версия — значок на том же месте получает свой прежний номер,
    новые значки — следующие свободные номера. Без прошлой версии — просто 1, 2, 3… по порядку."""
    if not prev: return [f"{prefix}{n:0{digits}d}" for n in range(1, len(lst) + 1)]
    rx = re.compile('^' + re.escape(prefix) + r'(\d+)(?:\.\d+)?$')
    olds = {}
    for q in prev:
        m = rx.match(q['label'])
        if m: olds.setdefault(re.sub(r'\.\d+$', '', q['label']), q)
    used = set(); out = [None] * len(lst)
    ctr = lambda s: ((s['x0'] + s['x1']) / 2, (s['y0'] + s['y1']) / 2)
    pairs = []
    for i, (s, r) in enumerate(lst):
        for base, q in olds.items():
            if q['typeId'] != r['type'] or q['page'] != s['page']: continue
            d = math.dist(ctr(s), (q['x'], q['y']))
            tol = max(12.0, 2.5 * max(s['x1'] - s['x0'], s['y1'] - s['y0'], q['size']))
            if d <= tol: pairs.append((d, i, base))
    for d, i, base in sorted(pairs):
        if out[i] is None and base not in used: out[i] = base; used.add(base)
    nums = [int(rx.match(b).group(1)) for b in olds] or [0]
    n = max(nums)
    for i in range(len(lst)):
        if out[i] is None: n += 1; out[i] = f"{prefix}{n:0{digits}d}"
    kept = sum(1 for b in out if b in used)
    log.append(f"- серия «{prefix or '(без букв)'}»: номер сохранён у {kept}, новых значков {len(lst) - kept}" + (f" (новые с {max(nums) + 1})" if len(lst) > kept else ''))
    return out

def _diff_prev(prev, final):
    old = {q['label']: q for q in prev}; new = {p['label']: p for p in final if p.get('s')}
    added = sorted(set(new) - set(old), key=lambda l: (sort_num(l), l)); gone = sorted(set(old) - set(new), key=lambda l: (sort_num(l), l))
    moved = []
    for l in set(old) & set(new):
        s = new[l]['s']; q = old[l]
        d = math.dist(((s['x0'] + s['x1']) / 2, (s['y0'] + s['y1']) / 2), (q['x'], q['y']))
        if d > max(12.0, 2.5 * q['size']): moved.append(f'{l} ({d:.0f} pt)')
    out = [f'- новые точки ({len(added)}): ' + (', '.join(added[:60]) or '—'),
           f'- исчезли с чертежа ({len(gone)}): ' + (', '.join(gone[:60]) or '—'),
           f'- сдвинулись ({len(moved)}): ' + (', '.join(sorted(moved)[:60]) or '—')]
    return out

def _sample_sheet(pdf, lst, path, title):
    from PIL import Image, ImageDraw
    ex = [lst[int(i * len(lst) / 6)] for i in range(min(6, len(lst)))]; crops = []
    for q in ex:
        pad = 30; cr = render_page(pdf, q['page'], 5.0, clip=(q['x0'] - pad, q['y0'] - pad, q['x1'] + pad, q['y1'] + pad))
        ImageDraw.Draw(cr).rectangle([pad * 5 - 4, pad * 5 - 4, int((q['x1'] - q['x0'] + pad) * 5) + 4, int((q['y1'] - q['y0'] + pad) * 5) + 4], outline=(255, 0, 255), width=3)
        cr.thumbnail((300, 300)); crops.append(cr)
    W = sum(c.width for c in crops) + 10 * len(crops); H = max(c.height for c in crops) + 36
    sh = Image.new('RGB', (W, H), 'white'); x = 0
    for c in crops: sh.paste(c, (x, 36)); x += c.width + 10
    ImageDraw.Draw(sh).text((6, 6), title, fill='black', font=_font(18)); sh.save(path)

def _split_glued(s):
    """«GD1/ D-15.2 D-14.2» → «GD1/D-15.2», «GD1/D-14.2» (часть, кончающаяся на «/», — приставка к следующим). Место — по доле символов."""
    t = s['t']; toks = [(m.start(), m.group()) for m in re.finditer(r'\S+', t)]
    out = []; pre = ''
    for pos, tok in toks:
        if tok.endswith('/') and len(tok) <= 6: pre = tok; continue
        q = dict(s); n = max(1, len(t)); w = s['x1'] - s['x0']
        q.update(t=pre + tok, x0=s['x0'] + w * pos / n, x1=s['x0'] + w * (pos + len(tok)) / n, split_from=t); out.append(q)
    return out if len(out) >= 2 or (len(out) == 1 and pre) else None

def build(work, mapfile, out):
    sc = json.load(open(os.path.join(work, 'scan.json'))); mp = json.load(open(mapfile))
    spans = sc['spans']; meta = sc['meta']
    _set_hide(meta, mp.get('hide_layers', [])); meta['colors'] = mp.get('colors', {})
    rules = mp.get('rules', [])
    free = collections.defaultdict(list); taken = []  # что не взято ни одним правилом / взято (для проверки «пропущенных значков»)
    renames = [(re.compile(a), b) for a, b in mp.get('rename', [])]
    cab_re = re.compile(mp['cabinet_regex']) if mp.get('cabinet_regex') else None
    used_clusters = {c for r in rules for c in (r.get('clusters') or [])}
    pts = []; unknown = []; skipped = collections.Counter(); icons = collections.defaultdict(list); nears = []; near_log = []
    def pick(s, t):
        for r in rules:
            if r.get('clusters') and s['c'] not in r['clusters']: continue
            if r.get('match') and not re.search(r['match'], t): continue
            if r.get('page') is not None and s['page'] != r['page']: continue
            if r.get('area') and not (r['area'][0] <= (s['x0'] + s['x1']) / 2 <= r['area'][2] and r['area'][1] <= (s['y0'] + s['y1']) / 2 <= r['area'][3]): continue  # по центру текста
            return r
        return None
    byicon = []; split_log = []
    queue = list(spans)
    while queue:
        s = queue.pop(0)
        t = s['t'].strip()
        rule = pick(s, t)
        if rule is None and re.search(r'\s', t) and not s.get('split_from'):
            parts = _split_glued(s)  # «GD1/ D-15.2 D-14.2» — две подписи слиплись в одну строку
            if parts and all((lambda r: r is not None and not r.get('skip'))(pick(q, q['t'])) for q in parts):
                split_log.append(f"«{t}» → {', '.join(q['t'] for q in parts)}"); queue[0:0] = parts; continue
        if rule is None:
            if s['c'] in used_clusters and labelish(t): unknown.append(s)
            free[s['c']].append(s)
            continue
        taken.append(s)
        if rule.get('skip'): skipped[rule.get('why', 'skip')] += 1; continue
        if rule.get('near'):
            nears.append((s, rule)); continue
        if rule.get('icon'):
            icons[rule.get('prefix', 'X')].append((s, rule)); continue
        label = t.replace(' ', '')
        for rx, rep in renames: label = rx.sub(rep, label)
        if rule.get('by_icon'):
            byicon.append(dict(label=label, orig=t, s=s, rule=rule)); continue
        pts.append(dict(label=label, orig=t, typeId=rule['type'], s=s, rule=rule))
    # тип подписи — по значку рядом (by_icon: {"sym:tri": "Магнит индикация", "sym:hex": "Галай"}): каждый значок достаётся одной подписи, ближайшей
    icon_log = []
    if byicon:
        groups = {g for b in byicon for g in b['rule']['by_icon']}
        icn = [x for x in spans if x['c'] in groups]
        def edge(a, b):  # расстояние от центра значка до прямоугольника подписи
            cx, cy = (b['x0'] + b['x1']) / 2, (b['y0'] + b['y1']) / 2
            return math.hypot(max(a['x0'] - cx, 0, cx - a['x1']), max(a['y0'] - cy, 0, cy - a['y1']))
        pairs = []
        for i, b in enumerate(byicon):
            md = float(b['rule'].get('icon_dist', 60))
            for j, x in enumerate(icn):
                if x['page'] == b['s']['page'] and x['c'] in b['rule']['by_icon']:
                    d = edge(b['s'], x)
                    if d <= md: pairs.append((d, i, j))
        got = {}; used = set()
        for d, i, j in sorted(pairs):
            if i in got or j in used: continue
            got[i] = (j, d); used.add(j)
        for i, b in enumerate(byicon):
            r = b['rule']
            if i in got:
                j, d = got[i]; x = icn[j]; typ = r['by_icon'][x['c']]; taken.append(x)
                alt = [(d2, icn[j2]['c']) for d2, i2, j2 in pairs if i2 == i and icn[j2]['c'] != x['c'] and j2 not in used]
                amb = alt and min(alt)[0] < d * 1.3 + 3
                if amb: icon_log.append(f"⚠️ {b['label']} → {typ} ({x['c']} {d:.0f} pt), но рядом и {min(alt)[1]} {min(alt)[0]:.0f} pt — проверить")
                b.update(typeId=typ, icon_d=d)
            else:
                typ = r.get('type')
                icon_log.append(f"⚠️ {b['label']}: значка рядом нет (≤{float(r.get('icon_dist', 60)):.0f} pt) → " + (f'«{typ}» по умолчанию (type правила) — проверить' if typ else 'не взята, нужен type в правиле или вопрос Ивану'))
                if not typ: unknown.append(b['s']); continue
                b['typeId'] = typ
            pts.append(b)
    # значок рядом с точкой другого типа (BRFC/APA/OB у двери): обозначение = обозначение ближайшей точки + суффикс
    ctr = lambda s: ((s['x0'] + s['x1']) / 2, (s['y0'] + s['y1']) / 2)
    used_lab = collections.Counter()
    for s, r in nears:
        cand = [p for p in pts if p['typeId'] == r['near'] and p['s']['page'] == s['page'] and not p.get('derived')]
        maxd = float(r.get('max_dist', 120))
        ranked = sorted(cand, key=lambda p: math.dist(ctr(p['s']), ctr(s)))
        best = ranked[0] if ranked else None
        d1 = math.dist(ctr(best['s']), ctr(s)) if best else None
        d2 = math.dist(ctr(ranked[1]['s']), ctr(s)) if len(ranked) > 1 else None
        if best is None or d1 > maxd:
            near_log.append(f"{s['t']} → далеко от «{r['near']}» ({'нет' if d1 is None else f'{d1:.0f} pt'} > {maxd:.0f}) → значок без номера")
            icons[r.get('prefix', 'X')].append((s, dict(r, icon=True))); continue
        base = best['label'] + r.get('suffix', ''); used_lab[base] += 1
        lab = base if used_lab[base] == 1 else f'{base}{used_lab[base]}'
        amb = d2 is not None and d2 < d1 * 1.5
        near_log.append(f"{'⚠️ ' if amb or used_lab[base] > 1 else ''}{lab}: ближайшая {best['label']} {d1:.0f} pt" + (f", следующая {ranked[1]['label']} {d2:.0f} pt" if d2 is not None else '')
                        + (' — неоднозначно, проверить' if amb else '') + (' — к этой точке уже привязан такой же значок' if used_lab[base] > 1 else ''))
        pts.append(dict(label=lab, orig=s['t'], typeId=r['type'], s=s, rule=dict(r, cabinet=r.get('cabinet')), derived=True, near=best['label']))
    # значок, у которого рядом уже есть подписанная точка (only_unlabeled: {type, dist}), не дублируем
    for prefix in list(icons):
        keep = []
        for s0, r in icons[prefix]:
            ou = r.get('only_unlabeled')
            if ou:
                near_pts = [p for p in pts if p['typeId'] == ou['type'] and p['s']['page'] == s0['page'] and math.dist(ctr(p['s']), ctr(s0)) <= float(ou.get('dist', 80))]
                if near_pts: skipped[f"значок «{s0['t']}» уже подписан рядом"] += 1; continue
            keep.append((s0, r))
        icons[prefix] = keep
    prev_pts = _load_prev(mp.get('previous'), meta); prev_log = []
    # значки без номеров: каждый вид (prefix) с 1, от края start (по умолчанию слева) к другому краю; соседние номера — рядом.
    # order: path (по умолчанию, цепочка по соседям) | snake (полосы туда-обратно) | rows (строками)
    for prefix, lst in icons.items():
        r0 = lst[0][1] if lst else {}
        order = r0.get('order', mp.get('order', 'path')); start = r0.get('start', mp.get('start', 'left'))
        digits = int(r0.get('digits', mp.get('digits', 2)))
        lst = _zoned(lst, mp, r0, start) if order == 'path' else _snake(lst, start, r0.get('strips', mp.get('strips'))) if order == 'snake' else sorted(lst, key=lambda x: (x[0]['page'], round(x[0]['y0'] / 60), x[0]['x0']))
        bases = _keep_numbers(lst, prefix, digits, prev_pts, prev_log)
        for (s, r), base in zip(lst, bases):
            per = int(r.get('per_icon', 1))
            for k in range(per):
                pts.append(dict(label=base if per == 1 else f'{base}.{k + 1}', orig=s['t'], typeId=r['type'], s=s, rule=r, invented=True))
    # шкаф, этаж
    for p in pts:
        if 'cabinet' in p['rule'] and not p.get('near') and p['rule']['cabinet'] is not None:
            p['cabinet'] = p['rule']['cabinet']; continue  # шкаф задан правилом явно ('' — без шкафа)
        cab = p['rule'].get('cabinet')
        if not cab and p.get('near'): cab = next((q.get('cabinet') or (cab_re.search(q['label']).group(1) if cab_re and cab_re.search(q['label']) else '') for q in pts if q['label'] == p['near']), '')
        if not cab and cab_re:
            m = cab_re.search(p['label'])
            if m: cab = m.group(1)
        if not cab and mp.get('cabinets') and p.get('s'):  # ближайший шкаф по координатам (шкафы: [{id, x, y}])
            cab = min(mp['cabinets'], key=lambda c: math.dist((c['x'], c['y']), ctr(p['s'])))['id']
        p['cabinet'] = cab or mp.get('default_cabinet', '')
    # исключения/добавления вручную
    excl = set(mp.get('exclude', []))
    pts = [p for p in pts if p['label'] not in excl and p.get('near') not in excl]  # исключённая точка забирает и привязанные к ней значки
    # дубли: одно обозначение в разных местах — предупреждение; в одном месте (наложение слоёв) — склеиваем
    byl = collections.defaultdict(list)
    for p in pts: byl[p['label']].append(p)
    final = []; dups = []
    for lab, lst in byl.items():
        keep = [lst[0]]
        for p in lst[1:]:
            if all(abs(p['s']['x0'] - k['s']['x0']) > 3 or abs(p['s']['y0'] - k['s']['y0']) > 3 or p['s']['page'] != k['s']['page'] for k in keep):
                keep.append(p)
        if len(keep) > 1: dups.append((lab, len(keep)))
        final.append(keep[0])
        for i, p in enumerate(keep[1:], 2):  # второй и далее — с пометкой, чтобы Иван решил
            q = dict(p); q['label'] = f"{lab}#{i}"; q['dup'] = True; final.append(q)
    for p in final:  # переименование конкретных точек (в том числе дублей «#2»): relabel {"R-C10#2": "R-C11"}
        if p['label'] in mp.get('relabel', {}): p['label'] = mp['relabel'][p['label']]; p.pop('dup', None)
    for e in mp.get('add', []):  # вручную; с координатами (x, y) — нарисуется на check.png
        s0 = dict(x0=e['x'] - 6, y0=e['y'] - 6, x1=e['x'] + 6, y1=e['y'] + 6, page=e.get('page', 0), t=e['label']) if 'x' in e else None
        final.append(dict(label=e['label'], typeId=e['type'], cabinet=e.get('cabinet', mp.get('default_cabinet', '')), s=s0, rule={}, note=e.get('note', 'добавлено вручную')))
    final.sort(key=lambda p: (p['cabinet'], p['typeId'], sort_num(p['label']), p['label']))
    # проверки
    probs = []
    for p in final:
        b = []
        if re.search(r'[А-Яа-яЁё]', p['label']): b.append('русские буквы')
        if re.search(r'\s', p['label']): b.append('пробел')
        if not re.search(r'\d', p['label']): b.append('нет цифр')
        if len(p['label']) > 30: b.append('очень длинное — предложить Ивану короткую форму')
        if b: probs.append(f"{p['label']}: {', '.join(b)}")
    # пропуски в сериях: префикс + номер
    series = collections.defaultdict(list)
    for p in final:
        m = re.match(r'^(.*?)(\d+)$', p['label'])
        if m and '.' not in p['label'][-4:]: series[(m.group(1), p['typeId'])].append(int(m.group(2)))
    pairs = collections.defaultdict(set)  # двери вида 1A-17.1 / 1A-17.2
    for p in final:
        m = re.match(r'^(.*?)(\d+)\.(\d+)$', p['label'])
        if m: series[(m.group(1), p['typeId'])].append(int(m.group(2))); pairs[(m.group(1), int(m.group(2)))].add(int(m.group(3)))
    gaps = []
    subs_all = collections.defaultdict(set)
    for (pre, n), ks in pairs.items(): subs_all[pre] |= ks
    for (pre, n), ks in sorted(pairs.items()):
        miss = sorted(subs_all[pre] - ks)
        if miss and len(subs_all[pre]) > 1: gaps.append(f"{pre}{n}: есть .{', .'.join(map(str, sorted(ks)))}, нет .{', .'.join(map(str, miss))}")
    for (pre, typ), nums in series.items():
        nums = sorted(set(nums))
        if len(nums) >= 4:
            miss = [n for n in range(nums[0], nums[-1] + 1) if n not in nums]
            if miss and len(miss) <= max(3, len(nums) // 3): gaps.append(f"{pre}… ({typ}): нет {', '.join(str(x) for x in miss[:12])}{' …' if len(miss) > 12 else ''}")
    # результат
    floor = mp.get('floor', '')
    pdata = []
    for p in final:
        d = dict(label=p['label'], typeId=p['typeId'], cabinet=p['cabinet'], floor=floor)
        if p.get('invented'): d['planName'] = p['orig']; d['note'] = 'обозначение придумано — нанести на чертёж'
        elif p.get('orig') and p['orig'].replace(' ', '') != p['label']: d['planName'] = p['orig']
        if p.get('dup'): d['note'] = (d.get('note', '') + ' повтор обозначения на чертеже — проверить').strip()
        if p.get('note'): d['note'] = p['note']
        if p.get('s'):  # место на листе (pt PDF, с учётом поворота; начало — левый верхний угол): для плана в приложении и сравнения ревизий
            sp = p['s']; d['pos'] = dict(page=sp['page'], x=round((sp['x0'] + sp['x1']) / 2, 1), y=round((sp['y0'] + sp['y1']) / 2, 1),
                                          w=round(sp['x1'] - sp['x0'], 1), h=round(sp['y1'] - sp['y0'], 1))
        pdata.append(d)
    res = dict(format='polevoy-points-1', source=f"{os.path.basename(meta['pdf'])}" + (f", этаж {floor}" if floor else ''), floor=floor, points=pdata)
    res['sheet'] = dict(pdf=os.path.basename(meta['pdf']), pages=meta['pages'])
    if mp.get('types'): res['types'] = mp['types']
    if mp.get('devices'): res['devices'] = mp['devices']
    json.dump(res, open(out, 'w'), ensure_ascii=False, indent=1)
    # отчёт
    cnt = collections.Counter((p['cabinet'] or '—', p['typeId']) for p in final)
    rep = [f"# Итог разбора: {os.path.basename(meta['pdf'])}", '', f'Точек: {len(final)}', ''] + [f'- {c} · {t}: {n}' for (c, t), n in sorted(cnt.items())]
    if skipped: rep += ['', '## Отброшено правилами'] + [f'- {k}: {v}' for k, v in skipped.items()]
    if unknown: rep += ['', f'## ⚠️ Похоже на обозначения, но ни одно правило не подошло ({len(unknown)}) — проверить!'] + [f"- {s['t']} ({s['c']})" for s in unknown[:80]]
    if dups: rep += ['', '## ⚠️ Одно обозначение в разных местах чертежа'] + [f'- {l}: {n} раза (вторые получили #2, #3…)' for l, n in dups]
    if gaps: rep += ['', '## Пропуски в сериях (на чертеже их нет — не добавлены)'] + [f'- {g}' for g in gaps]
    if probs: rep += ['', '## ⚠️ Странные обозначения'] + [f'- {x}' for x in probs]
    if near_log: rep += ['', '## Значки, привязанные к соседней точке (near) — проверить строки с ⚠️'] + [f'- {x}' for x in near_log]
    if icon_log: rep += ['', '## Тип по значку рядом (by_icon) — проверить'] + [f'- {x}' for x in icon_log]
    if split_log: rep += ['', '## Слипшиеся подписи разделены'] + [f'- {x}' for x in split_log]
    # значки/коды, которых много, но ни одно правило их не взяло — возможно, пропущен целый вид точек
    missed = []
    cl = {c['id']: c for c in sc['clusters']}
    tgrid = collections.defaultdict(list)
    for q in taken:
        for gx in range(int((q['x0'] - 3) // 40), int((q['x1'] + 3) // 40) + 1):
            for gy in range(int((q['y0'] - 3) // 40), int((q['y1'] + 3) // 40) + 1): tgrid[(q['page'], gx, gy)].append(q)
    def covered(x):  # на этом месте уже есть взятый (или осознанно отброшенный) текст/значок — тот же значок другим способом
        cx, cy = (x['x0'] + x['x1']) / 2, (x['y0'] + x['y1']) / 2
        return any(q['x0'] - 3 <= cx <= q['x1'] + 3 and q['y0'] - 3 <= cy <= q['y1'] + 3 for q in tgrid.get((x['page'], int(cx // 40), int(cy // 40)), []))
    for c, lst in free.items():
        c0 = cl.get(c, {})
        if not (c.startswith(('b:', 'sym:')) or c0.get('bg')): continue  # значки и буквы в цветных рамках
        lst = [x for x in lst if not covered(x)]
        if len(lst) >= 3: missed.append((c, lst))
    ign = [re.compile(x) for x in mp.get('ignore_missed', [])]
    missed = [(c, lst) for c, lst in missed if not any(x.search(c) for x in ign)]
    if missed:
        missed.sort(key=lambda e: -len(e[1])); show = missed[:12]; rest = missed[12:]
        rep += ['', '## ⚠️ Повторяющиеся значки/коды, которые ни одно правило не взяло — спросить Ивану или осознанно skip (картинки work/missed_*.png)']
        for c, lst in show:
            rep.append(f"- {c}: {len(lst)} шт., примеры: {' | '.join(dict.fromkeys(x['t'] for x in lst[:30]))[:80]}")
            try: _sample_sheet(meta['pdf'], lst, os.path.join(work, f"missed_{c.replace(':', '_')}.png"), f'{c}: {len(lst)} шт. не взяты')
            except Exception: pass
        if rest: rep.append(f"- …и ещё {len(rest)} видов поменьше ({sum(len(l) for c, l in rest)} шт.): {', '.join(c for c, l in rest[:30])}{' …' if len(rest) > 30 else ''} — обычно архитектура; если смотрел — убери из отчёта: \"ignore_missed\": [\"^b:\"]")
    if prev_pts is not None:
        rep += ['', '## Сравнение с прошлой версией (previous)'] + (prev_log or ['- нечего сравнивать'])
        rep += _diff_prev(prev_pts, final)
    under = []
    for p in final:
        s0 = p.get('s')
        if not s0: continue
        for a in meta.get('annots', []):
            if a['page'] == s0['page'] and a['x0'] - 5 <= (s0['x0'] + s0['x1']) / 2 <= a['x1'] + 5 and a['y0'] - 5 <= (s0['y0'] + s0['y1']) / 2 <= a['y1'] + 5 and a['kind'] not in ('Link', 'Widget'):
                under.append(f"{p['label']}: под пометкой {a['kind']}{' «' + a['text'] + '»' if a['text'] else ''} — посмотри (crop), не зачёркнута ли"); break
    if under: rep += ['', '## ⚠️ Точки под пометками поверх чертежа'] + [f'- {x}' for x in under]
    leftovers = collections.Counter(s['c'] for s in spans if s['c'] not in used_clusters and labelish(s['t']))
    if leftovers:
        rep += ['', '## Группы, не включённые ни в одно правило, где есть текст вида «буквы+цифры»']
        cl = {c['id']: c for c in sc['clusters']}
        rep += [f"- {c}: {n} шт., примеры: {' | '.join(cl[c]['samples'][:8])}" for c, n in leftovers.most_common()]
    open(os.path.join(work, 'report.md'), 'w').write('\n'.join(rep))
    open(os.path.join(work, 'points.md'), 'w').write('\n'.join(f"{p['cabinet'] or '—'}\t{p['typeId']}\t{p['label']}" + (f"\t({p['orig']})" if p.get('orig') and p['orig'] != p['label'] else '') for p in final))
    render_check(meta, work, final, unknown)
    try: render_pdf(meta, final, os.path.splitext(out)[0] + '.pdf')
    except Exception as e: print(f'PDF с номерами не получился: {e}')
    print('\n'.join(rep[:120]))
    print(f'\nФайл точек: {out}\nПроверочная картинка: {work}/check*.png')

def render_check(meta, work, final, unknown):
    """Чертёж с разметкой: зелёная рамка — точка (подпись — обозначение и тип), красная — похоже на обозначение, но не взято."""
    from PIL import ImageDraw
    for pi, pg in enumerate(meta['pages']):
        z = min(4.0, 4200 / pg['w'])
        img = render_page(meta['pdf'], pi, z); d = ImageDraw.Draw(img, 'RGBA'); f = _font(max(14, int(z * 5)))
        tc = type_colors(list(dict.fromkeys(p['typeId'] for p in final)), meta.get('colors'))
        colors = {}; drawn = set()
        for p in final:
            s = p.get('s')
            if not s or s['page'] != pi: continue
            col = colors.setdefault(p['typeId'], tuple(int(v * 255) for v in _hex2rgb(tc[p['typeId']])))
            x0, y0, x1, y1 = [v * z for v in (s['x0'], s['y0'], s['x1'], s['y1'])]
            d.rectangle([x0 - 4, y0 - 4, x1 + 4, y1 + 4], outline=col + (255,), width=3)
            if p.get('invented') or p.get('dup'):
                key = (round(x0), round(y0))
                if key in drawn: continue
                drawn.add(key)
                lab = re.sub(r'\.\d+$', '', p['label']) if p.get('invented') else p['label']
                d.text((x1 + 4, y0 - 2), lab, fill=(255, 0, 0, 255) if p.get('dup') else col + (255,), font=f)
        for s in unknown:
            if s['page'] != pi: continue
            x0, y0, x1, y1 = [v * z for v in (s['x0'], s['y0'], s['x1'], s['y1'])]
            d.rectangle([x0 - 6, y0 - 6, x1 + 6, y1 + 6], outline=(255, 0, 0, 255), width=4)
        y = 10
        for t, col in colors.items():
            d.rectangle([10, y, 40, y + 24], fill=col + (255,)); d.text((50, y), t, fill=(0, 0, 0, 255), font=_font(24)); y += 32
        d.rectangle([10, y, 40, y + 24], outline=(255, 0, 0, 255), width=4); d.text((50, y), 'не взято правилами — проверить', fill=(0, 0, 0, 255), font=_font(24))
        suf = '' if pi == 0 else f'_p{pi + 1}'
        small = img.copy(); small.thumbnail((2600, 2600)); small.save(os.path.join(work, f'check{suf}.png'))
        W, H = img.size  # 4 части крупно — для просмотра с телефона
        for i, (a, b) in enumerate([(0, 0), (1, 0), (0, 1), (1, 1)]):
            part = img.crop((int(a * W / 2) - (40 if a else 0), int(b * H / 2) - (40 if b else 0), int((a + 1) * W / 2), int((b + 1) * H / 2)))
            part.thumbnail((2400, 2400)); part.save(os.path.join(work, f'check{suf}_{i + 1}.png'))

def _strip_layers(doc, page, hidden_xrefs):
    """Вырезать из содержимого страницы всё, что нарисовано в скрытых слоях (/OC … BDC … EMC) — в любом просмотрщике их не будет."""
    res = doc.xref_get_key(page.xref, 'Resources/Properties')
    props = dict(re.findall(r'/([^\s/<>\[\]()]+)\s+(\d+)\s+0\s+R', res[1])) if res and res[1] else {}
    names = {n.encode() for n, x in props.items() if int(x) in hidden_xrefs}
    if not names: return 0
    page.clean_contents()  # одна склеенная последовательность команд
    xref = page.get_contents()[0]; data = doc.xref_stream(xref)
    tok = re.compile(rb'\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|/OC\s*/([^\s/<>\[\]()]+)\s*BDC|\bBDC\b|\bBMC\b|\bEMC\b')
    stack = []; cut = []; removed = 0
    for m in tok.finditer(data):
        t = m.group(0)
        if t[:1] in (b'(', b'<'): continue
        if m.group(1) is not None: stack.append((m.start(), m.group(1) in names))
        elif t in (b'BDC', b'BMC'): stack.append((m.start(), False))
        elif t == b'EMC' and stack:
            st, hid = stack.pop()
            if hid and not any(h for _, h in stack): cut.append((st, m.end())); removed += 1
    if not cut: return 0
    out = []; pos = 0
    for a, b in cut: out.append(data[pos:a]); pos = b
    out.append(data[pos:]); doc.update_stream(xref, b' '.join(out))
    return removed

def render_pdf(meta, final, out_pdf):
    """Копия чертежа PDF для Ивана: мешающие слои вырезаны, рамки-аннотации AutoCAD вокруг надписей удалены;
    у каждой точки рамка цвета типа, у придуманных номеров — подпись (без наложений, далёкая — с выноской).
    Каждый тип — свой слой (включается/выключается в просмотрщике), оглавление «тип → номер» (нажал — показало место),
    в конце — лист-легенда: цвет, тип, количество, номера. Векторный: читается при любом увеличении."""
    fitz = _fitz()
    if not fitz: print('PDF с номерами: нужен PyMuPDF'); return
    doc = fitz.open(meta['pdf'])
    ocgs = doc.get_ocgs() if hasattr(doc, 'get_ocgs') else {}
    hidden = {x for x, v in ocgs.items() if _hidden(v['name'])}
    if hidden:
        try: doc.set_layer(-1, off=list(hidden))
        except Exception: pass
    types = list(dict.fromkeys(q['typeId'] for q in final))
    tc = type_colors(types, meta.get('colors'))
    layer = {}
    for t in types:
        try: layer[t] = doc.add_ocg(f'Номера: {t}', on=True)
        except Exception: layer[t] = 0
    toc = collections.defaultdict(list); removed_ann = 0
    for pi, p in enumerate(doc):
        if hidden: _strip_layers(doc, p, hidden)
        for an in list(p.annots() or []):  # невидимые рамки AutoCAD вокруг каждой надписи (сам текст нарисован на чертеже)
            if (an.info.get('title') or '').strip() == 'AutoCAD SHX Text': p.delete_annot(an); removed_ann += 1
        dm = p.derotation_matrix
        pts = [q for q in final if q.get('s') and q['s']['page'] == pi]
        if not pts: continue
        hs = sorted(max(q['s']['x1'] - q['s']['x0'], q['s']['y1'] - q['s']['y0']) for q in pts)
        fs = max(3.5, min(14.0, hs[len(hs) // 2] * 1.0))  # размер подписи — как значок
        lw = max(0.5, fs / 8)
        items = []; seen = set(); sh = p.new_shape()  # всё рисуется одной вставкой (быстро на больших чертежах)
        for q in pts:
            sp = q['s']; col = _hex2rgb(tc[q['typeId']])
            r = fitz.Rect(sp['x0'] - 1, sp['y0'] - 1, sp['x1'] + 1, sp['y1'] + 1)
            sh.draw_rect(r * dm); sh.finish(color=col, width=lw, oc=layer[q['typeId']])
            lab = re.sub(r'\.\d+$', '', q['label']) if q.get('invented') else q['label']
            key = (round(sp['x0']), round(sp['y0']), lab)
            toc[q['typeId']].append((lab, pi, ((sp['x0'] + sp['x1']) / 2, (sp['y0'] + sp['y1']) / 2)))
            if not (q.get('invented') or q.get('dup')) or key in seen: continue
            seen.add(key); items.append((key, lab, (sp['x0'] - 1, sp['y0'] - 1, sp['x1'] + 1, sp['y1'] + 1), q))
        pos = place_labels([(k, t, b) for k, t, b, _ in items], fs, lambda t: fitz.get_text_length(t, fontname='hebo', fontsize=fs))
        for key, lab, b, q in items:
            (x0, y0, x1, y1), far = pos[key]; col = _hex2rgb(tc[q['typeId']]); oc = layer[q['typeId']]
            if far:  # выноска от значка к подписи
                cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
                tx, ty = min(max(cx, x0), x1), min(max(cy, y0), y1)
                sh.draw_line(fitz.Point(cx, cy) * dm, fitz.Point(tx, ty) * dm); sh.finish(color=col, width=lw * 0.8, oc=oc)
            sh.draw_rect(fitz.Rect(x0, y0, x1, y1) * dm); sh.finish(color=col, fill=(1, 1, 1), width=lw * 0.7, fill_opacity=0.92, oc=oc)
            sh.insert_text(fitz.Point(x0 + fs * 0.2, y1 - fs * 0.27) * dm, lab, fontsize=fs, fontname='hebo',
                           color=(0.85, 0, 0) if q.get('dup') else col, rotate=p.rotation, oc=oc)
        sh.commit(overlay=True)
    # лист-легенда
    lp_draw = doc.new_page(width=842, height=595); y = 96
    fontfile = next((f for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf', 'C:/Windows/Fonts/arial.ttf', '/Library/Fonts/Arial.ttf'] if os.path.exists(f)), None)
    fobj = fitz.Font(fontfile=fontfile) if fontfile else fitz.Font('helv')
    def txt(page, xy, t, size, color=(0, 0, 0)):  # кириллица — через шрифт с кириллицей
        if fontfile: page.insert_text(xy, t, fontsize=size, fontname='dv', fontfile=fontfile, color=color)
        else: page.insert_text(xy, t, fontsize=size, fontname='helv', color=color)
    txt(lp_draw, (40, 55), 'Легенда номеров — ' + os.path.basename(meta['pdf']), 16)
    for t in types:
        labs = list(dict.fromkeys(l for l, _, _ in sorted(toc[t], key=lambda e: natkey(e[0]))))
        npts = sum(1 for q in final if q['typeId'] == t); col = _hex2rgb(tc[t])
        if y > 540: lp_draw = doc.new_page(width=842, height=595); y = 50
        lp_draw.draw_rect(fitz.Rect(40, y - 10, 60, y + 4), color=col, fill=col)
        txt(lp_draw, (70, y + 2), f'{t}: {len(labs)}' + (f' значков, {npts} точек (кабелей)' if npts != len(labs) else ''), 12, col); y += 16
        line = ''
        for l in labs:
            if fobj.text_length(line + l + ', ', fontsize=8) > 720:
                txt(lp_draw, (70, y), line.rstrip(', '), 8, (0.2, 0.2, 0.2)); y += 11; line = ''
                if y > 570: lp_draw = doc.new_page(width=842, height=595); y = 50
            line += l + ', '
        if line: txt(lp_draw, (70, y), line.rstrip(', '), 8, (0.2, 0.2, 0.2)); y += 11
        y += 10
    # оглавление: тип → номера (переход к месту)
    outline = []
    for t in types:
        ent = sorted(dict(((l, pi), c) for l, pi, c in toc[t]).items(), key=lambda e: natkey(e[0][0]))
        if not ent: continue
        first = ent[0]
        outline.append([1, f'{t} ({len(ent)})', first[0][1] + 1])
        for (l, pi), (cx, cy) in ent:
            outline.append([2, l, pi + 1, {'kind': fitz.LINK_GOTO, 'page': pi, 'to': fitz.Point(0, 0), 'zoom': 0, 'view': (cx, cy)}])
    outline.append([1, 'Легенда', len(doc)])
    try:
        doc.set_toc(outline)
        # переход к точке: /FitR — показать прямоугольник вокруг значка (в координатах PDF без поворота, начало снизу слева);
        # так одинаково работает в любом просмотрщике и на повёрнутых листах (XYZ на повёрнутом листе уводит в угол)
        dests = [e for e in outline if len(e) > 3]
        for e, item in zip(dests, [x for x in doc.get_toc(simple=False) if x[0] == 2]):
            pi = e[3]['page']; pg = doc[pi]; c = fitz.Point(*e[3]['view']) * pg.derotation_matrix
            H = pg.mediabox.height; R = 70
            x0, y0, x1, y1 = c.x - R, H - c.y - R, c.x + R, H - c.y + R
            if item[3].get('xref'):
                doc.xref_set_key(item[3]['xref'], 'A', f'<</S/GoTo/D[{pg.xref} 0 R/FitR {x0:.1f} {y0:.1f} {x1:.1f} {y1:.1f}]>>')
    except Exception as e: print(f'оглавление не записалось: {e}')
    doc.save(out_pdf, garbage=3, deflate=True)
    print(f'PDF с номерами: {out_pdf} (слоёв убрано: {len(hidden)}, рамок надписей удалено: {removed_ann})')

def crop(pdf, x0, y0, x1, y1, out, page=0):
    """Вырезать область чертежа крупно (координаты PDF с учётом поворота, как в scan.json)."""
    if os.path.isdir(pdf):  # crop WORK/ … — тот же чертёж, со скрытыми слоями
        meta = json.load(open(os.path.join(pdf, 'scan.json')))['meta']; _set_hide(meta); pdf = meta['pdf']
    x0, y0, x1, y1 = map(float, (x0, y0, x1, y1)); z = min(8.0, 2400 / max(1.0, x1 - x0, y1 - y0))
    render_page(pdf, int(page), z, clip=(x0, y0, x1, y1)).save(out); print(out)

def _plen(items, rm):
    """Длина контура пути (не меняется при повороте значка)."""
    L = 0.0
    for it in items:
        k = it[0]
        if k == 'l': pts = [it[1], it[2]]
        elif k == 'c': pts = [it[1], it[2], it[3], it[4]]
        elif k == 're': r = it[1]; L += 2 * (r.width + r.height); continue
        elif k == 'qu': q = it[1]; pts = [q.ul, q.ur, q.lr, q.ll, q.ul]
        else: continue
        L += sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
    return L

def _pts(items, rm, step=0.3):
    """Точки вдоль контуров пути (pt листа, с поворотом), шаг ~step."""
    out = []
    def seg(a, b):
        n = max(1, int(math.dist(a, b) / step))
        out.extend((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n + 1))
    for it in items:
        k = it[0]
        if k == 'l': ps = [it[1] * rm, it[2] * rm]
        elif k == 'c':
            p0, p1, p2, p3 = (q * rm for q in it[1:5]); ps = []
            for i in range(9):
                t = i / 8; u = 1 - t
                ps.append(fitz_point(u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x, u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y))
        elif k == 're': r = it[1] * rm; ps = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1), (r.x0, r.y0)]
        elif k == 'qu': q = it[1] * rm; ps = [q.ul, q.ur, q.lr, q.ll, q.ul]
        else: continue
        ps = [(float(p[0]), float(p[1])) for p in ps]
        for i in range(len(ps) - 1): seg(ps[i], ps[i + 1])
    return out
def fitz_point(x, y): return (x, y)

def _shape_sig(pts, step=0.3):
    """Подпись формы, не зависящая от поворота и от того, как CAD разбил/продублировал линии:
    длина (по уникальным клеткам сетки), радиус инерции, вытянутость."""
    cells = {(round(x / step), round(y / step)) for x, y in pts}
    if len(cells) < 3: return None
    xs = [c[0] * step for c in cells]; ys = [c[1] * step for c in cells]; n = len(cells)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs) / n; syy = sum((y - my) ** 2 for y in ys) / n; sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / n
    tr = sxx + syy; det = sxx * syy - sxy * sxy; disc = math.sqrt(max(0.0, tr * tr / 4 - det))
    l1, l2 = tr / 2 + disc, tr / 2 - disc
    return dict(L=n * step, rg=math.sqrt(tr), el=(l2 / l1) if l1 > 0 else 1.0, cx=mx, cy=my)

def symbols(work, name, x0, y0, x1, y1, page=0, tol=0.15, color=None):
    """Найти на листе все такие же векторные значки, как в области (x0..y1) — образец (значок из легенды или на плане).
    Значок = соседние линии одного (главного) цвета; сравнение — по форме (длина контуров, радиус, вытянутость),
    не зависит от поворота значка и от того, как CAD разбил линии на куски. Чужие цвета (стена, дверь, выноски) не мешают.
    color — главный цвет вручную (hex, напр. 0000ff), если образец взялся не тот (скрипт печатает цвета в области).
    Найденные добавляются в scan.json как текст «name» в группе «sym:name» — для правил icon/near/by_icon. Повторный запуск с тем же именем заменяет найденное."""
    fitz = _fitz()
    if not fitz: print('Нужен PyMuPDF (pip install pymupdf)'); return
    sc = json.load(open(os.path.join(work, 'scan.json'))); pdf = sc['meta']['pdf']; page = int(page)
    p = fitz.open(pdf)[page]; rm = p.rotation_matrix; _set_hide(sc['meta'])
    x0, y0, x1, y1 = map(float, (x0, y0, x1, y1)); size = max(x1 - x0, y1 - y0)
    paths = []
    for d in p.get_drawings():
        if _hidden(d.get('layer')): continue
        r = d['rect'] * rm
        if r.width > size * 1.5 + 2 or r.height > size * 1.5 + 2: continue  # крупное (стены, рамки надписей) в значок не входит
        c = d.get('color') if d.get('color') is not None else d.get('fill')
        if c is None: continue
        paths.append((_color_hex(c), r, d['items']))
    inside = [q for q in paths if q[1].x0 >= x0 - 1 and q[1].y0 >= y0 - 1 and q[1].x1 <= x1 + 1 and q[1].y1 <= y1 + 1]
    if not inside: print('В области нет векторных элементов — увеличь область (координаты как в scan.json / crop)'); return
    cols = collections.Counter()
    cx0, cy0 = (x0 + x1) / 2, (y0 + y1) / 2
    for hx, r, it in inside:  # главный цвет: больше всего контура ближе к центру области
        w = 1.0 if abs((r.x0 + r.x1) / 2 - cx0) <= (x1 - x0) * 0.35 and abs((r.y0 + r.y1) / 2 - cy0) <= (y1 - y0) * 0.35 else 0.3
        cols[hx] += w * max(0.5, _plen(it, rm))
    main = (color or '').lower().lstrip('#') or cols.most_common(1)[0][0]
    print('Цвета в области (доля контура): ' + ', '.join(f'#{h} {v / sum(cols.values()):.0%}' for h, v in cols.most_common(5)) + f' → главный #{main}')
    tp = [pt for hx, r, it in inside if hx == main for pt in _pts(it, rm)]
    tsig = _shape_sig(tp)
    if not tsig: print(f'Цвета #{main} в области нет'); return
    # все значки главного цвета: соседние (зазор ≤1.5 pt) мелкие пути склеиваются
    L = [q for q in paths if q[0] == main]
    par = list(range(len(L)))
    def f(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    idx = sorted(range(len(L)), key=lambda i: L[i][1].x0); gap = 1.5
    for a in range(len(idx)):
        i = idx[a]
        for b in range(a + 1, len(idx)):
            j = idx[b]
            if L[j][1].x0 > L[i][1].x1 + gap: break
            if L[j][1].y0 <= L[i][1].y1 + gap and L[i][1].y0 <= L[j][1].y1 + gap: par[f(i)] = f(j)
    comp = collections.defaultdict(list)
    for i in range(len(L)): comp[f(i)].append(L[i])
    found = []; near_miss = 0
    for c in comp.values():
        bx0 = min(q[1].x0 for q in c); bx1 = max(q[1].x1 for q in c); by0 = min(q[1].y0 for q in c); by1 = max(q[1].y1 for q in c)
        if max(bx1 - bx0, by1 - by0) > size * 1.6 + 2: continue
        sg = _shape_sig([pt for q in c for pt in _pts(q[2], rm)])
        if not sg: continue
        dL = abs(sg['L'] - tsig['L']) / tsig['L']; dR = abs(sg['rg'] - tsig['rg']) / max(0.5, tsig['rg']); dE = abs(sg['el'] - tsig['el'])
        if dL <= tol and dR <= tol and dE <= 0.15: found.append((sg['cx'], sg['cy']))
        elif dL <= tol * 2.5 and dR <= tol * 2.5: near_miss += 1
    h = size / 2
    sc['spans'] = [q for q in sc['spans'] if q.get('c') != f'sym:{name}']
    for cx, cy in found: sc['spans'].append(dict(t=name, x0=cx - h, y0=cy - h, x1=cx + h, y1=cy + h, color=main, font='значок', size=0, page=page, c=f'sym:{name}'))
    sc['clusters'] = [c for c in sc['clusters'] if c['id'] != f'sym:{name}'] + ([dict(id=f'sym:{name}', color=main, font='значок', size=0, bg='', n=len(found), labelish=0, shapes=[], samples=[name], short=len(found))] if found else [])
    json.dump(sc, open(os.path.join(work, 'scan.json'), 'w'), ensure_ascii=False)
    print(f'Значков «{name}» найдено: {len(found)} (группа sym:{name}). Сверь число с легендой; примеры — work/sym_{name}.png.'
          + (f' Похожих, но не прошедших допуск: {near_miss} — если найдено мало, повтори с tol побольше (последний аргумент, напр. 0.25).' if near_miss else '')
          + ('' if found else ' Ничего не найдено — группа удалена; возьми область точнее (только сам значок) или другой экземпляр, либо задай цвет.'))
    if found:
        try: _sample_sheet(pdf, [dict(page=page, x0=cx - h, y0=cy - h, x1=cx + h, y1=cy + h, t=name) for cx, cy in found], os.path.join(work, f'sym_{name}.png'), f'sym:{name}: {len(found)} шт.')
        except Exception: pass

def layer_stats(pdf):
    """[(слой, число линий/фигур, главный цвет)] — по убыванию."""
    fitz = _fitz()
    if not fitz: return []
    try:
        doc = fitz.open(pdf)
        if not doc.get_ocgs(): return []
        cnt = collections.Counter(); col = collections.defaultdict(collections.Counter)
        for p in doc:
            for d in p.get_drawings():
                L = d.get('layer') or '—'; cnt[L] += 1; col[L]['#' + _color_hex(d.get('color') if d.get('color') is not None else d.get('fill'))] += 1
        names = {v['name'] for v in doc.get_ocgs().values()}
        return [(n, cnt[n], col[n].most_common(1)[0][0] if col[n] else '') for n in sorted(names | set(cnt), key=lambda n: -cnt[n])]
    except Exception: return []

CLUTTER_STRONG = r'KOTERET|HATCH|GRID|AXIS|COLUMN|ZIRIM'
CLUTTER_MAYBE = r'DIM|LEV|FURN|SANIT|MAAKE|TEXT_BEAM|STAIRS|MADREGOT|TRIBUNE|WINDOW'
SYSTEM_LAYERS = r'CCTV|CTV|CAM|ACC|ACS|COMM|TEL|DATA|ALR|ALARM|INT|SEC|BITACHON|LOW|WIFI|AP\b|FIBER|TV'
def clutter_layers(lay):
    """Слои-мусор: серые (архитектура «в подложке»), штриховки, рамки колонн, сетка осей. Слои систем не предлагаются."""
    strong, maybe = [], []
    for n, c, col in lay:
        if not c or re.search(SYSTEM_LAYERS, n, re.I): continue
        h = col.lstrip('#'); gray = len(h) == 6 and h[0:2] == h[2:4] == h[4:6] and 0x60 <= int(h[0:2], 16) <= 0xF0
        if gray or re.search(CLUTTER_STRONG, n, re.I): strong.append(n)
        elif re.search(CLUTTER_MAYBE, n, re.I): maybe.append(n)
    return strong, maybe

def layers(work):
    sc = json.load(open(os.path.join(work, 'scan.json'))); hide = sc['meta'].get('hide', [])
    global _HIDE; _HIDE = hide
    for n, c, col in layer_stats(sc['meta']['pdf']): print(f"{'СКРЫТ  ' if _hidden(n) else ''}{n}\t{c}\t{col}")

def hide(work, regs):
    """Скрыть слои на всех картинках (overview, c/, crop, check). Повторный вызов заменяет список; без regex — показать все."""
    path = os.path.join(work, 'scan.json'); sc = json.load(open(path))
    if 'auto' in regs:  # предложенные scan слои-мусор (точные имена)
        regs = [r for r in regs if r != 'auto'] + ['^' + re.escape(n) + '$' for n in sc['meta'].get('suggest_hide', [])]
    sc['meta']['hide'] = regs; json.dump(sc, open(path, 'w'), ensure_ascii=False); _set_hide(sc['meta'])
    off = [n for n, c, col in layer_stats(sc['meta']['pdf']) if _hidden(n)]
    print(f"Скрыто слоёв: {len(off)}: {', '.join(off) or '—'}")
    render_overview(sc['meta']['pdf'], work, sc['clusters'], sc['spans']); print(f'Перерисовано: {work}/overview.png и c/*.png')

def blobs(work, gap=1.5):
    """Найти все цветные значки (не чёрные и не серые): соседние линии одного цвета склеиваются в значок,
    значки раскладываются по видам (цвет + число линий + длина контура — от поворота не зависит).
    Каждый вид — группа b:kNN в scan.json (для правил icon), картинки b/kNN.png и b/_all.png, список b/blobs.md."""
    fitz = _fitz()
    if not fitz: print('Нужен PyMuPDF (pip install pymupdf)'); return
    sc = json.load(open(os.path.join(work, 'scan.json'))); meta = sc['meta']; pdf = meta['pdf']; _set_hide(meta)
    os.makedirs(os.path.join(work, 'b'), exist_ok=True)
    doc = fitz.open(pdf); found = []
    for pi, p in enumerate(doc):
        rm = p.rotation_matrix; items = collections.defaultdict(list)
        for d in p.get_drawings():
            if _hidden(d.get('layer')): continue
            c = d.get('color') if d.get('color') is not None else d.get('fill')
            if c is None: continue
            hx = _color_hex(c); rgb = [int(hx[i:i + 2], 16) for i in (0, 2, 4)]
            if max(rgb) - min(rgb) < 30: continue  # чёрный/серый — архитектура
            r = d['rect'] * rm
            if r.width > 60 or r.height > 60: continue
            items[hx].append((r.x0, r.y0, r.x1, r.y1, _plen(d['items'], rm)))
        for hx, L in items.items():
            par = list(range(len(L)))
            def f(i):
                while par[i] != i: par[i] = par[par[i]]; i = par[i]
                return i
            idx = sorted(range(len(L)), key=lambda i: L[i][0])
            for a in range(len(idx)):
                i = idx[a]
                for b in range(a + 1, len(idx)):
                    j = idx[b]
                    if L[j][0] > L[i][2] + gap: break
                    if L[j][1] <= L[i][3] + gap and L[i][1] <= L[j][3] + gap: par[f(i)] = f(j)
            comp = collections.defaultdict(list)
            for i in range(len(L)): comp[f(i)].append(L[i])
            for c in comp.values():
                x0, y0 = min(q[0] for q in c), min(q[1] for q in c); x1, y1 = max(q[2] for q in c), max(q[3] for q in c)
                if max(x1 - x0, y1 - y0) > 70: continue
                found.append(dict(page=pi, color=hx, n=len(c), plen=sum(q[4] for q in c), x0=x0, y0=y0, x1=x1, y1=y1))
    # текст внутри значка (буква/цифра в рамке): значки с текстом делятся на виды по цвету + тексту + размеру,
    # без текста — по цвету + числу частей + длине контура (±8%; от поворота не зависит)
    txt = [s for s in sc['spans'] if not str(s.get('c', '')).startswith(('b:', 'sym:')) and len(s['t']) <= 4]
    for b in found:
        t = [s['t'] for s in txt if s['page'] == b['page'] and b['x0'] - 2 <= (s['x0'] + s['x1']) / 2 <= b['x1'] + 2 and b['y0'] - 2 <= (s['y0'] + s['y1']) / 2 <= b['y1'] + 2]
        b['inner'] = ' '.join(sorted(t)); b['sz'] = max(b['x1'] - b['x0'], b['y1'] - b['y0'])
    kinds = []
    for b in sorted(found, key=lambda b: (b['color'], b['inner'], b['n'], b['plen'])):
        if b['inner']: k = next((k for k in kinds if k['color'] == b['color'] and k['inner'] == b['inner'] and abs(k['sz'] - b['sz']) <= 0.25 * k['sz'] + 1), None)
        else: k = next((k for k in kinds if not k['inner'] and k['color'] == b['color'] and k['n'] == b['n'] and abs(k['plen'] - b['plen']) <= 0.08 * k['plen'] + 0.5), None)
        if not k: k = dict(color=b['color'], n=b['n'], plen=b['plen'], inner=b['inner'], sz=b['sz'], items=[]); kinds.append(k)
        k['items'].append(b)
    kinds = [k for k in kinds if k['plen'] >= 6 and (k['inner'] or k['sz'] >= 4)]  # точки/обрывки линий — не значки
    kinds.sort(key=lambda k: (-len(k['items']), k['color']))
    sc['spans'] = [q for q in sc['spans'] if not str(q.get('c', '')).startswith('b:')]
    sc['clusters'] = [c for c in sc['clusters'] if not c['id'].startswith('b:')]
    from PIL import Image, ImageDraw
    lines = [f'# Цветные значки без подписей: {len(kinds)} видов, {sum(len(k["items"]) for k in kinds)} шт.', '',
             'Вид · цвет · частей · размер · сколько · текст внутри значка (если есть) · картинка b/<вид>.png (6 примеров) — сравни с легендой',
             'В числе есть и значки самой легенды — исключи их правилом с area + skip.', '']
    allimg = []
    for i, k in enumerate(kinds, 1):
        kid = f'b:k{i:02d}'; inner = collections.Counter()
        for b in k['items']:
            inner[b['inner']] += 1
            sc['spans'].append(dict(t=b['inner'] or kid[2:], x0=b['x0'], y0=b['y0'], x1=b['x1'], y1=b['y1'], color=k['color'], font='значок', size=0, page=b['page'], c=kid))
        w = sorted(round(max(b['x1'] - b['x0'], b['y1'] - b['y0'])) for b in k['items'])[len(k['items']) // 2]
        sc['clusters'].append(dict(id=kid, color=k['color'], font='значок', size=0, bg='', n=len(k['items']), labelish=0, shapes=[], samples=[kid[2:]], short=len(k['items'])))
        it = ', '.join(f'«{a}»×{n}' for a, n in inner.most_common(4) if a)
        lines.append(f"- **{kid}** · #{k['color']} · {k['n']} · ~{w} pt · **{len(k['items'])}**" + (f' · внутри: {it}' if it else ''))
        ex = [k['items'][int(j * len(k['items']) / 6)] for j in range(min(6, len(k['items'])))]
        crops = []
        for b in ex:
            pad = 25
            cr = render_page(pdf, b['page'], 6.0, clip=(b['x0'] - pad, b['y0'] - pad, b['x1'] + pad, b['y1'] + pad)); d = ImageDraw.Draw(cr)
            d.rectangle([int(pad * 6) - 4, int(pad * 6) - 4, int((b['x1'] - b['x0'] + pad) * 6) + 4, int((b['y1'] - b['y0'] + pad) * 6) + 4], outline=(255, 0, 255), width=3)
            cr.thumbnail((300, 300)); crops.append(cr)
        W = sum(c.width for c in crops) + 10 * len(crops); H = max(c.height for c in crops) + 36
        sheet = Image.new('RGB', (W, H), 'white'); x = 0
        for cr in crops: sheet.paste(cr, (x, 36)); x += cr.width + 10
        ImageDraw.Draw(sheet).text((6, 6), f"{kid[2:]}  #{k['color']}  {len(k['items'])} шт." + (f'  внутри: {it}' if it else ''), fill='black', font=_font(18))
        sheet.save(os.path.join(work, 'b', f'{kid[2:]}.png')); allimg.append((kid[2:], crops[0], len(k['items'])))
    # одна картинка: по одному примеру каждого вида — удобно сверять с легендой
    if allimg:
        cols = 6; cw, ch = 220, 250; rows = (len(allimg) + cols - 1) // cols
        sheet = Image.new('RGB', (cols * cw, rows * ch), 'white'); dr = ImageDraw.Draw(sheet)
        for j, (kid, cr, n) in enumerate(allimg):
            c2 = cr.copy(); c2.thumbnail((cw - 10, ch - 40)); x, y = (j % cols) * cw, (j // cols) * ch
            sheet.paste(c2, (x + 5, y + 34)); dr.text((x + 5, y + 6), f'{kid}: {n} шт.', fill='black', font=_font(20))
        sheet.save(os.path.join(work, 'b', '_all.png'))
    json.dump(sc, open(os.path.join(work, 'scan.json'), 'w'), ensure_ascii=False)
    open(os.path.join(work, 'b', 'blobs.md'), 'w').write('\n'.join(lines))
    print('\n'.join(lines)); print(f'\nКартинки: {work}/b/_all.png (по одному каждого вида), {work}/b/kNN.png')

def find(work, what, group=None):
    """Найти текст (regex) или показать всю группу: текст, группа, координаты (для crop/area/add)."""
    sc = json.load(open(os.path.join(work, 'scan.json')))
    rows = [q for q in sc['spans'] if (q.get('c') == group if group else re.search(what, q['t'], re.I) or re.search(what, q['t'][::-1], re.I))]
    for q in sorted(rows, key=lambda q: (q['page'], q['y0'], q['x0'])):
        print(f"{heb(q['t'])}\t{q.get('c')}\tстр {q['page']}\tx {q['x0']:.0f}..{q['x1']:.0f}\ty {q['y0']:.0f}..{q['y1']:.0f}")
    print(f'— {len(rows)} шт.')

def tiles(pdf, work, n=3):
    """Чертёж без текстового слоя (скан, фото): крупные части n×n с перекрытием 10% — для чтения глазами."""
    os.makedirs(work, exist_ok=True)
    pages, _ = extract(pdf)
    for pi, pg in enumerate(pages):
        img = render_page(pdf, pi, min(6.0, 9000 / pg['w'])); W, H = img.size; ov = 0.1
        for i in range(n):
            for j in range(n):
                box = (int(max(0, (j / n - ov) * W)), int(max(0, (i / n - ov) * H)), int(min(W, ((j + 1) / n + ov) * W)), int(min(H, ((i + 1) / n + ov) * H)))
                part = img.crop(box); part.thumbnail((2400, 2400)); part.save(os.path.join(work, f'tile_p{pi + 1}_r{i + 1}c{j + 1}.png'))
    print(f'Части чертежа: {work}/tile_*.png (ряд r, столбец c; перекрытие 10%)')

def merge(out, files):
    """Несколько файлов точек (по этажам) → один. Повторы обозначений сообщаются."""
    allp = []; seen = {}; dup = []; types = {}; devices = {}
    for f in files:
        d = json.load(open(f))
        for p in d['points']:
            if p['label'] in seen: dup.append(f"{p['label']} ({seen[p['label']]} и {os.path.basename(f)})"); continue
            seen[p['label']] = os.path.basename(f); allp.append(p)
        for t in d.get('types', []): types[t['id']] = t
        for x in d.get('devices', []): devices[x['id']] = x
    res = dict(format='polevoy-points-1', source=' + '.join(os.path.basename(f) for f in files), points=allp)
    if types: res['types'] = list(types.values())
    if devices: res['devices'] = list(devices.values())
    json.dump(res, open(out, 'w'), ensure_ascii=False, indent=1)
    print(f'Точек: {len(allp)} → {out}' + (f"\nПовторы между файлами (взята первая): {', '.join(dup)}" if dup else ''))

if __name__ == '__main__':
    try:
        import signal; signal.signal(signal.SIGPIPE, signal.SIG_DFL)  # «… | head» без BrokenPipe
    except Exception: pass
    if len(sys.argv) >= 2 and sys.argv[1] == 'version': print(VERSION)
    elif len(sys.argv) >= 4 and sys.argv[1] == 'scan': scan(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 5 and sys.argv[1] == 'build': build(sys.argv[2], sys.argv[3], sys.argv[4])
    elif len(sys.argv) >= 4 and sys.argv[1] == 'tiles': tiles(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 3)
    elif len(sys.argv) >= 4 and sys.argv[1] == 'merge': merge(sys.argv[2], sys.argv[3:])
    elif len(sys.argv) >= 4 and sys.argv[1] == 'find': find(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 4 and sys.argv[1] == 'list': find(sys.argv[2], '', group=sys.argv[3])
    elif len(sys.argv) >= 8 and sys.argv[1] == 'symbols':
        opt = [a for a in sys.argv[8:] if not a.startswith('color=')]; col = next((a[6:] for a in sys.argv[8:] if a.startswith('color=')), None)
        symbols(sys.argv[2], sys.argv[3], *sys.argv[4:8], int(opt[0]) if opt else 0, float(opt[1]) if len(opt) > 1 else 0.15, col)
    elif len(sys.argv) >= 3 and sys.argv[1] == 'layers': layers(sys.argv[2])
    elif len(sys.argv) >= 3 and sys.argv[1] == 'hide': hide(sys.argv[2], sys.argv[3:])
    elif len(sys.argv) >= 3 and sys.argv[1] == 'blobs': blobs(sys.argv[2])
    elif len(sys.argv) >= 8 and sys.argv[1] == 'crop': crop(sys.argv[2], *sys.argv[3:7], sys.argv[7], sys.argv[8] if len(sys.argv) > 8 else 0)
    else: print(__doc__)
