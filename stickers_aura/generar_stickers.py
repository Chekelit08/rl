"""Stickers AURA FC: toma los diseños base de ChatGPT, reemplaza nombre y número,
y agrega borde blanco de sticker con fondo transparente."""
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

D = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(D, '..', 'images')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, 'out')
ONLY = sys.argv[2] if len(sys.argv) > 2 else None
os.makedirs(OUT, exist_ok=True)
FONT = os.path.join(D, 'fonts', 'HeavenVarsity.ttf')
K = 2  # escala de salida

PLAYERS = [(1, 'CHIMBO'), (2, 'LESO'), (3, 'FELICHO'), (4, 'GABY'), (5, 'FACU'), (6, 'MATU'),
           (7, 'TOMY'), (8, 'EZE'), (9, 'COMPA'), (14, 'SANTY'), (17, 'JUANCHY'), (18, 'FRANCO'),
           (19, 'PINI'), (20, 'ARI')]

ad = Image.open(os.path.join(D, 'res', 'adidas.png')).convert('L')
ADIDAS = ad.crop(ad.getbbox())  # blanco sobre negro -> máscara


def load(name):
    im = Image.open(os.path.join(IMG, name)).convert('RGB')
    return im.resize((im.width * K, im.height * K), Image.LANCZOS)


def s(v):
    return int(round(v * K))


def text_mask(txt, cap_h, max_w, letter_sp=0):
    """Máscara (L) del texto con altura de mayúscula cap_h, comprimida a max_w si hace falta."""
    ss = 4
    size = 400
    f = ImageFont.truetype(FONT, size)
    # medir
    widths = [f.getbbox(ch) for ch in txt]
    total = sum(f.getlength(ch) for ch in txt) + letter_sp * size * (len(txt) - 1)
    bb = f.getbbox(txt)
    h = bb[3] - bb[1]
    W = int(total + size)
    im = Image.new('L', (W, int(size * 1.6)), 0)
    d = ImageDraw.Draw(im)
    x = size // 2
    for ch in txt:
        d.text((x, size * 0.1), ch, font=f, fill=255)
        x += f.getlength(ch) + letter_sp * size
    im = im.crop(im.getbbox())
    scale = cap_h / im.height
    w = im.width * scale
    sx = min(1.0, max_w / w)
    return im.resize((max(1, int(round(w * sx))), int(round(cap_h))), Image.LANCZOS)


def dilate(mask, r):
    """Dilatación cuadrada (conserva esquinas en ángulo, como las del diseño)."""
    if r <= 0:
        return mask
    out = mask
    while r > 0:
        k = min(r, 5)
        out = out.filter(ImageFilter.MaxFilter(2 * k + 1))
        r -= k
    return out


def paste_layers(base, mask, cx, top, layers):
    """layers: lista [(color, expand_px)] de afuera hacia adentro; el último es el relleno (0)."""
    pad = max(e for _, e in layers) + 4
    m = Image.new('L', (mask.width + 2 * pad, mask.height + 2 * pad), 0)
    m.paste(mask, (pad, pad))
    x0 = int(round(cx - m.width / 2))
    y0 = int(round(top - pad))
    for color, e in layers:
        mm = dilate(m, e)
        base.paste(Image.new('RGB', m.size, color), (x0, y0), mm)
    return (x0 + pad, y0 + pad, mask.width, mask.height, mask)


def add_adidas(base, box, color, h):
    x, y, w, hh, mask = box
    lg = ADIDAS.resize((int(ADIDAS.width * h / ADIDAS.height), h), Image.LANCZOS)
    by = y + hh - s(14)
    # buscar el tramo relleno más ancho en la franja donde va el logo
    m = np.asarray(mask) > 128
    band = m[hh - s(14) - h - s(4): hh - s(14) + 1].all(axis=0)
    best, cur, bx = 0, 0, w / 2
    for i, v in enumerate(band):
        cur = cur + 1 if v else 0
        if cur > best:
            best, bx = cur, i - cur / 2
    cx = x + bx
    base.paste(Image.new('RGB', lg.size, color), (int(cx - lg.width / 2), int(by - lg.height)), lg)


