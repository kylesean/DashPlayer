#!/usr/bin/env python3
"""Build the Refrain identity assets.

Two numbers drive everything: the wordmark's cap height (100 units) and the stroke
weight of DM Sans SemiBold at optical size 40 (17.14 units).

The mark is the letter R followed by a full stop. The distance between them is one
stroke, which is what turns punctuation into a logo unit. The mark is therefore the
wordmark in miniature — the first letter and the full stop — which is why the two are
never set side by side.
"""
import math
import os
import re

from wordmark import shape

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

INK = "#16171A"
PAPER = "#FBFAF7"
YELLOW = "#F6C445"

CAP = 100.0
BASE = CAP
GAP = 17.14                      # one stroke: distance from the R to the dot

R_PATH, _, (RX0, RY0, RX1, RY1) = shape("R", wght=600, tracking=0, opsz=40)
P_PATH, _, (PX0, PY0, PX1, PY1) = shape(".", wght=600, tracking=0, opsz=40)
W_PATH, _, (WX0, WY0, WX1, WY1) = shape("Refrain.", wght=600, tracking=-0.02, opsz=40)

R_W, R_H = RX1 - RX0, RY1 - RY0                  # 71.86 x 100
P_W, P_H = PX1 - PX0, PY1 - PY0                  # 21.29 x 20.29
DOT_X = R_W + GAP                                # the dot's ink starts one stroke right
MARK_W, MARK_H = DOT_X + P_W, R_H                # 110.28 x 100 (ink)
BOX_W, BOX_H = 111, 101                          # canvas: includes the dot's 0.71 overshoot
WM_W, WM_H = WX1 - WX0, WY1 - WY0


def rnd(d, n=2):
    return re.sub(r"-?\d+\.\d+", lambda m: f"{round(float(m.group()), n):g}", d)


R_PATH, P_PATH, W_PATH = rnd(R_PATH), rnd(P_PATH), rnd(W_PATH)


def svg(w, h, body, title=""):
    t = f"  <title>{title}</title>\n" if title else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
            f'width="{w}" height="{h}">\n' + t + body + "</svg>\n")


def write(name, text):
    open(os.path.join(OUT, name), "w").write(text)


def mark_body(letter=INK, dot=INK, dot_scale=1.0, dot_as_circle=False):
    """R (ink left at x=0, cap top at y=0) plus the dot sitting on the baseline."""
    out = [f'    <path d="{R_PATH}" transform="translate({-RX0:.3f},{-RY0:.3f})" fill="{letter}"/>\n']
    if dot_as_circle:
        cx = DOT_X + P_W / 2
        cy = -RY0 + (PY1 + PY0) / 2
        r = P_W / 2 * dot_scale
        out.append(f'    <circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="{dot}"/>\n')
    else:
        out.append(f'    <path d="{P_PATH}" transform="translate({DOT_X - PX0:.3f},{-RY0:.3f})" '
                   f'fill="{dot}"/>\n')
    return "".join(out)


# ---------------------------------------------------------------- 1. mark
for name, kw, title in (
    ("mark.svg", {}, "Refrain mark"),
    ("mark-reverse.svg", {"letter": PAPER, "dot": PAPER}, "Refrain mark, reverse"),
):
    write(name, svg(BOX_W, BOX_H,
                    f'  <g>\n{mark_body(**kw)}  </g>\n', title))

SIDE = 128.0
write("mark-square.svg", svg(
    int(SIDE), int(SIDE),
    f'  <g transform="translate({(SIDE - MARK_W) / 2:.2f},{(SIDE - MARK_H) / 2:.2f})">\n'
    f'{mark_body()}  </g>\n', "Refrain mark, square"))


# ---------------------------------------------------------------- 2. wordmark
for name, color, title in (
    ("wordmark.svg", INK, "Refrain wordmark"),
    ("wordmark-reverse.svg", PAPER, "Refrain wordmark, reverse"),
):
    write(name, svg(
        math.ceil(WM_W), math.ceil(WM_H),
        f'  <g fill="{color}" transform="translate({-WX0:.2f},{-WY0:.2f})">\n'
        f'    <path d="{W_PATH}"/>\n  </g>\n', title))


# ---------------------------------------------------------------- 3. app icon
def app_icon(plate=INK, letter=PAPER, dot=YELLOW, size=1024, ratio=0.64):
    m = 90
    w = size - 2 * m
    r = round(w * 0.2237)
    s = w * ratio / MARK_W
    mw, mh = MARK_W * s, MARK_H * s
    gx = (size - mw) / 2
    gy = (size - mh) / 2
    # the R carries the visual mass; the dot is light, so nudge the unit left
    gx -= size * 0.010
    # id="plate" / id="glyph" are the contract with scripts/build-mobile-icons.mjs:
    # it derives the full-bleed mobile icon from these two elements.
    body = (f'  <rect id="plate" x="{m}" y="{m}" width="{w}" height="{w}" rx="{r}" fill="{plate}"/>\n'
            f'  <g id="glyph" transform="translate({gx:.2f},{gy:.2f}) scale({s:.5f})">\n'
            f'{mark_body(letter, dot)}  </g>\n')
    return svg(size, size, body, "Refrain app icon")


write("app-icon.svg", app_icon())
write("app-icon-mono.svg", app_icon(dot=PAPER))
write("app-icon-light.svg", app_icon(plate=PAPER, letter=INK))


# ---------------------------------------------------------------- 4. favicon (16 px first)
def favicon(box=64, pad=6, fill=INK, dot=None, dot_boost=1.45):
    inner = box - pad * 2
    extent = MARK_W + (dot_boost - 1) * P_W          # the dot is wider than the ink box
    s = inner / extent
    h = MARK_H * s
    dy = (box - h) / 2
    return svg(box, box,
               f'  <g transform="translate({pad},{dy:.2f}) scale({s:.4g})">\n'
               f'{mark_body(fill, dot or fill, dot_boost, True)}  </g>\n',
               "Refrain mark, small")


write("favicon.svg", favicon())
write("favicon-dark.svg", favicon(fill=PAPER))

print("mark", round(MARK_W, 2), "x", round(MARK_H, 2))
print("wordmark", round(WM_W, 2), "x", round(WM_H, 2))
print("dot", round(P_W, 2), "| gap", GAP)
