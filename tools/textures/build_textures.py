"""Turns ambientCG 1K-JPG downloads (CC0) into the web-sized sets in public/assets/textures/.

  python tools/textures/build_textures.py <folder holding one sub-folder per ambientCG id>

Colour maps that take a per-chapter tint are neutralised to mid grey (the game multiplies the tint
back in), the ambient occlusion is baked into the colour so crevices stay dark in shade, and the
contrast is lifted slightly because the scanned sets are captured flat.
"""
import glob
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'textures'))
SETS = {
    # name: (ambientCG id, colour size, neutralise, contrast, saturation)
    'cliff': ('Rock022', 1024, True, 1.25, 1.0),
    'stone': ('Rock030', 1024, True, 1.2, 1.0),
    'mason': ('Rock030', 1024, True, 0.55, 0.6),
    'ground': ('Ground003', 1024, False, 1.05, 0.9),
    'grass': ('Grass004', 512, False, 1.0, 0.85),
    'moss': ('Moss002', 512, False, 1.0, 0.8),
    'bark': ('Bark012', 512, False, 1.1, 0.75),
    'wood': ('Wood049', 512, False, 1.15, 0.7),
    'rust': ('Rust004', 512, False, 1.0, 1.0),
}


def one(folder, suffix):
    found = glob.glob(os.path.join(folder, f'*_{suffix}.jpg'))
    return found[0] if found else None


def main(src):
    os.makedirs(ROOT, exist_ok=True)
    total = 0
    for name, (aid, size, neutral, contrast, sat) in SETS.items():
        folder = os.path.join(src, aid)
        col = np.asarray(Image.open(one(folder, 'Color')).convert('RGB').resize((size, size), Image.LANCZOS), dtype=np.float32) / 255
        ao_path = one(folder, 'AmbientOcclusion')
        if ao_path:
            ao = np.asarray(Image.open(ao_path).convert('L').resize((size, size), Image.LANCZOS), dtype=np.float32) / 255
            col = col * (0.35 + 0.65 * ao[..., None])
        if neutral:
            col = col * (0.5 / np.maximum(col.reshape(-1, 3).mean(0), 1e-3))
        lum = (col * [0.2126, 0.7152, 0.0722]).sum(-1, keepdims=True)
        col = lum + (col - lum) * sat
        mean = col.reshape(-1, 3).mean(0)
        col = np.clip(mean + (col - mean) * contrast, 0, 1)
        out = {
            f'{name}_color.jpg': (Image.fromarray((col * 255).astype(np.uint8)), 84),
            f'{name}_normal.jpg': (Image.open(one(folder, 'NormalGL')).convert('RGB').resize((size, size), Image.LANCZOS), 88),
            f'{name}_rough.jpg': (Image.open(one(folder, 'Roughness')).convert('L').resize((size // 2, size // 2), Image.LANCZOS), 75),
        }
        for fn, (im, q) in out.items():
            p = os.path.join(ROOT, fn)
            im.save(p, quality=q, optimize=True)
            total += os.path.getsize(p)
        print(name, aid, 'mean', np.round(mean, 2))
    print('total', round(total / 1048576, 2), 'MB')


if __name__ == '__main__':
    main(sys.argv[1])
