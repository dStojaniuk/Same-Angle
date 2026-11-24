import sys
from io import BytesIO
from json import dumps
from pathlib import Path

import pytest
from fastapi import HTTPException, Request, UploadFile
from PIL import Image, ImageDraw

from same_angle import api, codex_provider

PLAN = {
    "width": 64,
    "height": 48,
    "prompt": "Make the far wall green.",
    "editable": [[[4, 4], [60, 4], [60, 44], [4, 44]]],
    "protected": [[[22, 12], [40, 12], [40, 35], [22, 35]]],
    "feather_edges": False,
}


def upload(photo: Image.Image | None = None) -> UploadFile:
    buffer = BytesIO()
    if photo is None:
        photo = Image.new("RGB", (64, 48), "red")
    photo.save(buffer, "PNG")
    return UploadFile(BytesIO(buffer.getvalue()), size=buffer.tell())


def local_request(origin: str = "http://localhost:5173") -> Request:
    return Request(
        {
            "type": "http",
            "scheme": "http",
            "method": "POST",
            "path": api.STYLE_PATH,
            "headers": [(b"host", b"localhost:5173"), (b"origin", origin.encode())],
            "client": ("127.0.0.1", 50000),
        }
    )


def codex_executable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, generation: str
) -> None:
    binary = tmp_path / "codex"
    binary.write_text(
        f"#!{sys.executable}\n"
        "import os, sys\n"
        "if sys.argv[1:] == ['login', 'status']:\n"
        "    if os.getenv('LOCAL_TEST_CODEX_SIGNED_OUT'):\n"
        "        print('Not logged in')\n"
        "        sys.exit(1)\n"
        "    print('Logged in using ChatGPT')\n"
        "    sys.exit(0)\n" + generation
    )
    binary.chmod(0o700)
    monkeypatch.setenv("PATH", str(tmp_path))
    monkeypatch.setenv("ENABLE_CODEX_IMAGEGEN", "1")


