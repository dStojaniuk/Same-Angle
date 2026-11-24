from functools import lru_cache
from importlib import import_module
from math import hypot
from pathlib import Path
from typing import Any, cast

from PIL import Image, ImageChops

from same_angle.floor import PixelPoint, rasterize_polygon, validate_polygon
from same_angle.quick_floor import FloorSuggestion, make_floor_suggestion

type Segment = tuple[int, int, int, int]

cv = import_module("cv2")
np = import_module("numpy")
ort = import_module("onnxruntime")

PREVIEW_LIMIT = 420


@lru_cache(maxsize=1)
def _load_model(weights: str) -> Any:
    path = Path(weights).expanduser()
    if not path.is_file() or path.suffix != ".onnx":
        raise ValueError("Set the floor model path to a local Fast-SCNN ONNX file.")
    ort.disable_telemetry_events()
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    try:
        return ort.InferenceSession(
            str(path), sess_options=options, providers=["CPUExecutionProvider"]
        )
    except (
        RuntimeError,
        ValueError,
        ort.capi.onnxruntime_pybind11_state.Fail,
        ort.capi.onnxruntime_pybind11_state.InvalidProtobuf,
        ort.capi.onnxruntime_pybind11_state.InvalidGraph,
    ) as error:
        raise ValueError(
            "The configured Fast-SCNN model could not be opened."
        ) from error


def _floor_mask(photo: Image.Image, weights: str) -> Image.Image:
    session = _load_model(weights)
    inputs = session.get_inputs()
    if len(inputs) != 1 or inputs[0].type != "tensor(float)":
        raise ValueError("Use the binary Fast-SCNN floor checkpoint.")
    model_input = inputs[0]
    shape = model_input.shape
    if (
        not shape
        or shape[1:] != [3, 512, 512]
        or (isinstance(shape[0], int) and shape[0] != 1)
    ):
        raise ValueError("Use the binary Fast-SCNN floor checkpoint.")
    rgb = cv.resize(np.asarray(photo), (512, 512)).astype(np.float32) / 255
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    spread = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    tensor = ((rgb - mean) / spread).transpose(2, 0, 1)[None]
    try:
        outputs = session.run(None, {model_input.name: tensor})
    except (
        ort.capi.onnxruntime_pybind11_state.InvalidArgument,
        ort.capi.onnxruntime_pybind11_state.Fail,
        ort.capi.onnxruntime_pybind11_state.RuntimeException,
    ) as error:
        raise ValueError(
            "The configured Fast-SCNN model could not analyze the photo."
        ) from error
    output = outputs[0] if outputs else None
    if not isinstance(output, np.ndarray) or output.shape != (1, 2, 512, 512):
        raise ValueError("Use the binary Fast-SCNN floor checkpoint.")
    if not np.isfinite(output).all():
        raise ValueError(
            "The configured Fast-SCNN model produced invalid floor scores."
        )
    return Image.fromarray((output[0].argmax(axis=0) == 1).astype(np.uint8) * 255)


def _photo_support(edges: Any, segment: Segment) -> bool:
    x1, y1, x2, y2 = segment
    hits = 0
    for step in range(6):
        x = round(x1 + (x2 - x1) * step / 5)
        y = round(y1 + (y2 - y1) * step / 5)
        hits += bool(edges[max(0, y - 4) : y + 5, max(0, x - 4) : x + 5].any())
    return hits >= 5


