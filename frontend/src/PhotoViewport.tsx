import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

import { BedProjection } from "./BedPreview";
import {
  MAX_OUTLINE_POINTS,
  clientToPhoto,
  limitToPhoto,
  movePoint,
  translateOutline,
  type Point,
} from "./outline";
import { floorGridLines } from "./perspective";
import type { RoomPhoto } from "./photo";

type PhotoViewportProps = {
  photo: RoomPhoto;
  outline: Point[];
  onEdit: (points: Point[]) => void;
  bedPreview?: {
    faces: Point[][];
    guides: [Point, Point][];
    anchor: Point | null;
    onPlace: (point?: Point) => void;
  };
  tool: "points" | "pan" | "outline";
  onGeometryMove: (moving: boolean) => void;
  zoom: number;
  comparison: { url: string; split: number } | null;
  grid?: { corners: Point[]; locked: boolean };
};

const arrowSteps = new Map([
  ["ArrowLeft", { x: -1, y: 0 }],
  ["ArrowRight", { x: 1, y: 0 }],
  ["ArrowUp", { x: 0, y: -1 }],
  ["ArrowDown", { x: 0, y: 1 }],
]);

type Drag = {
  pointerId: number;
  base: Point[];
  tool: "points" | "outline";
  move: (point: Point) => Point[];
};

