# Python script to generate ContextLens extension PNG icons using PIL

from PIL import Image, ImageDraw
import os

os.makedirs('icons', exist_ok=True)

# Generate icons for standard sizes
for size in [16, 48, 128]:
    # Create transparent image
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Outer Rounded Rectangle (Indigo base)
    margin = max(1, size // 16)
    radius = size // 4
    
    # Draw rounded background
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=radius,
        fill='#6366f1' # indigo-500
    )
    
    # Draw a sleek circular lens outline inside
    cx = int(size * 7 // 16)
    cy = int(size * 7 // 16)
    r = int(size * 3.5 // 16)
    
    # Magnifying glass circle outline (crisp white)
    stroke_width = int(max(1, size // 16))
    draw.ellipse(
        [cx - r, cy - r, cx + r, cy + r],
        outline='white',
        width=stroke_width
    )
    
    # Diagonal handle
    hx_start = int(cx + r * 0.707)
    hy_start = int(cy + r * 0.707)
    hx_end = int(size * 12.5 // 16)
    hy_end = int(size * 12.5 // 16)
    draw.line(
        [hx_start, hy_start, hx_end, hy_end],
        fill='white',
        width=int(stroke_width * 1.5),
        joint='round'
    )
    
    # Save the file
    img.save(f'icons/icon-{size}.png')
    print(f'Created icons/icon-{size}.png ({size}x{size})')
