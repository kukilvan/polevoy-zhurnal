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
  python3 tohnit.py symbols WORK/ ИМЯ x0 y0 x1 y1 [стр]  → найти все векторные значки как в образце (значки без текста)

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
        if out:
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
        def dup(a):
            k = a['t'].replace(' ', '')
            return any(x['t'].replace(' ', '') == k and a['x0'] - 8 <= (x['x0'] + x['x1']) / 2 <= a['x1'] + 8 and a['y0'] - 8 <= (x['y0'] + x['y1']) / 2 <= a['y1'] + 8 for x in page_txt)
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
    lines += ['', f"overview.png: 1 пиксель = {meta['pages'][0]['w'] / 2400:.3f} pt PDF (для area: x_pt = x_px × это число). Вырезать место крупно: python3 tohnit.py crop PLAN.pdf x0 y0 x1 y1 out.png"]
    open(os.path.join(work, 'clusters.md'), 'w').write('\n'.join(lines))
    render_overview(pdf, work, clusters, allspans)
    print('\n'.join(lines[:60]))
    print(f'\nГотово: {work}/clusters.md, overview*.png, c/<группа>.png (примеры групп с окружением)')

# ---------------------------------------------------------------- картинки
_DL = {}
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
            doc = fitz.open(pdf); p = doc[page]; _DL[key] = (doc, p, p.get_displaylist())
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

def build(work, mapfile, out):
    sc = json.load(open(os.path.join(work, 'scan.json'))); mp = json.load(open(mapfile))
    spans = sc['spans']; meta = sc['meta']
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
            if r.get('area') and not (r['area'][0] <= s['x0'] <= r['area'][2] and r['area'][1] <= s['y0'] <= r['area'][3]): continue
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
    # значки без номеров: нумерация по порядку (сверху вниз, слева направо полосами)
    for prefix, lst in icons.items():
        band = 60
        lst.sort(key=lambda x: (x[0]['page'], round(x[0]['y0'] / band), x[0]['x0']))
        n = 0
        for s, r in lst:
            per = int(r.get('per_icon', 1))
            n += 1; base = f"{prefix}{n:03d}"
            for k in range(per):
                pts.append(dict(label=base if per == 1 else f'{base}.{k + 1}', orig=s['t'], typeId=r['type'], s=s, rule=r, invented=True))
    # шкаф, этаж
    for p in pts:
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

def crop(pdf, x0, y0, x1, y1, out, page=0):
    """Вырезать область чертежа крупно (координаты PDF с учётом поворота, как в scan.json)."""
    x0, y0, x1, y1 = map(float, (x0, y0, x1, y1)); z = min(8.0, 2400 / max(1.0, x1 - x0, y1 - y0))
    render_page(pdf, int(page), z, clip=(x0, y0, x1, y1)).save(out); print(out)

