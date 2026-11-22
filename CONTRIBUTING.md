# Contributing

Follow the installation steps in README.md, then run `bun run demo` and `bun run check` from the repository root. The package lives in `backend/src/same_angle/`. Keep pixel operations in memory and file handling in the example. Add a module when a feature needs it and cover its behavior in `backend/tests/`.

From `backend/`, use `uv add PACKAGE` for a runtime dependency or `uv add --dev PACKAGE` for a development tool. Include the updated pyproject.toml and uv.lock together.

Declare runnable workspaces in the root package.json. Define their commands in the workspace package.json and coordinate them in turbo.json. Commit bun.lock with JavaScript dependency changes.

## Code quality

Run these commands from the repository root to cover both workspaces. Run the same command from `frontend/` or `backend/` to work on that workspace alone.

| Command | What it does |
| --- | --- |
| `bun run format` | Formats frontend files with Oxfmt and Python files with Ruff. |
| `bun run format:check` | Checks formatting without editing files. |
| `bun run lint` | Runs Oxlint for TypeScript, React Hooks, and JSX accessibility, and Ruff for Python, including import order. |
| `bun run lint:fix` | Applies safe lint fixes, including Python import sorting. Review the diff and run `bun run format` afterward. |
| `bun run check` | Runs formatting and lint checks, mypy, TypeScript, frontend and Python tests, and the Vite build. GitHub Actions uses this command. |

### Code layout

Keep short Hook declarations of the same kind together. Start with state and reducers, followed by refs and derived values. Define memoized callbacks before effects that depend on them, and keep event handlers near the JSX. Oxlint checks the Rules of Hooks and effect dependencies. Preserve the relative order and dependencies of effects when reorganizing a component.

Use a blank line when a function moves between distinct steps such as preparing values, validating them, applying changes, and returning the result. Keep related declarations and guards together. Apply the same convention in TypeScript helpers and Python modules.

### Import order

Oxfmt puts side-effect imports first and preserves their relative order. It then groups React, built-ins and external packages, internal aliases, and relative imports, with a blank line between groups. Oxlint requires a blank line after the import block. The same rules apply to frontend tests and configuration files.

### Frontend tests

Run `bun run test` from `frontend/` for the unit tests. They use Playwright's test runner without starting a browser or server.

From `frontend/`, run `bunx playwright install chromium` once, then `bun run test:e2e`. Playwright starts Vite on port 4182 and the Python renderer on port 8765. It checks the editor with synthetic images. Use those ports for one checkout at a time.

### VS Code

After installing the Bun dependencies, run `uv sync --locked` from `backend/` to create `backend/.venv`. Open the repository root in VS Code and install the recommended Oxc, Ruff, and Python extensions. If the editor already has a different interpreter selected, use **Python: Select Interpreter** and choose the environment in `backend/.venv`.

**Format Document** uses Oxfmt for JavaScript and TypeScript, including JSX and TSX, and Ruff for Python. You can enable **Format On Save** in your user settings. Run `bun run check` before opening a PR or pushing directly to `main`.
