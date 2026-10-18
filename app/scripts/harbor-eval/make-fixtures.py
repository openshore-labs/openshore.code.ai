# The Harbor eval's pictures, drawn here so every one is reproducible and its
# answer is known. Each stays under 700 pixels a side, about what the phone's
# picture cap (HARBOR_IMAGE_TOKENS) reads, and is checked in beside this file.
#
#   python3 make-fixtures.py   (needs Pillow and the DejaVu fonts)
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
FONTS = Path("/usr/share/fonts/truetype/dejavu")
SANS = str(FONTS / "DejaVuSans.ttf")
BOLD = str(FONTS / "DejaVuSans-Bold.ttf")
MONO = str(FONTS / "DejaVuSansMono.ttf")


def font(path, size):
    return ImageFont.truetype(path, size)


def save(img, name):
    img.save(HERE / f"{name}.png", optimize=True)


def text_shot(name, lines, *, size=(680, 220), bg="white", fg="black", face=MONO, pt=17, top=24):
    img = Image.new("RGB", size, bg)
    d = ImageDraw.Draw(img)
    f = font(face, pt)
    y = top
    for line, color in lines:
        d.text((20, y), line, fill=color or fg, font=f)
        y += int(pt * 1.6)
    save(img, name)


# A browser console error.
text_shot(
    "error-console",
    [
        ("Uncaught TypeError: Cannot read properties of undefined (reading 'map')", "#c0392b"),
        ("    at renderList (App.jsx:42:18)", "#555555"),
        ("    at App (App.jsx:12:5)", "#555555"),
    ],
    size=(690, 160),
    pt=15,
)

# Code with an off-by-one bug.
text_shot(
    "buggy-sum",
    [
        ("function sum(arr) {", None),
        ("  let total = 0;", None),
        ("  for (let i = 1; i <= arr.length; i++) {", None),
        ("    total += arr[i];", None),
        ("  }", None),
        ("  return total;", None),
        ("}", None),
    ],
    size=(560, 270),
    bg="#1e1e1e",
    fg="#d4d4d4",
)

# A terminal with npm's missing package.json.
text_shot(
    "npm-enoent",
    [
        ("$ npm install", "#9be29b"),
        ("npm ERR! code ENOENT", "#ff6b6b"),
        ("npm ERR! syscall open", "#ff6b6b"),
        ("npm ERR! path /home/sam/app/package.json", "#ff6b6b"),
        ("npm ERR! enoent Could not read package.json", "#ff6b6b"),
    ],
    size=(600, 210),
    bg="#101010",
    fg="#e0e0e0",
)

# JSON with a trailing comma.
text_shot(
    "json-comma",
    [
        ("{", None),
        ('  "name": "harbor-demo",', None),
        ('  "version": "1.0.0",', None),
        ('  "private": true,', None),
        ("}", None),
    ],
    size=(420, 200),
    pt=18,
)

# A bar chart: A=3, B=7, C=5.
img = Image.new("RGB", (480, 360), "white")
d = ImageDraw.Draw(img)
d.text((150, 14), "Weekly signups", fill="black", font=font(BOLD, 20))
d.line((60, 300, 440, 300), fill="black", width=2)
d.line((60, 60, 60, 300), fill="black", width=2)
for v in range(0, 9, 2):
    y = 300 - v * 28
    d.text((30, y - 8), str(v), fill="black", font=font(SANS, 14))
    d.line((56, y, 60, y), fill="black", width=2)
for i, (label, value) in enumerate([("A", 3), ("B", 7), ("C", 5)]):
    x = 100 + i * 115
    d.rectangle((x, 300 - value * 28, x + 70, 300), fill="#3b6fd8")
    d.text((x + 28, 308), label, fill="black", font=font(BOLD, 18))
save(img, "bar-chart")

# A sign-up form with a disabled Save button.
img = Image.new("RGB", (420, 330), "#f6f6f4")
d = ImageDraw.Draw(img)
d.text((30, 24), "Sign up", fill="black", font=font(BOLD, 24))
d.text((30, 80), "Name", fill="#333333", font=font(SANS, 15))
d.rounded_rectangle((30, 102, 390, 138), radius=6, outline="#bbbbbb", fill="white")
d.text((42, 110), "Sam Rivera", fill="black", font=font(SANS, 16))
d.text((30, 152), "Email", fill="#333333", font=font(SANS, 15))
d.rounded_rectangle((30, 174, 390, 210), radius=6, outline="#d64545", fill="white", width=2)
d.text((30, 216), "Email is required", fill="#d64545", font=font(SANS, 14))
d.rounded_rectangle((30, 258, 160, 298), radius=8, fill="#cfcfcf")
d.text((72, 268), "Save", fill="#8a8a8a", font=font(BOLD, 17))
save(img, "signup-form")

# A table of people.
img = Image.new("RGB", (360, 230), "white")
d = ImageDraw.Draw(img)
rows = [("Name", "Age", "City"), ("Ana", "34", "Lisbon"), ("Maya", "41", "Austin"), ("Theo", "29", "Leeds"), ("Ravi", "38", "Pune")]
for r, row in enumerate(rows):
    y = 16 + r * 40
    d.line((16, y, 344, y), fill="#cccccc")
    for c, cell in enumerate(row):
        d.text((28 + c * 110, y + 10), cell, fill="black", font=font(BOLD if r == 0 else SANS, 16))
d.line((16, 16 + len(rows) * 40, 344, 16 + len(rows) * 40), fill="#cccccc")
save(img, "people-table")

# Three frames of a screen recording: loading, loading, then a server error.
for i, (title, body, color) in enumerate(
    [
        ("Orders", "Loading orders...", "#555555"),
        ("Orders", "Loading orders...", "#555555"),
        ("Orders", "Error 500: Internal Server Error", "#c0392b"),
    ],
    start=1,
):
    img = Image.new("RGB", (420, 260), "white")
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 420, 50), fill="#2b2b2b")
    d.text((20, 13), title, fill="white", font=font(BOLD, 20))
    d.text((30, 120), body, fill=color, font=font(SANS, 18))
    d.text((330, 230), f"0:0{i * 2}", fill="#999999", font=font(MONO, 13))
    save(img, f"clip-frame-{i}")
