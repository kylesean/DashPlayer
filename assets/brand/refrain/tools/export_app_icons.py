#!/usr/bin/env python3
"""Export the Refrain identity into the application's asset slots.

This is the only place that turns the brand SVGs into the many raster formats
Electron / Squirrel / macOS / iOS expect. Everything is derived from `app-icon.svg`
so there is exactly one source of truth for the app icon.

Requires: `rsvg-convert` (SVG rasterising) and Pillow (ICO / ICNS / GIF containers).
Run from anywhere:  python3 tools/export_app_icons.py
"""
import os
import re
import shutil
import struct
import subprocess
import tempfile

from PIL import Image, ImageDraw

BRAND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.abspath(os.path.join(BRAND, "..", "..", ".."))
ICONS = os.path.join(ROOT, "assets", "icons")
IOS_ICON = os.path.join(ROOT, "ios", "DashPlayerMobile", "Assets.xcassets",
                        "AppIcon.appiconset", "icon-1024.png")

INK = "#16171A"
PAPER = "#FBFAF7"

# The sizes the Linux hicolor set and the Windows ICO need.
HICOLOR = (16, 24, 32, 48, 64, 128, 256)
# ICNS OSTypes: standard PNG entries plus their @2x companions.
ICNS_TYPES = (
    ("icp4", 16), ("icp5", 32), ("icp6", 64),
    ("ic07", 128), ("ic08", 256), ("ic09", 512), ("ic10", 1024),
    ("ic11", 32), ("ic12", 64), ("ic13", 256), ("ic14", 512),
)


def render(svg_path, size, out_path):
    """Rasterise an SVG to an exact square PNG, preserving transparency."""
    subprocess.run(
        ["rsvg-convert", "-w", str(size), "-h", str(size), "-o", out_path, svg_path],
        check=True,
    )


def dib(rgba):
    """Build a 32-bit BMP/DIB payload for one ICO entry (XOR bitmap + AND mask)."""
    w, h = rgba.size
    pixels = rgba.load()
    xor = bytearray()
    for y in range(h - 1, -1, -1):                 # DIB rows are bottom-up
        for x in range(w):
            r, g, b, a = pixels[x, y]
            xor += bytes((b, g, r, a))             # DIB is BGRA
    row_bytes = ((w + 31) // 32) * 4              # AND mask: 1bpp, rows padded to 4
    and_mask = bytes(row_bytes * h)
    image = bytes(xor) + and_mask
    header = struct.pack("<IiiHHIIiiII", 40, w, 2 * h, 1, 32, 0, len(image), 0, 0, 0, 0)
    return header + image


def write_ico(path, png_paths):
    """Write a classic ICO with uncompressed DIB entries (works with rcedit)."""
    entries = [(size, dib(Image.open(png_paths[size]).convert("RGBA"))) for size in HICOLOR]
    count = len(entries)
    directory = bytearray(struct.pack("<HHH", 0, 1, count))
    offset = 6 + 16 * count
    for size, payload in entries:
        directory += struct.pack(
            "<BBBBHHII",
            size if size < 256 else 0,
            size if size < 256 else 0,
            0, 0, 1, 32, len(payload), offset,
        )
        offset += len(payload)
    with open(path, "wb") as f:
        f.write(directory)
        for _, payload in entries:
            f.write(payload)


def write_icns(path, png_paths):
    """Write an ICNS container with raw PNG payloads (macOS 10.7+)."""
    body = bytearray()
    for otype, size in ICNS_TYPES:
        with open(png_paths[size], "rb") as f:
            data = f.read()
        body += otype.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(body) + 8) + body)


