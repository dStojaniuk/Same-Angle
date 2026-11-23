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

After outlining the floor, choose **Calibrate and arrange** to work on one photo. Enter approximate room dimensions and mark at least five architectural edge segments, including a horizontal and a vertical on the far wall and a floor seam along a side wall. **Fit camera from edges** reports the pixel error. Mark other visible segments with **Check only** to measure their deviation from the fitted guides without changing the camera. **Place the bed** moves the bed along the floor, and **Render floor and bed** projects both changes from the fitted view. Compare the arrangement with the original and download the result as a PNG. The scale is approximate, and the calibration is kept for the current editing session.

Choose **Restyle room** to describe a renovation in a prompt. Outline and add editable regions for finishes and furnishings, and protected regions for doors, windows, and visible wall seams. **Generate with OpenAI** sends the prepared photo, editable-area overlay, and prompt to the Images API when `OPENAI_API_KEY` is set in the backend environment. Alternatively, import a static edited JPG, 8-bit PNG, or WebP with matching framing and aspect ratio and use **Apply masks to imported image**. Convert HDR or linear-color PNGs to sRGB first. The styled PNG has the original size. The compositor uses the original pixels in every protected area and everywhere outside the edit regions. Inspect newly revealed surfaces with the before/after slider. Turn off **Feather mask edges** for a crisp join at a door frame or baseboard.

To redesign through a signed-in Codex CLI session, use **Download Codex plan** and **Download prepared photo** in **Restyle room**. Run [`$same-angle-redesign`](.agents/skills/same-angle-redesign/SKILL.md) with those files and a private output directory. The CLI checks that the photo matches the plan before generation and saves the styled PNG and comparison automatically.

To load an existing private environment file for local generation, start the backend with `UV_ENV_FILE=/absolute/path/to/your.env bun run dev` from `backend/` and start `bun run dev` separately from `frontend/`. Set `OPENAI_API_KEY` in the private file and keep it outside Git. **Restyle room** shows whether the local backend has a key configured.

Choose **Preview a bed** to arrange a shared bed on one or two photos. Fit each camera, then open **Floor plan** to enter room and bed dimensions, check wall clearance, and move or rotate the bed. The default room dimensions are illustrative. The views and PNG snapshots display **Skala orientacyjna**.

Use **Download scene** to save the room, bed, and camera settings as JSON. To resume, open the same photos in the same order and choose **Load scene**. Scene files store photo names, dimensions, and content fingerprints. Use **Download view PNG** in each view to export the projected bed at the photo’s working resolution. View exports need at least 128 × 40 px to fit the scale label.

Uploaded photos and their floor drafts are saved in this browser. Use **Saved projects** to reopen a photo and continue editing its outline and grid. The original, outline, and grid are stored locally for the address where you opened the editor. Render a saved draft again to get a new PNG.

Run `bun run check` for formatting, lint, type checks, frontend and Python tests, and the frontend production build. See [Contributing](CONTRIBUTING.md) for individual commands.

See the [architecture](docs/architecture.md) for the workspace boundaries and the [visual evaluation plan](evals/README.md) for the first room trial.
