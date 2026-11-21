from PIL import Image


def apply_mask(
    image: Image.Image, mask: Image.Image, color: tuple[int, int, int]
) -> Image.Image:
    """Return a new RGB image. White mask pixels select the replacement color."""
    result = image.copy()
    # Exercise: use the mask to choose which pixels to recolor.
    return result
