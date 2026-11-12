#!/usr/bin/env python3
"""Compose the presentation board for the Refrain identity."""
import os

import build as ba

INK, PAPER, YELLOW = ba.INK, ba.PAPER, ba.YELLOW
W_, H_ = 1600, 1200


def word(cap, x, y, fill=INK, tracking=None):
    """Wordmark with cap height `cap`, ink top-left at (x, y)."""
    s = cap / 100.0
    return (f'<g transform="translate({x - ba.WX0 * s:.2f},{y - ba.WY0 * s:.2f}) scale({s:.5f})" '
            f'fill="{fill}"><path d="{ba.W_PATH}"/></g>')


def mark(h, x, y, fill=INK, dot=None):
    """Mark with cap height `h`, ink top-left at (x, y)."""
    s = h / 100.0
    body = ba.mark_body(fill, dot or fill)
    return (f'<g transform="translate({x:.2f},{y:.2f}) scale({s:.5f})">{body}</g>')


def icon(size, x, y, plate=INK, letter=PAPER, dot=YELLOW, stroke="none"):
    m = 90 / 1024 * size
    w = size - 2 * m
    r = w * 0.2237
    s = w * 0.64 / ba.MARK_W
    mw, mh = ba.MARK_W * s, ba.MARK_H * s
    gx = x + (size - mw) / 2 - size * 0.010
    gy = y + (size - mh) / 2
    return (f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{w:.2f}" rx="{r:.2f}" '
            f'fill="{plate}" stroke="{stroke}"/>'
            f'<g transform="translate({gx:.2f},{gy:.2f}) scale({s:.5f})">{ba.mark_body(letter, dot)}</g>')


def card(x, y, w, h, fill="#FFFFFF", radius=16, stroke="rgba(22,23,26,0.07)"):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" '
            f'stroke="{stroke}"/>')


def label(x, y, text, size=13, color="#7A7B80", weight=500, spacing=0.08):
    return (f'<text x="{x}" y="{y}" font-family="DM Sans" font-size="{size}" font-weight="{weight}" '
            f'letter-spacing="{spacing}em" fill="{color}">{text}</text>')


b = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W_} {H_}" width="{W_}" height="{H_}">',
     f'<rect width="{W_}" height="{H_}" fill="{PAPER}"/>']

# ---------------------------------------------------------------- header
b.append(label(64, 70, "REFRAIN", 15, INK, 600, 0.22))
b.append(label(64, 96, "Identity — one letter, one full stop, one stroke", 15, "#7A7B80", 400, 0.01))
b.append(label(1300, 70, "16 px → billboard", 13, "#A2A3A8", 400, 0.14))

# ---------------------------------------------------------------- hero: wordmark
b.append(card(64, 124, 1472, 306))
b.append(word(104, 148, 214))
b.append(label(148, 372, "Primary signature — the name, and the full stop that ends it", 13, "#A2A3A8"))

# ---------------------------------------------------------------- row 2
b.append(card(64, 454, 500, 322))
b.append(label(96, 494, "THE MARK", 12, INK, 600, 0.16))
xs = 96
for size, lbl in ((104, "104"), (64, "64"), (34, "34"), (16, "16")):
    b.append(mark(size, xs, 534))
    b.append(label(xs, 706, lbl, 12, "#A2A3A8", 400, 0.04))
    xs += size + 30
b.append(f'<rect x="448" y="520" width="92" height="92" rx="20" fill="{INK}"/>')
b.append(mark(44, 472, 544, fill=PAPER))
b.append(label(448, 636, "on ink", 12, "#A2A3A8", 400, 0.04))
b.append(label(96, 748, "The gap is one stroke, so the dot reads as part of the letter.", 12, "#A2A3A8"))

b.append(card(592, 454, 460, 322))
b.append(label(624, 494, "APP ICON", 12, INK, 600, 0.16))
b.append(icon(132, 620, 522))
b.append(icon(132, 764, 522, dot=PAPER))
b.append(icon(132, 908, 522, plate=PAPER, letter=INK))
b.append(label(620, 692, "accent", 12, "#A2A3A8", 400, 0.04))
b.append(label(764, 692, "mono", 12, "#A2A3A8", 400, 0.04))
b.append(label(908, 692, "light", 12, "#A2A3A8", 400, 0.04))
b.append(label(624, 748, "Yellow is the full stop — never type, never a button.", 12, "#A2A3A8"))

b.append(card(1080, 454, 456, 322))
b.append(label(1112, 494, "PALETTE", 12, INK, 600, 0.16))
chips = [(INK, "#16171A", "ink"), (YELLOW, "#F6C445", "highlighter"),
         (PAPER, "#FBFAF7", "paper"), ("#8A8B90", "#8A8B90", "mute")]
for i, (col, hexv, name) in enumerate(chips):
    cx = 1112 + (i % 2) * 216
    cy = 526 + (i // 2) * 96
    b.append(f'<rect x="{cx}" y="{cy}" width="48" height="48" rx="8" fill="{col}" '
             f'stroke="rgba(22,23,26,0.12)"/>')
    b.append(label(cx + 62, cy + 21, name, 13, INK, 500, 0.02))
    b.append(label(cx + 62, cy + 39, hexv, 12, "#A2A3A8", 400, 0.04))
b.append(label(1112, 748, "Highlighter is reserved for the stop.", 12, "#A2A3A8"))

# ---------------------------------------------------------------- row 3
b.append(card(64, 806, 700, 268, fill=INK, stroke="none"))
b.append(word(60, 112, 878, fill=PAPER))
b.append(label(112, 1002, "Reverse — dark UI, menu bar, tray", 12, "#B9BAC0"))

b.append(card(792, 806, 744, 268))
b.append(label(824, 846, "RULES", 12, INK, 600, 0.16))
rules = [
    "The mark is the wordmark in miniature: its first letter and its full stop.",
    "They never appear side by side — that would spell the letter twice.",
    "Gap R→dot = one stroke (17.14). Dot = the font's own period, overshoot included.",
    "DM Sans SemiBold, optical size 40, tracking −2%. Outlined: no font at runtime.",
]
ry = 884
for r in rules:
    b.append(f'<circle cx="827" cy="{ry - 4}" r="2.6" fill="#C9CACF"/>')
    b.append(label(840, ry, r, 12.5, "#5E5F64", 400, 0.01))
    ry += 40

b.append("</svg>")
open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "board.svg"), "w").write("".join(b))
print("ok")
