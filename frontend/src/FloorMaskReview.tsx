import { useEffect, useRef, useState } from "react";

import { suggestFloorProtection, type FloorProtection } from "./floorRender";
import type { Point } from "./outline";
import type { RoomPhoto } from "./photo";
import { PhotoViewport } from "./PhotoViewport";

const maxRegions = 8;
const maxRegionPoints = 16;
const ignoreGeometryMove = () => {};

type Props = {
  photo: RoomPhoto;
  outline: Point[];
  protection?: FloorProtection;
  error?: string;
  onSave: (protection: FloorProtection) => void;
  onBack: () => void;
};

export function FloorMaskReview({ photo, outline, protection, error, onSave, onBack }: Props) {
  const [regions, setRegions] = useState<Point[][]>(protection?.regions ?? []);
  const [draft, setDraft] = useState<Point[]>([]);
  const [hint, setHint] = useState<Blob | null>(protection?.depthMask ?? null);
  const [useHint, setUseHint] = useState(Boolean(protection?.depthMask));
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [zoom, setZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
    return () => request.current?.abort();
  }, []);

  async function checkDepth() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    setMessage("");
    try {
      const image = await suggestFloorProtection(photo, outline, controller.signal);
      if (controller.signal.aborted) return;
      setHint(image);
      setUseHint(false);
      if (!image) setMessage("Depth produced no reliable protection suggestion for this outline.");
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(error instanceof Error ? error.message : "The depth check failed.");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setChecking(false);
    }
  }

  return (
    <div className="studio-layout">
      <section className="canvas" aria-label="Floor mask preview">
        <div className="canvas-header">
          <div className="canvas-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={zoom === 1}
              onClick={() => {
                if (zoom === 2) setPanning(false);
                setZoom(zoom / 2);
              }}
            >
              Zoom mask out
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={zoom === 4}
              onClick={() => setZoom(zoom * 2)}
            >
              Zoom mask in
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={zoom === 1}
              aria-pressed={panning}
              onClick={() => setPanning(!panning)}
            >
              Pan mask
            </button>
          </div>
        </div>
        <PhotoViewport
          photo={photo}
          outline={draft}
          onEdit={setDraft}
          onGeometryMove={ignoreGeometryMove}
          tool={panning ? "pan" : "points"}
          zoom={zoom}
          comparison={null}
          depthOverlay={hint ?? undefined}
          maxOutlinePoints={maxRegionPoints}
          styleRegions={[
            { points: outline, kind: "editable" },
            ...regions.map((points) => ({ points, kind: "protected" as const })),
          ]}
        />
      </section>
      <section className="editor-panel" aria-label="Floor mask review controls">
        <h2 tabIndex={-1} ref={heading}>
          Review floor mask
        </h2>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <p id="style-mask-help">
          Mark a protected area around a threshold, trim or furniture. Orange shows areas that depth
          suggests protecting.
        </p>
        <div className="style-field">
          <button
            type="button"
            className="secondary-button"
            disabled={checking || !!hint}
            onClick={() => void checkDepth()}
          >
            {checking ? "Checking depth…" : "Suggest protection with depth"}
          </button>
          {message && <output>{message}</output>}
          {hint && (
            <label>
              <input
                type="checkbox"
                checked={useHint}
                onChange={(event) => setUseHint(event.currentTarget.checked)}
              />
              Protect the suggested areas
            </label>
          )}
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={draft.length < 3 || regions.length >= maxRegions}
            onClick={() => {
              setRegions([...regions, draft]);
              setDraft([]);
            }}
          >
            Add protected area
          </button>
          <button
            type="button"
            className="text-button"
            disabled={!draft.length}
            onClick={() => setDraft([])}
          >
            Clear points
          </button>
          <button
            type="button"
            className="text-button"
            disabled={!regions.length}
            onClick={() => setRegions(regions.slice(0, -1))}
          >
            Remove last area
          </button>
        </div>
        {regions.length > 0 && <output>{regions.length} marked areas</output>}
        <div className="editor-actions">
          <button
            type="button"
            className="primary-button"
            disabled={checking || draft.length > 0}
            onClick={() => onSave({ regions, depthMask: useHint ? hint : null })}
          >
            Use mask
          </button>
          <button type="button" className="secondary-button" onClick={onBack}>
            Cancel mask review
          </button>
        </div>
      </section>
    </div>
  );
}
