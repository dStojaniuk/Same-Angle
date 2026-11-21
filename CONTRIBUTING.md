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
| `bun run check` | Runs formatting and lint checks, mypy, TypeScript, the Python tests, and the Vite build. GitHub Actions uses this command. |

### VS Code

After installing the Bun dependencies, run `uv sync --locked` from `backend/` to create `backend/.venv`. Open the repository root in VS Code and install the recommended Oxc, Ruff, and Python extensions. If the editor already has a different interpreter selected, use **Python: Select Interpreter** and choose the environment in `backend/.venv`.

**Format Document** uses Oxfmt for JavaScript and TypeScript, including JSX and TSX, and Ruff for Python. You can enable **Format On Save** in your user settings. Run `bun run check` before opening a PR or pushing directly to `main`.
