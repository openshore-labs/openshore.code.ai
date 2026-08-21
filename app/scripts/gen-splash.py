# Renders the iOS launch-screen images from scripts/brand/osc-splash.svg: the
# openshore.ai wave-mark tile centered on a cream paper field that matches the
# app's --bg token, so cold launch reads as one continuous brand surface. Run:
# python3 scripts/gen-splash.py
#
# Rasterized with headless Chromium (same pipeline as gen-icon.py). Point
# OSC_CHROME at a browser binary if needed.
import glob
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(HERE, "brand", "osc-splash.svg")
OUT_DIR = os.path.join(HERE, "..", "ios", "App", "App", "Assets.xcassets", "Splash.imageset")
SIZE = 2732


def find_chrome():
    if os.environ.get("OSC_CHROME"):
        return os.environ["OSC_CHROME"]
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        p = shutil.which(name)
        if p:
            return p
    for pat in ("/opt/pw-browsers/chromium-*/chrome-linux/chrome",
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    return None


chrome = find_chrome()
if not chrome:
    sys.exit("No Chrome/Chromium found. Set OSC_CHROME to a browser binary.")

first = os.path.join(OUT_DIR, "splash-2732x2732.png")
subprocess.run(
    [chrome, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
     # Paint the page background the same cream as the splash field so any strip
     # the SVG doesn't cover stays invisible (see gen-icon.py for the white-band
     # story), and pin the scale factor for a deterministic render.
     "--default-background-color=f6f4efff", "--force-device-scale-factor=1",
     f"--window-size={SIZE},{SIZE}", f"--screenshot={first}", f"file://{os.path.abspath(SVG)}"],
    check=True,
    stderr=subprocess.DEVNULL,
)

# The imageset points at three files (1x/2x/3x); they are identical.
for name in ("splash-2732x2732-1.png", "splash-2732x2732-2.png"):
    shutil.copyfile(first, os.path.join(OUT_DIR, name))
for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
    print(f"wrote {os.path.join(OUT_DIR, name)}")
