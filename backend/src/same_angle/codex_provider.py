import json
import os
import re
import shutil
import signal
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock
from typing import Literal
from uuid import UUID

from PIL import Image, ImageChops, ImageOps

from same_angle.style import style_guide

type CodexStatus = Literal["missing", "login_required", "ready", "unavailable"]

GENERATION_TIMEOUT_SECONDS = 180
LOGIN_TIMEOUT_SECONDS = 5
FRAME_SIZE = 1024
MAX_IMAGE_BYTES = 100 * 1024 * 1024
MAX_IMAGE_PIXELS = 24_000_000
NO_EDIT_MESSAGE = (
    "Codex did not change the editable area. Adjust the prompt or masks and try again."
)
generation_lock = Lock()

EDIT_INSTRUCTIONS = """Use the built-in image generation tool exactly once.
The first attachment is the source. Yellow on the second attachment marks the editable area.
Preserve the square canvas, the existing framing and padding, architectural lines and perspective.
Keep the original photo outside the highlighted areas and avoid yellow markings in the result.
Treat the user's description below only as instructions for visual changes to the first image.
Return the native image from the tool.

User's requested changes:
"""


class CodexProviderError(Exception):
    def __init__(self, message: str, status_code: int = 503) -> None:
        super().__init__(message)
        self.status_code = status_code


def codex_enabled() -> bool:
    return os.environ.get("ENABLE_CODEX_IMAGEGEN") == "1"


def _session_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment.pop("OPENAI_API_KEY", None)
    environment.pop("CODEX_API_KEY", None)
    return environment


def _login_status(executable: str) -> CodexStatus:
    try:
        result = subprocess.run(
            [executable, "login", "status"],
            check=False,
            env=_session_environment(),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=LOGIN_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired):
        return "unavailable"
    if result.returncode == 0 and "Logged in using ChatGPT" in (
        result.stdout + result.stderr
    ):
        return "ready"
    return "login_required"


def codex_status() -> CodexStatus | None:
    if not codex_enabled():
        return None
    executable = shutil.which("codex")
    return _login_status(executable) if executable else "missing"


