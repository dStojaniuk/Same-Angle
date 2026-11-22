import pytest
from PIL import Image

from same_angle.floor import PixelPoint, render_floor


def test_projects_boards_towards_the_back_and_preserves_protected_pixels() -> None:
    original = Image.new("RGBA", (100, 100), (48, 63, 76, 222))
    outline: list[PixelPoint] = [(5, 15), (95, 15), (95, 95), (5, 95)]
    corners: list[PixelPoint] = [(30, 20), (70, 20), (90, 90), (10, 90)]
    tile = Image.new("RGB", (48, 48), "red")
    tile.paste("blue", (12, 0, 48, 48))

    result = render_floor(original, outline, corners, tile)

    assert result.size == original.size
    assert (
        result.crop((0, 0, 100, 15)).tobytes()
        == original.crop((0, 0, 100, 15)).tobytes()
    )
    assert (
        result.crop((0, 0, 5, 100)).tobytes() == original.crop((0, 0, 5, 100)).tobytes()
    )
    assert (
        result.crop((95, 0, 100, 100)).tobytes()
        == original.crop((95, 0, 100, 100)).tobytes()
    )
    assert (
        result.crop((0, 95, 100, 100)).tobytes()
        == original.crop((0, 95, 100, 100)).tobytes()
    )
    assert result.getchannel("A").tobytes() == original.getchannel("A").tobytes()
    # The same image column crosses a board boundary as the floor widens.
    near_back = result.getpixel((34, 24))
    near_front = result.getpixel((34, 86))
    assert isinstance(near_back, tuple) and near_back[0] > near_back[2]
    assert isinstance(near_front, tuple) and near_front[2] > near_front[0]
    assert original.getpixel((34, 24)) == (48, 63, 76, 222)


def test_refuses_a_grid_with_crossing_corners() -> None:
    original = Image.new("RGB", (100, 100))
    outline: list[PixelPoint] = [(0, 10), (100, 10), (100, 100), (0, 100)]
    crossed: list[PixelPoint] = [(25, 30), (75, 30), (10, 90), (90, 90)]
    with pytest.raises(ValueError, match="clockwise"):
        render_floor(original, outline, crossed, original)


def test_refuses_an_outline_that_crosses_the_grid_horizon() -> None:
    original = Image.new("RGB", (100, 100))
    outline: list[PixelPoint] = [(0, 0), (100, 0), (100, 100), (0, 100)]
    corners: list[PixelPoint] = [(30, 40), (70, 40), (90, 70), (10, 70)]
    with pytest.raises(ValueError, match="horizon"):
        render_floor(original, outline, corners, original)
