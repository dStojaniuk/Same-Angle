import { useRef } from "react";

import { bedPaint, type BedSize, type ProjectedBedFace } from "./bed";
import { cameraRange, type CameraSettings } from "./camera";
import type { PhotoSize, Point } from "./outline";

const cameraControls = [
  { key: "fieldOfView", label: "Horizontal field of view", unit: "°" },
  { key: "yaw", label: "Turn", unit: "°" },
  { key: "tilt", label: "Tilt", unit: "°" },
  { key: "roll", label: "Roll", unit: "°" },
  { key: "heightMeters", label: "Camera height", unit: " m" },
  { key: "xMeters", label: "Camera X in room", unit: " m" },
  { key: "zMeters", label: "Camera Z in room", unit: " m" },
] as const;

type BedViewsProps = {
  view: "first" | "second" | "plan";
  hasSecondPhoto: boolean;
  photoError: string;
  openingSecondPhoto: boolean;
  onSelectView: (view: "first" | "second" | "plan") => void;
  onOpenSecondPhoto: (file: File) => void;
};

export function BedViews({
  view,
  hasSecondPhoto,
  photoError,
  openingSecondPhoto,
  onSelectView,
  onOpenSecondPhoto,
}: BedViewsProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="bed-view-controls">
      <fieldset className="bed-view-switch" aria-label="Room views">
        <button
          type="button"
          className="secondary-button"
          aria-pressed={view === "first"}
          onClick={() => onSelectView("first")}
        >
          First view
        </button>
        {hasSecondPhoto && (
          <button
            type="button"
            className="secondary-button"
            aria-pressed={view === "second"}
            onClick={() => onSelectView("second")}
          >
            Second view
          </button>
        )}
        <button
          type="button"
          className="secondary-button"
          aria-pressed={view === "plan"}
          onClick={() => onSelectView("plan")}
        >
          Floor plan
        </button>
      </fieldset>
      <input
        ref={fileInput}
        type="file"
        disabled={openingSecondPhoto}
        aria-label="Second room photo"
        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onOpenSecondPhoto(file);
        }}
      />
      <button
        type="button"
        className="secondary-button"
        disabled={openingSecondPhoto}
        onClick={() => fileInput.current?.click()}
      >
        {openingSecondPhoto
          ? "Opening photo…"
          : hasSecondPhoto
            ? "Replace second photo"
            : "Add second photo"}
      </button>
      {photoError && (
        <p className="field-error" role="alert">
          {photoError}
        </p>
      )}
    </div>
  );
}

type BedControlsProps = {
  size: BedSize;
  settings: CameraSettings;
  hasSecondPhoto: boolean;
  message: string;
  focusHeading: (heading: HTMLHeadingElement | null) => void;
  onAdjust: (key: keyof CameraSettings, value: number) => void;
  onRotate: () => void;
  onReset: () => void;
  onBack: () => void;
};

export function BedControls({
  size,
  settings,
  hasSecondPhoto,
  message,
  focusHeading,
  onAdjust,
  onRotate,
  onReset,
  onBack,
}: BedControlsProps) {
  return (
    <>
      <h2 tabIndex={-1} ref={focusHeading}>
        Fit the camera
      </h2>
      <p className="bed-scale">
        <strong lang="pl">Skala orientacyjna</strong>
        <span>
          {size.width} × {size.length} × {size.height} m
        </span>
      </p>
      <p id="bed-help">
        Align the guides with the floor.
        {hasSecondPhoto &&
          " Both cameras use the same grid. X moves across it and Z along it."}{" "}
        Click to place the bed. On the focused photo, press Enter to place it. Use arrows to move
        the placement point and hold Shift for larger steps.
      </p>
      <fieldset className="camera-controls" aria-label="Camera settings">
        {cameraControls.map(({ key, label, unit }) => {
          const { min, max, step } = cameraRange(key, hasSecondPhoto);
          return (
            <label key={key}>
              {label}
              <span aria-hidden="true">
                {settings[key]}
                {unit}
              </span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={settings[key]}
                aria-valuetext={`${settings[key]}${unit}`}
                onChange={(event) => onAdjust(key, event.currentTarget.valueAsNumber)}
              />
            </label>
          );
        })}
      </fieldset>
      <output className="bed-status field-error">{message}</output>
      <div className="bed-actions">
        <button type="button" className="secondary-button" onClick={onRotate}>
          Rotate bed 90°
        </button>
        <button type="button" className="text-button" onClick={onReset}>
          {hasSecondPhoto ? "Reset camera" : "Reset preview"}
        </button>
        <button type="button" className="secondary-button" onClick={onBack}>
          Back to outline
        </button>
      </div>
    </>
  );
}

type BedProjectionProps = {
  photo: PhotoSize;
  guides: [Point, Point][];
  faces: ProjectedBedFace[];
};

export function BedProjection({ photo, guides, faces }: BedProjectionProps) {
  return (
    <svg
      className="bed-overlay"
      viewBox={`0 0 ${photo.width} ${photo.height}`}
      role={faces.length ? "img" : undefined}
      aria-label={faces.length ? "Projected bed" : undefined}
      aria-hidden={!faces.length}
    >
      <g className="camera-guides" aria-hidden="true">
        {guides.map(([start, end], index) => (
          <line
            key={index}
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      <g className="bed-faces" stroke={bedPaint.outline}>
        {faces.map(({ kind, points }, index) => (
          <polygon
            key={index}
            fill={bedPaint[kind]}
            points={points.map(({ x, y }) => `${x},${y}`).join(" ")}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  );
}
