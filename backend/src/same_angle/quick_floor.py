from dataclasses import dataclass
from os import getenv
from statistics import median, quantiles
from typing import cast

from PIL import Image, ImageChops, ImageDraw

from same_angle.floor import PixelPoint, rasterize_polygon, validate_floor_grid

OAK_PROMPTS = frozenset(
    {
        "oak",
        "light oak",
        "change the floor to light oak",
        "replace the floor with light oak",
        "dąb",
        "jasny dąb",
        "dębowa podłoga",
        "zmień podłogę na jasny dąb",
        "wymień podłogę na jasny dąb",
    }
)


@dataclass(frozen=True)
class FloorSuggestion:
    outline: list[PixelPoint]
    corners: list[PixelPoint] | None = None


def make_floor_suggestion(
    size: tuple[int, int],
    outline: list[PixelPoint],
    corners: list[PixelPoint] | None,
) -> FloorSuggestion:
    if corners:
        try:
            validate_floor_grid(size, outline, corners)
        except ValueError:
            corners = None
    return FloorSuggestion(outline, corners)


@dataclass(frozen=True)
class FloorRow:
    y: int
    left: int
    right: int
    coverage: float


def requests_oak(prompt: str) -> bool:
    return " ".join(prompt.casefold().split()).rstrip(".!?") in OAK_PROMPTS


def _hue_distance(first: int, second: int) -> int:
    distance = abs(first - second)
    return min(distance, 256 - distance)


