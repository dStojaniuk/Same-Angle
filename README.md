# Same Angle

Same Angle explores how to redesign a room while keeping the original camera perspective. The first exercise uses a four-pixel-wide, three-pixel-high image.

Use the Node LTS version pinned in `.nvmrc` (with nvm, run `nvm install`). Install Bun 1.4.3 and uv 0.13.8. From the repository root, run:

```sh
bun install --frozen-lockfile
bun run demo
```

Turborepo runs the backend demo. On the first run, uv prepares the pinned Python environment from the backend lockfile. To run just the Python exercise, use `uv run --locked python examples/mask_demo.py` from `backend/`.

Open `output/original-preview.png`, `output/mask-preview.png` and `output/result-preview.png`. The corresponding files without the preview suffix are the actual 4 × 3 images. The previews use nearest-neighbor scaling so pixel boundaries stay sharp.

White marks an editable pixel. Black protects the original color. Before editing, predict which two cells will turn coral. The starter function returns a copy, so the initial result matches the original. Write the rule inside [apply_mask](backend/src/same_angle/imaging.py) and run `bun run demo` again.

Run `bun run dev` and open the URL printed by Vite. This starts the editor and its local Python renderer. Open the sample room or load a JPG or PNG with **Open photo**. Outline the floor, choose **Adjust perspective grid**, and move the four corners to match the room. Press **Render floor** to send the photo and the approved outline and grid to Python on this machine. Use the slider to compare the resulting PNG with the original. **Compare sample finishes** opens the prepared comparison directly.

Photos can be up to 25 MiB and 24 megapixels. The editor uses a static sRGB preview for editing, rendering, and comparison. For an animated PNG it uses the default image, or the first frame if there is no separate default image. The outline accepts up to 128 points. **Undo**, **Redo**, and the reset controls cover both the outline and the grid. **Move outline** moves every point together. At higher zoom levels, turn on **Pan** to drag the view. **Download PNG** saves the current render.

Uploaded photos and their floor drafts are saved in this browser. Use **Saved projects** to reopen a photo and continue editing its outline and grid. The original, outline, and grid are stored locally for the address where you opened the editor. Render a saved draft again to get a new PNG.

Run `bun run check` for formatting, lint, type checks, frontend and Python tests, and the frontend production build. See [Contributing](CONTRIBUTING.md) for individual commands.

See the [architecture](docs/architecture.md) for the workspace boundaries and the [visual evaluation plan](evals/README.md) for the first room trial.
