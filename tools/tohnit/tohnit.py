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
  python3 tohnit.py blobs WORK/                       → сам найти все цветные значки без подписей и разложить по видам (b/…png)

Нужен PyMuPDF (pip install pymupdf) или pdfplumber (обычно уже установлен) + Pillow.
"""
import json, os, re, sys, math, collections

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

def merge_spans(spans):
    """Соседние фрагменты одной строки и одного стиля («TV» «140», «ACP» «PUP-A1») склеиваются в один (через пробел)."""
    key = lambda s: (s['color'], s['font'], s['size'])
    spans = sorted(spans, key=lambda s: (key(s), round((s['y0'] + s['y1']) / 2, 0), s['x0']))
    out = []
    for s in spans:
        if s['font'].startswith('аннотация'):  # подпись-аннотация — всегда целый текст, с соседями не склеиваем («C» «C», «H=90» «A»)
            out.append(dict(s)); continue
        if out and not out[-1]['font'].startswith('аннотация'):
            o = out[-1]
            same = key(o) == key(s) and abs((o['y0'] + o['y1']) / 2 - (s['y0'] + s['y1']) / 2) < s['size'] * 0.3
            gap = s['x0'] - o['x1']
            if same and -0.1 * s['size'] <= gap <= 0.6 * s['size']:
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
        lines += ['', f'## Слои чертежа: {len(lay)} (полный список: python3 tohnit.py layers WORK/)',
                  'Мешающие слои (рамки колонн, штриховки, сетка осей, размеры) можно скрыть на всех картинках: python3 tohnit.py hide WORK/ \'KOTERET|Hatch\'. Крупнейшие:']
        lines += [f'- {n}: {c} шт., цвет {col}' for n, c, col in lay[:15]]
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

def build(work, mapfile, out):
    sc = json.load(open(os.path.join(work, 'scan.json'))); mp = json.load(open(mapfile))
    spans = sc['spans']; meta = sc['meta']
    _set_hide(meta, mp.get('hide_layers', []))
    rules = mp.get('rules', [])
    renames = [(re.compile(a), b) for a, b in mp.get('rename', [])]
    cab_re = re.compile(mp['cabinet_regex']) if mp.get('cabinet_regex') else None
    used_clusters = {c for r in rules for c in (r.get('clusters') or [])}
    pts = []; unknown = []; skipped = collections.Counter(); icons = collections.defaultdict(list); nears = []; near_log = []
    for s in spans:
        t = s['t'].strip()
        rule = None
        for r in rules:
            if r.get('clusters') and s['c'] not in r['clusters']: continue
            if r.get('match') and not re.search(r['match'], t): continue
            if r.get('page') is not None and s['page'] != r['page']: continue
            if r.get('area') and not (r['area'][0] <= (s['x0'] + s['x1']) / 2 <= r['area'][2] and r['area'][1] <= (s['y0'] + s['y1']) / 2 <= r['area'][3]): continue  # по центру текста
            rule = r; break
        if rule is None:
            if s['c'] in used_clusters and labelish(t): unknown.append(s)
            continue
        if rule.get('skip'): skipped[rule.get('why', 'skip')] += 1; continue
        if rule.get('near'):
            nears.append((s, rule)); continue
        if rule.get('icon'):
            icons[rule.get('prefix', 'X')].append((s, rule)); continue
        label = t.replace(' ', '')
        for rx, rep in renames: label = rx.sub(rep, label)
        pts.append(dict(label=label, orig=t, typeId=rule['type'], s=s, rule=rule))
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
    # значки без номеров: каждый вид (prefix) с 1, от края start (по умолчанию слева) к другому краю; соседние номера — рядом.
    # order: path (по умолчанию, цепочка по соседям) | snake (полосы туда-обратно) | rows (строками)
    for prefix, lst in icons.items():
        r0 = lst[0][1] if lst else {}
        order = r0.get('order', mp.get('order', 'path')); start = r0.get('start', mp.get('start', 'left'))
        digits = int(r0.get('digits', mp.get('digits', 2)))
        lst = _zoned(lst, mp, r0, start) if order == 'path' else _snake(lst, start, r0.get('strips', mp.get('strips'))) if order == 'snake' else sorted(lst, key=lambda x: (x[0]['page'], round(x[0]['y0'] / 60), x[0]['x0']))
        n = 0
        for s, r in lst:
            per = int(r.get('per_icon', 1))
            n += 1; base = f"{prefix}{n:0{digits}d}"
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
        pdata.append(d)
    res = dict(format='polevoy-points-1', source=f"{os.path.basename(meta['pdf'])}" + (f", этаж {floor}" if floor else ''), floor=floor, points=pdata)
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
        colors = {}; drawn = set()
        pal = [(0, 170, 0), (0, 110, 255), (200, 0, 200), (255, 120, 0), (0, 160, 160), (120, 60, 0), (90, 90, 90)]
        for p in final:
            s = p.get('s')
            if not s or s['page'] != pi: continue
            col = colors.setdefault(p['typeId'], pal[len(colors) % len(pal)])
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
    """Копия чертежа PDF: мешающие слои убраны, у каждой точки — рамка цвета типа, у придуманных номеров — подпись.
    Это обычный векторный PDF: масштабируется без потери, номера можно переносить на чертёж или печатать."""
    fitz = _fitz()
    if not fitz: print('PDF с номерами: нужен PyMuPDF'); return
    doc = fitz.open(meta['pdf'])
    ocgs = doc.get_ocgs() if hasattr(doc, 'get_ocgs') else {}
    hidden = {x for x, v in ocgs.items() if _hidden(v['name'])}
    if hidden:
        try: doc.set_layer(-1, off=list(hidden))  # и в настройках слоёв PDF выключены
        except Exception: pass
    pal = [(0, 0.6, 0), (0, 0.4, 1), (0.8, 0, 0.8), (1, 0.45, 0), (0, 0.6, 0.6), (0.5, 0.25, 0), (0.35, 0.35, 0.35)]
    colors = {}
    for pi, p in enumerate(doc):
        if hidden: _strip_layers(doc, p, hidden)
        dm = p.derotation_matrix; drawn = set()
        pts = [q for q in final if q.get('s') and q['s']['page'] == pi]
        if not pts: continue
        hs = sorted(max(q['s']['x1'] - q['s']['x0'], q['s']['y1'] - q['s']['y0']) for q in pts)
        fs = max(3.0, min(14.0, hs[len(hs) // 2] * 0.9))  # размер подписи — как значок
        for q in pts:
            sp = q['s']; col = colors.setdefault(q['typeId'], pal[len(colors) % len(pal)])
            r = fitz.Rect(sp['x0'] - 1, sp['y0'] - 1, sp['x1'] + 1, sp['y1'] + 1)
            p.draw_rect(r * dm, color=col, width=max(0.4, fs / 10), overlay=True)
            if not (q.get('invented') or q.get('dup')): continue
            lab = re.sub(r'\.\d+$', '', q['label']) if q.get('invented') else q['label']
            key = (round(sp['x0']), round(sp['y0']), lab)
            if key in drawn: continue
            drawn.add(key)
            w = fitz.get_text_length(lab, fontname='hebo', fontsize=fs)
            x = sp['x1'] + 1.5; cy = (sp['y0'] + sp['y1']) / 2
            box = fitz.Rect(x - 0.5, cy - fs * 0.62, x + w + 0.8, cy + fs * 0.5)
            p.draw_rect(box * dm, color=None, fill=(1, 1, 1), fill_opacity=0.85, overlay=True)
            p.insert_text(fitz.Point(x, cy + fs * 0.35) * dm, lab, fontsize=fs, fontname='hebo',
                          color=(0.85, 0, 0) if q.get('dup') else col, rotate=p.rotation, overlay=True)
    doc.save(out_pdf, garbage=3, deflate=True)
    print(f'PDF с номерами: {out_pdf}' + (f' (убраны слои: {len(hidden)})' if hidden else ''))

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

def symbols(work, name, x0, y0, x1, y1, page=0, tol=0.12):
    """Найти на листе все такие же векторные значки, как в области (x0..y1) — образец (значок из легенды или на плане).
    Сравнение не зависит от поворота значка (длина контуров + расстояния между частями).
    Найденные добавляются в scan.json как текст «name» в группе «sym:name» — для правил icon/near. Повторный запуск с тем же именем заменяет найденное."""
    fitz = _fitz()
    if not fitz: print('Нужен PyMuPDF (pip install pymupdf)'); return
    sc = json.load(open(os.path.join(work, 'scan.json'))); pdf = sc['meta']['pdf']; page = int(page)
    p = fitz.open(pdf)[page]; rm = p.rotation_matrix; _set_hide(sc['meta'])
    x0, y0, x1, y1 = map(float, (x0, y0, x1, y1))
    paths = []
    for d in p.get_drawings():
        if _hidden(d.get('layer')): continue
        r = d['rect'] * rm
        if r.width > 300 or r.height > 300: continue
        sig = (_color_hex(d.get('fill')) if d.get('fill') is not None else '', _color_hex(d.get('color')) if d.get('color') is not None else '', ''.join(sorted(it[0] for it in d['items'])))
        paths.append((sig, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, _plen(d['items'], rm), r))
    tpl = [q for q in paths if q[4].x0 >= x0 - 1 and q[4].y0 >= y0 - 1 and q[4].x1 <= x1 + 1 and q[4].y1 <= y1 + 1]
    if not tpl: print('В области нет векторных элементов — увеличь область'); return
    same = lambda a, b: a[0] == b[0] and abs(a[3] - b[3]) <= tol * max(1.0, b[3]) + 0.5
    anchor = max(tpl, key=lambda q: q[3])
    # части значка — того же цвета, что главный контур (стрелки-выноски, штриховка мебели в образец не входят)
    others = [q for q in tpl if q is not anchor and (q[0][0], q[0][1]) == (anchor[0][0], anchor[0][1])]
    tpl = [anchor] + others
    rad = [(q, math.dist((q[1], q[2]), (anchor[1], anchor[2]))) for q in others]
    grid = collections.defaultdict(list)
    for q in paths: grid[(int(q[1] // 30), int(q[2] // 30))].append(q)
    size = max(x1 - x0, y1 - y0)
    found = []
    for c in paths:
        if not same(c, anchor): continue
        near = [z for gx in range(int((c[1] - size) // 30), int((c[1] + size) // 30) + 1) for gy in range(int((c[2] - size) // 30), int((c[2] + size) // 30) + 1) for z in grid.get((gx, gy), [])]
        ok = sum(1 for q, rq in rad if any(same(z, q) and abs(math.dist((z[1], z[2]), (c[1], c[2])) - rq) <= max(1.5, 0.1 * rq) for z in near))
        if not others or ok >= 0.8 * len(others):
            if any(math.dist((b[0], b[1]), (c[1], c[2])) < 2 for b in found): continue
            found.append((c[1], c[2]))
    # сам образец тоже считается (если он из легенды — исключи легенду правилом area + skip, как и другие её значки)
    h = size / 2
    sc['spans'] = [q for q in sc['spans'] if q.get('c') != f'sym:{name}']
    for cx, cy in found: sc['spans'].append(dict(t=name, x0=cx - h, y0=cy - h, x1=cx + h, y1=cy + h, color='', font='значок', size=0, page=page, c=f'sym:{name}'))
    sc['clusters'] = [c for c in sc['clusters'] if c['id'] != f'sym:{name}'] + ([dict(id=f'sym:{name}', color='', font='значок', size=0, bg='', n=len(found), labelish=0, shapes=[], samples=[name], short=len(found))] if found else [])
    json.dump(sc, open(os.path.join(work, 'scan.json'), 'w'), ensure_ascii=False)
    print(f'Значков «{name}» найдено: {len(found)} (группа sym:{name}; образец из {len(tpl)} элементов). Сверь число с легендой и посмотри на check.png после build.'
          + ('' if found else ' Ничего не найдено — группа удалена; попробуй образец точнее (только сам значок) или другой экземпляр.'))

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

def layers(work):
    sc = json.load(open(os.path.join(work, 'scan.json'))); hide = sc['meta'].get('hide', [])
    global _HIDE; _HIDE = hide
    for n, c, col in layer_stats(sc['meta']['pdf']): print(f"{'СКРЫТ  ' if _hidden(n) else ''}{n}\t{c}\t{col}")

def hide(work, regs):
    """Скрыть слои на всех картинках (overview, c/, crop, check). Повторный вызов заменяет список; без regex — показать все."""
    path = os.path.join(work, 'scan.json'); sc = json.load(open(path))
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
    if len(sys.argv) >= 4 and sys.argv[1] == 'scan': scan(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 5 and sys.argv[1] == 'build': build(sys.argv[2], sys.argv[3], sys.argv[4])
    elif len(sys.argv) >= 4 and sys.argv[1] == 'tiles': tiles(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 3)
    elif len(sys.argv) >= 4 and sys.argv[1] == 'merge': merge(sys.argv[2], sys.argv[3:])
    elif len(sys.argv) >= 4 and sys.argv[1] == 'find': find(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 4 and sys.argv[1] == 'list': find(sys.argv[2], '', group=sys.argv[3])
    elif len(sys.argv) >= 8 and sys.argv[1] == 'symbols': symbols(sys.argv[2], sys.argv[3], *sys.argv[4:8], *(sys.argv[8:9]))
    elif len(sys.argv) >= 3 and sys.argv[1] == 'layers': layers(sys.argv[2])
    elif len(sys.argv) >= 3 and sys.argv[1] == 'hide': hide(sys.argv[2], sys.argv[3:])
    elif len(sys.argv) >= 3 and sys.argv[1] == 'blobs': blobs(sys.argv[2])
    elif len(sys.argv) >= 8 and sys.argv[1] == 'crop': crop(sys.argv[2], *sys.argv[3:7], sys.argv[7], sys.argv[8] if len(sys.argv) > 8 else 0)
    else: print(__doc__)
