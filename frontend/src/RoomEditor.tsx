import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { placeBedOnPhoto, projectBed, projectFloorGuides } from "./bed";
import { BedControls, BedViews } from "./BedPreview";
import { CalibrationEditor } from "./CalibrationEditor";
import { createCameraProjection, type FloorPoint } from "./camera";
import { changeDraft, startHistory, type FloorDraft } from "./floorDraft";
import { renderFloor } from "./floorRender";
import { MAX_OUTLINE_POINTS, type Point } from "./outline";
import { initialGrid, projectFloor } from "./perspective";
import { sampleRoom, type RoomPhoto } from "./photo";
import { PhotoViewport } from "./PhotoViewport";
import { changeLayout, initialBed, startLayout } from "./roomLayout";
import { PlanControls, RoomPlan } from "./RoomPlan";
import { SceneFiles } from "./SceneFiles";
import { SnapshotButton } from "./SnapshotButton";
import { StyleEditor } from "./StyleEditor";
import { useBedViews } from "./useBedViews";

const zoomLevels = [1, 1.25, 1.5, 2];

type EditorMode =
  | { kind: "outline" }
  | { kind: "grid" }
  | { kind: "bed" }
  | { kind: "calibration" }
  | { kind: "style" }
  | { kind: "comparison"; url: string; source: "sample" | "render" };
type FocusTarget =
  | "grid"
  | "sample"
  | "render"
  | "slider"
  | "camera"
  | "preview-bed"
  | "plan"
  | "calibration"
  | "style";

type RoomEditorProps = {
  photo: RoomPhoto;
  initialDraft?: FloorDraft;
  onDraftChange: (draft: FloorDraft) => void;
  saveMessage: string;
  onRetrySave?: () => void;
  onOpenSavedVersion?: () => void;
  recoveringConflict: boolean;
  onOpenSample: () => void;
  headingRef: (heading: HTMLHeadingElement | null) => void;
};

