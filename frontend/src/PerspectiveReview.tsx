import { useCallback, useId, useRef, useState } from "react";

import {
  angleTolerance,
  assessPerspective,
  offsetTolerance,
  type EdgePair,
  type EdgeTrace,
  usableTrace,
} from "./edgeMeasurements";
import type { Point } from "./outline";

type Review = {
  url: string;
  pairs: EdgePair[];
  scale: number;
  marking: boolean;
  points: Point[];
  original: EdgeTrace | null;
  error?: string;
};

export function usePerspectiveReview(
  url: string | null,
  split: number,
  onStartMarking: () => void,
) {
  const [stored, setReview] = useState<Review | null>(null);
  const restoreFocus = useRef(false);
  const helpId = useId();
  const review = stored?.url === url ? stored : null;
  const marking = review?.marking ?? false;
  const status = review && assessPerspective(review.pairs, review.scale);
  const sketch = status?.status === "mismatch";

  const focusPhoto = useCallback((button: HTMLButtonElement | null) => {
    button?.focus();
  }, []);
  const focusMarkButton = useCallback((button: HTMLButtonElement | null) => {
    if (button && restoreFocus.current) {
      restoreFocus.current = false;
      button.focus();
    }
  }, []);

  function startEdge() {
    if (!url) return;
    onStartMarking();
    restoreFocus.current = true;
    setReview({
      url,
      pairs: review?.pairs ?? [],
      scale: review?.scale ?? 1,
      marking: true,
      points: [],
      original: null,
    });
  }

  function markPoint(point: Point, scale: number) {
    if (!review) return;
    const [start, checkpoint] = review.points;
    if (!start || !checkpoint) {
      setReview({ ...review, points: [...review.points, point], error: undefined });
      return;
    }

    const trace: EdgeTrace = { edge: [start, point], checkpoint };
    const reviewScale = review.original || review.pairs.length ? review.scale : scale;
    if (!usableTrace(trace, reviewScale)) {
      setReview({
        ...review,
        points: [],
        error:
          "Choose two endpoints with a checkpoint between them. Leave at least 4 pixels on each side at fit-to-window scale.",
      });
      return;
    }
    if (!review.original) {
      setReview({ ...review, original: trace, points: [], scale: reviewScale, error: undefined });
      return;
    }
    setReview({
      ...review,
      marking: false,
      points: [],
      original: null,
      scale: reviewScale,
      pairs: [...review.pairs, { original: review.original, edited: trace }],
      error: undefined,
    });
  }

  const controls = url && (
    <fieldset className="style-field">
      <legend>Check perspective</legend>
      <p id={helpId}>
        {marking
          ? `On the ${review?.original ? "edit, mark the same points" : "original, mark the edge"} from one end to the other. Place the middle point near the mask boundary if it crosses the edge. ${review?.points.length ?? 0} of 3 points marked.`
          : "Compare fixed edges in two directions, such as a door frame and a baseboard."}
      </p>
      {review?.error && marking && <p role="alert">{review.error}</p>}
      {status && review && review.pairs.length > 0 && (
        <>
          <output>
            {sketch
              ? "Sketch. A marked edge shifted."
              : status.status === "matched"
                ? "Marked points and angles are within tolerance."
                : "Mark an edge in a second direction to complete the check."}
          </output>
          <ul>
            {status.edges.map(({ offsetPixels, angleDegrees, moved }, index) => (
              <li key={index}>
                Edge {index + 1} · {offsetPixels.toFixed(1)} px · {angleDegrees.toFixed(1)}°
                {moved ? " · shifted" : ""}
              </li>
            ))}
          </ul>
          <p>
            Trial tolerance {offsetTolerance} px at fit-to-window scale or {angleTolerance}°.
          </p>
        </>
      )}
      <div className="editor-actions">
        {marking ? (
          <button
            type="button"
            className="secondary-button"
            key="cancel"
            onClick={() => review && setReview({ ...review, marking: false, error: undefined })}
          >
            Cancel marking
          </button>
        ) : (
          <button
            type="button"
            className="secondary-button"
            key="mark"
            ref={focusMarkButton}
            onClick={startEdge}
          >
            Mark an edge
          </button>
        )}
        {review && !marking && review.pairs.length > 0 && (
          <button type="button" className="text-button" onClick={() => setReview(null)}>
            Clear edge checks
          </button>
        )}
      </div>
    </fieldset>
  );

  return {
    controls,
    sketch,
    marking,
    split: marking ? (review?.original ? 0 : 100) : split,
    annotations: marking
      ? {
          lines: [],
          start: review?.points.at(-1) ?? null,
          onPoint: markPoint,
          focusTarget: focusPhoto,
          helpId,
        }
      : undefined,
  };
}
