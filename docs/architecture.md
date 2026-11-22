# Architecture

Bun installs the frontend dependencies and Turborepo runs workspace tasks. Each workspace owns its commands. The backend uses uv to manage Python independently.

- `backend/src/same_angle/imaging.py` operates on images in memory. The example handles files and produces the teaching images.
- `frontend/` runs the editor with React and Vite. It draws the outline and perspective grid in oriented image coordinates, then sends one render request after approval.
- `evals/` describes how to assess visual quality once the editor produces room renders.

Vite proxies `POST /api/floor-render` to FastAPI on loopback. The browser decodes an uploaded photo into an oriented, static 8-bit sRGB PNG and shares that raster between the editor and renderer. The multipart request contains the working image and a JSON `plan` with its dimensions, outline vertices, and four grid corners. The bundled sample uses a static WebP. Corner order is top left, top right, bottom right, bottom left. All points use pixel coordinates in the oriented image. The grid previews six board widths along the far edge and four depth intervals.

The renderer accepts working PNGs up to 100 MiB so lossless encoding can cover the 24 MP import limit. The limit for JPEG and WebP requests is 25 MiB. Direct requests with APNG, 16-bit PNG, or PNG color metadata that cannot be preserved get a 422 response asking the caller to prepare the photo in the editor. Python verifies the dimensions, projects a repeating oak texture from the same corners, and composites it only inside the outline. The endpoint returns a PNG with the original framing and dimensions. `backend/src/same_angle/floor.py` owns the projection and compositing. `apply_mask` in the imaging module remains the introductory recoloring exercise. Calibrated room geometry and model integrations belong to later features.

The editor keeps one undo and redo history for the floor outline and grid. IndexedDB stores the current draft and the source file in separate stores in the browser. Draft writes leave the original file in place and verify the saved revision before replacing coordinates. Opening the saved projects list refreshes it from IndexedDB and keeps drafts pending in the active tab. Reopening a project restores its pending edits when present. After a conflict, the editor can save those edits as a separate project and open the saved version for continued work. The editor checks the render's PNG signature and chunk boundaries, decodes it, and checks its dimensions before enabling comparison and download.