export function RoomEditor({
  photo,
  initialDraft,
  onDraftChange,
  saveMessage,
  onRetrySave,
  onOpenSavedVersion,
  recoveringConflict,
  onOpenSample,
  headingRef,
}: RoomEditorProps) {
  const [{ draft, past, future }, dispatch] = useReducer(
    changeDraft,
    initialDraft ?? { outline: photo.outline, corners: null },
    startHistory,
  );
  const [zoomIndex, setZoomIndex] = useState(0);
  const [editorMode, setMode] = useState<EditorMode>({ kind: "outline" });
  const [photoTool, setPhotoTool] = useState<"points" | "pan" | "outline">("points");
  const [{ layout, past: pastLayout, future: futureLayout }, dispatchLayout] = useReducer(
    changeLayout,
    undefined,
    startLayout,
  );
  const [planOpen, setPlanOpen] = useState(false);
  const [placementMessage, setPlacementMessage] = useState("");
  const [split, setSplit] = useState(50);
  const [movingGeometry, setMovingGeometry] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState("");

  const views = useBedViews(photo);

  const focusTarget = useRef<FocusTarget | null>(null);
  const request = useRef<AbortController | null>(null);
  const resultUrl = useRef<string | null>(null);
  const lastDraft = useRef(draft);

  const { outline } = draft;
  const { bed } = layout;
  const mode =
    editorMode.kind === "grid" && outline.length < 3 ? ({ kind: "outline" } as const) : editorMode;
  const suggestedCorners = useMemo(
    () => (outline.length >= 3 ? initialGrid(outline) : []),
    [outline],
  );
  const corners = draft.corners ?? suggestedCorners;

  const historyAvailable =
    (mode.kind === "outline" || mode.kind === "grid") &&
    !rendering &&
    !movingGeometry &&
    !recoveringConflict;
  const validGrid = projectFloor(corners) !== null;
  const sampleComparisonUrl = photo.comparisonUrl;
  const comparison = mode.kind === "comparison" ? { url: mode.url, split } : null;
  const grid = mode.kind === "grid" ? { corners, locked: rendering } : undefined;
  const showFloorSave = mode.kind !== "bed";
  const showPlan = mode.kind === "bed" && planOpen;
  const viewportPhoto = mode.kind === "bed" ? views.activePhoto : photo;
  const camera = mode.kind === "bed" ? createCameraProjection(viewportPhoto, views.settings) : null;
  const bedPreview = camera && {
    faces: projectBed(camera, viewportPhoto, bed.center, bed.crosswise, bed.size),
    guides: projectFloorGuides(camera, layout.room),
    anchor: camera.project({ ...bed.center, y: 0 }),
    onPlace: placeBed,
  };

  const stepHistory = useCallback((type: "undo" | "redo") => {
    dispatch({ type });
    setPhotoTool((tool) => (tool === "outline" ? "points" : tool));
    setRenderError("");
  }, []);

  useEffect(() => {
    return () => {
      request.current?.abort();
      request.current = null;
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    };
  }, []);

  useEffect(() => {
    if (lastDraft.current === draft) return;

    lastDraft.current = draft;
    onDraftChange(draft);
  }, [draft, onDraftChange]);

  useEffect(() => {
    if (!historyAvailable) return;

    function handleHistoryShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, select, [contenteditable]")
      )
        return;

      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;

      event.preventDefault();
      stepHistory(key === "y" || event.shiftKey ? "redo" : "undo");
    }

    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [historyAvailable, stepHistory]);

  function editOutline(next: Point[]) {
    dispatch({ type: "edit", draft: { ...draft, outline: next } });
  }

  function resetActiveGeometry() {
    setPhotoTool("points");
    dispatch({
      type: "edit",
      draft:
        mode.kind === "grid" ? { ...draft, corners: null } : { ...draft, outline: photo.outline },
    });
    setRenderError("");
  }

  function changeMode(next: EditorMode, focus: FocusTarget) {
    focusTarget.current = focus;
    setPhotoTool("points");
    setMode(next);
  }

  function focusAfterSwitch(target: FocusTarget) {
    return (element: HTMLElement | null) => {
      if (element && focusTarget.current === target) {
        focusTarget.current = null;
        element.focus();
      }
    };
  }

  function openGrid() {
    setRenderError("");
    changeMode({ kind: "grid" }, "render");
  }

  function editGrid(next: Point[]) {
    dispatch({ type: "edit", draft: { ...draft, corners: next } });
    setRenderError("");
  }

  function resetViewport() {
    setPlacementMessage("");
    setPhotoTool("points");
    setZoomIndex(0);
  }

  async function openSecondPhoto(file: File) {
    if (await views.openSecondPhoto(file)) resetViewport();
  }

  function placeBed(point?: Point) {
    if (!camera) return;

    const placement = placeBedOnPhoto(camera, viewportPhoto, bed.crosswise, point, bed.size);
    if ("message" in placement) {
      setPlacementMessage(placement.message);
      return;
    }

    moveBed(placement.center);
    setPlacementMessage("");
  }

  function moveBed(center: FloorPoint) {
    dispatchLayout({
      type: "change",
      update: (current) => ({ ...current, bed: { ...current.bed, center } }),
    });
  }

  function rotateBed() {
    dispatchLayout({
      type: "change",
      update: (current) => ({
        ...current,
        bed: { ...current.bed, crosswise: !current.bed.crosswise },
      }),
    });
    setPlacementMessage("");
  }

  function backToOutline() {
    views.selectView("first");
    setPlanOpen(false);
    changeMode({ kind: "outline" }, "preview-bed");
  }

  async function submitFloor() {
    if (!validGrid || movingGeometry || request.current) return;

    const controller = new AbortController();
    request.current = controller;
    setRenderError("");
    setRendering(true);
    let incomingUrl: string | null = null;

    try {
      const result = await renderFloor(photo, outline, corners, controller.signal);
      if (request.current !== controller) return;

      incomingUrl = URL.createObjectURL(result);
      const image = new Image();
      image.src = incomingUrl;
      await image.decode().catch(() => {
        throw new Error("The renderer returned a PNG that could not be opened.");
      });

      if (request.current !== controller) return;
      if (image.naturalWidth !== photo.width || image.naturalHeight !== photo.height) {
        throw new Error("The rendered PNG does not match the photo dimensions.");
      }

      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
      resultUrl.current = incomingUrl;
      setSplit(50);
      changeMode({ kind: "comparison", url: incomingUrl, source: "render" }, "slider");
      incomingUrl = null;
    } catch (error) {
      if (request.current === controller) {
        setRenderError(error instanceof Error ? error.message : "The local render failed.");
        focusTarget.current = "render";
      }
    } finally {
      if (incomingUrl) URL.revokeObjectURL(incomingUrl);

      if (request.current === controller) {
        request.current = null;
        setRendering(false);
      }
    }
  }

  function cancelRender() {
    request.current?.abort();
    request.current = null;
    focusTarget.current = "render";
    setRendering(false);
  }

  const floorSaveStatus = (
    <>
      {saveMessage && (
        <output className="save-status">
          {mode.kind === "calibration" && "Floor outline · "}
          {saveMessage}
        </output>
      )}
      {onRetrySave && (
        <button type="button" className="text-button retry-save" onClick={onRetrySave}>
          Retry save
        </button>
      )}
      {onOpenSavedVersion && (
        <button
          type="button"
          className="text-button retry-save"
          disabled={movingGeometry}
          onClick={onOpenSavedVersion}
        >
          Save draft copy and open saved version
        </button>
      )}
    </>
  );

  return (
    <main className="studio" inert={recoveringConflict}>
      <CalibrationEditor
        active={mode.kind === "calibration"}
        photo={photo}
        outline={outline}
        saveStatus={floorSaveStatus}
        onBack={() => changeMode({ kind: "outline" }, "calibration")}
      />
      <StyleEditor
        active={mode.kind === "style"}
        photo={photo}
        onBack={() => changeMode({ kind: "outline" }, "style")}
      />
      <div className="studio-heading" hidden={mode.kind === "calibration" || mode.kind === "style"}>
        <h1 ref={headingRef} tabIndex={-1}>
          Room editor
        </h1>
        <div className="canvas-actions">
          {mode.kind === "outline" && (
            <button
              type="button"
              className="text-button"
              ref={focusAfterSwitch("style")}
              disabled={movingGeometry}
              onClick={() => changeMode({ kind: "style" }, "style")}
            >
              Restyle room
            </button>
          )}
          {photo !== sampleRoom && (
            <button type="button" className="text-button" onClick={onOpenSample}>
              Open sample room
            </button>
          )}
        </div>
      </div>

      <div className="studio-layout" hidden={mode.kind === "calibration" || mode.kind === "style"}>
        <section className="canvas" aria-label="Photo workspace" hidden={showPlan}>
          <div className="canvas-header">
            <div className="photo-details">
              <strong title={viewportPhoto.name}>{viewportPhoto.name}</strong>
              <span>
                {viewportPhoto.width} × {viewportPhoto.height} px
              </span>
              {mode.kind !== "calibration" && showFloorSave && floorSaveStatus}
            </div>
            <div className="canvas-actions">
              <button
                type="button"
                className="secondary-button pan-toggle"
                aria-label="Pan photo"
                aria-pressed={photoTool === "pan"}
                title="Pan photo"
                disabled={zoomIndex === 0 || rendering}
                onClick={() => setPhotoTool(photoTool === "pan" ? "points" : "pan")}
              >
                Pan
              </button>
              <fieldset className="zoom-controls" aria-label="Photo zoom">
                <button
                  type="button"
                  aria-label="Zoom out"
                  disabled={zoomIndex === 0}
                  onClick={() => {
                    setZoomIndex(zoomIndex - 1);
                    if (zoomIndex === 1 && photoTool === "pan") setPhotoTool("points");
                  }}
                >
                  −
                </button>
                <button
                  type="button"
                  aria-label="Fit photo"
                  title="Fit photo"
                  className="zoom-value"
                  onClick={() => {
                    setZoomIndex(0);
                    if (photoTool === "pan") setPhotoTool("points");
                  }}
                >
                  {zoomLevels[zoomIndex] * 100}%
                </button>
                <button
                  type="button"
                  aria-label="Zoom in"
                  disabled={zoomIndex === zoomLevels.length - 1}
                  onClick={() => setZoomIndex(zoomIndex + 1)}
                >
                  +
                </button>
              </fieldset>
            </div>
          </div>
          <PhotoViewport
            key={viewportPhoto.url}
            photo={viewportPhoto}
            outline={outline}
            onEdit={grid ? editGrid : editOutline}
            grid={grid}
            bedPreview={bedPreview ?? undefined}
            tool={photoTool}
            onGeometryMove={setMovingGeometry}
            zoom={zoomLevels[zoomIndex]}
            comparison={comparison}
          />
          {comparison && (
            <div className="comparison-control">
              <span>All oak</span>
              <input
                type="range"
                aria-label="Before and after"
                ref={focusAfterSwitch("slider")}
                aria-valuetext={`${split}% original, ${100 - split}% oak`}
                min={0}
                max={100}
                value={split}
                onChange={(event) => setSplit(event.currentTarget.valueAsNumber)}
              />
              <span>All original</span>
            </div>
          )}
        </section>

        {showPlan && (
          <section className="canvas" aria-label="Layout workspace">
            <RoomPlan
              layout={layout}
              cameras={views.sceneViews.map(({ camera }) => camera)}
              onMove={moveBed}
              focusSurface={focusAfterSwitch("plan")}
            />
          </section>
        )}
        <aside className="editor-panel" aria-label="Room tools">
          {mode.kind === "comparison" ? (
            <>
              <h2>Compare finishes</h2>
              <p>Move the slider to compare the original floor with oak in the same room.</p>
              {mode.source === "sample" ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => changeMode({ kind: "outline" }, "sample")}
                >
                  Back to outline
                </button>
              ) : (
                <div className="editor-actions">
                  <a
                    className="primary-button download-button"
                    href={mode.url}
                    download={`${photo.name.replace(/\.[^.]+$/, "") || "room"}-floor.png`}
                  >
                    Download PNG
                  </a>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => changeMode({ kind: "grid" }, "render")}
                  >
                    Adjust grid
                  </button>
                </div>
              )}
            </>
          ) : bedPreview ? (
            <>
              <BedViews
                view={showPlan ? "plan" : views.view}
                hasSecondPhoto={views.secondPhoto !== null}
                photoError={views.photoError}
                openingSecondPhoto={views.openingSecondPhoto}
                onSelectView={(view) => {
                  if (view === "plan" && !showPlan) focusTarget.current = "plan";
                  setPlanOpen(view === "plan");
                  if (view !== "plan") {
                    views.selectView(view);
                    if (showPlan || view !== views.view) resetViewport();
                  }
                }}
                onOpenSecondPhoto={(file) => void openSecondPhoto(file)}
              />
              {showPlan ? (
                <PlanControls
                  layout={layout}
                  canUndo={pastLayout.length > 0}
                  canRedo={futureLayout.length > 0}
                  onChange={(update) => dispatchLayout({ type: "change", update })}
                  onUndo={() => dispatchLayout({ type: "undo" })}
                  onRedo={() => dispatchLayout({ type: "redo" })}
                  onRotate={rotateBed}
                  onBack={backToOutline}
                />
              ) : (
                <BedControls
                  size={bed.size}
                  settings={views.settings}
                  hasSecondPhoto={views.secondPhoto !== null}
                  message={
                    placementMessage ||
                    (bedPreview.faces.length
                      ? ""
                      : "The bed is out of view. Adjust the camera or place it again on the photo.")
                  }
                  focusHeading={focusAfterSwitch("camera")}
                  onAdjust={(key, value) => {
                    views.adjustCamera(key, value);
                    setPlacementMessage("");
                  }}
                  onRotate={rotateBed}
                  onReset={() => {
                    views.resetCamera();
                    if (!views.secondPhoto) {
                      dispatchLayout({
                        type: "change",
                        update: (current) => ({ ...current, bed: initialBed }),
                      });
                    }
                    setPlacementMessage("");
                  }}
                  onBack={backToOutline}
                />
              )}
              <SceneFiles
                layout={layout}
                views={views.sceneViews}
                photoChanging={views.openingSecondPhoto}
                onLoad={(scene, secondPhotoUrl) => {
                  views.restoreCameras(
                    scene.views.map(({ camera }) => camera),
                    secondPhotoUrl,
                  );
                  dispatchLayout({ type: "change", update: () => scene.layout });
                  setPlacementMessage("");
                }}
              />
            </>
          ) : mode.kind === "grid" ? (
            <>
              <h2>Align the floor grid</h2>
              <p id="grid-help">
                Move the four corners to match the floor. Align the long lines with the direction of
                the boards.
              </p>
              {!validGrid && (
                <p className="field-error" role="alert">
                  Keep the four corners in clockwise order.
                </p>
              )}
              {renderError && (
                <p className="field-error" role="alert">
                  {renderError}
                </p>
              )}
              {rendering ? (
                <div className="editor-actions">
                  <output>Rendering with Python…</output>
                  <button type="button" className="secondary-button" onClick={cancelRender}>
                    Stop waiting
                  </button>
                </div>
              ) : (
                <div className="editor-actions">
                  <button
                    type="button"
                    className="primary-button"
                    ref={focusAfterSwitch("render")}
                    disabled={!validGrid || movingGeometry}
                    onClick={() => void submitFloor()}
                  >
                    Render floor
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => changeMode({ kind: "outline" }, "grid")}
                  >
                    Back to outline
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <h2>Outline the floor</h2>
              <p id="outline-help">
                Click the photo to add points. Drag a point or use the arrow keys. Press Delete to
                remove a focused point.
              </p>
              <div className="outline-tools">
                <span>
                  {outline.length} {outline.length === 1 ? "point" : "points"}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  aria-pressed={photoTool === "outline"}
                  disabled={outline.length === 0 || movingGeometry}
                  onClick={() => setPhotoTool(photoTool === "outline" ? "points" : "outline")}
                >
                  Move outline
                </button>
              </div>
              {outline.length >= MAX_OUTLINE_POINTS && (
                <p className="field-error">
                  Undo a point to add another. The outline supports up to {MAX_OUTLINE_POINTS}{" "}
                  points.
                </p>
              )}
              <div className="floor-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={outline.length < 3 || movingGeometry}
                  ref={focusAfterSwitch("grid")}
                  onClick={openGrid}
                >
                  Adjust perspective grid
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  ref={focusAfterSwitch("preview-bed")}
                  disabled={movingGeometry}
                  onClick={() => changeMode({ kind: "bed" }, "camera")}
                >
                  Preview a bed
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  ref={focusAfterSwitch("calibration")}
                  disabled={outline.length < 3 || movingGeometry}
                  onClick={() => changeMode({ kind: "calibration" }, "calibration")}
                >
                  Calibrate and arrange
                </button>
                {sampleComparisonUrl && (
                  <button
                    type="button"
                    className="secondary-button"
                    ref={focusAfterSwitch("sample")}
                    onClick={() =>
                      changeMode(
                        { kind: "comparison", url: sampleComparisonUrl, source: "sample" },
                        "slider",
                      )
                    }
                  >
                    Compare sample finishes
                  </button>
                )}
              </div>
            </>
          )}
          {(mode.kind === "outline" || mode.kind === "grid") && (
            <fieldset className="history-controls" aria-label="Edit history">
              <button
                type="button"
                className="secondary-button"
                disabled={!historyAvailable || !past.length}
                onClick={() => stepHistory("undo")}
              >
                Undo
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!historyAvailable || !future.length}
                onClick={() => stepHistory("redo")}
              >
                Redo
              </button>
              <button
                type="button"
                className="text-button"
                disabled={
                  !historyAvailable ||
                  (mode.kind === "grid"
                    ? draft.corners === null
                    : outline === photo.outline || (!outline.length && !photo.outline.length))
                }
                onClick={resetActiveGeometry}
              >
                {mode.kind === "grid" ? "Reset grid" : "Reset outline"}
              </button>
            </fieldset>
          )}
          <SnapshotButton
            snapshot={
              bedPreview && !showPlan
                ? { photo: viewportPhoto, faces: bedPreview.faces, view: views.view }
                : null
            }
          />
        </aside>
      </div>
    </main>
  );
}
