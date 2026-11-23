import { expect, test } from "@playwright/test";

import { fitRoomCamera, measureEdge, overlapsEdgeSpan, type EdgeMark } from "../../src/calibration";
import { createCameraProjection } from "../../src/camera";

const photo = { width: 1000, height: 800 };
const room = { x: -1.6, z: 0, width: 3.2, length: 5, height: 2.6 };
const marks: EdgeMark[] = [
  {
    edge: "farFloor",
    points: [
      { x: 468, y: 482 },
      { x: 900, y: 525 },
    ],
  },
  {
    edge: "farCeiling",
    points: [
      { x: 477, y: 148 },
      { x: 959, y: 141 },
    ],
  },
  {
    edge: "farLeft",
    points: [
      { x: 468, y: 482 },
      { x: 477, y: 148 },
    ],
  },
  {
    edge: "farRight",
    points: [
      { x: 900, y: 525 },
      { x: 959, y: 141 },
    ],
  },
  {
    edge: "leftFloor",
    points: [
      { x: 418, y: 537 },
      { x: 468, y: 482 },
    ],
  },
];
const heldOut: EdgeMark = {
  edge: "rightFloor",
  points: [
    { x: 993, y: 606 },
    { x: 915, y: 538 },
  ],
};

test("fits marked architectural edges and projects an unused edge within two pixels", () => {
  const fit = fitRoomCamera(photo, room, marks);
  expect(fit?.rmsPixels).toBeLessThan(1);
  expect(
    measureEdge(createCameraProjection(photo, fit!.camera), room, heldOut)?.rmsPixels,
  ).toBeLessThan(2);
});

test("fits a wide-angle room without stopping at the field-of-view limit", () => {
  const wideRoom = { x: -2.34, z: 0, width: 4.68, length: 7.66, height: 2.74 };
  const observations = [
    ["farFloor", 472, 291, 670, 313],
    ["farCeiling", 476, 158, 711, 171],
    ["farRight", 670, 313, 711, 171],
    ["leftFloor", 472, 291, 132, 527],
    ["rightFloor", 670, 313, 1000, 662],
  ] as const;
  const wideMarks: EdgeMark[] = observations.map(([edge, x1, y1, x2, y2]) => ({
    edge,
    points: [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ],
  }));

  const fit = fitRoomCamera(photo, wideRoom, wideMarks);

  expect(fit?.rmsPixels).toBeLessThan(0.5);
  expect(fit?.camera.fieldOfView).toBeLessThan(112);
});

test("rejects a wall-only fit that has no depth-direction observation", () => {
  expect(fitRoomCamera(photo, room, marks.slice(0, 4))).toBeNull();
});

test("needs a fifth edge when four exact observations admit a wrong camera", () => {
  const ambiguous: EdgeMark[] = [
    {
      edge: "farFloor",
      points: [
        { x: 543, y: 453 },
        { x: 916, y: 532 },
      ],
    },
    {
      edge: "farLeft",
      points: [
        { x: 543, y: 453 },
        { x: 555, y: 197 },
      ],
    },
    {
      edge: "farRight",
      points: [
        { x: 916, y: 532 },
        { x: 982, y: 158 },
      ],
    },
    {
      edge: "leftFloor",
      points: [
        { x: 543, y: 453 },
        { x: 10, y: 659 },
      ],
    },
  ];
  expect(fitRoomCamera(photo, room, ambiguous)).toBeNull();

  const fit = fitRoomCamera(photo, room, [
    ...ambiguous,
    {
      edge: "rightFloor",
      points: [
        { x: 916, y: 532 },
        { x: 945, y: 790 },
      ],
    },
  ]);
  expect(fit?.rmsPixels).toBeLessThan(1);
  expect(
    measureEdge(createCameraProjection(photo, fit!.camera), room, {
      edge: "farCeiling",
      points: [
        { x: 555, y: 197 },
        { x: 982, y: 158 },
      ],
    })?.rmsPixels,
  ).toBeLessThan(2);
});

test("disallows using the fitted span as independent evidence", () => {
  const mark = marks[0];
  expect(overlapsEdgeSpan(mark, mark)).toBe(true);
  expect(overlapsEdgeSpan({ edge: "farCeiling", points: mark.points }, mark)).toBe(true);
  expect(overlapsEdgeSpan(heldOut, mark)).toBe(false);
  expect(
    overlapsEdgeSpan(
      {
        edge: mark.edge,
        points: [
          { x: 930, y: 529 },
          { x: 980, y: 535 },
        ],
      },
      mark,
    ),
  ).toBe(false);
});

test("checks distance to the finite edge rather than its extension", () => {
  const fit = fitRoomCamera(photo, room, marks)!;
  const guideExtension: EdgeMark = {
    edge: "farFloor",
    points: [
      { x: 17, y: 437 },
      { x: 318, y: 467 },
    ],
  };

  const measurement = measureEdge(createCameraProjection(photo, fit.camera), room, guideExtension);

  expect(measurement?.rmsPixels).toBeGreaterThan(300);
  expect(measurement?.maxPixels).toBeGreaterThan(400);
});

test("the floor texture matrix and furniture projection share the same world coordinates", () => {
  const fit = fitRoomCamera(photo, room, marks)!;
  const camera = createCameraProjection(photo, fit.camera);
  const position = { x: -0.75, y: 0, z: 3.25 };
  const { x, y } = camera.project(position)!;
  const [a, b, c, d, e, f, g, h, k] = camera.floorProjection(1.2);
  const divisor = g * x + h * y + k;
  expect((a * x + b * y + c) / divisor).toBeCloseTo(position.x / 1.2, 8);
  expect((d * x + e * y + f) / divisor).toBeCloseTo(position.z / 1.2, 8);
});
