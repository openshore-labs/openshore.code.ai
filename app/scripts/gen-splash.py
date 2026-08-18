# Regenerates the iOS launch-screen images as a solid navy field matching the
# app's own --bg token, so cold launch reads as one continuous surface instead
# of a white flash before the WebView paints. Run: python3 scripts/gen-splash.py
# OPENSHORE: mirrors NAVY_BOTTOM in gen-icon.py; keep both in step if the real
# palette lands.
from PIL import Image

SIZE = 2732
NAVY = (11, 27, 43)  # --bg

img = Image.new("RGB", (SIZE, SIZE), NAVY)

out_dir = "ios/App/App/Assets.xcassets/Splash.imageset"
for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
    path = f"{out_dir}/{name}"
    img.save(path, "PNG")
    print(f"wrote {path}")
