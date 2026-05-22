import sys
try:
    from PIL import Image, ImageChops
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'Pillow'])
    from PIL import Image, ImageChops

def trim(im):
    bg = Image.new(im.mode, im.size, im.getpixel((0,0)))
    diff = ImageChops.difference(im, bg)
    diff = ImageChops.add(diff, diff, 2.0, -100)
    bbox = diff.getbbox()
    if bbox:
        return im.crop(bbox)
    return im

def make_square(im, min_size=256, fill_color=(255, 255, 255, 0)):
    x, y = im.size
    size = max(min_size, x, y)
    new_im = Image.new('RGBA', (size, size), fill_color)
    new_im.paste(im, (int((size - x) / 2), int((size - y) / 2)))
    return new_im

def process_image(path, out_dir):
    im = Image.open(path).convert("RGBA")
    width, height = im.size
    
    # Left half
    left_half = im.crop((0, 0, width // 2, height))
    # Right half
    right_half = im.crop((width // 2, 0, width, height))
    
    # Trim white borders
    # Assuming top-left pixel is background color (white)
    
    # Convert white to transparent for better icons
    def white_to_transp(img):
        datas = img.getdata()
        newData = []
        for item in datas:
            # Check if it's white or very close to white
            if item[0] > 240 and item[1] > 240 and item[2] > 240:
                newData.append((255, 255, 255, 0))
            else:
                newData.append(item)
        img.putdata(newData)
        return img
    
    left_half = white_to_transp(left_half)
    right_half = white_to_transp(right_half)
    
    left_trimmed = trim(left_half)
    right_trimmed = trim(right_half)
    
    left_square = make_square(left_trimmed)
    right_square = make_square(right_trimmed)
    
    # Main Icon (Left)
    for size in [16, 48, 128]:
        resized = left_square.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(f"{out_dir}/icon-{size}.png")
        
    # Floating/Right-click Icon (Right)
    # Save a generic floating icon and replace content.js svg with it
    right_square.resize((128, 128), Image.Resampling.LANCZOS).save(f"{out_dir}/icon-floating.png")
    
    # Also save the 16x16 one if needed for context menu, though context menu usually uses the 16x16 main icon.
    # The user said: "右边的这个是：选中文本后 浮窗里的icon以及右键的功能icon" (right one is for floating window and right-click function icon)
    # So we should also save a 16x16 version of the right icon for the right-click menu.
    right_square.resize((16, 16), Image.Resampling.LANCZOS).save(f"{out_dir}/icon-floating-16.png")

if __name__ == "__main__":
    process_image(sys.argv[1], sys.argv[2])
