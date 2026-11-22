"""Turn a PDF's first page into a PNG that looks like a phone scan: slight rotation + noise.

Usage: python scanify.py <pdf> <png>
"""
import random
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

DPI = 110
MAX_ROTATION_DEG = 2.0
MIN_ROTATION_DEG = 1.0
NOISE_BLEND = 0.12
NOISE_SIGMA = 40
BLUR_RADIUS = 0.5
BACKGROUND = (235, 235, 235)
SEED = 7  # fixed so regenerating gives the same scan


def main(pdf: str, png: str) -> None:
    random.seed(SEED)
    with tempfile.TemporaryDirectory() as tmp:
        prefix = Path(tmp) / "page"
        subprocess.run(["pdftoppm", "-r", str(DPI), "-png", "-singlefile", pdf, str(prefix)], check=True)
        img = Image.open(f"{prefix}.png").convert("RGB")
    angle = random.choice([-1, 1]) * random.uniform(MIN_ROTATION_DEG, MAX_ROTATION_DEG)
    img = img.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=BACKGROUND)
    noise = Image.effect_noise(img.size, NOISE_SIGMA).convert("RGB")
    img = Image.blend(img, ImageChops.multiply(img, noise), NOISE_BLEND).filter(ImageFilter.GaussianBlur(BLUR_RADIUS))
    img.save(png)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
