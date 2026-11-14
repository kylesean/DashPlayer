#!/usr/bin/env python3
"""Wordmark outlining: DM Sans variable font -> SVG paths, shaped with HarfBuzz.

Coordinates are in "cap height = 100" units, baseline at y = 0, y growing downwards.
"""
import os

import uharfbuzz as hb
from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.."))
WOFF = os.path.join(ROOT, "src/frontend/styles/fonts/dm-sans/latin-01.woff2")
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")


def source_font():
    """Decompress the project's self-hosted DM Sans woff2 once, into tools/cache/."""
    os.makedirs(CACHE, exist_ok=True)
    ttf = os.path.join(CACHE, "DMSans-var.ttf")
    if not os.path.exists(ttf):
        f = TTFont(WOFF)
        f.flavor = None
        f.save(ttf)
    return ttf


_cache = {}


def _instance(wght, opsz):
    key = (wght, opsz)
    if key not in _cache:
        f = TTFont(source_font())
        instantiateVariableFont(f, {"opsz": opsz, "wght": wght}, inplace=True)
        path = os.path.join(CACHE, f"DMSans-{int(wght)}-{int(opsz)}.ttf")
        f.save(path)
        _cache[key] = path
    return _cache[key]


def shape(text, wght=600, opsz=40, tracking=-0.02):
    """Returns (path_d, advance_width, (x0, y0, x1, y1))."""
    path_file = _instance(wght, opsz)
    tt = TTFont(path_file)
    upem = tt["head"].unitsPerEm
    cap = tt["OS/2"].sCapHeight or int(upem * 0.7)
    scale = 100.0 / cap

    face = hb.Face(open(path_file, "rb").read())
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hb.Font(face), buf, {"kern": True, "liga": True})

    order, gs = tt.getGlyphOrder(), tt.getGlyphSet()
    x, cmds = 0.0, []
    bounds = BoundsPen(gs)
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        gname = order[info.codepoint]
        t = Transform(scale, 0, 0, -scale, (x + pos.x_offset) * scale, 0)
        pen = SVGPathPen(gs)
        gs[gname].draw(TransformPen(pen, t))
        if pen.getCommands():
            cmds.append(pen.getCommands())
        gs[gname].draw(TransformPen(bounds, t))
        x += pos.x_advance + tracking * upem
    return " ".join(cmds), (x - tracking * upem) * scale, bounds.bounds
