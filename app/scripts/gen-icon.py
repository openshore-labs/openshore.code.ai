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
         f"--window-size={size},{size}", f"--screenshot={out}", f"file://{os.path.abspath(svg)}"],
        check=True,
        stderr=subprocess.DEVNULL,
    )


render(SVG, OUT, SIZE)
print(f"wrote {OUT} ({SIZE}x{SIZE})")
