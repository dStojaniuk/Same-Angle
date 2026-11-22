from collections.abc import Awaitable, Callable
from io import BytesIO
from struct import unpack
from typing import Annotated, BinaryIO

from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps
from PIL.PngImagePlugin import PngImageFile
from pydantic import BaseModel, Field, ValidationError

from same_angle.floor import oak_texture, render_floor

app = FastAPI(title="Same Angle local renderer")
MAX_PHOTO_BYTES = 25 * 1024 * 1024
# An 8-bit RGBA snapshot of a 24 MP photo can exceed the source file limit.
MAX_WORKING_PNG_BYTES = 100 * 1024 * 1024
MAX_PHOTO_PIXELS = 24_000_000
MAX_PLAN_BYTES = 8192
MAX_OUTLINE_POINTS = 128
RENDER_PATH = "/api/floor-render"

type Coordinate = Annotated[int, Field(ge=0, strict=True)]
type Point = tuple[Coordinate, Coordinate]
type Dimension = Annotated[int, Field(gt=0, strict=True)]


class FloorPlan(BaseModel):
    width: Dimension
    height: Dimension
    outline: Annotated[list[Point], Field(min_length=3, max_length=MAX_OUTLINE_POINTS)]
    corners: Annotated[list[Point], Field(min_length=4, max_length=4)]


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


@app.middleware("http")
async def limit_render_request(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    if request.method == "POST" and request.url.path == RENDER_PATH:
        length = request.headers.get("content-length", "")
        if not length.isascii() or not length.isdecimal() or len(length) > 12:
            return JSONResponse(
                {"detail": "Send the photo with its content length."}, status_code=411
            )
        if int(length) > MAX_WORKING_PNG_BYTES + 2 * MAX_PLAN_BYTES:
            return JSONResponse(
                {"detail": "The working photo exceeds 100 MiB."}, status_code=413
            )
    return await call_next(request)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post(
    RENDER_PATH,
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
)
def render_photo(
    photo: Annotated[UploadFile, File()],
    plan: Annotated[str, Form(max_length=MAX_PLAN_BYTES)],
) -> Response:
    if photo.size is not None and photo.size > MAX_WORKING_PNG_BYTES:
        raise HTTPException(413, "The working photo exceeds 100 MiB.")

    try:
        approved = FloorPlan.model_validate_json(plan)
    except ValidationError as error:
        raise HTTPException(
            422,
            f"Send the photo size, 3 to {MAX_OUTLINE_POINTS} outline points, and four grid corners.",
        ) from error

    try:
        # PNG stores the bit depth in IHDR, even when Pillow decodes to an 8-bit mode.
        header = photo.file.read(25)
        with Image.open(photo.file, formats=["JPEG", "PNG", "WEBP"]) as source:
            if isinstance(source, PngImageFile):
                unsupported_color = (
                    not source.info.get("icc_profile")
                    and "srgb" not in source.info
                    and ("gamma" in source.info or "chromaticity" in source.info)
                ) or (
                    source.info.get("icc_profile")
                    and source.mode not in {"RGB", "RGBA"}
                )

                if (
                    header[24] > 8
                    or source.get_format_mimetype() == "image/apng"
                    or unsupported_color
                    or _has_cicp(photo.file)
                ):
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
    except ValueError as error:
        raise HTTPException(422, str(error)) from error

    with BytesIO() as output:
        result.save(output, format="PNG", icc_profile=profile)

        return Response(
            output.getvalue(),
            media_type="image/png",
            headers={"Cache-Control": "no-store"},
        )
