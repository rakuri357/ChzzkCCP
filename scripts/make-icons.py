#!/usr/bin/env python3
"""
assets/source-icon.png 에서 앱 아이콘을 만듭니다.
  assets/icon.ico  윈도우 exe 아이콘 (16~256px). 작은 크기는 전통적인 BMP 방식, 256px만 PNG 방식으로 저장합니다.
                   (PNG 압축 상태의 작은 아이콘은 윈도우 탐색기의 작은 아이콘 보기에서 읽지 못하는 경우가 있습니다.)
  assets/icon.png  앱 창 아이콘 (256px)
  assets/tray.png  트레이 아이콘 (32px)
사용법: python3 scripts/make-icons.py   (Pillow 필요: pip install pillow)
"""
import io
import os
import struct
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ASSETS = os.path.join(ROOT, 'assets')
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]   # 20, 40은 화면 배율 125%, 250%에서 쓰입니다.


def square_crop(src):
    """투명한 여백을 줄여 작은 크기에서도 그림이 크게 보이게 정사각형으로 자릅니다."""
    bbox = src.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    x0, y0, x1, y1 = bbox
    side = max(x1 - x0, y1 - y0)
    half = side // 2 + int(side * 0.04)
    canvas = Image.new('RGBA', (half * 2, half * 2), (0, 0, 0, 0))
    canvas.paste(src.crop(bbox), (half - (x1 - x0) // 2, half - (y1 - y0) // 2))
    return canvas


def resized(img, size):
    # 곱해진 알파로 줄여야 투명한 가장자리가 번지지 않습니다.
    return img.convert('RGBa').resize((size, size), Image.LANCZOS).convert('RGBA')


def bmp_entry(img):
    """ICO 안의 BMP(DIB) 이미지: 헤더 + 아래에서 위로 쌓은 BGRA 픽셀 + AND 마스크(투명도는 알파가 맡으므로 0)."""
    w, h = img.size
    pixels = img.load()
    rows = []
    for y in range(h - 1, -1, -1):
        rows.append(b''.join(struct.pack('<BBBB', pixels[x, y][2], pixels[x, y][1], pixels[x, y][0], pixels[x, y][3]) for x in range(w)))
    xor = b''.join(rows)
    mask = bytes(((w + 31) // 32) * 4 * h)
    header = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0, len(xor) + len(mask), 0, 0, 0, 0)
    return header + xor + mask


def png_entry(img):
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


def build_ico(images):
    entries = []
    for size in SIZES:
        img = images[size]
        data = png_entry(img) if size >= 256 else bmp_entry(img)
        entries.append((size, data))
    out = struct.pack('<HHH', 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    body = b''
    for size, data in entries:
        out += struct.pack('<BBBBHHII', 0 if size >= 256 else size, 0 if size >= 256 else size, 0, 0, 1, 32, len(data), offset + len(body))
        body += data
    return out + body


def main():
    src = Image.open(os.path.join(ASSETS, 'source-icon.png')).convert('RGBA')
    canvas = square_crop(src)
    images = {s: resized(canvas, s) for s in SIZES}
    images[256].save(os.path.join(ASSETS, 'icon.png'))
    images[32].save(os.path.join(ASSETS, 'tray.png'))
    with open(os.path.join(ASSETS, 'icon.ico'), 'wb') as f:
        f.write(build_ico(images))
    print('만들었습니다: icon.ico (%s px), icon.png, tray.png' % ', '.join(str(s) for s in SIZES))


if __name__ == '__main__':
    main()