def test_codex_png_uses_compositor_and_keeps_protected_pixels(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    native = (
        tmp_path
        / ".codex"
        / "generated_images"
        / "12345678-9123-4567-8912-345678912345"
    )
    codex_executable(
        tmp_path,
        monkeypatch,
        f"from pathlib import Path\nfrom PIL import Image\n"
        "assert 'OPENAI_API_KEY' not in os.environ and 'CODEX_API_KEY' not in os.environ\n"
        "assert sys.argv.count('-i') == 2\n"
        f"directory = Path({str(native)!r})\n"
        "directory.mkdir(parents=True)\n"
        "image = Image.new('RGB', (128, 128), 'magenta')\n"
        "image.paste('green', (0, 16, 128, 112))\n"
        "image.save(directory / 'native.png')\n"
        'print(\'{"type":"thread.started","thread_id":"12345678-9123-4567-8912-345678912345"}\')\n'
        'print(\'{"type":"turn.completed"}\')\n',
    )
    monkeypatch.delenv("CODEX_HOME", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("OPENAI_API_KEY", "dummy-openai")
    monkeypatch.setenv("CODEX_API_KEY", "dummy-codex")
    response = api.render_style_request(
        local_request(), upload(), dumps(PLAN), provider="codex"
    )

    with Image.open(BytesIO(response.body)) as result:
        assert result.size == (64, 48)
        assert result.getpixel((1, 1)) == (255, 0, 0, 255)
        assert result.getpixel((30, 20)) == (255, 0, 0, 255)
        assert result.getpixel((10, 10)) == (0, 128, 0, 255)
        assert result.getpixel((10, 5)) == (0, 128, 0, 255)


def test_codex_rejects_an_unreadable_native_png(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    native = (
        tmp_path
        / ".codex"
        / "generated_images"
        / "12345678-9123-4567-8912-345678912345"
    )
    codex_executable(
        tmp_path,
        monkeypatch,
        f"from pathlib import Path\ndirectory = Path({str(native)!r})\n"
        "directory.mkdir(parents=True)\n"
        "(directory / 'native.png').write_bytes(b'not an image')\n"
        'print(\'{"type":"thread.started","thread_id":"12345678-9123-4567-8912-345678912345"}\')\n'
        'print(\'{"type":"turn.completed"}\')\n',
    )
    monkeypatch.delenv("CODEX_HOME", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    with pytest.raises(HTTPException, match="readable PNG") as error:
        api.render_style_request(
            local_request(), upload(), dumps(PLAN), provider="codex"
        )
    assert error.value.status_code == 503


@pytest.mark.parametrize(
    ("program", "signed_out", "status_code", "message"),
    [
        ("raise RuntimeError('not reached')\n", True, 503, "Run codex login"),
        ("import time\ntime.sleep(10)\n", False, 504, "timed out"),
        ('print(\'{"type":"turn.completed"}\')\n', False, 503, "did not report"),
        ("print('429 usage limit')\nsys.exit(1)\n", False, 429, "limit was reached"),
        ("print('HTTP 429')\nsys.exit(1)\n", False, 429, "limit was reached"),
        (
            (
                'print("{\\"type\\":\\"thread.started\\",\\"thread_id\\":'
                '\\"12345678-9123-4567-8912-345678912429\\"}")\nsys.exit(1)\n'
            ),
            False,
            503,
            "could not complete",
        ),
    ],
)
def test_codex_failures_release_the_local_slot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    program: str,
    signed_out: bool,
    status_code: int,
    message: str,
) -> None:
    codex_executable(tmp_path, monkeypatch, program)
    monkeypatch.setattr(codex_provider, "GENERATION_TIMEOUT_SECONDS", 0.25)
    if signed_out:
        monkeypatch.setenv("LOCAL_TEST_CODEX_SIGNED_OUT", "1")
    with pytest.raises(HTTPException, match=message) as error:
        api.render_style_request(
            local_request(), upload(), dumps(PLAN), provider="codex"
        )
    assert error.value.status_code == status_code
    assert not codex_provider.generation_lock.locked()


def test_cannot_start_codex_while_disabled_cross_origin_or_already_running(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ENABLE_CODEX_IMAGEGEN", raising=False)
    with pytest.raises(HTTPException, match="disabled") as disabled:
        api.render_style_request(
            local_request(), upload(), dumps(PLAN), provider="codex"
        )
    assert disabled.value.status_code == 403

    monkeypatch.setenv("ENABLE_CODEX_IMAGEGEN", "1")
    with pytest.raises(HTTPException, match="localhost") as cross_origin:
        api.render_style_request(
            local_request("https://example.test"),
            upload(),
            dumps(PLAN),
            provider="codex",
        )
    assert cross_origin.value.status_code == 403

    with (
        codex_provider.generation_lock,
        pytest.raises(HTTPException, match="already running") as busy,
    ):
        api.render_style_request(
            local_request(), upload(), dumps(PLAN), provider="codex"
        )
    assert busy.value.status_code == 409


@pytest.mark.parametrize(
    ("scale", "outside_only", "resampling"),
    [
        (1, False, None),
        (25, False, None),
        (25, True, None),
        (25, False, "BICUBIC"),
        (25, False, "BILINEAR"),
    ],
)
def test_codex_does_not_return_unchanged_photo_as_an_edit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    scale: int,
    outside_only: bool,
    resampling: str | None,
) -> None:
    codex_home = tmp_path / "custom-codex"
    monkeypatch.setenv("CODEX_HOME", str(codex_home))
    codex_executable(
        tmp_path,
        monkeypatch,
        "from pathlib import Path\nfrom PIL import Image\n"
        "directory = Path(os.environ['CODEX_HOME']) / 'generated_images' / "
        "'12345678-9123-4567-8912-345678912345'\n"
        "directory.mkdir(parents=True)\n"
        "with Image.open(sys.argv[sys.argv.index('-i') + 1]) as source:\n"
        f"    if {outside_only!r}: source.putpixel((0, 0), (0, 0, 255))\n"
        f"    if {resampling!r}: source = source.resize((768, 768), Image.Resampling[{resampling!r}])\n"
        "    source.save(directory / 'native.png')\n"
        'print(\'{"type":"thread.started","thread_id":"12345678-9123-4567-8912-345678912345"}\')\n'
        'print(\'{"type":"turn.completed"}\')\n',
    )
    plan = {
        **PLAN,
        "width": 64 * scale,
        "height": 48 * scale,
        "editable": [
            [
                [4 * scale, 4 * scale],
                [60 * scale, 4 * scale],
                [60 * scale, 44 * scale],
                [4 * scale, 44 * scale],
            ]
        ],
    }
    photo = Image.new("RGB", (64 * scale, 48 * scale), "red")
    ImageDraw.Draw(photo).line(
        [(9 * scale, 5 * scale), (55 * scale, 40 * scale)], fill="white"
    )

    with pytest.raises(
        HTTPException, match="did not change the editable area"
    ) as error:
        api.render_style_request(
            local_request(), upload(photo), dumps(plan), provider="codex"
        )
    assert error.value.status_code == 422
