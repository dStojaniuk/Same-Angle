import { useState } from "react";

import type { ProjectedBedFace } from "./bed";
import { downloadBlob } from "./download";
import type { RoomPhoto } from "./photo";
import { renderRoomSnapshot, supportsSnapshotSize } from "./roomSnapshot";

type Snapshot = { photo: RoomPhoto; faces: ProjectedBedFace[]; view: "first" | "second" };

export function SnapshotButton({ snapshot }: { snapshot: Snapshot | null }) {
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<{ photoUrl: string; message: string } | null>(null);

  if (!snapshot) return null;
  const { photo, faces, view } = snapshot;
  const sizeSupported = supportsSnapshotSize(photo);

  async function saveSnapshot() {
    setPreparing(true);
    setError(null);

    try {
      const png = await renderRoomSnapshot(photo, faces);
      const basename = photo.name.replace(/\.[^.]+$/, "") || "room";
      downloadBlob(png, `${basename}-${view}-view.png`);
    } catch (error) {
      setError({
        photoUrl: photo.url,
        message: error instanceof Error ? error.message : "The view could not be exported.",
      });
    } finally {
      setPreparing(false);
    }
  }

  return (
    <div className="snapshot-action">
      <button
        type="button"
        className="secondary-button"
        disabled={preparing || !sizeSupported || !faces.length}
        onClick={() => void saveSnapshot()}
      >
        {preparing ? "Preparing PNG…" : "Download view PNG"}
      </button>
      {!sizeSupported && (
        <output className="field-error">
          This photo is too small for a readable scale label (128 × 40 px minimum).
        </output>
      )}
      {error?.photoUrl === photo.url && <output className="field-error">{error.message}</output>}
    </div>
  );
}