def full_bleed_svg(icon_svg):
    """Re-frame the master on its plate box: square canvas, no rounded corners.

    iOS / Squirrel apply their own corner radius, so the icon must fill the whole
    canvas. The plate's `rx` and the outer margin are the only things removed.
    """
    text = open(icon_svg, encoding="utf-8").read()
    plate = re.search(r'<rect id="plate"([^>]*)>', text).group(1)

    def attr(name, default):
        m = re.search(rf'{name}="([^"]*)"', plate)
        return m.group(1) if m else default

    box = [attr(k, "0") for k in ("x", "y", "width", "height")]
    body = text[text.index("<g id=\"glyph\""):text.rindex("</svg>")]
    body = body.replace(' id="glyph"', "")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
        f'viewBox="{" ".join(box)}">\n'
        f'  <rect x="{box[0]}" y="{box[1]}" width="{box[2]}" height="{box[3]}" '
        f'fill="{attr("fill", INK)}"/>\n'
        f'  {body}\n</svg>\n'
    )


def write_install_gif(path, icon_svg):
    """One-frame installer card: rounded ink plate, paper R, yellow stop.

    The old file had 8 byte-identical frames; there is no animation to preserve.
    Squirrel's AnimatedGifWindow only needs a transparent-corner square image.
    """
    w, h, radius, margin = 325, 339, 30, 12
    side = min(w, h) - 2 * margin
    with tempfile.TemporaryDirectory() as tmp:
        svg = os.path.join(tmp, "full-bleed.svg")
        open(svg, "w", encoding="utf-8").write(full_bleed_svg(icon_svg))
        plate_png = os.path.join(tmp, "plate.png")
        render(svg, 512, plate_png)
        plate = Image.open(plate_png).convert("RGBA").resize((side, side), Image.LANCZOS)
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, side - 1, side - 1), radius=radius, fill=255)
    plate.putalpha(mask)

    card = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    card.alpha_composite(plate, ((w - side) // 2, (h - side) // 2))
    # GIF only carries 1-bit alpha. Reserve palette index 255 for transparency:
    # quantise the opaque card to 255 colours, then remap every transparent pixel
    # to that index. This is deterministic (unlike quantising RGBA directly).
    alpha = card.getchannel("A")
    flat = Image.new("RGB", card.size, (22, 23, 26))
    flat.paste(card.convert("RGB"), (0, 0), alpha)
    palette = flat.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    indices = bytearray(palette.tobytes())
    for i, value in enumerate(alpha.tobytes()):
        if value < 128:
            indices[i] = 255
    image = Image.frombytes("P", card.size, bytes(indices))
    image.putpalette(palette.getpalette())
    image.save(path, save_all=True, append_images=[], duration=250, loop=0,
               transparency=255, disposal=2)


def main():
    master_svg = os.path.join(ICONS, "icon.svg")
    shutil.copyfile(os.path.join(BRAND, "app-icon.svg"), master_svg)
    print("wrote assets/icons/icon.svg")

    sizes = set(HICOLOR) | {size for _, size in ICNS_TYPES} | {512, 1024}
    png_paths = {}
    with tempfile.TemporaryDirectory() as tmp:
        for size in sorted(sizes):
            path = os.path.join(tmp, f"{size}.png")
            render(master_svg, size, path)
            png_paths[size] = path

        for size in HICOLOR:
            shutil.copyfile(png_paths[size], os.path.join(ICONS, f"{size}x{size}.png"))
        shutil.copyfile(png_paths[512], os.path.join(ICONS, "icon.png"))
        shutil.copyfile(png_paths[1024], os.path.join(ICONS, "icon@2x.png"))
        shutil.copyfile(png_paths[1024], IOS_ICON)
        write_ico(os.path.join(ICONS, "icon.ico"), png_paths)
        write_icns(os.path.join(ICONS, "icon.icns"), png_paths)

    write_install_gif(os.path.join(ICONS, "install.gif"), master_svg)
    print("wrote PNGs, icon.ico, icon.icns, install.gif, iOS AppIcon")
    print("next: node scripts/build-mobile-icons.mjs && pnpm run build:mobile")


if __name__ == "__main__":
    main()
