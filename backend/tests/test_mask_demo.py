from pathlib import Path

from PIL import Image

from examples.mask_demo import MASK_ROWS, main


def test_demo_writes_images_and_previews(tmp_path: Path) -> None:
    main(tmp_path)

    for name, mode in (("original", "RGB"), ("mask", "L"), ("result", "RGB")):
        with Image.open(tmp_path / f"{name}.png") as image:
            assert image.format == "PNG"
            assert image.size == (4, 3)
            assert image.mode == mode
            if name == "mask":
                assert image.tobytes() == bytes(
                    255 * selected for row in MASK_ROWS for selected in row
                )
            with Image.open(tmp_path / f"{name}-preview.png") as preview:
                assert preview.format == "PNG"
                assert preview.size == (320, 240)
                assert preview.mode == mode
                expected = image.resize(preview.size, Image.Resampling.NEAREST)
                assert preview.tobytes() == expected.tobytes()
