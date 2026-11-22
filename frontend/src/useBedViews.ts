import { useEffect, useRef, useState } from "react";

import { initialCameraSettings, type CameraSettings } from "./camera";
import { openRoomPhoto, type RoomPhoto } from "./photo";

const initialSecondCamera = { ...initialCameraSettings, yaw: 180, zMeters: 7.6 };

type RoomView = "first" | "second";

export function useBedViews(firstPhoto: RoomPhoto) {
  const [firstCamera, setFirstCamera] = useState(initialCameraSettings);
  const [secondPhoto, setSecondPhoto] = useState<RoomPhoto | null>(null);
  const [secondCamera, setSecondCamera] = useState(initialSecondCamera);
  const [view, setView] = useState<RoomView>("first");
  const [photoError, setPhotoError] = useState("");

  const upload = useRef(0);
  const selection = useRef<{ view: RoomView }>({ view: "first" });
  const photoUrl = useRef<string | null>(null);

  const isSecond = view === "second" && secondPhoto !== null;
  const settings = isSecond ? secondCamera : firstCamera;
  const activePhoto = isSecond ? secondPhoto : firstPhoto;
  const setCamera = isSecond ? setSecondCamera : setFirstCamera;

  useEffect(() => {
    return () => {
      upload.current += 1;
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    };
  }, []);

  function selectView(view: RoomView) {
    selection.current = { view };
    setView(view);
  }

  async function openSecondPhoto(file: File): Promise<boolean> {
    const request = ++upload.current;
    const requestedFrom = selection.current;
    setPhotoError("");

    try {
      const photo = await openRoomPhoto(file, file.name, true);
      if (upload.current !== request) {
        URL.revokeObjectURL(photo.url);
        return false;
      }

      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
      photoUrl.current = photo.url;
      setSecondPhoto(photo);
      setSecondCamera(initialSecondCamera);
      const showSecond = selection.current === requestedFrom || selection.current.view === "second";
      if (showSecond) selectView("second");
      return showSecond;
    } catch (error) {
      if (upload.current === request) {
        setPhotoError(
          error instanceof Error ? error.message : "The second photo could not be opened.",
        );
      }
      return false;
    }
  }

  function adjustCamera(key: keyof CameraSettings, value: number) {
    setCamera((camera) => ({ ...camera, [key]: value }));
  }

  function resetCamera() {
    setCamera(isSecond ? initialSecondCamera : initialCameraSettings);
  }

  return {
    view,
    selectView,
    settings,
    activePhoto,
    secondPhoto,
    photoError,
    openSecondPhoto,
    adjustCamera,
    resetCamera,
  };
}
