from argparse import ArgumentParser
from hashlib import file_digest, sha256
from json import dumps
from pathlib import Path
from typing import Annotated

from PIL import Image, ImageChops, ImageDraw, ImageOps
from pydantic import BaseModel, Field

from same_angle.api import StylePlan, read_style_image
from same_angle.style import composite_style, style_guide, style_mask

type Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class RedesignPlan(StylePlan):
    source_sha256: Sha256 | None = None


class PreparedInputs(BaseModel):
    photo_sha256: Sha256
    plan_sha256: Sha256


def read_photo(
    path: Path,
    expected_digest: str | None = None,
    *,
    digest_error: str = "Use the prepared photo downloaded with this Codex plan.",
) -> Image.Image:
    with path.open("rb") as source:
        if expected_digest is not None:
            if file_digest(source, "sha256").hexdigest() != expected_digest:
                raise ValueError(digest_error)
            source.seek(0)

        return read_style_image(source)


def prepare(photo: Path, plan_path: Path, output: Path) -> None:
    plan = RedesignPlan.model_validate_json(plan_path.read_bytes())
    original = read_photo(photo, plan.source_sha256)
    if original.size != (plan.width, plan.height):
        raise ValueError("The plan must match the oriented photo size.")
    if not plan.prompt.strip():
        raise ValueError("Describe the style change in the plan.")

    if original.mode not in {"RGB", "RGBA"} and original.info.get("icc_profile"):
        raise ValueError("Convert the source photo and its color profile to RGB.")
    if original.mode == "CMYK":
        original = original.convert("RGB")

    allowed = style_mask(original.size, plan.editable, plan.protected)
    guide = style_guide(original, allowed)

    output.mkdir(mode=0o700)
    prepared_photo = output / "before.png"
    original.save(prepared_photo)
    guide.save(output / "guide.png")
    prepared_plan = plan.model_dump_json(exclude_none=True).encode("utf-8")
    (output / "plan.json").write_bytes(prepared_plan)

    with prepared_photo.open("rb") as stored_photo:
        manifest = PreparedInputs(
            photo_sha256=file_digest(stored_photo, "sha256").hexdigest(),
            plan_sha256=sha256(prepared_plan).hexdigest(),
        )
    (output / "prepared-inputs.json").write_text(
        manifest.model_dump_json(), encoding="utf-8"
    )


def change_mask(before: Image.Image, after: Image.Image) -> Image.Image:
    channels = ImageChops.difference(before.convert("RGBA"), after).split()
    red, green, blue, alpha = channels
    rgb = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    return ImageChops.lighter(rgb, alpha).point([0] + [255] * 255)


def comparison(before: Image.Image, after: Image.Image) -> Image.Image:
    preview_size = (760, 760)
    left = ImageOps.contain(before.convert("RGB"), preview_size)
    right = ImageOps.contain(after.convert("RGB"), preview_size)
    inset = 12
    heading_height = 30
    canvas = Image.new(
        "RGB",
        (left.width * 2 + inset * 3, left.height + heading_height + inset),
        "#15171c",
    )
    second_column = left.width + inset * 2
    canvas.paste(left, (inset, heading_height))
    canvas.paste(right, (second_column, heading_height))
    labels = ImageDraw.Draw(canvas)
    labels.text((inset, 7), "Before", fill="white", font_size=16)
    labels.text((second_column, 7), "After", fill="white", font_size=16)
    return canvas


def finish(output: Path) -> None:
    report_path = output / "pixel-checks.json"
    if report_path.exists():
        if not all(
            (output / name).is_file() for name in ("after.png", "before-after.png")
        ):
            raise ValueError(
                "Files are missing from the finished result. Prepare a new run."
            )
        raise ValueError(
            "This run already has a finished result. Use a new output directory."
        )

    manifest_path = output / "prepared-inputs.json"
    if not manifest_path.is_file():
        raise ValueError("Prepare a new run with this version of the redesign command.")
    prepared = PreparedInputs.model_validate_json(manifest_path.read_bytes())
    plan_bytes = (output / "plan.json").read_bytes()
    if sha256(plan_bytes).hexdigest() != prepared.plan_sha256:
        raise ValueError("The prepared style plan changed. Prepare a new run.")

    plan = StylePlan.model_validate_json(plan_bytes)
    original = read_photo(
        output / "before.png",
        prepared.photo_sha256,
        digest_error="The prepared source photo changed. Prepare a new run.",
    )
    if original.size != (plan.width, plan.height):
        raise ValueError("The plan must match the oriented photo size.")

    candidate = read_photo(output / "candidate.png")
    candidate_size = candidate.size
    allowed = style_mask(original.size, plan.editable, plan.protected)

    after = composite_style(
        original, candidate, allowed, feather_edges=plan.feather_edges
    )

    changed = change_mask(original, after)
    outside = ImageChops.invert(allowed)
    changed_outside = ImageChops.multiply(changed, outside).histogram()[255]
    changed_inside = ImageChops.multiply(changed, allowed).histogram()[255]
    if changed_outside or not changed_inside:
        raise ValueError("The edit must change pixels only inside the effective mask.")

    profile = original.info.get("icc_profile")
    after.save(output / "after.png", icc_profile=profile)
    comparison(original, after).save(output / "before-after.png", icc_profile=profile)
    report = {
        "original_size": original.size,
        "candidate_size": candidate_size,
        "output_size": after.size,
        "outside_mask_pixels": outside.histogram()[255],
        "changed_outside_mask_pixels": changed_outside,
        "changed_inside_mask_pixels": changed_inside,
    }
    pending_report = report_path.with_suffix(".tmp")
    pending_report.write_text(dumps(report, indent=2) + "\n", encoding="utf-8")
    pending_report.replace(report_path)
    print(dumps(report))


def main() -> None:
    parser = ArgumentParser(description="Prepare and finish a Codex room redesign.")
    commands = parser.add_subparsers(dest="step", required=True)
    prepare_command = commands.add_parser("prepare")
    prepare_command.add_argument("photo", type=Path)
    prepare_command.add_argument("plan", type=Path)
    prepare_command.add_argument("output", type=Path)
    finish_command = commands.add_parser("finish")
    finish_command.add_argument("output", type=Path)

    args = parser.parse_args()
    try:
        output = args.output.resolve()
        if any((parent / ".git").exists() for parent in (output, *output.parents)):
            raise ValueError("Choose a private output directory outside Git worktrees.")

        if args.step == "prepare":
            prepare(args.photo, args.plan, output)
        else:
            finish(output)
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
