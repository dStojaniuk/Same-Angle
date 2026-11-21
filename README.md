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

Run `bun run dev` to start the React frontend with Vite on Bun. Open the local URL printed by Vite. The starter page displays the project name.

Run `bun run check` for formatting, lint, type checks, the Python tests, and the frontend production build. See [Contributing](CONTRIBUTING.md) for individual commands.

See the [architecture](docs/architecture.md) for the workspace boundaries and the [visual evaluation plan](evals/README.md) for the first room trial.
