from pathlib import Path

from PIL import Image

from same_angle.imaging import apply_mask

OUTPUT = Path(__file__).resolve().parents[2] / "output"
SAND = (232, 202, 158)
BLUE = (64, 104, 138)
CORAL = (238, 101, 83)

MASK_ROWS = (
    (0, 1, 0, 0),
    (0, 0, 0, 0),
    (0, 0, 1, 0),
)


def main(output_dir: Path = OUTPUT) -> None:
    image = Image.new("RGB", (4, 3), SAND)
    image.paste(BLUE, (0, 1, 4, 2))
    mask = Image.new("L", image.size)
    for y, row in enumerate(MASK_ROWS):
        for x, selected in enumerate(row):
            mask.putpixel((x, y), 255 * selected)

    result = apply_mask(image, mask, CORAL)
    output_dir.mkdir(exist_ok=True)
    for name, panel in (("original", image), ("mask", mask), ("result", result)):
        panel.save(output_dir / f"{name}.png")
        preview = panel.resize((320, 240), Image.Resampling.NEAREST)
        preview.save(output_dir / f"{name}-preview.png")
    print(
        f"Open original-preview.png, mask-preview.png and result-preview.png in {output_dir}"
    )


if __name__ == "__main__":
    main()
