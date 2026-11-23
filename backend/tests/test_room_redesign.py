from hashlib import sha256
from json import dumps, loads
from pathlib import Path
from subprocess import CompletedProcess, run
from sys import executable

import pytest
from PIL import Image, ImageCms

BACKEND = Path(__file__).resolve().parents[1]


def redesign(*args: Path | str) -> CompletedProcess[str]:
    return run(
        [executable, "-m", "examples.room_redesign", *map(str, args)],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.fixture
def prepared_redesign(tmp_path: Path) -> Path:
    source = tmp_path / "source.png"
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    Image.new("RGB", (64, 48), "red").save(source, icc_profile=profile)
    plan = tmp_path / "plan.json"
    plan.write_text(
        dumps(
            {
                "width": 64,
                "height": 48,
                "prompt": "Put wallpaper on the wall.",
                "editable": [[[4, 4], [60, 4], [60, 45], [4, 45]]],
                "protected": [[[20, 10], [39, 10], [39, 29], [20, 29]]],
                "feather_edges": False,
            }
        ),
        encoding="utf-8",
    )

    output = tmp_path / "run"
    result = redesign("prepare", source, plan, output)
    assert result.returncode == 0, result.stderr
    with Image.open(output / "guide.png") as guide:
        assert guide.getpixel((1, 1)) == (255, 0, 0)
        assert guide.getpixel((25, 16)) == (255, 0, 0)
        assert guide.getpixel((7, 7)) != (255, 0, 0)

    return output


def test_prepares_and_finishes_a_redesign_with_unchanged_protected_pixels(
    prepared_redesign: Path,
) -> None:
    Image.new("RGB", (32, 24), "blue").save(prepared_redesign / "candidate.png")

    result = redesign("finish", prepared_redesign)

    assert result.returncode == 0, result.stderr
    with Image.open(prepared_redesign / "after.png") as after:
        assert after.size == (64, 48)
        assert after.getpixel((1, 1)) == (255, 0, 0, 255)
        assert after.getpixel((25, 16)) == (255, 0, 0, 255)
        assert after.getpixel((7, 7)) == (0, 0, 255, 255)
    stats = loads((prepared_redesign / "pixel-checks.json").read_text())
    assert stats["outside_mask_pixels"] == 1137
    assert stats["changed_outside_mask_pixels"] == 0
    assert stats["changed_inside_mask_pixels"] == 1935
    with Image.open(prepared_redesign / "before-after.png") as comparison:
        assert comparison.width > 2 * 64
        assert comparison.height > 48
        with Image.open(prepared_redesign / "before.png") as before:
            assert comparison.info.get("icc_profile") == before.info["icc_profile"]

    finished_png = (prepared_redesign / "after.png").read_bytes()
    Image.new("RGB", (32, 24), "green").save(prepared_redesign / "candidate.png")

    retry = redesign("finish", prepared_redesign)

    assert retry.returncode != 0
    assert "already has a finished result" in retry.stderr
    assert (prepared_redesign / "after.png").read_bytes() == finished_png

    (prepared_redesign / "after.png").unlink()
    incomplete = redesign("finish", prepared_redesign)
    assert incomplete.returncode != 0
    assert "Files are missing from the finished result" in incomplete.stderr


@pytest.mark.parametrize("changed", ["source photo", "style plan"])
def test_refuses_to_finish_if_prepared_inputs_changed(
    prepared_redesign: Path, changed: str
) -> None:
    Image.new("RGB", (32, 24), "blue").save(prepared_redesign / "candidate.png")
    if changed == "source photo":
        Image.new("RGB", (64, 48), "green").save(prepared_redesign / "before.png")
    else:
        plan_path = prepared_redesign / "plan.json"
        plan = loads(plan_path.read_text())
        plan["protected"][0][0] = [21, 10]
        plan_path.write_text(dumps(plan))

    result = redesign("finish", prepared_redesign)

    assert result.returncode != 0
    assert f"The prepared {changed} changed" in result.stderr
    assert not (prepared_redesign / "after.png").exists()


def test_rejects_a_different_frame_before_export(prepared_redesign: Path) -> None:
    Image.new("RGB", (64, 64), "blue").save(prepared_redesign / "candidate.png")

    result = redesign("finish", prepared_redesign)

    assert result.returncode != 0
    assert "aspect ratio" in result.stderr
    assert not (prepared_redesign / "after.png").exists()


def test_rejects_another_photo_of_the_same_size(
    tmp_path: Path, prepared_redesign: Path
) -> None:
    source = prepared_redesign / "before.png"
    plan = loads((prepared_redesign / "plan.json").read_text())
    plan["source_sha256"] = sha256(source.read_bytes()).hexdigest()
    plan_path = tmp_path / "exported-plan.json"
    plan_path.write_text(dumps(plan))
    another_photo = tmp_path / "other.png"
    Image.new("RGB", (64, 48), "green").save(another_photo)

    wrong_output = tmp_path / "wrong-run"
    wrong = redesign("prepare", another_photo, plan_path, wrong_output)
    assert wrong.returncode != 0
    assert "prepared photo downloaded with this Codex plan" in wrong.stderr
    assert not wrong_output.exists()

    right = redesign("prepare", source, plan_path, tmp_path / "right-run")
    assert right.returncode == 0, right.stderr


def test_prepares_an_unprofiled_cmyk_jpeg(
    tmp_path: Path, prepared_redesign: Path
) -> None:
    source = tmp_path / "cmyk.jpg"
    Image.new("CMYK", (64, 48), (0, 255, 255, 0)).save(source)
    output = tmp_path / "cmyk-run"

    result = redesign("prepare", source, prepared_redesign / "plan.json", output)

    assert result.returncode == 0, result.stderr
    with Image.open(output / "before.png") as before:
        assert before.convert("RGB").getpixel((0, 0)) == (255, 0, 0)
