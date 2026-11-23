import { useEffect, useRef, useState, type ReactNode } from "react";

import { bedSize, placeBedOnPhoto, projectBed, projectFloorGuides } from "./bed";
import {
  fitRoomCamera,
  hasEdgeLength,
  measureEdge,
  overlapsEdgeSpan,
  projectRoomEdge,
  roomEdgeLabels,
  type EdgeId,
  type EdgeMark,
  type RoomShell,
} from "./calibration";
import { createCameraProjection, type FloorPoint } from "./camera";
import { renderFloor } from "./floorRender";
import type { Point } from "./outline";
import type { RoomPhoto } from "./photo";
import { PhotoViewport } from "./PhotoViewport";
import { roomSizeLimits } from "./roomLayout";
import { renderRoomSnapshot } from "./roomSnapshot";

const edgeIds = Object.keys(roomEdgeLabels) as EdgeId[];
const dimensionFields = {
  width: "Room width",
  length: "Room length",
  height: "Wall height",
} as const;
type Dimensions = Pick<RoomShell, keyof typeof dimensionFields>;
type MarkPurpose = "fit" | "check";
type RecordedMark = EdgeMark & { purpose: MarkPurpose };

function bedInsideRoom({ x, z }: FloorPoint, room: RoomShell): FloorPoint {
  return {
    x: Math.max(room.x + bedSize.width / 2, Math.min(x, room.x + room.width - bedSize.width / 2)),
    z: Math.max(
      room.z + bedSize.length / 2,
      Math.min(z, room.z + room.length - bedSize.length / 2),
    ),
  };
}

