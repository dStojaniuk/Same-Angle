import { useId, useRef, useState } from "react";

import { bedBounds } from "./bed";
import type { CameraSettings, FloorPoint } from "./camera";
import {
  bedFitsRoom,
  bedHeightLimits,
  bedSizeLimits,
  positionLimits,
  roomOriginLimits,
  roomSizeLimits,
  type RoomLayout,
} from "./roomLayout";

type PlanProps = {
  layout: RoomLayout;
  cameras: CameraSettings[];
  onMove: (position: FloorPoint) => void;
  focusSurface: (surface: HTMLButtonElement | null) => void;
};

const roomFields = [
  { key: "width", label: "Room width (m)", limits: roomSizeLimits },
  { key: "length", label: "Room length (m)", limits: roomSizeLimits },
  { key: "x", label: "Room left edge X (m)", limits: roomOriginLimits },
  { key: "z", label: "Room near edge Z (m)", limits: roomOriginLimits },
] as const;

const bedFields = [
  { key: "width", label: "Bed width (m)", limits: bedSizeLimits },
  { key: "length", label: "Bed length (m)", limits: bedSizeLimits },
  { key: "height", label: "Bed height (m)", limits: bedHeightLimits },
] as const;

const centerFields = [
  { key: "x", label: "Bed center X (m)" },
  { key: "z", label: "Bed center Z (m)" },
] as const;

export function RoomPlan({ layout, cameras, onMove, focusSurface }: PlanProps) {
  const drawing = useRef<SVGSVGElement>(null);
  const gridId = useId();
  const { room, bed } = layout;
  const footprint = bedBounds(bed.center, bed.crosswise, bed.size);
  const padding = Math.max(room.width, room.length) * 0.09 + 0.2;
  const left = Math.min(room.x, footprint.x);
  const near = Math.min(room.z, footprint.z);
  const right = Math.max(room.x + room.width, footprint.x + footprint.width);
  const far = Math.max(room.z + room.length, footprint.z + footprint.length);
  const view = {
    x: left - padding,
    z: near - padding,
    width: right - left + padding * 2,
    length: far - near + padding * 2,
  };

  function move(x: number, z: number) {
    const round = (value: number) =>
      Math.max(positionLimits.min, Math.min(positionLimits.max, Math.round(value * 100) / 100));
    onMove({ x: round(x), z: round(z) });
  }

  return (
    <div className="room-plan">
      <svg
        ref={drawing}
        role="img"
        aria-label="Top-down room plan"
        viewBox={`${view.x} ${view.z} ${view.width} ${view.length}`}
      >
        <defs>
          <pattern id={gridId} width="1" height="1" patternUnits="userSpaceOnUse">
            <path className="plan-grid-line" d="M 1 0 H 0 V 1" />
          </pattern>
        </defs>
        <rect className="plan-room" x={room.x} y={room.z} width={room.width} height={room.length} />
        <rect
          x={room.x}
          y={room.z}
          width={room.width}
          height={room.length}
          fill={`url(#${gridId})`}
        />
        <rect
          className="plan-bed"
          data-outside={!bedFitsRoom(layout)}
          x={footprint.x}
          y={footprint.z}
          width={footprint.width}
          height={footprint.length}
        />
        {cameras.map((camera, index) => (
          <g
            key={index}
            transform={`translate(${camera.xMeters} ${camera.zMeters}) rotate(${-camera.yaw})`}
          >
            <path className="plan-camera" d="M -.12 -.09 H .12 L 0 .22 Z" />
          </g>
        ))}
      </svg>
      <button
        type="button"
        ref={focusSurface}
        className="place-point plan-surface"
        aria-label="Position bed on the plan"
        aria-describedby="plan-help"
        onClick={(event) => {
          if (!event.detail) return;
          const matrix = drawing.current?.getScreenCTM();
          if (!matrix) return;

          const pointer = new DOMPoint(event.clientX, event.clientY).matrixTransform(
            matrix.inverse(),
          );
          if (
            pointer.x < view.x ||
            pointer.x > view.x + view.width ||
            pointer.y < view.z ||
            pointer.y > view.z + view.length
          )
            return;

          move(pointer.x, pointer.y);
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.25 : 0.05;
          const { x, z } = bed.center;
          switch (event.key) {
            case "ArrowLeft":
              move(x - step, z);
              break;
            case "ArrowRight":
              move(x + step, z);
              break;
            case "ArrowUp":
              move(x, z - step);
              break;
            case "ArrowDown":
              move(x, z + step);
              break;
            default:
              return;
          }
          event.preventDefault();
        }}
      />
    </div>
  );
}

