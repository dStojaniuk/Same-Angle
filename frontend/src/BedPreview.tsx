import { bedSize } from "./bed";
import type { CameraSettings } from "./camera";
import type { PhotoSize, Point } from "./outline";

const cameraControls = [
  { key: "fieldOfView", label: "Horizontal field of view", min: 35, max: 110, step: 1, unit: "°" },
  { key: "yaw", label: "Turn", min: -45, max: 45, step: 1, unit: "°" },
  { key: "tilt", label: "Tilt", min: -45, max: 45, step: 1, unit: "°" },
  { key: "roll", label: "Roll", min: -20, max: 20, step: 1, unit: "°" },
  { key: "heightMeters", label: "Camera height", min: 0.8, max: 2.4, step: 0.05, unit: " m" },
] as const;

type BedControlsProps = {
  settings: CameraSettings;
  message: string;
  focusHeading: (heading: HTMLHeadingElement | null) => void;
  onAdjust: (key: keyof CameraSettings, value: number) => void;
  onRotate: () => void;
  onReset: () => void;
  onBack: () => void;
};

export function BedControls({
  settings,
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
          {bedSize.width} × {bedSize.length} × {bedSize.height} m
        </span>
      </p>
      <p id="bed-help">
        Align the guides with the floor. Click to place the bed. On the focused photo, press Enter
        to place it. Use arrows to move the placement point and hold Shift for larger steps.
      </p>
      <fieldset className="camera-controls" aria-label="Camera settings">
        {cameraControls.map(({ key, label, min, max, step, unit }) => (
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
        ))}
      </fieldset>
      <output className="bed-status field-error">{message}</output>
      <div className="bed-actions">
        <button type="button" className="secondary-button" onClick={onRotate}>
          Rotate bed 90°
        </button>
        <button type="button" className="text-button" onClick={onReset}>
          Reset preview
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
  faces: Point[][];
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
      <g className="bed-faces">
        {faces.map((face, index) => (
          <polygon
            key={index}
            points={face.map(({ x, y }) => `${x},${y}`).join(" ")}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  );
}
