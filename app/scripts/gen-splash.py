# Regenerates the iOS launch-screen images: a cream paper field matching the
# app's own --bg token, with the OpenShore wave-mark tile centered, so cold
# launch reads as one continuous brand surface instead of a white flash before
# the WebView paints. Run: python3 scripts/gen-splash.py
#
# Colors mirror src/theme.css / BrandMark.tsx. Keep in step with gen-icon.py.
from PIL import Image, ImageDraw

SIZE = 2732
SS = 2  # supersample the tile, then downscale for clean edges
PAPER = (246, 244, 239)  # #f6f4ef  --bg
INK = (28, 42, 51)       # #1c2a33  tile field / --ink
CREAM = (246, 244, 239)  # #f6f4ef  horizon line
WAVE = (75, 144, 163)    # #4b90a3  shore wave

TILE = 760  # rendered tile size on the splash


def quad(p0, p1, p2, n=120):
    out = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0]
        y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
        out.append((x, y))
    return out


def build_tile(px):
    """The rounded wave-mark tile as an RGBA image of side `px`."""
    big = px * SS
    u = big / 32.0
    stroke_w = 2 * u
    tile = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    # rx=7.5 on a 32 tile -> radius as a fraction of the side.
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=7.5 * u, fill=INK)

    def stroke(pts, color):
        r = stroke_w / 2
        for x, y in pts:
            cx, cy = x * u, y * u
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)

    stroke(quad((7, 13), (16, 13), (25, 13)), CREAM)
    stroke(quad((7, 19), (11.5, 15.7), (16, 19)) + quad((16, 19), (20.5, 22.3), (25, 19)), WAVE)
    return tile.resize((px, px), Image.LANCZOS)


img = Image.new("RGB", (SIZE, SIZE), PAPER)
tile = build_tile(TILE)
pos = ((SIZE - TILE) // 2, (SIZE - TILE) // 2)
img.paste(tile, pos, tile)

out_dir = "ios/App/App/Assets.xcassets/Splash.imageset"
for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
    path = f"{out_dir}/{name}"
    img.save(path, "PNG")
    print(f"wrote {path}")
