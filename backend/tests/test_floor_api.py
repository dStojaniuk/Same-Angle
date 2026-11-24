from io import BytesIO
from json import dumps, loads
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


def test_renders_calibrated_tiles_and_protects_pixels_outside_the_outline() -> None:
    plan = """{
        "width": 64,
        "height": 64,
        "outline": [[4, 33], [60, 33], [60, 60], [4, 60]],
        "projection": [0.02, 0, -0.64, 0, 0, 1, 0, 0.02, -0.64]
    }"""
    with BytesIO() as original:
        Image.new("RGBA", (64, 64), (48, 63, 76, 222)).save(original, "PNG")
        png = original.getvalue()

    response = api.render_photo(UploadFile(BytesIO(png), size=len(png)), plan)

    with Image.open(BytesIO(response.body)) as result:
        assert result.getpixel((32, 32)) == (48, 63, 76, 222)
        edited = result.getpixel((32, 45))
        assert isinstance(edited, tuple)
        assert edited != (48, 63, 76, 222)
        assert edited[3] == 222


@pytest.mark.parametrize(
    ("surface", "message"),
    [
        (
            '"projection": [0.02, 0, -0.64, 0, 0, 1, 0, 0.02, -0.8]',
            "below the calibrated horizon",
        ),
        (
            (
                '"corners": [[4, 33], [60, 33], [60, 60], [4, 60]], '
                '"projection": [0.02, 0, -0.64, 0, 0, 1, 0, 0.02, -0.64]'
            ),
            "four grid corners or a calibrated floor projection",
        ),
    ],
)
def test_rejects_an_unsafe_or_ambiguous_calibrated_plan(
    surface: str, message: str
) -> None:
    plan = (
        '{"width": 64, "height": 64, '
        '"outline": [[4, 33], [60, 33], [60, 60], [4, 60]], ' + surface + "}"
    )
    with BytesIO() as original:
        Image.new("RGB", (64, 64)).save(original, "PNG")
        png = original.getvalue()

    with pytest.raises(HTTPException, match=message) as error:
        api.render_photo(UploadFile(BytesIO(png), size=len(png)), plan)
    assert error.value.status_code == 422


@pytest.mark.parametrize(
    ("geometry", "adjust", "message"),
    [
        (
            {"outline": [[30, 40], [31, 40], [30, 41]]},
            "outline",
            "covers floor pixels",
        ),
        (
            {"corners": [[24, 46], [40, 46], [56, 61], [8, 61]]},
            "grid",
            "horizon stays outside",
        ),
    ],
)
def test_floor_geometry_error_names_the_editor_to_reopen(
    geometry: dict[str, list[list[int]]], adjust: str, message: str
) -> None:
    original = BytesIO()
    Image.new("RGB", (64, 64)).save(original, "PNG")
    original.seek(0)
    plan = dumps({**loads(PLAN), **geometry})

    with pytest.raises(HTTPException, match=message) as error:
        api.render_photo(UploadFile(original), plan, prompt="light oak")
    assert error.value.status_code == 422
    assert error.value.headers == {"X-Same-Angle-Floor-Adjust": adjust}
