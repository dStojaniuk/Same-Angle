import type { Point } from "./outline";

export type FloorDraft = { outline: Point[]; corners: Point[] | null };

export type DraftHistory = {
  draft: FloorDraft;
  past: FloorDraft[];
  future: FloorDraft[];
};

export type DraftAction = { type: "edit"; draft: FloorDraft } | { type: "undo" | "redo" };

export function startHistory(draft: FloorDraft): DraftHistory {
  return { draft, past: [], future: [] };
}

export function changeDraft(history: DraftHistory, action: DraftAction): DraftHistory {
  const { draft, past, future } = history;

  switch (action.type) {
    case "edit":
      if (action.draft.outline === draft.outline && action.draft.corners === draft.corners)
        return history;

      return { draft: action.draft, past: [...past, draft], future: [] };
    case "undo": {
      const previous = past.at(-1);

      return previous
        ? { draft: previous, past: past.slice(0, -1), future: [draft, ...future] }
        : history;
    }
    case "redo": {
      const [next, ...remaining] = future;

      return next ? { draft: next, past: [...past, draft], future: remaining } : history;
    }
  }
}
