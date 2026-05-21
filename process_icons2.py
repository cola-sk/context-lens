#!/usr/bin/env python3
"""
Split the combined icon image into:
  - Left half  → main extension icon (icon-16.png, icon-48.png, icon-128.png)
  - Right half → floating/right-click icon (icon-floating.png, icon-floating-16.png)

The image is 1024x1024 with two icons side-by-side on a white background.
We use a content-aware crop: find the actual bounding box of non-white pixels
for each half independently.
"""

import sys
from PIL import Image, ImageChops, ImageFilter

SRC = sys.argv[1]
OUT_DIR = sys.argv[2]

def is_near_white(pixel, threshold=240):
    """Return True if pixel is near-white (background)."""
    r, g, b, a = pixel if len(pixel) == 4 else (*pixel, 255)
    return r > threshold and g > threshold and b > threshold and a > 200

def crop_content(img):
    """Crop to the tight bounding box of non-white, non-transparent content."""
    rgba = img.convert("RGBA")
    data = rgba.getdata()
    w, h = rgba.size
    
    min_x, min_y = w, h
    max_x, max_y = 0, 0
    
    for y in range(h):
        for x in range(w):
            px = data[y * w + x]
            if not is_near_white(px):
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    
    if max_x <= min_x or max_y <= min_y:
        return img  # nothing found, return as-is
    
    # Add a small padding around the content
    padding = 8
    min_x = max(0, min_x - padding)
    min_y = max(0, min_y - padding)
    max_x = min(w - 1, max_x + padding)
    max_y = min(h - 1, max_y + padding)
    
    return img.crop((min_x, min_y, max_x + 1, max_y + 1))

def make_square_white_bg(img, size):
    """Paste the icon (cropped to content) onto a square white background, then resize."""
    # First crop to content
    content = crop_content(img)
    cw, ch = content.size
    
    # Make square canvas with white background
    side = max(cw, ch)
    canvas = Image.new("RGBA", (side, side), (255, 255, 255, 255))
    offset_x = (side - cw) // 2
    offset_y = (side - ch) // 2
    canvas.paste(content.convert("RGBA"), (offset_x, offset_y), content.convert("RGBA"))
    
    # Resize to target
    resized = canvas.resize((size, size), Image.Resampling.LANCZOS)
    return resized.convert("RGBA")

def make_square_transparent_bg(img, size):
    """Paste the icon onto a square transparent background, then resize."""
    content = crop_content(img)
    cw, ch = content.size
    
    side = max(cw, ch)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    offset_x = (side - cw) // 2
    offset_y = (side - ch) // 2
    
    rgba_content = content.convert("RGBA")
    # Remove near-white background from content
    data = rgba_content.getdata()
    new_data = []
    for px in data:
        r, g, b, a = px
        if r > 240 and g > 240 and b > 240:
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append(px)
    rgba_content.putdata(new_data)
    
    canvas.paste(rgba_content, (offset_x, offset_y), rgba_content)
    resized = canvas.resize((size, size), Image.Resampling.LANCZOS)
    return resized


# ---- Main ----
img = Image.open(SRC).convert("RGBA")
width, height = img.size

print(f"Image size: {width}x{height}")

# The two icons are side by side. 
# Looking at the image: left icon (main) is a rounded square with dog+sparkles,
# right icon (floating) is a pill/bubble shape.
# The split point is roughly at the midpoint but let's use 50% as split.
split_x = width // 2

left_half = img.crop((0, 0, split_x, height))
right_half = img.crop((split_x, 0, width, height))

print("Generating main extension icons from left half...")
# Main icon: white background for standard Chrome extension icons
for size in [16, 48, 128]:
    result = make_square_white_bg(left_half, size)
    path = f"{OUT_DIR}/icon-{size}.png"
    result.save(path)
    print(f"  Saved: {path}")

print("Generating floating/right-click icons from right half...")
# Floating icon: transparent bg for use on web pages
result_128 = make_square_transparent_bg(right_half, 128)
path = f"{OUT_DIR}/icon-floating.png"
result_128.save(path)
print(f"  Saved: {path}")

result_16 = make_square_transparent_bg(right_half, 16)
path = f"{OUT_DIR}/icon-floating-16.png"
result_16.save(path)
print(f"  Saved: {path}")

print("Done!")
