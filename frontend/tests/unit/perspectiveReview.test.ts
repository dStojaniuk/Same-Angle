import { expect, test } from "@playwright/test";

import { assessPerspective, type EdgePair, type EdgeTrace } from "../../src/edgeMeasurements";

const across: EdgeTrace = {
  edge: [
    { x: 10, y: 40 },
    { x: 100, y: 40 },
  ],
  checkpoint: { x: 55, y: 40 },
};
const horizontal: EdgePair = {
  original: across,
  edited: { edge: [across.edge[1], across.edge[0]], checkpoint: across.checkpoint },
};
const up: EdgeTrace = {
  edge: [
    { x: 20, y: 10 },
    { x: 20, y: 60 },
  ],
  checkpoint: { x: 20, y: 35 },
};
const vertical: EdgePair = { original: up, edited: up };

test("needs two independent edges for a matched review", () => {
  expect(assessPerspective([horizontal], 1).status).toBe("uncertain");
  expect(assessPerspective([horizontal, horizontal], 1).status).toBe("uncertain");
  expect(assessPerspective([horizontal, vertical], 1).status).toBe("matched");
});

test("flags a bent continuation even when the shared endpoint stays in place", () => {
  const bent: EdgePair = {
    original: horizontal.original,
    edited: {
      edge: [
        { x: 10, y: 40 },
        { x: 100, y: 51 },
      ],
      checkpoint: { x: 55, y: 46 },
    },
  };
  const review = assessPerspective([bent], 1);
  expect(review.status).toBe("mismatch");
  expect(review.edges[0].angleDegrees).toBeGreaterThan(6);
  expect(review.edges[0].offsetPixels).toBe(11);
});

test("flags a kink between two fixed endpoints", () => {
  const bent: EdgePair = {
    ...horizontal,
    edited: { ...horizontal.edited, checkpoint: { x: 55, y: 46 } },
  };
  expect(assessPerspective([bent], 1).status).toBe("mismatch");
});

test("flags a parallel shift at the fitted display scale", () => {
  const shifted: EdgePair = {
    original: horizontal.original,
    edited: {
      edge: [
        { x: 10, y: 45 },
        { x: 100, y: 45 },
      ],
      checkpoint: { x: 55, y: 45 },
    },
  };
  const review = assessPerspective([shifted, vertical], 0.5);
  expect(review.status).toBe("mismatch");
  expect(review.edges[0].angleDegrees).toBe(0);
  expect(review.edges[0].offsetPixels).toBe(2.5);
  expect(assessPerspective([shifted, vertical], 0.2).status).toBe("matched");
});
