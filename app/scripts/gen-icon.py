# Generates the 1024x1024 iOS app icon: the OpenShore wave-mark full-bleed.
# A deep-ink navy field (iOS masks the corners to its own squircle), a cream
# horizon line, and the shore wave in teal, all from the exact geometry of the
# openshore.ai brand tile (viewBox 0 0 32 32). Run: python3 scripts/gen-icon.py
#
# Colors mirror src/theme.css / BrandMark.tsx: --ink field, --bg horizon,
# --wave stroke. Keep the three in step if the brand palette moves.
from PIL import Image, ImageDraw

SIZE = 1024
SS = 4  # supersample, then downscale for clean anti-aliased curves
INK = (28, 42, 51)      # #1c2a33  brand ink field
CREAM = (246, 244, 239)  # #f6f4ef  horizon line
WAVE = (75, 144, 163)    # #4b90a3  shore wave

# The mark lives in a 32-unit viewBox; scale it up to the rendered canvas.
U = (SIZE * SS) / 32.0
STROKE = 2 * U  # stroke-width 2 in viewBox units


def quad(p0, p1, p2, n=120):
    """Sample a quadratic bezier into n points."""
    out = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0]
        y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
        out.append((x, y))
    return out


def stroke(draw, pts, width, color):
    """Round-capped, round-joined stroke: a disc at every sampled point."""
    r = width / 2
    for x, y in pts:
        px, py = x * U, y * U
        draw.ellipse([px - r, py - r, px + r, py + r], fill=color)


img = Image.new("RGB", (SIZE * SS, SIZE * SS), INK)
draw = ImageDraw.Draw(img)

# Horizon line: M7,13 -> 25,13 (cream). Two endpoints are enough for the disc
# stroke, but sample a few so the caps sit flush.
stroke(draw, quad((7, 13), (16, 13), (25, 13)), STROKE, CREAM)

# Shore wave: M7 19 q4.5 -3.3 9 0 t9 0 (teal). The `t` reflects the control
# point across the segment join.
seg1 = quad((7, 19), (11.5, 15.7), (16, 19))
seg2 = quad((16, 19), (20.5, 22.3), (25, 19))
stroke(draw, seg1 + seg2, STROKE, WAVE)

img = img.resize((SIZE, SIZE), Image.LANCZOS)

out = "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
img.save(out, "PNG")
print(f"wrote {out} ({SIZE}x{SIZE})")
