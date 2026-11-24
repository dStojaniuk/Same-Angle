from collections.abc import Sequence
from io import BytesIO

from PIL import Image, ImageChops, ImageCms, ImageFilter

from same_angle.floor import PixelPoint, rasterize_polygon, validate_polygon

type Region = Sequence[PixelPoint]


def style_mask(
    size: tuple[int, int], editable: Sequence[Region], protected: Sequence[Region]
) -> Image.Image:
    width, height = size

    def render_regions(regions: Sequence[Region]) -> Image.Image:
        mask = Image.new("L", size)
        for region in regions:
            if any(not (0 <= x <= width and 0 <= y <= height) for x, y in region):
                raise ValueError("Keep the regions inside the photo.")
            try:
                validate_polygon(region)
            except ValueError as error:
                raise ValueError(
                    "Draw each region as a simple polygon with a visible area."
                ) from error
            mask = ImageChops.lighter(mask, rasterize_polygon(size, region))
        return mask

    locked = render_regions(protected)
    if locked.getbbox() is None:
        raise ValueError("Mark at least one architectural region to protect.")
    allowed = ImageChops.subtract(render_regions(editable), locked)
    if allowed.getbbox() is None:
        raise ValueError("Leave a visible area inside the edit mask.")
    return allowed


def style_guide(original: Image.Image, allowed: Image.Image) -> Image.Image:
    guide = original.convert("RGB")
    guide.paste("#ffd14a", mask=allowed.point([0] * 255 + [110]))
    return guide


def composite_style(
    original: Image.Image,
    candidate: Image.Image,
    allowed: Image.Image,
    *,
    feather_edges: bool = True,
) -> Image.Image:
    if original.width * candidate.height != candidate.width * original.height:
        raise ValueError("The edited image must have the original aspect ratio.")

    edited = candidate.convert("RGBA")
    if edited.getchannel("A").getextrema()[0] != 255:
        raise ValueError("Use an edited image without transparency.")

    source_profile = original.info.get("icc_profile")
    if source_profile and original.mode not in {"RGB", "RGBA"}:
        raise ValueError(
            "Open the source photo in the editor to prepare it for rendering."
        )

    candidate_profile = candidate.info.get("icc_profile")
    if source_profile != candidate_profile:
        try:
            srgb = ImageCms.createProfile("sRGB")
            cms_input = (
                candidate
                if candidate_profile and candidate.mode in {"L", "LA", "LAB", "CMYK"}
                else edited
            )
            if cms_input.mode == "LA":
                cms_input = cms_input.convert("L")
            converted = ImageCms.profileToProfile(
                cms_input,
                BytesIO(candidate_profile) if candidate_profile else srgb,
                BytesIO(source_profile) if source_profile else srgb,
                outputMode="RGBA",
            )
            if converted is None:
                raise ValueError("Unable to convert image colors.")
            edited = converted
        except ImageCms.PyCMSError as error:
            raise ValueError(
                "Convert the images to sRGB before importing the edit."
            ) from error

    if edited.size != original.size:
        edited = edited.resize(original.size, Image.Resampling.LANCZOS)
    source = original.convert("RGBA")
    radius = min(10, min(source.size) / 128)
    if feather_edges and radius >= 1:
        # Fade on the editable side only. A protected pixel always has zero alpha.
        softened = allowed.filter(ImageFilter.GaussianBlur(radius))
        feather = softened.point([max(32, 2 * value - 255) for value in range(256)])
        allowed = ImageChops.multiply(allowed, feather)

    return Image.composite(edited, source, allowed)
