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



# ---- números en bloque calcados del "3" del diseño original (medidas tomadas del 3 de ChatGPT)
DW, DH = 100, 203
HB, VS = 31, 27          # grosor barras horizontales / verticales
M0, M1 = 84, 112         # barra del medio
EAR = 46                 # largo de las "orejas" (puntas cortas)
C = 20                   # chaflán de esquinas exteriores
NOTCH = 10               # muesca en V del costado (como el 3)

def _glyph(d):
    W, H = DW, DH
    R = []; cuts = []; vs = []
    top = (0, 0, W, HB); bot = (0, H - HB, W, H)
    L = (0, 0, VS, H); Rr = (W - VS, 0, W, H)
    std = [(0, 0, -1, -1), (W, 0, 1, -1), (0, H, -1, 1), (W, H, 1, 1)]
    if d == '0': R = [top, bot, L, Rr]; cuts = std
    elif d == '1':
        R = [(36, 0, 36 + VS, H), (12, 0, 36 + VS, HB)]; cuts = [(12, 0, -1, -1), (36 + VS, 0, 1, -1), (36, H, -1, 1), (36 + VS, H, 1, 1)]
        cuts = [(12, 0, -1, -1), (36 + VS, 0, 1, -1, 8), (36, H, -1, 1, 8), (36 + VS, H, 1, 1, 8)]
    elif d == '2':
        R = [top, (0, 0, VS, EAR), (W - VS, 0, W, M1), (0, M0, W, M1), (0, M0, VS, H), bot]
        cuts = std + [(W, M1, 1, 1)]
    elif d == '3':
        R = [top, (0, 0, VS, EAR), (29, M0, W, M1), Rr, (0, H - EAR, VS, H), bot]
        cuts = std; vs = ['R']
    elif d == '4':
        R = [(0, 0, VS, 130), (0, 102, W, 130), (60, 0, 60 + VS, H)]
        cuts = [(0, 0, -1, -1), (60 + VS, 0, 1, -1, 8), (0, 130, -1, 1, 8), (60, H, -1, 1, 8), (60 + VS, H, 1, 1, 8)]
    elif d == '5':
        R = [top, (0, 0, VS, M1), (0, M0, W, M1), (W - VS, M0, W, H), bot, (0, H - EAR, VS, H)]
        cuts = std + [(W, M0, 1, -1)]
    elif d == '6':
        R = [top, (W - VS, 0, W, EAR), L, (0, M0, W, M1), (W - VS, M0, W, H), bot]
        cuts = std + [(W, M0, 1, -1)]
    elif d == '7':
        R = [top, (0, 0, VS, EAR), (W - VS, 0, W, H)]
        cuts = [(0, 0, -1, -1), (W, 0, 1, -1), (W - VS, H, -1, 1, 8), (W, H, 1, 1, 8)]
    elif d == '8':
        R = [top, bot, L, Rr, (0, M0, W, M1)]; cuts = std; vs = ['L', 'R']
    elif d == '9':
        R = [top, (0, 0, VS, M1), (0, M0, W, M1), Rr, bot, (0, H - EAR, VS, H)]
        cuts = std + [(0, M1, -1, 1)]
    return R, cuts, vs

def number_mask(txt, h, max_w):
    k = 8
    gap = 14
    imgs = []
    for ch in txt:
        g = Image.new('L', (DW * k, DH * k), 0); gd = ImageDraw.Draw(g)
        R, cuts, vs = _glyph(ch)
        for (a, b, c_, e) in R:
            gd.rectangle([a * k, b * k, c_ * k - 1, e * k - 1], fill=255)
        for cut in cuts:
            x, y, dx, dy = cut[:4]; cc = cut[4] if len(cut) > 4 else C
            gd.polygon([(x * k, y * k), ((x - dx * cc) * k, y * k), (x * k, (y - dy * cc) * k)], fill=0)
        mid = (M0 + M1) / 2
        for side in vs:
            if side == 'R':
                gd.polygon([(DW * k, (M0 - 3) * k), ((DW - NOTCH) * k, mid * k), (DW * k, (M1 + 3) * k)], fill=0)
            else:
                gd.polygon([(0, (M0 - 3) * k), (NOTCH * k, mid * k), (0, (M1 + 3) * k)], fill=0)
        bb = g.getbbox()
        imgs.append(g.crop((bb[0], 0, bb[2], DH * k)))
    total = sum(i.width for i in imgs) + gap * k * (len(imgs) - 1)
    im = Image.new('L', (total, DH * k), 0)
    x = 0
    for i in imgs:
        im.paste(i, (x, 0)); x += i.width + gap * k
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
    nb = number_mask(str(num), s(448 if num < 10 else 420), s(460))
    box = paste_layers(im, nb, s(CX), s(490 if num < 10 else 504), [(WHITE, s(13)), (BLACK, s(7)), (WHITE, 0)])
    add_adidas(im, box, BLACK, s(24))
    return im


def espalda_blanca(num, name):
    im = load('7.webp')
    im = restore_cols(im, (380, 402, 708, 508), (985, 1030))
    im = restore_cols(im, (420, 515, 672, 962), (985, 1030))
    nm = text_mask(name, s(74), s(400))
    paste_layers(im, nm, s(CX), s(416), [(WHITE, s(7)), (INK, 0)])
    nb = number_mask(str(num), s(384 if num < 10 else 364), s(420))
    box = paste_layers(im, nb, s(CX), s(548 if num < 10 else 558), [(WHITE, s(19)), (INK, s(12)), (WHITE, s(6)), (INK, 0)])
    add_adidas(im, box, WHITE, s(22))
    return im


def frente_bastones(num, name):
    im = load('10.webp')
    im = restore_cols(im, (484, 526, 606, 730), (735, 760))
    nb = number_mask(str(num), s(177 if num < 10 else 150), s(160))
    paste_layers(im, nb, s(545), s(539 if num < 10 else 552), [(INK, s(5)), (WHITE, 0)])
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
