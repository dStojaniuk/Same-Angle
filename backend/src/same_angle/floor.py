from collections.abc import Sequence
from functools import cache
from math import ceil, floor, sin
from random import Random

from PIL import Image, ImageChops, ImageDraw

type PixelPoint = tuple[int, int]
type Matrix = tuple[float, float, float, float, float, float, float, float, float]


def _cross(a: PixelPoint, b: PixelPoint, c: PixelPoint) -> int:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _edges_cross(a: PixelPoint, b: PixelPoint, c: PixelPoint, d: PixelPoint) -> bool:
    def on_edge(start: PixelPoint, end: PixelPoint, point: PixelPoint) -> bool:
        return all(
            min(s, e) <= p <= max(s, e)
            for s, e, p in zip(start, end, point, strict=True)
        )

    abc, abd, cda, cdb = (
        _cross(a, b, c),
        _cross(a, b, d),
        _cross(c, d, a),
        _cross(c, d, b),
    )
    return (
        (abc * abd < 0 and cda * cdb < 0)
        or (abc == 0 and on_edge(a, b, c))
        or (abd == 0 and on_edge(a, b, d))
        or (cda == 0 and on_edge(c, d, a))
        or (cdb == 0 and on_edge(c, d, b))
    )


def _validate_outline(outline: Sequence[PixelPoint]) -> None:
    edges = (
        list(zip(outline, (*outline[1:], outline[0]), strict=True)) if outline else []
    )
    if len(edges) < 3 or len(set(outline)) != len(edges):
        raise ValueError("Draw a floor outline with at least three distinct points.")
    if sum(ax * by - ay * bx for (ax, ay), (bx, by) in edges) == 0:
        raise ValueError("Draw a floor outline with a visible area.")
    for i, (a, b) in enumerate(edges):
        for j in range(i + 2, len(edges)):
            if i == 0 and j == len(edges) - 1:
                continue
            c, d = edges[j]
            if _edges_cross(a, b, c, d):
                raise ValueError(
                    "Move the floor outline points so its edges do not cross."
                )


def _photo_to_floor(corners: Sequence[PixelPoint]) -> Matrix:
    if len(corners) != 4 or any(
        _cross(corners[i], corners[(i + 1) % 4], corners[(i + 2) % 4]) <= 0
        for i in range(4)
    ):
        raise ValueError(
            "Place the four grid corners in clockwise order around the floor."
        )

    # Project the unit square onto the four photo corners, then invert the homography.
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = corners
    dx1, dx2 = x1 - x2, x3 - x2
    dy1, dy2 = y1 - y2, y3 - y2
    sx, sy = x0 - x1 + x2 - x3, y0 - y1 + y2 - y3
    denominator = dx1 * dy2 - dx2 * dy1
    g = (sx * dy2 - sy * dx2) / denominator
    h = (dx1 * sy - dy1 * sx) / denominator
    a, b, c = x1 * (1 + g) - x0, x3 * (1 + h) - x0, x0
    d, e, f = y1 * (1 + g) - y0, y3 * (1 + h) - y0, y0
    return (
        e - f * h,
        c * h - b,
        b * f - c * e,
        f * g - d,
        a - c * g,
        c * d - a * f,
        d * h - e * g,
        b * g - a * h,
        a * e - b * d,
    )


