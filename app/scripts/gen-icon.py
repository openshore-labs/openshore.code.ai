# Generates the 1024x1024 iOS app icon: deep ocean navy field, a faint
# vertical gradient, the OS wordmark in bold mono teal with an amber block
# cursor. Run: python3 scripts/gen-icon.py
# OPENSHORE: colors mirror src/theme.css tokens; swap both together when the
# real openshore.ai palette lands.
from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
NAVY_TOP = (16, 38, 58)      # slightly lifted at the top
NAVY_BOTTOM = (8, 20, 32)    # settling into the deep
TEAL = (45, 212, 191)        # --local
AMBER = (245, 166, 35)       # --cloud
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

img = Image.new("RGB", (SIZE, SIZE))
draw = ImageDraw.Draw(img)

# Vertical gradient wash.
for y in range(SIZE):
    t = y / (SIZE - 1)
    color = tuple(round(a + (b - a) * t) for a, b in zip(NAVY_TOP, NAVY_BOTTOM))
    draw.line([(0, y), (SIZE, y)], fill=color)

# A whisper of a horizon line in teal, low on the field.
horizon_y = round(SIZE * 0.78)
for i, alpha in enumerate((10, 22, 10)):
    overlay = Image.new("RGB", (SIZE, 1), TEAL)
    img.paste(
        Image.blend(img.crop((0, horizon_y + i, SIZE, horizon_y + i + 1)), overlay, alpha / 255),
        (0, horizon_y + i),
    )

# The wordmark: OS + block cursor.
font = ImageFont.truetype(FONT, 340)
text = "OS"
bbox = draw.textbbox((0, 0), text, font=font)
text_w = bbox[2] - bbox[0]
text_h = bbox[3] - bbox[1]

cursor_w = round(text_w * 0.22)
gap = round(cursor_w * 0.42)
total_w = text_w + gap + cursor_w

x = (SIZE - total_w) // 2 - bbox[0]
y = (SIZE - text_h) // 2 - bbox[1] - round(SIZE * 0.02)
draw.text((x, y), text, font=font, fill=TEAL)

cursor_x = x + bbox[0] + text_w + gap
cursor_top = y + bbox[1] + round(text_h * 0.18)
cursor_bottom = y + bbox[1] + text_h
draw.rectangle([cursor_x, cursor_top, cursor_x + cursor_w, cursor_bottom], fill=AMBER)

out = "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
img.save(out, "PNG")
print(f"wrote {out} ({SIZE}x{SIZE})")
