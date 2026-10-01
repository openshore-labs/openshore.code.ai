# Renders the 1024x1024 app icons, one per tile the person can pick in
# Settings, Appearance (founder, 2026-10-01): the default ink tile
# (scripts/brand/osc-tile-icon.svg), the turquoise one from openshore.ai, and
# an all-white one with the mark in near-black. Each is the exact openshore.ai
# wave-mark, full-bleed so iOS masks its own corners, written to its iOS icon
# set (the default as AppIcon, the others as alternate icons) and to
# public/app-icons/ for the desktop, which swaps its window and Dock icon at
# runtime. Run: python3 scripts/gen-icon.py
#
# We rasterize the SVG with headless Chromium so the geometry stays 1:1 with the
# marketing-site mark. Point OSC_CHROME at a Chrome/Chromium binary if it is not
# found automatically. The committed PNG is what ships; regenerate only when the
# brand SVG changes.
import glob
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ICONS = os.path.join(HERE, "..", "ios", "App", "App", "Assets.xcassets")
PUBLIC = os.path.join(HERE, "..", "public", "app-icons")
SIZE = 1024
# (id, source svg, iOS icon set, png name, full-bleed ground). The default's
# ground is #1c2a33, the turquoise #5bb6cb, the white #ffffff.
VARIANTS = [
    ("default", "osc-tile-icon.svg", "AppIcon", "AppIcon-512@2x.png", (28, 42, 51)),
    ("turquoise", "osc-tile-icon-turquoise.svg", "AppIcon-Turquoise", "AppIcon-Turquoise.png", (91, 182, 203)),
    ("white", "osc-tile-icon-white.svg", "AppIcon-White", "AppIcon-White.png", (255, 255, 255)),
]


def find_chrome():
    if os.environ.get("OSC_CHROME"):
        return os.environ["OSC_CHROME"]
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        from shutil import which
        p = which(name)
        if p:
            return p
    for pat in ("/opt/pw-browsers/chromium-*/chrome-linux/chrome",
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    return None


def render(svg, out, size, ground):
    chrome = find_chrome()
    if not chrome:
        sys.exit("No Chrome/Chromium found. Set OSC_CHROME to a browser binary.")
    subprocess.run(
        [chrome, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
         # A standalone SVG doesn't fill the whole window (Chromium lays it out a
         # touch shorter than the viewport), and the uncovered strip defaults to
         # white, so the shipped icon had a white band across the bottom that read
         # as a "cut off" tile once iOS masked the corners. Paint the page
         # background the same navy as the mark so any uncovered area is invisible.
         "--default-background-color=%02x%02x%02xff" % ground, "--force-device-scale-factor=1",
         f"--window-size={size},{size}", f"--screenshot={out}", f"file://{os.path.abspath(svg)}"],
        check=True,
        stderr=subprocess.DEVNULL,
    )


def verify(out, size, ground, cream_only):
    # Guard against the white-band regression: the standalone SVG can lay out
    # shorter than the window and leave an uncovered strip, which used to ship
    # baked into the icon and read as a "cut off" tile once iOS masked the
    # corners. Fail loudly if the output isn't a full-bleed square of its ground. Pillow
    # is optional here; skip the check (with a warning) if it isn't installed.
    try:
        from PIL import Image
    except ImportError:
        print("warning: Pillow not installed; skipped the full-bleed check.")
        return
    im = Image.open(out).convert("RGB")
    if im.size != (size, size):
        sys.exit(f"icon check failed: expected {size}x{size}, got {im.size[0]}x{im.size[1]}")
    px = im.load()
    W, wht = im.size[0], (255, 255, 255)
    for x in range(W):
        for y in (0, W - 1):  # top and bottom edges
            if px[x, y] != ground:
                sys.exit(f"icon check failed: border pixel ({x},{y})={px[x, y]} is not {ground}")
    for y in range(W):
        for x in (0, W - 1):  # left and right edges
            if px[x, y] != ground:
                sys.exit(f"icon check failed: border pixel ({x},{y})={px[x, y]} is not {ground}")
    if cream_only and any(px[x, y] == wht for y in range(W) for x in range(W)):
        sys.exit("icon check failed: found pure-white pixels (the mark's cream is #f6f4ef, not #fff)")


os.makedirs(PUBLIC, exist_ok=True)
for vid, svg, iconset, png, ground in VARIANTS:
    folder = os.path.join(ICONS, f"{iconset}.appiconset")
    os.makedirs(folder, exist_ok=True)
    out = os.path.join(folder, png)
    render(os.path.join(HERE, "brand", svg), out, SIZE, ground)
    # Only the default promises cream, never pure white; the white tile is white.
    verify(out, SIZE, ground, cream_only=(vid != "white"))
    shutil.copyfile(out, os.path.join(PUBLIC, f"{vid}.png"))
    print(f"wrote {out} and public/app-icons/{vid}.png ({SIZE}x{SIZE})")
