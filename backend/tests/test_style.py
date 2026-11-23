from http.client import IncompleteRead
from io import BytesIO
from json import dumps
from struct import pack
from urllib.request import Request

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image, PngImagePlugin

from same_angle import api, style_provider


def upload(size: tuple[int, int], color: str) -> UploadFile:
    stream = BytesIO()
    Image.new("RGB", size, color).save(stream, "PNG")
    stream.seek(0)
    return UploadFile(stream, size=len(stream.getvalue()))


PLAN = {
    "width": 64,
    "height": 48,
    "prompt": "Make the room boho.",
    "editable": [[[4, 4], [60, 4], [60, 45], [4, 45]]],
    "protected": [[[20, 10], [39, 10], [39, 29], [20, 29]]],
}


def test_style_composite_preserves_rgb_outside_the_mask_and_inside_the_door() -> None:
    response = api.render_style(
        upload((64, 48), "red"), dumps(PLAN), upload((32, 24), "green")
    )

    with Image.open(BytesIO(response.body)) as result:
        assert result.size == (64, 48)
        assert result.getpixel((1, 1)) == (255, 0, 0, 255)
        assert result.getpixel((20, 10)) == (255, 0, 0, 255)
        assert result.getpixel((38, 28)) == (255, 0, 0, 255)
        assert result.getpixel((39, 29)) == (0, 128, 0, 255)


@pytest.mark.parametrize("kind", ["16-bit", "linear", "cicp"])
def test_style_rejects_pngs_that_need_color_preparation(kind: str) -> None:
    metadata = PngImagePlugin.PngInfo()
    image = Image.new("RGB", (64, 48), "green")
    if kind == "16-bit":
        image = Image.new("I;16", (64, 48), 8192)
    elif kind == "linear":
        metadata.add(b"gAMA", pack(">I", 100_000))
    else:
        metadata.add(b"cICP", bytes([9, 16, 0, 1]))

    stream = BytesIO()
    image.save(stream, format="PNG", pnginfo=metadata)
    length = stream.tell()
    stream.seek(0)

    with pytest.raises(HTTPException, match="static 8-bit sRGB PNG") as error:
        api.render_style(
            upload((64, 48), "red"), dumps(PLAN), UploadFile(stream, size=length)
        )
    assert error.value.status_code == 422


def test_incomplete_provider_response_is_reported_as_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class IncompleteResponse(BytesIO):
        def read(self, size: int | None = -1, /) -> bytes:
            raise IncompleteRead(b"truncated")

    def respond(request: Request, *, timeout: float) -> BytesIO:
        return IncompleteResponse()

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(style_provider, "urlopen", respond)
    with pytest.raises(
        HTTPException, match="image edit could not be completed"
    ) as error:
        api.render_style(upload((64, 48), "red"), dumps(PLAN))
    assert error.value.status_code == 503


def test_different_aspect_ratios_are_rejected() -> None:
    with pytest.raises(HTTPException, match="original aspect ratio") as error:
        api.render_style(
            upload((64, 48), "red"), dumps(PLAN), upload((64, 47), "green")
        )
    assert error.value.status_code == 422


def test_generation_receives_the_prompt_and_the_same_mask_used_for_compositing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def edit(original: Image.Image, allowed: Image.Image, prompt: str) -> bytes:
        assert original.size == (64, 48)
        assert allowed.getpixel((25, 16)) == 0
        assert allowed.getpixel((7, 7)) == 255
        assert prompt == PLAN["prompt"]
        return upload((64, 48), "blue").file.read()

    monkeypatch.setattr(api, "edit_with_openai", edit)
    response = api.render_style(upload((64, 48), "red"), dumps(PLAN))
    with Image.open(BytesIO(response.body)) as result:
        assert result.getpixel((7, 7)) == (0, 0, 255, 255)
        assert result.getpixel((25, 16)) == (255, 0, 0, 255)


def test_no_provider_key_still_allows_the_import_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(HTTPException, match="import an edited photo") as error:
        api.render_style(upload((64, 48), "red"), dumps(PLAN))
    assert error.value.status_code == 503
    assert (
        api.render_style(
            upload((64, 48), "red"), dumps(PLAN), upload((64, 48), "green")
        ).media_type
        == "image/png"
    )


def test_a_thin_edit_region_keeps_visible_color_after_feathering() -> None:
    plan = {
        **PLAN,
        "width": 512,
        "height": 512,
        "editable": [[[100, 100], [106, 100], [106, 160], [100, 160]]],
    }
    response = api.render_style(
        upload((512, 512), "red"), dumps(plan), upload((512, 512), "green")
    )

    with Image.open(BytesIO(response.body)) as result:
        assert result.getpixel((103, 140)) != (255, 0, 0, 255)
        assert result.getpixel((106, 140)) == (255, 0, 0, 255)


def test_turns_off_feathering_at_a_hard_material_join() -> None:
    plan = {
        **PLAN,
        "width": 512,
        "height": 512,
        "editable": [[[100, 100], [150, 100], [150, 160], [100, 160]]],
        "feather_edges": False,
    }
    response = api.render_style(
        upload((512, 512), "red"), dumps(plan), upload((512, 512), "green")
    )

    with Image.open(BytesIO(response.body)) as result:
        assert result.getpixel((99, 130)) == (255, 0, 0, 255)
        assert result.getpixel((100, 130)) == (0, 128, 0, 255)