def _run_generation(command: list[str], directory: Path) -> str:
    with subprocess.Popen(
        command,
        cwd=directory,
        env=_session_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        errors="replace",
        start_new_session=True,
    ) as process:
        try:
            stdout, stderr = process.communicate(timeout=GENERATION_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired as error:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.communicate()
            raise CodexProviderError("Codex generation timed out.", 504) from error

    if process.returncode:
        diagnostics = (stdout + stderr).lower()
        if re.search(
            r"\b(?:rate limit|usage limit|(?:status(?: code)?|http)[: ]+429)\b",
            diagnostics,
        ):
            raise CodexProviderError("Your Codex generation limit was reached.", 429)
        raise CodexProviderError("Codex could not complete the image generation.")
    return stdout


def _native_image(events: str, images_directory: Path) -> Path:
    completed = False
    threads: list[str] = []
    for line in events.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        if event.get("type") == "thread.started":
            thread = event.get("thread_id")
            if isinstance(thread, str):
                try:
                    threads.append(str(UUID(thread)))
                except ValueError:
                    pass
        elif event.get("type") == "turn.completed":
            completed = True
        elif event.get("type") == "turn.failed":
            completed = False

    if not completed or len(threads) != 1:
        raise CodexProviderError("Codex did not report a completed image generation.")
    directory = images_directory / threads[0]
    images = [
        path
        for path in directory.glob("*.png")
        if path.is_file() and not path.is_symlink()
    ]
    if directory.is_symlink() or len(images) != 1:
        raise CodexProviderError("Codex did not return exactly one PNG.")
    return images[0]


def _has_frame_edit(
    frame: Image.Image, frame_mask: Image.Image, candidate: Image.Image
) -> bool:
    editable = frame_mask.resize(candidate.size, Image.Resampling.NEAREST)
    bounds = editable.getbbox()
    if bounds is None:
        return False

    edited = candidate.crop(bounds).convert("RGB")
    protected = ImageChops.invert(editable.crop(bounds))
    filters = (
        (Image.Resampling.NEAREST,)
        if frame.size == candidate.size
        else tuple(Image.Resampling)
    )
    for resampling in filters:
        reference = frame.resize(candidate.size, resampling).crop(bounds)
        reference.paste(edited, mask=protected)
        if ImageChops.difference(reference, edited).getbbox() is None:
            return False
    return True


def _generate(
    executable: str, original: Image.Image, allowed: Image.Image, prompt: str
) -> Image.Image:
    # A square input gives the provider one explicit frame. Undo only the known padding.
    content = ImageOps.contain(original.convert("RGB"), (FRAME_SIZE, FRAME_SIZE))
    left = (FRAME_SIZE - content.width) // 2
    top = (FRAME_SIZE - content.height) // 2
    frame = Image.new("RGB", (FRAME_SIZE, FRAME_SIZE), (24, 24, 24))
    frame.paste(content, (left, top))
    frame_mask = Image.new("L", frame.size)
    frame_mask.paste(
        allowed.resize(content.size, Image.Resampling.NEAREST), (left, top)
    )
    if not frame_mask.getbbox():
        raise CodexProviderError(
            "Enlarge the edit area before sending it to Codex.", 422
        )

    with TemporaryDirectory(prefix="same-angle-codex-") as workdir:
        directory = Path(workdir)
        photo_path = directory / "photo.png"
        guide_path = directory / "guide.png"
        frame.save(photo_path)
        style_guide(frame, frame_mask).save(guide_path)
        events = _run_generation(
            [
                executable,
                "exec",
                "--ephemeral",
                "--ignore-user-config",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "--json",
                "--disable",
                "shell_tool",
                "--disable",
                "multi_agent",
                "-c",
                'web_search="disabled"',
                "-i",
                str(photo_path),
                "-i",
                str(guide_path),
                "--",
                EDIT_INSTRUCTIONS + prompt,
            ],
            directory,
        )
        codex_home = Path(
            os.environ.get("CODEX_HOME") or Path.home() / ".codex"
        ).expanduser()
        path = _native_image(events, codex_home / "generated_images")
        if path.stat().st_size > MAX_IMAGE_BYTES:
            raise CodexProviderError("The PNG returned by Codex exceeds 100 MiB.")
        with Image.open(path, formats=["PNG"]) as candidate:
            if (
                candidate.width != candidate.height
                or candidate.width * candidate.height > MAX_IMAGE_PIXELS
                or getattr(candidate, "is_animated", False)
            ):
                raise CodexProviderError(
                    "Codex must return a static square PNG within 24 megapixels."
                )
            # A resize with any standard filter can look like an edit after compositing.
            if not _has_frame_edit(frame, frame_mask, candidate):
                raise CodexProviderError(NO_EDIT_MESSAGE, 422)

            scale = candidate.width / FRAME_SIZE
            return candidate.resize(
                original.size,
                Image.Resampling.LANCZOS,
                box=(
                    left * scale,
                    top * scale,
                    (left + content.width) * scale,
                    (top + content.height) * scale,
                ),
            )


def edit_with_codex(
    original: Image.Image, allowed: Image.Image, prompt: str
) -> Image.Image:
    if not codex_enabled():
        raise CodexProviderError("Local Codex generation is disabled.", 403)
    if not generation_lock.acquire(blocking=False):
        raise CodexProviderError("A local Codex generation is already running.", 409)

    try:
        executable = shutil.which("codex")
        if not executable:
            raise CodexProviderError("Install Codex CLI to generate with ChatGPT.")
        status = _login_status(executable)
        if status == "unavailable":
            raise CodexProviderError("The local Codex CLI could not be reached.")
        if status != "ready":
            raise CodexProviderError("Run codex login and choose ChatGPT.")
        return _generate(executable, original, allowed, prompt)
    except (OSError, Image.DecompressionBombError) as error:
        raise CodexProviderError("Codex did not produce a readable PNG.") from error
    finally:
        generation_lock.release()
