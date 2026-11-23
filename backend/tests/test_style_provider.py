from base64 import b64encode
from email.message import Message
from email.parser import BytesParser
from email.policy import default
from io import BytesIO
from json import dumps
from urllib.error import HTTPError
from urllib.request import Request

import pytest
from PIL import Image, ImageDraw

from same_angle import style_provider


def test_provider_preserves_registration_of_an_odd_ratio_photo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def respond(request: Request, *, timeout: float) -> BytesIO:
        assert request.full_url == style_provider.IMAGE_EDIT_URL
        assert timeout == 180
        assert request.get_header("Authorization") == "Bearer test-key"
        body = request.data
        assert isinstance(body, bytes)
        content_type = request.get_header("Content-type")
        mime = BytesParser(policy=default).parsebytes(
            f"Content-Type: {content_type}\r\n\r\n".encode() + body
        )
        fields = {
            part.get_param("name", header="content-disposition"): part.get_payload(
                decode=True
            )
            for part in mime.iter_parts()
        }
        assert fields["model"] == b"gpt-image-2.6-sunburst"
        assert fields["size"] == b"1536x1024"
        prompt = fields["prompt"]
        assert isinstance(prompt, bytes)
        assert b"Keep the original framing" in prompt
        assert b"Use light oak." in prompt
        photo_bytes = fields["image"]
        assert isinstance(photo_bytes, bytes)
        with Image.open(BytesIO(photo_bytes)) as photo:
            assert photo.getpixel((86, 512)) == (24, 24, 24)
            assert photo.getpixel((87, 512)) == (255, 0, 0)
        markup_bytes = fields["markup"]
        assert isinstance(markup_bytes, bytes)
        with Image.open(BytesIO(markup_bytes)) as markup:
            assert markup.size == (1536, 1024)
            assert markup.getpixel((768, 512)) == (255, 209, 74, 117)
            assert markup.getpixel((92, 3)) == (255, 209, 74, 0)
            assert markup.getpixel((30, 512)) == (0, 0, 0, 0)

        with BytesIO() as data:
            rendered = Image.new("RGB", (1536, 1024), "magenta")
            rendered.paste("green", (87, 0, 1449, 1024))
            rendered.save(data, format="PNG")
            return BytesIO(
                dumps(
                    {"data": [{"b64_json": b64encode(data.getvalue()).decode()}]}
                ).encode()
            )

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(style_provider, "urlopen", respond)
    mask = Image.new("L", (121, 91))
    ImageDraw.Draw(mask).rectangle((30, 30, 80, 60), fill=255)

    result = style_provider.edit_with_openai(
        Image.new("RGB", (121, 91), "red"), mask, "Use light oak."
    )

    with Image.open(BytesIO(result)) as edited:
        assert edited.size == (121, 91)
        assert edited.getpixel((0, 45)) == (0, 128, 0)
        assert edited.getpixel((120, 45)) == (0, 128, 0)


def test_an_invalid_provider_payload_has_a_local_fallback_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(
        style_provider, "urlopen", lambda *args, **kwargs: BytesIO(b"\xff")
    )
    with pytest.raises(
        style_provider.StyleProviderError, match="importing an edited photo"
    ):
        style_provider.edit_with_openai(
            Image.new("RGB", (16, 16)), Image.new("L", (16, 16), 255), "Use light oak."
        )


@pytest.mark.parametrize(
    ("code", "message"),
    [
        (401, "API key and project access"),
        (403, "API key and project access"),
        (429, "rate or quota limit"),
    ],
)
def test_provider_explains_denied_or_limited_live_requests(
    monkeypatch: pytest.MonkeyPatch, code: int, message: str
) -> None:
    def respond(request: Request, *, timeout: float) -> BytesIO:
        raise HTTPError(
            request.full_url,
            code,
            "hidden",
            Message(),
            BytesIO(b"private account details"),
        )

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(style_provider, "urlopen", respond)
    with pytest.raises(style_provider.StyleProviderError, match=message):
        style_provider.edit_with_openai(
            Image.new("RGB", (16, 16)), Image.new("L", (16, 16), 255), "Use light oak."
        )
