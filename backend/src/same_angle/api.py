from collections.abc import Awaitable, Callable
from io import BytesIO
from struct import unpack
from typing import Annotated, BinaryIO, Literal

from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageChops, ImageOps
from PIL.PngImagePlugin import PngImageFile
from pydantic import BaseModel, Field, ValidationError

from same_angle.codex_provider import (
    NO_EDIT_MESSAGE,
    CodexProviderError,
    codex_status,
    edit_with_codex,
)
from same_angle.floor import (
    FloorGeometryError,
    Matrix,
    oak_texture,
    render_calibrated_floor,
    render_floor,
)
from same_angle.quick_floor import requests_oak, suggest_floor
from same_angle.style import composite_style, style_mask
from same_angle.style_provider import (
    StyleProviderError,
    edit_with_openai,
    style_provider_configured,
)

app = FastAPI(title="Same Angle local renderer")
MAX_PHOTO_BYTES = 25 * 1024 * 1024
# An 8-bit RGBA snapshot of a 24 MP photo can exceed the source file limit.
MAX_WORKING_PNG_BYTES = 100 * 1024 * 1024
MAX_PHOTO_PIXELS = 24_000_000
MAX_PLAN_BYTES = 8192
MAX_OUTLINE_POINTS = 128
RENDER_PATH = "/api/floor-render"
FLOOR_SUGGESTION_PATH = "/api/floor-suggestion"
STYLE_PATH = "/api/style-render"
MAX_STYLE_PLAN_BYTES = 32 * 1024

type Coordinate = Annotated[int, Field(ge=0, strict=True)]
type Point = tuple[Coordinate, Coordinate]
type Dimension = Annotated[int, Field(gt=0, strict=True)]


class FloorPlan(BaseModel):
    width: Dimension
    height: Dimension
    outline: Annotated[list[Point], Field(min_length=3, max_length=MAX_OUTLINE_POINTS)]
    corners: Annotated[list[Point], Field(min_length=4, max_length=4)] | None = None
    projection: Matrix | None = None


type Region = Annotated[list[Point], Field(min_length=3, max_length=MAX_OUTLINE_POINTS)]
type Regions = Annotated[list[Region], Field(min_length=1, max_length=8)]


class StylePlan(BaseModel):
    width: Dimension
    height: Dimension
    editable: Regions
    protected: Regions
    prompt: Annotated[str, Field(min_length=1, max_length=2000)]
    feather_edges: Annotated[bool, Field(strict=True)] = True


def _has_cicp(file: BinaryIO) -> bool:
    # cICP is public PNG metadata, but Pillow 13 doesn't expose it in Image.info.
    position = file.tell()
    try:
        file.seek(8)  # Skip the PNG signature.
        while len(chunk := file.read(8)) == 8:
            length, kind = unpack(">I4s", chunk)
            if kind == b"cICP":
                return True
            if kind in {b"IDAT", b"IEND"}:
                break

            file.seek(length + 4, 1)  # Skip data and CRC.

        return False
    finally:
        file.seek(position)


def _requires_prepared_png(image: PngImageFile, file: BinaryIO, bit_depth: int) -> bool:
    profile = image.info.get("icc_profile")
    unsupported_color = (
        image.mode not in {"RGB", "RGBA"}
        if profile
        else "srgb" not in image.info
        and ("gamma" in image.info or "chromaticity" in image.info)
    )
    return (
        bit_depth > 8
        or image.get_format_mimetype() == "image/apng"
        or unsupported_color
        or _has_cicp(file)
    )