export function CalibrationEditor({
  active,
  photo,
  outline,
  saveStatus,
  onBack,
}: {
  active: boolean;
  photo: RoomPhoto;
  outline: Point[];
  saveStatus: ReactNode;
  onBack: () => void;
}) {
  const [dimensions, setDimensions] = useState<Dimensions>({ width: 3, length: 5, height: 2.6 });
  const [edge, setEdge] = useState<EdgeId>("farFloor");
  const [purpose, setPurpose] = useState<MarkPurpose>("fit");
  const [marks, setMarks] = useState<RecordedMark[]>([]);
  const [start, setStart] = useState<Point | null>(null);
  const [fit, setFit] = useState<ReturnType<typeof fitRoomCamera>>(null);
  const [fitAttempted, setFitAttempted] = useState(false);
  const [placingBed, setPlacingBed] = useState(false);
  const [bedPosition, setBedPosition] = useState<FloorPoint>({ x: 0, z: 1.15 });
  const [split, setSplit] = useState(50);
  const [comparisonUrl, setComparisonUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState("");

  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null);
  const result = useRef<string | null>(null);

  const room = { ...dimensions, x: -dimensions.width / 2, z: 0 };
  const validRoom = Object.values(dimensions).every(
    (value) => value >= roomSizeLimits.min && value <= roomSizeLimits.max,
  );
  const canFitBed = room.width >= bedSize.width && room.length >= bedSize.length;
  const camera = fit && createCameraProjection(photo, fit.camera);
  const center = bedInsideRoom(bedPosition, room);
  const faces = camera && canFitBed ? projectBed(camera, photo, center, false) : [];
  const fitMarks = marks.filter((mark) => mark.purpose === "fit");
  const checks = marks.filter((mark) => mark.purpose === "check");
  const comparison = comparisonUrl ? { url: comparisonUrl, split } : null;
  const lines = marks.map(({ points, purpose }) => ({
    points,
    kind: purpose === "check" ? ("check" as const) : ("mark" as const),
  }));

  const fittedLines = camera
    ? edgeIds.flatMap((id) => {
        const points = projectRoomEdge(camera, room, id);
        return points ? [{ points, kind: "fit" as const }] : [];
      })
    : [];

  useEffect(() => {
    if (active) heading.current?.focus();
  }, [active]);

  useEffect(() => {
    return () => {
      request.current?.abort();
      request.current = null;
      if (result.current) URL.revokeObjectURL(result.current);
    };
  }, []);

  function clearFit() {
    setFit(null);
    setFitAttempted(false);
    setPlacingBed(false);
    setRenderError("");
  }

  function markPoint(point: Point) {
    if (!start) {
      setStart(point);
      return;
    }

    setMarks([
      ...marks.filter((mark) => mark.edge !== edge || mark.purpose !== purpose),
      { edge, purpose, points: [start, point] },
    ]);
    setStart(null);
    if (purpose === "fit") clearFit();
  }

  function applyFit() {
    setStart(null);
    setFit(
      fitRoomCamera(
        photo,
        room,
        marks.filter((mark) => mark.purpose === "fit"),
      ),
    );
    setFitAttempted(true);
    setRenderError("");
  }

  function placeBed(point?: Point) {
    if (!camera) return;

    const placement = placeBedOnPhoto(camera, photo, false, point);
    if ("center" in placement) setBedPosition(bedInsideRoom(placement.center, room));
  }

  function returnToCalibration() {
    if (result.current) URL.revokeObjectURL(result.current);
    result.current = null;
    setComparisonUrl(null);
  }

  async function renderArrangement() {
    if (!camera || !faces.length || request.current) return;

    const controller = new AbortController();
    request.current = controller;
    setRendering(true);
    setRenderError("");
    let floorUrl: string | null = null;

    try {
      const floor = await renderFloor(
        photo,
        outline,
        { projection: camera.floorProjection(1.2) },
        controller.signal,
      );
      if (controller.signal.aborted) return;

      floorUrl = URL.createObjectURL(floor);
      const arrangement = await renderRoomSnapshot({ ...photo, url: floorUrl }, faces, {
        markScale: false,
      });
      if (controller.signal.aborted) return;

      result.current = URL.createObjectURL(arrangement);
      setSplit(50);
      setComparisonUrl(result.current);
    } catch (error) {
      if (!controller.signal.aborted) {
        setRenderError(
          error instanceof Error ? error.message : "The arrangement could not be rendered.",
        );
      }
    } finally {
      if (floorUrl) URL.revokeObjectURL(floorUrl);
      if (request.current === controller) {
        request.current = null;
        setRendering(false);
      }
    }
  }

  if (!active) return null;

  return (
    <>
      <div className="studio-heading">
        <h1 ref={heading} tabIndex={-1}>
          Calibrate and arrange
        </h1>
      </div>
      <div className="studio-layout">
        <section className="canvas" aria-label="Calibrated photo">
          <div className="canvas-header">
            <div className="photo-details">
              <strong title={photo.name}>{photo.name}</strong>
              <span>
                {photo.width} × {photo.height} px
              </span>
              {saveStatus}
            </div>
          </div>
          <PhotoViewport
            photo={photo}
            outline={outline}
            onEdit={() => {}}
            onGeometryMove={() => {}}
            tool="points"
            zoom={1}
            comparison={comparison}
            annotations={
              comparison
                ? undefined
                : {
                    lines: [...fittedLines, ...lines],
                    start,
                    onPoint: placingBed || rendering ? undefined : markPoint,
                  }
            }
            bedPreview={
              camera && placingBed && !comparison
                ? {
                    faces,
                    guides: projectFloorGuides(camera, room),
                    anchor: camera.project({ ...center, y: 0 }),
                    helpId: "calibration-bed-help",
                    onPlace: rendering ? () => {} : placeBed,
                  }
                : undefined
            }
          />
          {comparison && (
            <div className="comparison-control">
              <span>All arranged</span>
              <input
                type="range"
                aria-label="Before and after"
                aria-valuetext={`${split}% original, ${100 - split}% arranged`}
                min={0}
                max={100}
                value={split}
                onChange={(event) => setSplit(event.currentTarget.valueAsNumber)}
              />
              <span>All original</span>
            </div>
          )}
        </section>

        <aside className="editor-panel" aria-label="Calibration tools">
          {comparison ? (
            <>
              <h2>Compare the arrangement</h2>
              <p lang="pl">Skala orientacyjna</p>
              <a
                className="primary-button download-button"
                href={comparison.url}
                download={`${photo.name.replace(/\.[^.]+$/, "") || "room"}-arranged.png`}
              >
                Download arranged PNG
              </a>
              <button type="button" className="secondary-button" onClick={returnToCalibration}>
                Back to calibration
              </button>
            </>
          ) : (
            <>
              <h2>Match the room</h2>
              <p id="calibration-help">
                Click two visible points along each of five seams. Include both a horizontal and a
                vertical on the far wall and at least one side-wall floor seam. Keep distinct
                segments for checks.
              </p>
              <fieldset className="calibration-fields" disabled={rendering}>
                <legend lang="pl">Skala orientacyjna</legend>
                {(Object.keys(dimensionFields) as (keyof Dimensions)[]).map((dimension) => (
                  <label key={dimension}>
                    {dimensionFields[dimension]} (m)
                    <input
                      type="number"
                      min={roomSizeLimits.min}
                      max={roomSizeLimits.max}
                      step={0.01}
                      value={dimensions[dimension] || ""}
                      onChange={(event) => {
                        setDimensions({
                          ...dimensions,
                          [dimension]: Number(event.currentTarget.value),
                        });
                        clearFit();
                      }}
                    />
                  </label>
                ))}
              </fieldset>
              <fieldset className="calibration-fields" disabled={rendering || placingBed}>
                <legend>Edge marks</legend>
                <label>
                  Room edge
                  <select
                    value={edge}
                    onChange={(event) => {
                      setEdge(event.currentTarget.value as EdgeId);
                      setStart(null);
                    }}
                  >
                    {edgeIds.map((id) => (
                      <option key={id} value={id}>
                        {roomEdgeLabels[id]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Use mark to
                  <select
                    value={purpose}
                    onChange={(event) => {
                      setPurpose(event.currentTarget.value as MarkPurpose);
                      setStart(null);
                    }}
                  >
                    <option value="fit">Fit camera</option>
                    <option value="check">Check only</option>
                  </select>
                </label>
                <output>
                  {start
                    ? "Choose the second endpoint."
                    : `${marks.length - checks.length} fit marks, ${checks.length} check marks`}
                </output>
                <button
                  type="button"
                  className="text-button"
                  disabled={
                    !start && !marks.some((mark) => mark.edge === edge && mark.purpose === purpose)
                  }
                  onClick={() => {
                    if (start) {
                      setStart(null);
                      return;
                    }
                    setMarks(
                      marks.filter((mark) => mark.edge !== edge || mark.purpose !== purpose),
                    );
                    if (purpose === "fit") clearFit();
                  }}
                >
                  Clear selected mark
                </button>
              </fieldset>
              <button
                type="button"
                className="secondary-button"
                disabled={!validRoom || fitMarks.length < 5 || rendering}
                onClick={applyFit}
              >
                Fit camera from edges
              </button>
              {fitAttempted && !fit && (
                <output>Add longer, distinct edges in all three room directions.</output>
              )}
              {fit && (
                <>
                  <output>Fit RMS: {fit.rmsPixels.toFixed(1)} px</output>
                  <ul className="calibration-checks" aria-label="Independent edge checks">
                    {checks.map((mark) => {
                      if (!hasEdgeLength(photo, mark)) {
                        return (
                          <li key={mark.edge}>
                            {roomEdgeLabels[mark.edge]}: choose a longer check segment.
                          </li>
                        );
                      }

                      if (fitMarks.some((fitMark) => overlapsEdgeSpan(mark, fitMark))) {
                        return (
                          <li key={mark.edge}>
                            {roomEdgeLabels[mark.edge]}: choose a segment outside the fitted span.
                          </li>
                        );
                      }

                      const measurement = camera && measureEdge(camera, room, mark);
                      return (
                        <li key={mark.edge}>
                          {roomEdgeLabels[mark.edge]}:{" "}
                          {measurement
                            ? `${measurement.rmsPixels.toFixed(1)} px RMS, ${measurement.maxPixels.toFixed(1)} px max`
                            : "outside the camera"}
                        </li>
                      );
                    })}
                    {!checks.length && <li>Mark a separate segment to check the fit.</li>}
                  </ul>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!canFitBed || rendering}
                    onClick={() => {
                      setPlacingBed(!placingBed);
                      setStart(null);
                    }}
                  >
                    {placingBed ? "Mark edges" : "Place the bed"}
                  </button>
                  {placingBed && (
                    <p id="calibration-bed-help">
                      Click the floor to position the bed. On the focused photo, press Enter to
                      place it or use the arrow keys to move it.
                    </p>
                  )}
                  {!canFitBed && <p>The bed needs a floor area at least 1.6 × 2 m.</p>}
                  {canFitBed && !faces.length && (
                    <p>Place the bed where it is visible in the photo.</p>
                  )}
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!faces.length || rendering}
                    onClick={() => void renderArrangement()}
                  >
                    {rendering ? "Rendering…" : "Render floor and bed"}
                  </button>
                </>
              )}
              {renderError && (
                <p role="alert" className="field-error">
                  {renderError}
                </p>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  request.current?.abort();
                  onBack();
                }}
              >
                Back to floor outline
              </button>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