def symbols(work, name, x0, y0, x1, y1, page=0, tol=0.12):
    """Найти на листе все такие же векторные значки, как в области (x0..y1) — образец (например, значок из легенды
    или один значок на плане). Найденные добавляются в scan.json как текст «name» в группе «sym:name» — для правил icon/near."""
    fitz = _fitz()
    if not fitz: print('Нужен PyMuPDF (pip install pymupdf)'); return
    sc = json.load(open(os.path.join(work, 'scan.json'))); pdf = sc['meta']['pdf']; page = int(page)
    p = fitz.open(pdf)[page]; rm = p.rotation_matrix
    x0, y0, x1, y1 = map(float, (x0, y0, x1, y1))
    paths = []
    for d in p.get_drawings():
        r = d['rect'] * rm
        if r.width > 200 or r.height > 200: continue
        sig = (_color_hex(d.get('fill')) if d.get('fill') is not None else '', _color_hex(d.get('color')) if d.get('color') is not None else '', ''.join(it[0] for it in d['items']))
        paths.append((sig, r.x0, r.y0, r.x1, r.y1))
    tpl = [q for q in paths if q[1] >= x0 - 1 and q[2] >= y0 - 1 and q[3] <= x1 + 1 and q[4] <= y1 + 1]
    if not tpl: print('В области нет векторных элементов — увеличь область'); return
    size_ok = lambda a, b: abs((a[3] - a[1]) - (b[3] - b[1])) <= tol * max(1, b[3] - b[1]) + 0.3 and abs((a[4] - a[2]) - (b[4] - b[2])) <= tol * max(1, b[4] - b[2]) + 0.3
    anchor = max(tpl, key=lambda q: (q[3] - q[1]) * (q[4] - q[2]))
    ac = ((anchor[1] + anchor[3]) / 2, (anchor[2] + anchor[4]) / 2)
    others = [q for q in tpl if q is not anchor]
    grid = collections.defaultdict(list)
    for q in paths: grid[(q[0], int((q[1] + q[3]) / 20), int((q[2] + q[4]) / 20))].append(q)
    found = []
    for c in paths:
        if c[0] != anchor[0] or not size_ok(c, anchor): continue
        dx, dy = (c[1] + c[3]) / 2 - ac[0], (c[2] + c[4]) / 2 - ac[1]
        ok = 0
        for q in others:
            tx, ty = (q[1] + q[3]) / 2 + dx, (q[2] + q[4]) / 2 + dy
            cand = [z for gx in (int(tx * 2 / 20) - 1, int(tx * 2 / 20), int(tx * 2 / 20) + 1) for gy in (int(ty * 2 / 20) - 1, int(ty * 2 / 20), int(ty * 2 / 20) + 1) for z in grid.get((q[0], gx, gy), [])]
            if any(abs((z[1] + z[3]) / 2 - tx) < 1.5 and abs((z[2] + z[4]) / 2 - ty) < 1.5 and size_ok(z, q) for z in cand): ok += 1
        if not others or ok >= 0.8 * len(others):
            box = (x0 + dx, y0 + dy, x1 + dx, y1 + dy)
            if any(abs(b[0] - box[0]) < 2 and abs(b[1] - box[1]) < 2 for b in found): continue
            found.append(box)
    found = [b for b in found if not (abs(b[0] - x0) < 2 and abs(b[1] - y0) < 2)]  # сам образец не считаем
    sc['spans'] = [q for q in sc['spans'] if q.get('c') != f'sym:{name}']
    for b in found: sc['spans'].append(dict(t=name, x0=b[0], y0=b[1], x1=b[2], y1=b[3], color='', font='значок', size=0, page=page, c=f'sym:{name}'))
    sc['clusters'] = [c for c in sc['clusters'] if c['id'] != f'sym:{name}'] + [dict(id=f'sym:{name}', color='', font='значок', size=0, bg='', n=len(found), labelish=0, shapes=[], samples=[name], short=len(found))]
    json.dump(sc, open(os.path.join(work, 'scan.json'), 'w'), ensure_ascii=False)
    print(f'Значков «{name}» найдено: {len(found)} (группа sym:{name}). Образец {len(tpl)} элементов. Проверь число по легенде и на check.png после build.')

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
    if len(sys.argv) >= 4 and sys.argv[1] == 'scan': scan(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 5 and sys.argv[1] == 'build': build(sys.argv[2], sys.argv[3], sys.argv[4])
    elif len(sys.argv) >= 4 and sys.argv[1] == 'tiles': tiles(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 3)
    elif len(sys.argv) >= 4 and sys.argv[1] == 'merge': merge(sys.argv[2], sys.argv[3:])
    elif len(sys.argv) >= 8 and sys.argv[1] == 'symbols': symbols(sys.argv[2], sys.argv[3], *sys.argv[4:8], *(sys.argv[8:9]))
    elif len(sys.argv) >= 8 and sys.argv[1] == 'crop': crop(sys.argv[2], *sys.argv[3:7], sys.argv[7], sys.argv[8] if len(sys.argv) > 8 else 0)
    else: print(__doc__)
