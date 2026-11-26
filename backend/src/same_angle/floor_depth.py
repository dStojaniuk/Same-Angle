from functools import cache
from importlib import import_module
from os import getenv
from pathlib import Path
from threading import Lock
from typing import Any

from PIL import Image, ImageChops

from same_angle.floor import PixelPoint, rasterize_polygon, validate_polygon

_inference_lock = Lock()


@cache
def _load_model(checkpoint: str) -> tuple[Any, Any, Any]:
    torch = import_module("torch")
    moge = import_module("moge.model.v2")
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    return moge.MoGeModel.from_pretrained(checkpoint).to(device).eval(), torch, device


def _estimate(photo: Image.Image, checkpoint: str) -> dict[str, Any]:
    np = import_module("numpy")
    with _inference_lock:
        model, torch, device = _load_model(checkpoint)
        tensor = torch.from_numpy(np.array(photo)).to(device).permute(2, 0, 1)
        with torch.inference_mode():
            outputs = model.infer(
                tensor.float() / 255, apply_mask=False, use_fp16=False
            )
        return {
            key: outputs[key].cpu().numpy()
            for key in ("depth", "normal", "mask", "intrinsics")
        }


def _off_plane_mask(
    outline: Image.Image, estimate: dict[str, Any]
) -> Image.Image | None:
    np = import_module("numpy")
    depth, normals = estimate["depth"], estimate["normal"]
    valid = estimate["mask"] & np.isfinite(depth) & (depth > 0)
    inside = np.asarray(outline) > 0
    bounds = outline.getbbox()
    if bounds is None:
        return None

    left, top, right, bottom = bounds
    y, x = np.indices(depth.shape, dtype=np.float32)
    seed = (
        valid
        & inside
        & (y >= bottom - (bottom - top) / 4)
        & (x >= left + (right - left) / 5)
        & (x < right - (right - left) / 5)
    )
    if seed.sum() < 100:
        return None
    floor_normal = np.median(normals[seed], axis=0)
    length = np.linalg.norm(floor_normal)
    if not np.isfinite(length) or length < 0.5:
        return None
    floor_normal /= length
    aligned = np.abs(normals @ floor_normal) >= np.cos(np.radians(30))
    if aligned[seed].mean() < 0.7:
        return None

    width, height = outline.size
    pixels = np.stack(((x + 0.5) / width, (y + 0.5) / height, np.ones_like(x)), axis=-1)
    rays = pixels @ np.linalg.inv(estimate["intrinsics"]).T
    plane_offsets = (rays @ floor_normal) * depth
    plane = np.median(plane_offsets[seed & aligned])
    if not np.isfinite(plane) or abs(plane) < 0.05:
        return None
    near_plane = np.abs(plane_offsets - plane) <= 0.04 * abs(plane)
    if near_plane[seed].mean() < 0.7:
        return None
    suspect = inside & valid & ~(near_plane & aligned)
    return Image.frombytes(
        "L", outline.size, (suspect.astype(np.uint8) * 255).tobytes()
    )


def depth_hint(photo: Image.Image, outline: list[PixelPoint]) -> Image.Image | None:
    checkpoint = getenv("SAME_ANGLE_DEPTH_MODEL_FILE")
    if not checkpoint or not Path(checkpoint).is_file():
        raise FileNotFoundError(
            "Configure a local MoGe-2 checkpoint to check the mask."
        )

    validate_polygon(outline)
    if any(x > photo.width or y > photo.height for x, y in outline):
        raise ValueError("Keep the outline inside the photo.")
    candidate = rasterize_polygon(photo.size, outline)
    working = photo.convert("RGB")
    working.thumbnail((1536, 1536))
    region = candidate.resize(working.size, Image.Resampling.NEAREST)
    hint = _off_plane_mask(region, _estimate(working, checkpoint))
    if hint is None:
        return None
    clipped = ImageChops.darker(
        candidate, hint.resize(photo.size, Image.Resampling.NEAREST)
    )
    if clipped.getbbox() is None:
        return None
    overlay = Image.new("RGBA", photo.size, (255, 139, 38))
    overlay.putalpha(clipped)
    return overlay
