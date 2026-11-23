from base64 import b64decode
from http.client import HTTPException
from io import BytesIO
from json import loads
from os import getenv
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from PIL import Image, ImageOps

IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits"
MODEL = "gpt-image-2.6-sunburst"
MAX_PROVIDER_BYTES = 32 * 1024 * 1024


class StyleProviderError(Exception):
    pass


def _png(image: Image.Image) -> bytes:
    with BytesIO() as data:
        image.save(data, format="PNG")
        return data.getvalue()


def _prepare_edit(
    original: Image.Image, allowed: Image.Image
) -> tuple[Image.Image, Image.Image, tuple[int, int, int, int]]:
    width, height = original.size
    if width == height:
        size = (1024, 1024)
    elif width > height:
        size = (1536, 1024)
    else:
        size = (1024, 1536)

    resized = ImageOps.contain(original.convert("RGB"), size, Image.Resampling.LANCZOS)
    left = (size[0] - resized.width) // 2
    top = (size[1] - resized.height) // 2
    content = (left, top, left + resized.width, top + resized.height)
    source = Image.new("RGB", size, (24, 24, 24))
    source.paste(resized, (left, top))

    overlay_mask = allowed.resize(resized.size, Image.Resampling.NEAREST)
    highlight = Image.new("RGBA", resized.size, (255, 209, 74))
    highlight.putalpha(overlay_mask.point([0] * 255 + [117]))
    overlay = Image.new("RGBA", size)
    overlay.paste(highlight, (left, top))
    if overlay.getbbox() is None:
        raise StyleProviderError(
            "The mask is too small to send to the editor. Enlarge it or import an edited photo."
        )
    return source, overlay, content


def _api_key() -> str:
    return getenv("OPENAI_API_KEY", "").strip()


def style_provider_configured() -> bool:
    return bool(_api_key())


def edit_with_openai(original: Image.Image, allowed: Image.Image, prompt: str) -> bytes:
    key = _api_key()
    if not key:
        raise StyleProviderError(
            "Set OPENAI_API_KEY on the backend, or import an edited photo."
        )

    source, overlay, content = _prepare_edit(original, allowed)
    full_prompt = (
        "Edit the exact photo only where the yellow overlay highlights the room. Remove all overlay "
        "color from the finished result. Keep the original framing, doors, windows, corners and visible "
        "wall seams at their original positions. Keep the outer padding and camera perspective. "
        "Match exposed surfaces to existing wall and floor lines. Apply this design: "
        + prompt
    )
    fields = {
        "model": MODEL,
        "quality": "medium",
        "background": "opaque",
        "output_format": "png",
        "size": f"{source.width}x{source.height}",
        "prompt": full_prompt,
    }

    boundary = uuid4().hex
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        for name, value in fields.items()
    ]
    for name, image in (("image", source), ("markup", overlay)):
        parts.extend(
            [
                (
                    f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; '
                    f'filename="{name}.png"\r\nContent-Type: image/png\r\n\r\n'
                ).encode(),
                _png(image),
                b"\r\n",
            ]
        )
    parts.append(f"--{boundary}--\r\n".encode())
    request = Request(
        IMAGE_EDIT_URL,
        data=b"".join(parts),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=180) as response:
            payload = response.read(MAX_PROVIDER_BYTES + 1)
        if len(payload) > MAX_PROVIDER_BYTES:
            raise StyleProviderError("The generated image response is too large.")
        encoded = loads(payload)["data"][0]["b64_json"]
        if not isinstance(encoded, str):
            raise TypeError("Image data is not text.")
        with Image.open(
            BytesIO(b64decode(encoded, validate=True)), formats=["PNG"]
        ) as candidate:
            if candidate.size != source.size or getattr(
                candidate, "is_animated", False
            ):
                raise StyleProviderError(
                    "The image edit changed the frame. Try importing an edited photo."
                )
            crop = candidate.crop(content).resize(
                original.size, Image.Resampling.LANCZOS
            )
            return _png(crop)
    except HTTPError as error:
        with error:
            if error.code in {401, 403}:
                message = "OpenAI denied the editor request. Check the API key and project access."
            elif error.code == 429:
                message = "OpenAI reached a rate or quota limit. Check the API project before trying again."
            else:
                message = "OpenAI could not complete the image edit. Try again later."
            raise StyleProviderError(message) from error
    except (
        HTTPException,
        OSError,
        ValueError,
        KeyError,
        IndexError,
        TypeError,
        Image.DecompressionBombError,
    ) as error:
        raise StyleProviderError(
            "The image edit could not be completed. Try importing an edited photo."
        ) from error