@app.middleware("http")
async def limit_render_request(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    if request.method == "POST" and request.url.path in {
        RENDER_PATH,
        STYLE_PATH,
        FLOOR_SUGGESTION_PATH,
    }:
        length = request.headers.get("content-length", "")
        if not length.isascii() or not length.isdecimal() or len(length) > 12:
            return JSONResponse(
                {"detail": "Send the photo with its content length."}, status_code=411
            )
        limit = (
            2 * MAX_WORKING_PNG_BYTES + 2 * MAX_STYLE_PLAN_BYTES
            if request.url.path == STYLE_PATH
            else MAX_WORKING_PNG_BYTES + 2 * MAX_PLAN_BYTES
        )
        if int(length) > limit:
            message = (
                "The style render request is too large."
                if request.url.path == STYLE_PATH
                else "The working photo exceeds 100 MiB."
            )
            return JSONResponse({"detail": message}, status_code=413)
    return await call_next(request)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _local_browser_request(request: Request) -> bool:
    loopback = {"localhost", "127.0.0.1", "::1"}
    host = request.headers.get("host")
    if (
        request.url.hostname not in loopback
        or request.client is None
        or request.client.host not in loopback
        or not host
    ):
        return False

    origin = request.headers.get("origin")
    if origin is not None:
        return origin == f"{request.url.scheme}://{host}"
    # A same-origin browser GET does not normally send Origin.
    return (
        request.method == "GET"
        and request.headers.get("sec-fetch-site") == "same-origin"
    )


@app.get("/api/style-status")
def style_status(request: Request) -> JSONResponse:
    codex = codex_status() if _local_browser_request(request) else None
    return JSONResponse(
        {
            "configured": style_provider_configured(),
            **({"codex": codex} if codex else {}),
        },
        headers={"Cache-Control": "no-store"},
    )


def _require_oak_prompt(prompt: str) -> None:
    if not requests_oak(prompt):
        raise HTTPException(
            422,
            'Quick floor currently supports light oak. Try "Change the floor to light oak."',
        )


@app.post(
    RENDER_PATH,
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
)
def render_photo(
    photo: Annotated[UploadFile, File()],
    plan: Annotated[str, Form(max_length=MAX_PLAN_BYTES)],
    prompt: Annotated[str | None, Form(max_length=2000)] = None,
) -> Response:
    if prompt is not None:
        _require_oak_prompt(prompt)
    if photo.size is not None and photo.size > MAX_WORKING_PNG_BYTES:
        raise HTTPException(413, "The working photo exceeds 100 MiB.")

    try:
        approved = FloorPlan.model_validate_json(plan)
    except ValidationError as error:
        raise HTTPException(
            422,
            f"Send the photo size, 3 to {MAX_OUTLINE_POINTS} outline points, and a floor projection.",
        ) from error

    if (approved.corners is None) == (approved.projection is None):
        raise HTTPException(
            422, "Send four grid corners or a calibrated floor projection."
        )

    try:
        # PNG stores the bit depth in IHDR, even when Pillow decodes to an 8-bit mode.
        header = photo.file.read(25)
        with Image.open(photo.file, formats=["JPEG", "PNG", "WEBP"]) as source:
            if isinstance(source, PngImageFile):
                if _requires_prepared_png(source, photo.file, header[24]):
                    raise HTTPException(
                        422,
                        "Open this photo in the editor to prepare it for rendering.",
                    )
            elif photo.size is not None and photo.size > MAX_PHOTO_BYTES:
                raise HTTPException(413, "Choose a photo of 25 MiB or less.")

            if source.width * source.height > MAX_PHOTO_PIXELS:
                raise HTTPException(413, "Choose a photo of 24 megapixels or less.")

            original = ImageOps.exif_transpose(source)
            if original.size != (approved.width, approved.height):
                raise HTTPException(
                    422,
                    "The approved outline and grid must match the oriented photo size.",
                )

            if approved.projection is not None:
                result = render_calibrated_floor(
                    original, approved.outline, approved.projection, oak_texture()
                )
            else:
                assert approved.corners is not None
                result = render_floor(
                    original, approved.outline, approved.corners, oak_texture()
                )
            profile = (
                original.info.get("icc_profile")
                if original.mode in {"RGB", "RGBA"}
                else None
            )
    except Image.DecompressionBombError as error:
        raise HTTPException(413, "Choose a photo of 24 megapixels or less.") from error
    except OSError as error:
        raise HTTPException(422, "The photo could not be decoded.") from error
    except FloorGeometryError as error:
        raise HTTPException(
            422, str(error), headers={"X-Same-Angle-Floor-Adjust": error.adjust}
        ) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error

    with BytesIO() as output:
        result.save(output, format="PNG", icc_profile=profile)

        return Response(
            output.getvalue(),
            media_type="image/png",
            headers={"Cache-Control": "no-store"},
        )


@app.post(
    STYLE_PATH,
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
)
def render_style_request(
    request: Request,
    photo: Annotated[UploadFile, File()],
    plan: Annotated[str, Form(max_length=MAX_STYLE_PLAN_BYTES)],
    candidate: Annotated[UploadFile | None, File()] = None,
    provider: Annotated[Literal["openai", "codex"], Form()] = "openai",
) -> Response:
    if provider == "codex":
        if not _local_browser_request(request):
            raise HTTPException(
                403, "Open the Same Angle editor on localhost to use Codex."
            )
        if candidate is not None:
            raise HTTPException(422, "Generate with Codex or import an edited photo.")
    return render_style(photo, plan, candidate, provider=provider)


@app.post(FLOOR_SUGGESTION_PATH)
def floor_suggestion(
    photo: Annotated[UploadFile, File()],
    prompt: Annotated[str, Form(max_length=2000)],
) -> JSONResponse:
    _require_oak_prompt(prompt)
    if photo.size is not None and photo.size > MAX_WORKING_PNG_BYTES:
        raise HTTPException(413, "The working photo exceeds 100 MiB.")
    try:
        suggestion = suggest_floor(read_style_image(photo.file))
    except (OSError, Image.DecompressionBombError) as error:
        raise HTTPException(422, "Open a readable room photo.") from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    return JSONResponse(
        {"outline": suggestion.outline, "corners": suggestion.corners},
        headers={"Cache-Control": "no-store"},
    )


def render_style(
    photo: UploadFile,
    plan: str,
    candidate: UploadFile | None = None,
    *,
    provider: Literal["openai", "codex"] = "openai",
) -> Response:
    uploads = (photo,) if candidate is None else (photo, candidate)
    if any(
        upload.size is not None and upload.size > MAX_WORKING_PNG_BYTES
        for upload in uploads
    ):
        raise HTTPException(413, "Each working image must be at most 100 MiB.")

    try:
        approved = StylePlan.model_validate_json(plan)
        if not approved.prompt.strip():
            raise ValueError("Describe the style change in the prompt.")
    except ValidationError as error:
        raise HTTPException(
            422, "Send the photo size, prompt, and editable and protected regions."
        ) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error

    try:
        original = read_style_image(photo.file)
        if original.size != (approved.width, approved.height):
            raise ValueError("The approved regions must match the oriented photo size.")
        allowed = style_mask(original.size, approved.editable, approved.protected)

        if provider == "codex":
            edited = edit_with_codex(original, allowed, approved.prompt)
        elif candidate is None:
            result = edit_with_openai(original, allowed, approved.prompt)
            edited = read_style_image(BytesIO(result))
        else:
            edited = read_style_image(candidate.file)

        composite = composite_style(
            original, edited, allowed, feather_edges=approved.feather_edges
        )
        if provider == "codex" and not ImageChops.difference(
            original.convert("RGBA"), composite
        ).getbbox(alpha_only=False):
            raise HTTPException(422, NO_EDIT_MESSAGE)
    except CodexProviderError as error:
        raise HTTPException(error.status_code, str(error)) from error
    except StyleProviderError as error:
        raise HTTPException(503, str(error)) from error
    except (Image.DecompressionBombError, OSError) as error:
        raise HTTPException(
            422, "Use a readable static image of at most 24 megapixels."
        ) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error

    with BytesIO() as output:
        composite.save(
            output, format="PNG", icc_profile=original.info.get("icc_profile")
        )
        return Response(
            output.getvalue(),
            media_type="image/png",
            headers={"Cache-Control": "no-store"},
        )


def read_style_image(file: BinaryIO) -> Image.Image:
    header = file.read(25)
    with Image.open(file, formats=["PNG", "JPEG", "WEBP"]) as opened:
        if opened.width * opened.height > MAX_PHOTO_PIXELS or getattr(
            opened, "is_animated", False
        ):
            raise ValueError("Use a static image of at most 24 megapixels.")
        if isinstance(opened, PngImageFile) and _requires_prepared_png(
            opened, file, header[24]
        ):
            raise ValueError("Prepare the style image as a static 8-bit sRGB PNG.")
        return ImageOps.exif_transpose(opened)
