from pathlib import Path

from PIL import Image


def test_rgb_png_roundtrip(tmp_path: Path) -> None:
    image = Image.new("RGB", (4, 3), (232, 202, 158))
    image.putpixel((3, 1), (64, 104, 138))
    path = tmp_path / "sample.png"
    image.save(path)

    with Image.open(path) as restored:
        assert restored.format == "PNG"
        assert restored.mode == "RGB"
        assert restored.size == (4, 3)
        assert restored.tobytes() == image.tobytes()
