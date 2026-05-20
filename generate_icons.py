"""
ContextLens Icon Generator
--------------------------
Generates 16x16, 48x48, 128x128 PNG icons from the flat design source image.

Source: icon_flat_v2 — indigo squircle flat design
  - Background: #4F46E5 flat indigo squircle
  - Icon: white magnifying glass + text lines + AI sparkle star
  - Style: pure flat, no gradients, no shadows

To regenerate icons, run:
  python3 generate_icons.py
"""

from PIL import Image
import os

# Path to the master flat-design source image (1024x1024)
SRC_IMAGE = os.path.join(
    os.path.expanduser("~"),
    ".gemini/antigravity/brain/77b52dbc-28a1-4877-966d-ac09005c90bd/icon_flat_v2_1779258562849.png"
)

os.makedirs("icons", exist_ok=True)

img = Image.open(SRC_IMAGE).convert("RGBA")
w, h = img.size

# Crop away the light grey outer border (82px padding on each side)
pad = 82
cropped = img.crop((pad, pad, w - pad, h - pad))

for size in [16, 48, 128]:
    resized = cropped.resize((size, size), Image.LANCZOS)
    out_path = f"icons/icon-{size}.png"
    resized.save(out_path, "PNG")
    print(f"✅ Generated: {out_path} ({size}x{size})")

print("\n🎉 All icons generated successfully!")
