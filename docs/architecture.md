# Architecture

Bun installs the frontend dependencies and Turborepo runs workspace tasks. Each workspace owns its commands. The backend uses uv to manage Python independently.

- `backend/src/same_angle/imaging.py` operates on images in memory. The example handles files and produces the teaching images.
- `frontend/` runs a React page with Vite. It can run on its own.
- `evals/` describes how to assess visual quality once the editor produces room renders.

The first connection between workspaces will be a before-and-after slider reading two local images. When the editor needs to submit an image, an HTTP handler can call the same Python imaging function as the example. Floor geometry, scene persistence and model integrations belong to later features.
