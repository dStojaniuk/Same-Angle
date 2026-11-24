from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw

from same_angle.floor import rasterize_polygon

pytest.importorskip("cv2")
pytest.importorskip("onnxruntime")

from same_angle import floor_vision
from same_angle.floor_vision import _suggest_from_mask, suggest_with_model


@pytest.fixture
def floor_scene() -> tuple[Image.Image, Image.Image]:
    mask = Image.new("L", (315, 420))
    ImageDraw.Draw(mask).polygon(
        [(24, 246), (148, 224), (313, 390), (313, 419), (19, 419)], fill=255
    )
    preview = Image.new("RGB", mask.size, "#ddd0ba")
    preview.paste("#793345", mask=mask)
    return preview, mask


def test_model_mask_and_visible_edges_can_supply_a_grid(
    floor_scene: tuple[Image.Image, Image.Image],
) -> None:
    photo, mask = floor_scene
    suggestion = _suggest_from_mask(photo.size, photo, mask)

    assert suggestion.corners is not None
    outline_mask = rasterize_polygon(photo.size, suggestion.outline)
    assert outline_mask.getpixel((150, 355)) == 255
    assert outline_mask.getpixel((150, 150)) == 0


def test_without_matching_photo_edges_use_manual_outline(
    floor_scene: tuple[Image.Image, Image.Image],
) -> None:
    _, mask = floor_scene
    blank = Image.new("RGB", mask.size, "#ddd0ba")
    suggestion = _suggest_from_mask(blank.size, blank, mask)

    assert suggestion.corners is None
    assert not suggestion.outline


def test_invalid_checkpoint_reports_setup_error(tmp_path: Path) -> None:
    checkpoint = tmp_path / "invalid.onnx"
    checkpoint.write_bytes(b"not an onnx graph")

    with pytest.raises(ValueError, match="could not be opened"):
        suggest_with_model(Image.new("RGB", (192, 144)), str(checkpoint))


def test_native_mask_gap_requires_manual_outline(
    floor_scene: tuple[Image.Image, Image.Image],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    photo, preview = floor_scene
    mask = preview.resize((512, 512), Image.Resampling.NEAREST)
    photo = photo.resize((1260, 1680), Image.Resampling.NEAREST)
    np = floor_vision.np

    def predict(*args: object) -> list[object]:
        floor = np.asarray(mask) == 255
        return [np.stack((~floor, floor))[None].astype(np.float32)]

    session = SimpleNamespace(
        get_inputs=lambda: [
            SimpleNamespace(name="image", shape=[1, 3, 512, 512], type="tensor(float)")
        ],
        run=predict,
    )
    monkeypatch.setattr(floor_vision, "_load_model", lambda _: session)
    assert suggest_with_model(photo, "floor.onnx").corners is not None

    ImageDraw.Draw(mask).line([(183, 360), (183, 490)], fill=0)
    suggestion = suggest_with_model(photo, "floor.onnx")
    assert suggestion.outline == []
    assert suggestion.corners is None


@pytest.mark.parametrize(
    ("batch", "tensor_type", "message"),
    [
        (2, "tensor(float)", "binary Fast-SCNN"),
        (1, "tensor(double)", "binary Fast-SCNN"),
        (1, "tensor(float)", "could not analyze the photo"),
    ],
)
def test_incompatible_model_reports_configuration_error(
    monkeypatch: pytest.MonkeyPatch,
    batch: int,
    tensor_type: str,
    message: str,
) -> None:
    def bad_inference(*args: object) -> list[object]:
        raise floor_vision.ort.capi.onnxruntime_pybind11_state.InvalidArgument(
            "invalid input"
        )

    session = SimpleNamespace(
        get_inputs=lambda: [
            SimpleNamespace(name="image", shape=[batch, 3, 512, 512], type=tensor_type)
        ],
        run=bad_inference,
    )
    monkeypatch.setattr(floor_vision, "_load_model", lambda _: session)
    with pytest.raises(ValueError, match=message):
        suggest_with_model(Image.new("RGB", (192, 144)), "floor.onnx")


@pytest.mark.parametrize(
    ("invalid_score", "message"),
    [
        (None, "binary Fast-SCNN"),
        (float("nan"), "invalid floor scores"),
        (float("inf"), "invalid floor scores"),
    ],
)
def test_invalid_model_output_reports_configuration_error(
    monkeypatch: pytest.MonkeyPatch,
    invalid_score: float | None,
    message: str,
) -> None:
    output = (
        []
        if invalid_score is None
        else floor_vision.np.full(
            (1, 2, 512, 512), invalid_score, dtype=floor_vision.np.float32
        )
    )
    session = SimpleNamespace(
        get_inputs=lambda: [
            SimpleNamespace(name="image", shape=[1, 3, 512, 512], type="tensor(float)")
        ],
        run=lambda *_: [output],
    )
    monkeypatch.setattr(floor_vision, "_load_model", lambda _: session)
    with pytest.raises(ValueError, match=message):
        suggest_with_model(Image.new("RGB", (192, 144)), "floor.onnx")


def test_keeps_outline_for_grid_that_crosses_the_horizon() -> None:
    mask = Image.new("L", (315, 420))
    ImageDraw.Draw(mask).polygon(
        [
            (116, 265),
            (151, 265),
            (151, 224),
            (157, 224),
            (157, 265),
            (188, 265),
            (314, 357),
            (314, 419),
            (0, 419),
            (9, 357),
        ],
        fill=255,
    )
    photo = Image.new("RGB", mask.size, "#ddd0ba")
    photo.paste("#793345", mask=mask)

    suggestion = _suggest_from_mask(photo.size, photo, mask)
    assert suggestion.outline
    assert suggestion.corners is None