def _floor_color_mask(photo: Image.Image, reference: Image.Image) -> Image.Image:
    width, height = reference.size
    colors = cast(tuple[tuple[int, int, int], ...], reference.get_flattened_data())
    samples = [
        colors[y * width + x]
        for y in range(height * 9 // 10, height, max(1, height // 40))
        for x in range(width // 3, 5 * width // 6, max(1, width // 24))
    ]
    hues = [h for h, s, _ in samples if s >= 55]
    hue = (
        max(hues, key=lambda h: sum(_hue_distance(h, other) <= 11 for other in hues))
        if hues
        else 0
    )
    saturated = len(hues) > len(samples) // 2
    saturations = quantiles([s for _, s, _ in samples], n=10, method="inclusive")
    values = quantiles([v for _, _, v in samples], n=10, method="inclusive")

    hue_band, saturation_band, value_band = photo.convert("HSV").split()
    # Use the sampled variation so a similar hue alone cannot absorb furniture.
    matching_saturation = saturation_band.point(
        lambda s: 255 * (saturations[0] - 16 <= s <= saturations[-1] + 16)
    )
    matching_value = value_band.point(
        lambda v: 255 * (values[0] - 12 <= v <= values[-1] + 12)
    )
    mask = ImageChops.darker(matching_saturation, matching_value)
    if not saturated:
        return mask

    matching_hue = hue_band.point(lambda h: 255 * (_hue_distance(h, hue) <= 14))
    return ImageChops.darker(mask, matching_hue)


def _floor_rows(mask: Image.Image) -> list[FloorRow]:
    width, height = mask.size
    mask.paste(0, (0, 0, width, height * 2 // 5))
    pixels = mask.get_flattened_data()
    central_columns = sorted(
        range(width // 3, 5 * width // 6), key=lambda x: abs(x - width / 2)
    )
    seed = next(
        (
            (x, y)
            for y in range(height - 1, height - max(3, height // 40), -1)
            for x in central_columns
            if pixels[y * width + x]
        ),
        None,
    )
    if seed is None:
        return []
    ImageDraw.floodfill(mask, seed, 128)
    pixels = mask.get_flattened_data()
    rows = []
    for y in range(seed[1], height * 2 // 5, -1):
        hits = [
            x
            for x, value in enumerate(pixels[y * width : (y + 1) * width])
            if value == 128
        ]
        if len(hits) < width * 0.15:
            break
        left, right = hits[0], hits[-1] + 1
        rows.append(FloorRow(y, left, right, len(hits) / (right - left)))
    rows.reverse()
    return rows


def _fit_side(points: list[PixelPoint], height: int) -> tuple[float, float] | None:
    if len(points) < 6 or points[-1][1] - points[0][1] < height * 0.09:
        return None

    x_mean = sum(x for x, _ in points) / len(points)
    y_mean = sum(y for _, y in points) / len(points)
    slope = sum((x - x_mean) * (y - y_mean) for x, y in points) / sum(
        (y - y_mean) ** 2 for _, y in points
    )
    intercept = x_mean - slope * y_mean
    errors = [abs(x - (slope * y + intercept)) for x, y in points]
    if median(errors) > 1.6 or sum(error <= 3 for error in errors) < len(errors) * 0.85:
        return None
    return slope, intercept


def _grid(rows: list[FloorRow], width: int, height: int) -> list[PixelPoint] | None:
    left = _fit_side([(row.left, row.y) for row in rows if row.left > 1], height)
    right = _fit_side(
        [(row.right, row.y) for row in rows if row.right < width - 1], height
    )
    if left is None or right is None or left[0] > -0.07 or right[0] < 0.07:
        return None

    far = rows[0]
    near = rows[min(len(rows) - 1, height // 5)]
    if (
        abs(left[0] * far.y + left[1] - far.left) > 4
        or abs(right[0] * far.y + right[1] - far.right) > 4
    ):
        return None
    return [
        (far.left, far.y),
        (far.right, far.y),
        (near.right, near.y),
        (near.left, near.y),
    ]


def suggest_floor(photo: Image.Image) -> FloorSuggestion:
    weights = getenv("SAME_ANGLE_FLOOR_MODEL_FILE")
    if weights:
        try:
            from same_angle.floor_vision import suggest_with_model
        except ModuleNotFoundError as error:
            raise ValueError(
                "Install the floor-vision extra to use the configured floor model."
            ) from error
        return suggest_with_model(photo, weights)

    return _suggest_from_color(photo)


def _suggest_from_color(photo: Image.Image) -> FloorSuggestion:
    thumbnail = photo.convert("RGB")
    thumbnail.thumbnail((192, 192))
    width, height = thumbnail.size
    if min(width, height) < 48:
        return FloorSuggestion([])
    reference = thumbnail.convert("HSV")
    rows = _floor_rows(_floor_color_mask(thumbnail, reference))
    if (
        len(rows) < height * 0.12
        or rows[0].y <= height * 0.44
        or sum(row.coverage >= 0.75 for row in rows) < len(rows) * 0.85
    ):
        return FloorSuggestion([])

    def original_points(points: list[PixelPoint]) -> list[PixelPoint]:
        return [
            (round(x * photo.width / width), round(y * photo.height / height))
            for x, y in points
        ]

    first_solid = next(
        (index for index, row in enumerate(rows) if row.coverage >= 0.9), None
    )
    if first_solid is None or len(rows) - first_solid < height * 0.12:
        return FloorSuggestion([])
    rows = rows[first_solid:]
    # A polygon through the row endpoints would paint over any interior gaps.
    if any(row.coverage < 1 for row in rows):
        return FloorSuggestion([])
    steps = rows[: -1 : max(1, len(rows) // 18)] + [rows[-1]]
    left = [(row.left + 1, row.y) for row in steps]
    right = [(row.right - 1, row.y) for row in reversed(steps)]
    outline = left + right
    simplified_mask = rasterize_polygon((width, height), outline)
    for row in rows:
        bounds = simplified_mask.crop((0, row.y, width, row.y + 1)).getbbox()
        if bounds and (bounds[0] < row.left or bounds[2] > row.right):
            return FloorSuggestion([])
    original_outline = original_points(outline)
    working_mask = rasterize_polygon(photo.size, original_outline)
    area = working_mask.getbbox()
    if area is None:
        return FloorSuggestion([])
    matching_pixels = _floor_color_mask(photo.crop(area), reference)
    if ImageChops.subtract(working_mask.crop(area), matching_pixels).getbbox():
        return FloorSuggestion([])

    grid = _grid(rows, width, height)
    return make_floor_suggestion(
        photo.size,
        original_outline,
        original_points(grid) if grid else None,
    )
