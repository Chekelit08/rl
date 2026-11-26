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
    nb = text_mask(str(num), s(459), s(330 if num >= 10 else 260))
    box = paste_layers(im, nb, s(CX), s(482), [(WHITE, s(10)), (BLACK, s(5)), (WHITE, 0)])
    add_adidas(im, box, BLACK, s(24))
    return im


def espalda_blanca(num, name):
    im = load('7.webp')
    im = restore_cols(im, (380, 402, 708, 508), (985, 1030))
    im = restore_cols(im, (420, 515, 672, 962), (985, 1030))
    nm = text_mask(name, s(74), s(400))
    paste_layers(im, nm, s(CX), s(416), [(WHITE, s(7)), (INK, 0)])
    nb = text_mask(str(num), s(408), s(310 if num >= 10 else 222))
    box = paste_layers(im, nb, s(CX), s(538), [(WHITE, s(16)), (INK, s(10)), (WHITE, s(5)), (INK, 0)])
    add_adidas(im, box, WHITE, s(22))
    return im


def frente_bastones(num, name):
    im = load('10.webp')
    im = restore_cols(im, (484, 526, 606, 730), (735, 760))
    nb = text_mask(str(num), s(170), s(120 if num >= 10 else 86))
    paste_layers(im, nb, s(545), s(542), [(INK, s(5)), (WHITE, 0)])
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
