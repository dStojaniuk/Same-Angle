import pytest
from PIL import Image, ImageDraw

from same_angle.floor import oak_texture, render_floor
from same_angle.quick_floor import suggest_floor


def test_suggests_a_floor_grid_for_a_clear_trapezoid() -> None:
    photo = Image.new("RGBA", (192, 144), "#ddd0ba")
    ImageDraw.Draw(photo).polygon(
        [(62, 84), (132, 84), (185, 142), (12, 142)],
        fill="#793345",
    )
    suggestion = suggest_floor(photo)

    assert suggestion.corners is not None
    result = render_floor(photo, suggestion.outline, suggestion.corners, oak_texture())
    assert result.getpixel((90, 30)) == photo.getpixel((90, 30))
    assert result.getpixel((12, 90)) == photo.getpixel((12, 90))
    assert result.getpixel((90, 120)) != photo.getpixel((90, 120))


def test_leaves_the_floor_for_manual_adjustment_when_no_edges_are_visible() -> None:
    photo = Image.new("RGB", (192, 144), "#ddd0ba")
    suggestion = suggest_floor(photo)
    assert suggestion.corners is None
    assert suggestion.outline == []


@pytest.mark.parametrize(
    ("floor", "foreground"),
    [
        ("#793345", "#111111"),
        ("#793345", "#b44d62"),
        ("#793345", "#4e142c"),
        ("#82796c", "#5c5653"),
        ("#82796c", "#786658"),
    ],
)
def test_floor_with_an_obstruction_requires_manual_review(
    floor: str, foreground: str
) -> None:
    photo = Image.new("RGB", (192, 144), "#ddd0ba")
    draw = ImageDraw.Draw(photo)
    draw.polygon([(62, 84), (132, 84), (185, 143), (12, 143)], fill=floor)
    assert suggest_floor(photo).corners is not None

    draw.rectangle((94, 97, 103, 127), fill=foreground)
    suggestion = suggest_floor(photo)
    assert suggestion.corners is None
    assert suggestion.outline == []


def test_simplifying_the_outline_does_not_bridge_a_side_obstruction() -> None:
    photo = Image.new("RGB", (192, 144), "#ddd0ba")
    draw = ImageDraw.Draw(photo)
    draw.polygon([(62, 84), (132, 84), (185, 143), (12, 143)], fill="#793345")
    draw.rectangle((40, 103, 59, 104), fill="#111111")
    suggestion = suggest_floor(photo)
    assert suggestion.corners is None
    assert suggestion.outline == []


@pytest.mark.parametrize("foreground", ["#111111", "#23000b"])
def test_thin_foreground_in_a_large_photo_requires_manual_outline(
    foreground: str,
) -> None:
    photo = Image.new("RGB", (3840, 2880), "#ddd0ba")
    draw = ImageDraw.Draw(photo)
    draw.polygon(
        [(1240, 1680), (2640, 1680), (3700, 2879), (240, 2879)], fill="#793345"
    )
    assert suggest_floor(photo).corners is not None

    draw.rectangle((1910, 2060, 1934, 2300), fill=foreground)
    suggestion = suggest_floor(photo)
    assert suggestion.outline == []
    assert suggestion.corners is None
