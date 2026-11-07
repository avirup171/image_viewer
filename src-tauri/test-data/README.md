# Test data

`rotated.heic`: 60×40 pixels as stored (left half red, right half blue) with
a HEIF rotation (`irot`) so it *displays* as 40×60 with red on top, and EXIF
Model "TestCam HEIC". Used by the HEIC tests in `src/heic/` and `src/edit/`.

Made with Python and pillow-heif (libheif + x265):

```python
from PIL import Image
import pillow_heif
pillow_heif.register_heif_opener()
im = Image.new("RGB", (60, 40))
for x in range(60):
    for y in range(40):
        im.putpixel((x, y), (220, 30, 30) if x < 30 else (30, 60, 220))
exif = Image.Exif()
exif[0x0110] = "TestCam HEIC"
exif[0x0112] = 6
im.save("rotated.heic", format="HEIF", exif=exif.tobytes(), quality=90)
```