export function PhotoViewport({
  photo,
  outline,
  onEdit,
  tool,
  onGeometryMove,
  zoom,
  comparison,
  grid,
  bedPreview,
}: PhotoViewportProps) {
  const [preview, setPreview] = useState<{ points: Point[]; base: Point[] } | null>(null);
  const [bedCursor, setBedCursor] = useState<Point | null>(null);

  const frame = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const addPoint = useRef<HTMLButtonElement>(null);
  const pan = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(
    null,
  );
  const drag = useRef<Drag | null>(null);

  const editing = comparison === null && !bedPreview;
  const panning = tool === "pan";
  const movingOutline = tool === "outline";

  const editPoints = grid?.corners ?? outline;
  const locked = grid?.locked ?? false;
  const visiblePoints = preview?.base === editPoints ? preview.points : editPoints;
  const mask = grid ? outline : visiblePoints;
  const points = mask.map(({ x, y }) => `${x},${y}`).join(" ");
  const sizing = { "--image-ratio": photo.width / photo.height, "--zoom": zoom } as CSSProperties;

  useEffect(() => {
    const current = drag.current;

    if (current && (!editing || locked || current.tool !== tool || current.base !== editPoints)) {
      drag.current = null;
      onGeometryMove(false);
      setPreview(null);
    }

    if (!panning) pan.current = null;
  }, [editing, locked, panning, tool, editPoints, onGeometryMove]);

  function photoPosition(event: { clientX: number; clientY: number }) {
    const rect = frame.current!.getBoundingClientRect();

    return clientToPhoto({ x: event.clientX, y: event.clientY }, rect, photo);
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, index?: number) {
    if (!event.isPrimary || event.button !== 0 || drag.current || tool === "pan") return;

    const origin = photoPosition(event);
    const point = index === undefined ? undefined : editPoints[index];

    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      base: editPoints,
      tool,
      move: (target) => {
        const offset = { x: target.x - origin.x, y: target.y - origin.y };
        if (index === undefined || !point) return translateOutline(editPoints, offset, photo);

        const next = limitToPhoto({ x: point.x + offset.x, y: point.y + offset.y }, photo);
        return movePoint(editPoints, index, next);
      },
    };

    onGeometryMove(true);
  }

  function previewDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;

    setPreview({ points: current.move(photoPosition(event)), base: current.base });
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;

    drag.current = null;
    onGeometryMove(false);
    setPreview(null);

    if (!cancelled && current.base === editPoints) onEdit(current.move(photoPosition(event)));
  }

  function startPan(event: PointerEvent<HTMLButtonElement>) {
    const scroll = viewport.current;
    if (!scroll || !event.isPrimary || event.button !== 0 || pan.current) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    pan.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: scroll.scrollLeft,
      top: scroll.scrollTop,
    };
  }

  function movePan(event: PointerEvent<HTMLButtonElement>) {
    const origin = pan.current;
    if (origin?.pointerId !== event.pointerId || !viewport.current) return;

    viewport.current.scrollLeft = origin.left + origin.x - event.clientX;
    viewport.current.scrollTop = origin.top + origin.y - event.clientY;
  }

  function endPan(event: PointerEvent<HTMLButtonElement>) {
    if (pan.current?.pointerId === event.pointerId) pan.current = null;
  }

  return (
    <div className="photo-scroll" style={sizing} ref={viewport}>
      <div className="photo-positioner">
        <div className="photo-frame" ref={frame}>
          <img
            className="photo-layer"
            src={photo.url}
            alt={photo.name}
            draggable={false}
            style={comparison ? { clipPath: `inset(0 ${100 - comparison.split}% 0 0)` } : undefined}
          />
          {editing && (
            <>
              {!grid && tool === "points" && (
                <button
                  type="button"
                  className="place-point"
                  ref={addPoint}
                  aria-label="Add floor point"
                  disabled={outline.length >= MAX_OUTLINE_POINTS}
                  aria-describedby="outline-help"
                  onClick={(event) => {
                    const point = event.detail
                      ? photoPosition(event)
                      : { x: photo.width / 2, y: photo.height / 2 };
                    onEdit([...outline, limitToPhoto(point, photo)]);
                  }}
                />
              )}
              <svg
                className="outline-overlay"
                aria-hidden="true"
                viewBox={`0 0 ${photo.width} ${photo.height}`}
              >
                {mask.length > 2 ? (
                  <polygon points={points} vectorEffect="non-scaling-stroke" />
                ) : (
                  <polyline points={points} vectorEffect="non-scaling-stroke" />
                )}
                {grid && (
                  <g className="grid-lines">
                    {floorGridLines(visiblePoints).map(([start, end], index) => (
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
                )}
              </svg>
              {tool === "points" &&
                visiblePoints.map(({ x, y }, index) => (
                  <button
                    type="button"
                    className={grid ? "floor-point grid-corner" : "floor-point"}
                    disabled={locked}
                    key={index}
                    aria-label={`${grid ? "Grid corner" : "Floor point"} ${index + 1}`}
                    aria-describedby={grid ? "grid-help" : "outline-help"}
                    style={{
                      left: `${(x / photo.width) * 100}%`,
                      top: `${(y / photo.height) * 100}%`,
                    }}
                    onPointerDown={(event) => startDrag(event, index)}
                    onPointerMove={previewDrag}
                    onPointerUp={finishDrag}
                    onPointerCancel={(event) => finishDrag(event, true)}
                    onLostPointerCapture={(event) => finishDrag(event, true)}
                    onKeyDown={(event) => {
                      if (
                        !grid &&
                        !drag.current &&
                        (event.key === "Delete" || event.key === "Backspace")
                      ) {
                        event.preventDefault();
                        onEdit(outline.filter((_, pointIndex) => pointIndex !== index));
                        if (index === outline.length - 1) {
                          requestAnimationFrame(() =>
                            addPoint.current?.focus({ preventScroll: true }),
                          );
                        }
                        return;
                      }

                      const step = arrowSteps.get(event.key);
                      if (!step || drag.current) return;

                      event.preventDefault();
                      const amount = event.shiftKey ? 10 : 1;
                      const point = limitToPhoto(
                        { x: x + step.x * amount, y: y + step.y * amount },
                        photo,
                      );
                      const next = movePoint(editPoints, index, point);
                      if (next === editPoints) return;

                      onEdit(next);
                      const handle = event.currentTarget;
                      requestAnimationFrame(() => {
                        if (document.activeElement === handle) {
                          handle.scrollIntoView({ block: "nearest", inline: "nearest" });
                        }
                      });
                    }}
                  />
                ))}
            </>
          )}
          {bedPreview && (
            <>
              <BedProjection photo={photo} faces={bedPreview.faces} guides={bedPreview.guides} />
              {bedCursor && (
                <span
                  className="bed-placement-cursor"
                  aria-hidden="true"
                  style={{
                    left: `${(bedCursor.x / photo.width) * 100}%`,
                    top: `${(bedCursor.y / photo.height) * 100}%`,
                  }}
                />
              )}
              {!panning && (
                <button
                  type="button"
                  className="place-point"
                  aria-label="Place bed on the photo"
                  aria-describedby="bed-help"
                  onBlur={() => setBedCursor(null)}
                  onClick={(event) => {
                    if (event.detail) {
                      setBedCursor(null);
                      bedPreview.onPlace(photoPosition(event));
                    } else {
                      bedPreview.onPlace(bedCursor ?? undefined);
                    }
                  }}
                  onKeyDown={(event) => {
                    const step = arrowSteps.get(event.key);
                    if (!step) return;

                    event.preventDefault();
                    const amount = event.shiftKey
                      ? Math.max(1, Math.round(Math.min(photo.width, photo.height) * 0.015))
                      : 1;
                    const origin = bedCursor ??
                      bedPreview.anchor ?? {
                        x: photo.width / 2,
                        y: photo.height * 0.8,
                      };
                    const point = limitToPhoto(
                      { x: origin.x + step.x * amount, y: origin.y + step.y * amount },
                      photo,
                    );

                    setBedCursor(point);
                    bedPreview.onPlace(point);
                  }}
                />
              )}
            </>
          )}
          {comparison && (
            <>
              <img
                className="photo-layer"
                src={comparison.url}
                alt=""
                draggable={false}
                style={{ clipPath: `inset(0 0 0 ${comparison.split}%)` }}
              />
              {comparison.split > 0 && comparison.split < 100 && (
                <div
                  className="comparison-divider"
                  aria-hidden="true"
                  style={{ left: `${comparison.split}%` }}
                />
              )}
            </>
          )}
          {movingOutline && editing && (
            <button
              type="button"
              className="pan-surface"
              aria-label="Move the entire outline"
              onPointerDown={(event) => startDrag(event)}
              onPointerMove={previewDrag}
              onPointerUp={finishDrag}
              onPointerCancel={(event) => finishDrag(event, true)}
              onLostPointerCapture={(event) => finishDrag(event, true)}
              onKeyDown={(event) => {
                const step = arrowSteps.get(event.key);
                if (!step || drag.current) return;
                event.preventDefault();
                const units = event.shiftKey ? 10 : 1;
                onEdit(translateOutline(outline, { x: step.x * units, y: step.y * units }, photo));
              }}
            />
          )}
          {panning && (
            <button
              type="button"
              className="pan-surface"
              aria-label="Move the photo view"
              onPointerDown={startPan}
              onPointerMove={movePan}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onLostPointerCapture={endPan}
              onKeyDown={(event) => {
                const step = arrowSteps.get(event.key);
                const scroll = viewport.current;
                if (!step || !scroll) return;
                event.preventDefault();
                scroll.scrollBy(step.x * 32, step.y * 32);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
