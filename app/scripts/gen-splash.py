# Renders the iOS launch-screen images from scripts/brand/osc-splash.svg (light)
# and scripts/brand/osc-splash-dark.svg (dark): the openshore.ai wave-mark tile
# centered on a field that matches the app's --bg token in each theme (cream
# paper #f6f4ef, warm dark #17140e), so cold launch reads as one continuous
# brand surface in either appearance. The imageset carries both, the dark set
# tagged with the dark luminosity appearance so iOS picks it by itself. Run:
# python3 scripts/gen-splash.py
#
# Rasterized with headless Chromium (same pipeline as gen-icon.py). Point
# OSC_CHROME at a browser binary if needed.
import glob
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(HERE, "brand", "osc-splash.svg")
SVG_DARK = os.path.join(HERE, "brand", "osc-splash-dark.svg")
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

VARIANTS = (
    # (svg, file stem, background the page paints behind the svg)
    (SVG, "splash-2732x2732", "f6f4efff"),
    (SVG_DARK, "splash-dark-2732x2732", "17140eff"),
)

for svg, stem, bg in VARIANTS:
    first = os.path.join(OUT_DIR, f"{stem}.png")
    subprocess.run(
        [chrome, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
         # Paint the page background the same colour as the splash field so any
         # strip the SVG doesn't cover stays invisible (see gen-icon.py for the
         # white-band story), and pin the scale factor for a deterministic render.
         f"--default-background-color={bg}", "--force-device-scale-factor=1",
         f"--window-size={SIZE},{SIZE}", f"--screenshot={first}", f"file://{os.path.abspath(svg)}"],
        check=True,
        stderr=subprocess.DEVNULL,
    )
    # The imageset points at three files per appearance (1x/2x/3x); identical.
    for suffix in ("-1", "-2"):
        shutil.copyfile(first, os.path.join(OUT_DIR, f"{stem}{suffix}.png"))
    for suffix in ("", "-1", "-2"):
        print(f"wrote {os.path.join(OUT_DIR, f'{stem}{suffix}.png')}")

DARK = [{"appearance": "luminosity", "value": "dark"}]
images = []
for stem, appearances in (("splash-2732x2732", None), ("splash-dark-2732x2732", DARK)):
    for suffix, scale in (("-2", "1x"), ("-1", "2x"), ("", "3x")):
        entry = {"idiom": "universal"}
        if appearances:
            entry["appearances"] = appearances
        entry["filename"] = f"{stem}{suffix}.png"
        entry["scale"] = scale
        images.append(entry)
with open(os.path.join(OUT_DIR, "Contents.json"), "w") as f:
    json.dump({"images": images, "info": {"version": 1, "author": "xcode"}}, f, indent=2)
    f.write("\n")
print(f"wrote {os.path.join(OUT_DIR, 'Contents.json')}")