def restore_cols(img, box, ref_rows):
    """Rellena un rectángulo copiando, columna por columna, el color de filas de referencia
    (las rayas son verticales)."""
    a = np.asarray(img).copy()
    x0, y0, x1, y1 = [s(v) for v in box]
    r0, r1 = s(ref_rows[0]), s(ref_rows[1])
    ref = np.median(a[r0:r1, x0:x1], axis=0).astype(np.uint8)
    a[y0:y1, x0:x1] = ref[None, :, :]
    return Image.fromarray(a)


def fill_rect(img, box, color):
    d = ImageDraw.Draw(img)
    d.rectangle([s(v) for v in box], fill=color)
    return img



# ---- números en bloque estilo college (como los del diseño): esquinas cortadas a 45°
DW, DH, T, V, CH = 100, 180, 28, 34, 15
MID = (76, 104)
def _digit_rects(d):
    W, H = DW, DH
    top = (0, 0, W, T); bot = (0, H - T, W, H); mid = (0, MID[0], W, MID[1])
    L = (0, 0, V, H); R = (W - V, 0, W, H)
    Lu = (0, 0, V, MID[1]); Ll = (0, MID[0], V, H); Ru = (W - V, 0, W, MID[1]); Rl = (W - V, MID[0], W, H)
    earLt = (0, 0, V, 54); earLb = (0, H - 54, V, H); earRt = (W - V, 0, W, 54)
    return {
        '0': [top, bot, L, R],
        '1': [(30, 0, 30 + V + 4, H), (8, 0, 34, T + 6)],
        '2': [top, Ru, mid, Ll, bot, earLt],
        '3': [top, (22, MID[0], W, MID[1]), bot, R, earLt, earLb],
        '4': [(0, 0, V, 118), (0, 90, W, 118), (W - V, 0, W, H)],
        '5': [top, Lu, mid, Rl, bot, earLb],
        '6': [top, L, mid, Rl, bot, earRt],
        '7': [top, (W - V, 0, W, H), earLt],
        '8': [top, bot, L, R, mid],
        '9': [top, Lu, mid, R, bot, earLb],
    }[d]

def number_mask(txt, h, max_w):
    k = 8  # escala de dibujo
    gap = 12
    widths = [(68 if ch == '1' else DW) for ch in txt]
    total = sum(widths) + gap * (len(txt) - 1)
    im = Image.new('L', (total * k, DH * k), 0)
    d = ImageDraw.Draw(im)
    x = 0
    for ch, w in zip(txt, widths):
        g = Image.new('L', (DW * k, DH * k), 0); gd = ImageDraw.Draw(g)
        for (a, b, c_, e) in _digit_rects(ch):
            gd.rectangle([a * k, b * k, c_ * k - 1, e * k - 1], fill=255)
        bb = g.getbbox()
        # chaflanes en las 4 esquinas exteriores
        x0, y0, x1, y1 = bb; c = CH * k
        for tri in [[(x0, y0), (x0 + c, y0), (x0, y0 + c)], [(x1, y0), (x1 - c, y0), (x1, y0 + c)],
                    [(x0, y1), (x0 + c, y1), (x0, y1 - c)], [(x1, y1), (x1 - c, y1), (x1, y1 - c)]]:
            gd.polygon(tri, fill=0)
        if ch == '1':
            g = g.crop((bb[0], 0, bb[0] + w * k, DH * k))
        else:
            g = g.crop((0, 0, w * k, DH * k))
        im.paste(g, (x * k, 0))
        x += w + gap
    im = im.crop(im.getbbox())
    sc = h / im.height
    wpx = im.width * sc
    sx = min(1.0, max_w / wpx)
    return im.resize((max(1, int(round(wpx * sx))), int(round(h))), Image.LANCZOS)

# ----------------------------------------------------------------- vistas
BLACK = (12, 12, 12)
WHITE = (250, 250, 250)
INK = (17, 17, 17)
CX = 543  # centro de la camiseta


