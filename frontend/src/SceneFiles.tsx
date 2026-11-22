import { useEffect, useRef, useState } from "react";

import { downloadBlob } from "./download";
import type { RoomLayout } from "./roomLayout";
import { createScene, readScene, type OpenRoomView, type RoomScene } from "./roomScene";

type SceneFilesProps = {
  layout: RoomLayout;
  views: OpenRoomView[];
  photoChanging: boolean;
  onLoad: (scene: RoomScene, secondPhotoUrl: string | null) => void;
};

export function SceneFiles({ layout, views, photoChanging, onLoad }: SceneFilesProps) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const readId = useRef(0);

  useEffect(
    () => () => {
      readId.current += 1;
    },
    [],
  );

  async function save() {
    setSaving(true);
    setMessage(null);

    try {
      const scene = await createScene(layout, views);
      const blob = new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" });
      downloadBlob(blob, "same-angle-scene.json");
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "The scene could not be saved.",
        error: true,
      });
    } finally {
      setSaving(false);
    }
  }

  async function load(file: File) {
    const id = ++readId.current;
    setMessage(null);

    try {
      const scene = await readScene(
        file,
        views.map(({ photo }) => photo),
      );
      if (id !== readId.current) return;
      onLoad(scene, views[1]?.photo.url ?? null);
      setMessage({ text: "Scene loaded.", error: false });
    } catch (error) {
      if (id === readId.current) {
        setMessage({
          text: error instanceof Error ? error.message : "The scene could not be opened.",
          error: true,
        });
      }
    }
  }

  return (
    <fieldset className="scene-files" aria-label="Room scene files">
      <input
        type="file"
        aria-label="Room scene file"
        accept=".json,application/json"
        ref={input}
        hidden
        disabled={photoChanging}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void load(file);
        }}
      />
      <button
        type="button"
        className="secondary-button"
        disabled={saving || photoChanging}
        onClick={() => void save()}
      >
        Download scene
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={photoChanging}
        onClick={() => input.current?.click()}
      >
        Load scene
      </button>
      <p className="scene-files-help">
        Download the scene to keep the room layout and camera fits.
      </p>
      {message && (
        <output className={message.error ? "field-error" : undefined}>{message.text}</output>
      )}
    </fieldset>
  );
}
