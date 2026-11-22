import { bedBounds, bedSize, type Bed } from "./bed";
import type { FloorBounds } from "./camera";

export type RoomLayout = { room: FloorBounds; bed: Bed };

export const initialBed: Bed = { center: { x: 0, z: 3.8 }, crosswise: false, size: bedSize };

export const initialRoom: FloorBounds = { x: -1.6, z: 0, width: 3.2, length: 7.6 };

export const roomSizeLimits = { min: 0.5, max: 25 };
export const bedSizeLimits = { min: 0.5, max: 4 };
export const bedHeightLimits = { min: 0.1, max: 0.75 };
export const roomOriginLimits = { min: -25, max: 25 };
export const positionLimits = { min: -50, max: 50 };

export function bedFitsRoom({ room, bed }: RoomLayout): boolean {
  const bounds = bedBounds(bed.center, bed.crosswise, bed.size);
  const tolerance = 1e-8;

  return (
    bounds.x >= room.x - tolerance &&
    bounds.z >= room.z - tolerance &&
    bounds.x + bounds.width <= room.x + room.width + tolerance &&
    bounds.z + bounds.length <= room.z + room.length + tolerance
  );
}

type LayoutHistory = { layout: RoomLayout; past: RoomLayout[]; future: RoomLayout[] };
type LayoutAction =
  | { type: "change"; update: (layout: RoomLayout) => RoomLayout }
  | { type: "undo" }
  | { type: "redo" };

export function startLayout(): LayoutHistory {
  return { layout: { room: initialRoom, bed: initialBed }, past: [], future: [] };
}

function sameLayout(left: RoomLayout, right: RoomLayout): boolean {
  const { room, bed } = left;
  const { room: nextRoom, bed: nextBed } = right;

  return (
    room.x === nextRoom.x &&
    room.z === nextRoom.z &&
    room.width === nextRoom.width &&
    room.length === nextRoom.length &&
    bed.center.x === nextBed.center.x &&
    bed.center.z === nextBed.center.z &&
    bed.crosswise === nextBed.crosswise &&
    bed.size.width === nextBed.size.width &&
    bed.size.length === nextBed.size.length &&
    bed.size.height === nextBed.size.height
  );
}

export function changeLayout(history: LayoutHistory, action: LayoutAction): LayoutHistory {
  const { layout, past, future } = history;
  switch (action.type) {
    case "change": {
      const next = action.update(layout);
      return sameLayout(layout, next)
        ? history
        : { layout: next, past: [...past.slice(-49), layout], future: [] };
    }
    case "undo": {
      const previous = past.at(-1);
      return previous
        ? { layout: previous, past: past.slice(0, -1), future: [layout, ...future] }
        : history;
    }
    case "redo": {
      const [next, ...remaining] = future;
      return next ? { layout: next, past: [...past, layout], future: remaining } : history;
    }
  }
}