def _project_texture(
    size: tuple[int, int],
    outline: Sequence[PixelPoint],
    inverse: Matrix,
    texture: Image.Image,
) -> Image.Image:
    a, b, c, d, e, f, g, h, k = inverse
    divisors = [g * x + h * y + k for x, y in outline]
    if min(divisors) <= 0 <= max(divisors):
        raise ValueError(
            "Move the grid so its horizon stays outside the floor outline."
        )

    u = [(a * x + b * y + c) / w for (x, y), w in zip(outline, divisors, strict=True)]
    v = [(d * x + e * y + f) / w for (x, y), w in zip(outline, divisors, strict=True)]
    left, top = floor(min(u)) - 1, floor(min(v)) - 1
    columns, rows = ceil(max(u)) + 1 - left, ceil(max(v)) + 1 - top
    if max(columns, rows) > 64:
        raise ValueError("Spread the grid corners out over more of the floor.")

    pixels_per_tile = min(texture.width, texture.height, 1536 // max(columns, rows))
    tile = texture.resize((pixels_per_tile, pixels_per_tile), Image.Resampling.BICUBIC)
    material = Image.new("RGB", (columns * pixels_per_tile, rows * pixels_per_tile))
    for row in range(rows):
        for column in range(columns):
            material.paste(tile, (column * pixels_per_tile, row * pixels_per_tile))

    # Pillow's output-to-source transform has a fixed denominator constant of 1.
    # Pad the output origin by one pixel if it happens to sit on the horizon.
    offset_x = int(abs(k) < 1e-8 and abs(g) >= abs(h))
    offset_y = int(abs(k) < 1e-8 and not offset_x)
    c, f, k = (
        c - a * offset_x - b * offset_y,
        f - d * offset_x - e * offset_y,
        k - g * offset_x - h * offset_y,
    )
    scale = pixels_per_tile / k
    coefficients = (
        (a - left * g) * scale,
        (b - left * h) * scale,
        (c - left * k) * scale,
        (d - top * g) * scale,
        (e - top * h) * scale,
        (f - top * k) * scale,
        g / k,
        h / k,
    )
    width, height = size
    projected = material.transform(
        (width + offset_x, height + offset_y),
        Image.Transform.PERSPECTIVE,
        coefficients,
        Image.Resampling.BICUBIC,
    )
    return (
        projected.crop((offset_x, offset_y, width + offset_x, height + offset_y))
        if offset_x or offset_y
        else projected
    )


def _rasterize_outline(
    size: tuple[int, int], outline: Sequence[PixelPoint]
) -> Image.Image:
    width, height = size
    if height > width:
        return _rasterize_outline(
            (height, width), [(y, x) for x, y in outline]
        ).transpose(Image.Transpose.TRANSPOSE)

    edges = list(zip(outline, (*outline[1:], outline[0]), strict=True))
    mask = Image.new("L", size)
    draw = ImageDraw.Draw(mask)
    ys = [y for _, y in outline]
    # The editor's coordinates mark pixel edges. Include only centers inside the outline.
    for y in range(min(ys), max(ys)):
        center_y = y + 0.5
        intersections = sorted(
            ax + (bx - ax) * (center_y - ay) / (by - ay)
            for (ax, ay), (bx, by) in edges
            if min(ay, by) < center_y < max(ay, by)
        )
        for left, right in zip(intersections[::2], intersections[1::2], strict=True):
            start, end = ceil(left - 0.5), ceil(right - 0.5)
            if start < end:
                draw.line((start, y, end - 1, y), fill=255)
    return mask


def render_floor(
    original: Image.Image,
    outline: Sequence[PixelPoint],
    corners: Sequence[PixelPoint],
    texture: Image.Image,
) -> Image.Image:
    """Replace the outlined area in oriented photo coordinates and preserve the other pixels."""
    if any(
        not (0 <= x <= original.width and 0 <= y <= original.height)
        for x, y in (*outline, *corners)
    ):
        raise ValueError("Keep the outline and grid corners inside the photo.")
    _validate_outline(outline)
    inverse = _photo_to_floor(corners)
    projected = _project_texture(original.size, outline, inverse, texture)
    source = original.convert("RGBA")
    mask = _rasterize_outline(source.size, outline)
    shade = source.convert("L").point(
        lambda brightness: round(160 + (95 / 255) * brightness)
    )
    shaded = ImageChops.multiply(projected, shade.convert("RGB"))
    shaded.putalpha(source.getchannel("A"))
    return Image.composite(shaded, source, mask)


@cache
def oak_texture() -> Image.Image:
    """Create one repeatable tile with six boards across its width."""
    plank_width, tile_size = 48, 288
    noise = Random(42)
    texture = Image.new("RGB", (tile_size, tile_size))
    pixels = []
    for y in range(tile_size):
        for x in range(tile_size):
            board, across = divmod(x, plank_width)
            along = (y + board * 89) % tile_size
            grain = 5 * sin(across * 0.9 + 1.6 * sin(y * 0.026))
            variation = (
                grain
                + 5 * sin(across * 1.9 + y * 0.043)
                + (board % 4) * 5
                + noise.randint(-4, 4)
            )
            seam = 23 if across == 0 or along == 0 else 0
            pixels.append(
                (
                    round(174 + variation - seam),
                    round(119 + variation - seam),
                    round(69 + variation - seam),
                )
            )
    texture.putdata(pixels)
    return texture
