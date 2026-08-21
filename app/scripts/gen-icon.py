# Renders the 1024x1024 iOS app icon from scripts/brand/osc-tile-icon.svg: the
# exact openshore.ai wave-mark, full-bleed so iOS masks its own corners. Run:
# python3 scripts/gen-icon.py
#
# We rasterize the SVG with headless Chromium so the geometry stays 1:1 with the
# marketing-site mark. Point OSC_CHROME at a Chrome/Chromium binary if it is not
# found automatically. The committed PNG is what ships; regenerate only when the
# brand SVG changes.
import glob
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(HERE, "brand", "osc-tile-icon.svg")
OUT = os.path.join(
    HERE, "..", "ios", "App", "App", "Assets.xcassets",
    "AppIcon.appiconset", "AppIcon-512@2x.png",
)
SIZE = 1024
NAVY = (28, 42, 51)  # #1c2a33, the full-bleed background of the mark


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


def render(svg, out, size):
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
         "--default-background-color=1c2a33ff", "--force-device-scale-factor=1",
         f"--window-size={size},{size}", f"--screenshot={out}", f"file://{os.path.abspath(svg)}"],
        check=True,
        stderr=subprocess.DEVNULL,
    )


def verify(out, size):
    # Guard against the white-band regression: the standalone SVG can lay out
    # shorter than the window and leave an uncovered strip, which used to ship
    # baked into the icon and read as a "cut off" tile once iOS masked the
    # corners. Fail loudly if the output isn't a full-bleed navy square. Pillow
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
            if px[x, y] != NAVY:
                sys.exit(f"icon check failed: border pixel ({x},{y})={px[x, y]} is not navy {NAVY}")
    for y in range(W):
        for x in (0, W - 1):  # left and right edges
            if px[x, y] != NAVY:
                sys.exit(f"icon check failed: border pixel ({x},{y})={px[x, y]} is not navy {NAVY}")
    if any(px[x, y] == wht for y in range(W) for x in range(W)):
        sys.exit("icon check failed: found pure-white pixels (the mark's cream is #f6f4ef, not #fff)")


render(SVG, OUT, SIZE)
verify(OUT, SIZE)
print(f"wrote {OUT} ({SIZE}x{SIZE})")
