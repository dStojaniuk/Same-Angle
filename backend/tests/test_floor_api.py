from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image, PngImagePlugin

from same_angle import api

PLAN = """{
    "width": 64,
    "height": 64,
    "outline": [[4, 32], [60, 32], [60, 60], [4, 60]],
    "corners": [[4, 32], [60, 32], [60, 60], [4, 60]]
}"""
FIXTURES = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures"


@pytest.mark.parametrize(
    "name", ["grayscale-16bit.png", "linear-gamma.png", "animated-room.png"]
)
def test_requires_preparation_for_pngs_the_renderer_cannot_preserve(name: str) -> None:
    original = (FIXTURES / name).read_bytes()
    photo = UploadFile(BytesIO(original), size=len(original))
    with pytest.raises(HTTPException, match="prepare it for rendering") as error:
        api.render_photo(photo, PLAN)
    assert error.value.status_code == 422


def test_accepts_a_working_png_larger_than_the_source_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with BytesIO() as original:
        Image.new("RGBA", (64, 64), (48, 63, 76, 222)).save(original, "PNG")
        png = original.getvalue()
    monkeypatch.setattr(api, "MAX_PHOTO_BYTES", len(png) - 1)

    response = api.render_photo(UploadFile(BytesIO(png), size=len(png)), PLAN)

    assert response.media_type == "image/png"
    with Image.open(BytesIO(response.body)) as result:
        assert result.getpixel((0, 0)) == (48, 63, 76, 222)


def test_requires_preparation_for_png_with_cicp_color_metadata() -> None:
    metadata = PngImagePlugin.PngInfo()
    metadata.add(b"cICP", bytes((12, 13, 0, 1)))  # Display P3 primaries, sRGB transfer.
    with BytesIO() as original:
        Image.new("RGB", (64, 64), (48, 63, 76)).save(original, "PNG", pnginfo=metadata)
        png = original.getvalue()

    photo = UploadFile(BytesIO(png), size=len(png))
    with pytest.raises(HTTPException, match="prepare it for rendering") as error:
        api.render_photo(photo, PLAN)
    assert error.value.status_code == 422