type NumberFieldProps = {
  label: string;
  value: number;
  limits: { min: number; max: number };
  onCommit: (value: number) => void;
};

function NumberField({ label, value, limits, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const { min, max } = limits;
  const errorId = useId();

  return (
    <label className="plan-field">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step="0.01"
        value={draft ?? Number(value.toFixed(2))}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setInvalid(false);
        }}
        onBlur={(event) => {
          if (draft === null) return;
          const proposed = event.currentTarget.valueAsNumber;
          setDraft(null);
          if (!Number.isFinite(proposed) || proposed < min || proposed > max) {
            setInvalid(true);
            return;
          }
          const rounded = Number(proposed.toFixed(2));
          if (rounded !== value) onCommit(rounded);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(null);
            setInvalid(false);
          }
        }}
      />
      {invalid && (
        <span id={errorId} className="field-error">
          Enter {min} to {max} m.
        </span>
      )}
    </label>
  );
}

type PlanControlsProps = {
  layout: RoomLayout;
  canUndo: boolean;
  canRedo: boolean;
  onChange: (update: (layout: RoomLayout) => RoomLayout) => void;
  onUndo: () => void;
  onRedo: () => void;
  onRotate: () => void;
  onBack: () => void;
};

export function PlanControls({
  layout,
  canUndo,
  canRedo,
  onChange,
  onUndo,
  onRedo,
  onRotate,
  onBack,
}: PlanControlsProps) {
  return (
    <>
      <h2>Arrange the room</h2>
      <p className="bed-scale">
        <strong lang="pl">Skala orientacyjna</strong>
      </p>
      <p id="plan-help">
        Click the plan to place the bed or use its arrow keys. Set dimensions in meters and press
        Enter to apply.
      </p>
      <fieldset className="plan-fields">
        <legend>Room</legend>
        {roomFields.map(({ key, label, limits }) => (
          <NumberField
            key={`${key}:${layout.room[key]}`}
            label={label}
            limits={limits}
            value={layout.room[key]}
            onCommit={(value) =>
              onChange((current) => ({ ...current, room: { ...current.room, [key]: value } }))
            }
          />
        ))}
      </fieldset>
      <fieldset className="plan-fields">
        <legend>Bed</legend>
        {bedFields.map(({ key, label, limits }) => (
          <NumberField
            key={`${key}:${layout.bed.size[key]}`}
            label={label}
            limits={limits}
            value={layout.bed.size[key]}
            onCommit={(value) =>
              onChange((current) => ({
                ...current,
                bed: { ...current.bed, size: { ...current.bed.size, [key]: value } },
              }))
            }
          />
        ))}
        {centerFields.map(({ key, label }) => (
          <NumberField
            key={`${key}:${layout.bed.center[key]}`}
            label={label}
            limits={positionLimits}
            value={layout.bed.center[key]}
            onCommit={(value) =>
              onChange((current) => ({
                ...current,
                bed: { ...current.bed, center: { ...current.bed.center, [key]: value } },
              }))
            }
          />
        ))}
      </fieldset>
      {!bedFitsRoom(layout) && (
        <output className="field-error">The bed crosses the room boundary.</output>
      )}
      <div className="bed-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo layout change"
        >
          Undo
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo layout change"
        >
          Redo
        </button>
        <button type="button" className="secondary-button" onClick={onRotate}>
          Rotate bed 90°
        </button>
        <button type="button" className="text-button" onClick={onBack}>
          Back to outline
        </button>
      </div>
    </>
  );
}