def _grid(mask: Image.Image, photo: Image.Image, top: int) -> list[PixelPoint] | None:
    width, height = mask.size
    found = cv.HoughLinesP(
        cv.Canny(np.asarray(mask), 40, 120),
        1,
        np.pi / 180,
        threshold=22,
        minLineLength=25,
        maxLineGap=7,
    )
    if found is None:
        return None
    original_edges = cv.Canny(np.asarray(photo.convert("L")), 30, 90)
    segments = sorted(
        cast(list[Segment], found.reshape(-1, 4).tolist()),
        key=lambda segment: -hypot(segment[2] - segment[0], segment[3] - segment[1]),
    )[:32]
    supported = [line for line in segments if _photo_support(original_edges, line)]
    far = next(
        (
            line
            for line in supported
            if abs(line[3] - line[1]) < abs(line[2] - line[0]) * 0.32
            and max(line[1], line[3]) <= top + height * 0.10
        ),
        None,
    )
    if far is None:
        return None
    x1, y1, x2, y2 = far
    far_slope = (y2 - y1) / (x2 - x1)
    far_intercept = y1 - far_slope * x1
    far_center = (x1 + x2) / 2

    def cross(a: float, b: float, intercept: float) -> tuple[float, float]:
        y = (far_slope * b + intercept) / (1 - far_slope * a)
        return a * y + b, y

    left = right = None
    for x1, y1, x2, y2 in supported:
        if abs(y2 - y1) < height * 0.075:
            continue
        a = (x2 - x1) / (y2 - y1)
        if abs(1 - far_slope * a) < 0.1:
            continue
        b = x1 - a * y1
        x, y = cross(a, b, far_intercept)
        if not (0 <= x <= width and top - height * 0.05 <= y <= top + height * 0.16):
            continue
        if left is None and x < far_center - width * 0.10 and a < 0.16:
            left = (a, b)
        if (
            right is None
            and x > far_center + width * 0.10
            and a > 0.13
            and min(y1, y2) < y + height * 0.14
        ):
            right = (a, b)
    if left is None or right is None or right[0] - left[0] < 0.16:
        return None

    # Extend the observed depth edges across the visible floor.
    near = top + (height - top) * 0.68
    corners = [
        cross(*left, far_intercept),
        cross(*right, far_intercept),
        cross(*right, near),
        cross(*left, near),
    ]
    if not all(
        0 <= x <= width and top - height * 0.06 <= y <= height for x, y in corners
    ):
        return None
    return [(round(x), round(y)) for x, y in corners]


def _contour(mask: Image.Image) -> list[PixelPoint]:
    # Inset before simplifying so model and raster boundaries leave a margin at furniture.
    inset = cv.erode(np.asarray(mask), np.ones((3, 3), dtype=np.uint8), iterations=2)
    found, _ = cv.findContours(inset, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    if not found:
        return []
    largest = max(found, key=cv.contourArea)
    points = cast(
        list[list[int]], cv.approxPolyDP(largest, 0.9, True).reshape(-1, 2).tolist()
    )
    outline = [(x, y) for x, y in points]
    if not 3 <= len(outline) <= 128:
        return []
    try:
        validate_polygon(outline)
    except ValueError:
        return []
    raster = np.asarray(rasterize_polygon(mask.size, outline))
    if (raster & ~np.asarray(mask)).any():
        return []
    return outline


def suggest_with_model(source: Image.Image, weights: str) -> FloorSuggestion:
    photo = source.convert("RGB")
    thumbnail = photo.copy()
    thumbnail.thumbnail((PREVIEW_LIMIT, PREVIEW_LIMIT))
    if min(thumbnail.size) < 48:
        return FloorSuggestion([])
    return _suggest_from_mask(source.size, thumbnail, _floor_mask(photo, weights))


def _suggest_from_mask(
    source_size: tuple[int, int], thumbnail: Image.Image, native_mask: Image.Image
) -> FloorSuggestion:
    mask = native_mask.resize(thumbnail.size, Image.Resampling.NEAREST)
    bounds = mask.getbbox()
    if (
        bounds is None
        or bounds[3] < mask.height * 0.95
        or bounds[1] < mask.height * 0.35
    ):
        return FloorSuggestion([])
    outline = _contour(mask)
    if not outline:
        return FloorSuggestion([])
    corners = _grid(mask, thumbnail, bounds[1])
    if not corners:
        return FloorSuggestion([])

    def resize(points: list[PixelPoint]) -> list[PixelPoint]:
        return [
            (
                round(x * source_size[0] / mask.width),
                round(y * source_size[1] / mask.height),
            )
            for x, y in points
        ]

    original_outline = resize(outline)
    working_mask = rasterize_polygon(source_size, original_outline)
    model_floor = native_mask.resize(source_size, Image.Resampling.NEAREST)
    if ImageChops.subtract(working_mask, model_floor).getbbox():
        return FloorSuggestion([])

    return make_floor_suggestion(source_size, original_outline, resize(corners))