def espalda_negra(num, name):
    im = load('9.webp')
    fill_rect(im, (366, 338, 724, 434), BLACK)
    fill_rect(im, (406, 472, 680, 952), BLACK)
    nm = text_mask(name, s(73), s(400))
    paste_layers(im, nm, s(CX), s(349), [(WHITE, 0)])
    nb = number_mask(str(num), s(459 if num < 10 else 430), s(400))
    box = paste_layers(im, nb, s(CX), s(482 if num < 10 else 496), [(WHITE, s(10)), (BLACK, s(5)), (WHITE, 0)])
    add_adidas(im, box, BLACK, s(24))
    return im


def espalda_blanca(num, name):
    im = load('7.webp')
    im = restore_cols(im, (380, 402, 708, 508), (985, 1030))
    im = restore_cols(im, (420, 515, 672, 962), (985, 1030))
    nm = text_mask(name, s(74), s(400))
    paste_layers(im, nm, s(CX), s(416), [(WHITE, s(7)), (INK, 0)])
    nb = number_mask(str(num), s(408 if num < 10 else 385), s(370))
    box = paste_layers(im, nb, s(CX), s(538 if num < 10 else 550), [(WHITE, s(16)), (INK, s(10)), (WHITE, s(5)), (INK, 0)])
    add_adidas(im, box, WHITE, s(22))
    return im


def frente_bastones(num, name):
    im = load('10.webp')
    im = restore_cols(im, (484, 526, 606, 730), (735, 760))
    nb = number_mask(str(num), s(177 if num < 10 else 145), s(156))
    paste_layers(im, nb, s(545), s(539 if num < 10 else 555), [(INK, s(5)), (WHITE, 0)])
    return im


VIEWS = [('espalda_negra', espalda_negra, 253), ('frente_bastones', frente_bastones, 253),
         ('espalda_blanca', espalda_blanca, 224)]
if os.path.exists(os.path.join(IMG, 'frente_blanca.png')):
    pass  # se agrega cuando llegue el archivo


# ----------------------------------------------------------------- sticker
def sticker(im, bg_level, border=s(34)):
    a = np.asarray(im).astype(int)
    near = (np.abs(a - bg_level).max(axis=2) < 14).astype(np.uint8) * 255
    # flood fill del fondo desde los bordes
    region = near > 0
    bgm = np.zeros_like(region)
    bgm[0, :] = region[0, :]; bgm[-1, :] = region[-1, :]; bgm[:, 0] = region[:, 0]; bgm[:, -1] = region[:, -1]
    while True:
        g = bgm.copy()
        g[1:] |= bgm[:-1]; g[:-1] |= bgm[1:]; g[:, 1:] |= bgm[:, :-1]; g[:, :-1] |= bgm[:, 1:]
        g &= region
        if (g == bgm).all():
            break
        bgm = g
    fg = Image.fromarray((~bgm).astype(np.uint8) * 255, 'L')
    fg = fg.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    # borde blanco redondeado
    bord = fg.filter(ImageFilter.GaussianBlur(border * 0.55)).point(lambda v: 255 if v > 6 else 0)
    bord = bord.filter(ImageFilter.GaussianBlur(1.5))
    pad = border + s(30)
    W, H = im.width + 2 * pad, im.height + 2 * pad
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    def padded(mask):
        c = Image.new('L', (W, H), 0)
        c.paste(mask, (pad, pad))
        return c
    # recalcular borde en lienzo con margen (para que no se corte)
    fgp = padded(fg)
    bordp = fgp.filter(ImageFilter.GaussianBlur(border * 0.55)).point(lambda v: 255 if v > 6 else 0).filter(ImageFilter.GaussianBlur(1.5))
    shadow = bordp.filter(ImageFilter.GaussianBlur(s(8))).point(lambda v: int(v * 0.30))
    canvas.paste((0, 0, 0, 255), (0, s(5)), shadow.crop((0, 0, W, H - s(5))))
    canvas.paste((255, 255, 255, 255), (0, 0), bordp)
    jer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    jer.paste(im, (pad, pad))
    canvas.paste(jer, (0, 0), fgp)
    return canvas.crop(canvas.getbbox())


for num, name in PLAYERS:
    if ONLY and name != ONLY:
        continue
    for vname, fn, bg in VIEWS:
        st = sticker(fn(num, name), bg)
        p = os.path.join(OUT, f'{num:02d}_{name}_{vname}.png')
        st.save(p, optimize=True)
        print(p)
