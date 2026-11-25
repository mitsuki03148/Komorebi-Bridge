#!/usr/bin/env python3
"""Builds the app icons from the logo's circle emblem on its paper colour.

The logo PNG is transparent: only the green emblem, the sparkles and the title are drawn, and the paper
is empty (its colour survives only in the hidden RGB of the transparent pixels). iOS fills transparent
icon pixels with black, so the icon is the emblem on a solid cream square.

    python3 scripts/make-icons.py [logo.png]        # needs Pillow and numpy
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'src/assets/brand/komorebi-logo.png'
out = root / 'public/icons'
out.mkdir(parents=True, exist_ok=True)
CREAM = (246, 231, 219, 255)
TITLE_STARTS_AT = 1120  # rows below this hold the title text, which is unreadable at icon size

logo = Image.open(source).convert('RGBA')
ys, xs = np.where(np.array(logo)[:TITLE_STARTS_AT, :, 3] > 0)
emblem = logo.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

def render(size: int, fill: float) -> Image.Image:
    height = int(size * fill)
    width = round(emblem.width * height / emblem.height)
    # Resize premultiplied, so the transparent pixels' hidden colour does not leak into the edges.
    small = emblem.convert('RGBa').resize((width, height), Image.LANCZOS).convert('RGBA')
    canvas = Image.new('RGBA', (size, size), CREAM)
    canvas.alpha_composite(small, ((size - width) // 2, (size - height) // 2))
    return canvas.convert('RGB')

master = render(1024, 0.78)
for name, px in [('apple-touch-icon.png', 180), ('icon-192.png', 192), ('icon-512.png', 512)]:
    master.resize((px, px), Image.LANCZOS).save(out / name, optimize=True)
# The tab icon is tiny, so the emblem fills more of it.
render(256, 0.92).resize((32, 32), Image.LANCZOS).save(out / 'favicon-32.png', optimize=True)
print('wrote', *sorted(p.name for p in out.glob('*.png')))
