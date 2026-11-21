# Contributing

Follow the installation steps in README.md, then run `bun run demo` and `bun run check` from the repository root. The package lives in `backend/src/same_angle/`. Keep pixel operations in memory and file handling in the example. Add a module when a feature needs it and cover its behavior in `backend/tests/`.

From `backend/`, use `uv add PACKAGE` for a runtime dependency or `uv add --dev PACKAGE` for a development tool. Include the updated pyproject.toml and uv.lock together.

Declare runnable workspaces in the root package.json. Define their commands in the workspace package.json and coordinate them in turbo.json. Commit bun.lock with JavaScript dependency changes.
