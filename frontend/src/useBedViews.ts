import { useEffect, useRef, useState } from "react";

import { initialCameraSettings, type CameraSettings } from "./camera";
import { openRoomPhoto, type RoomPhoto } from "./photo";
import type { OpenRoomView } from "./roomScene";

const initialSecondCamera = { ...initialCameraSettings, yaw: 180, zMeters: 7.6 };

type RoomView = "first" | "second";

export function useBedViews(firstPhoto: RoomPhoto) {
  const [firstCamera, setFirstCamera] = useState(initialCameraSettings);
  const [secondPhoto, setSecondPhoto] = useState<RoomPhoto | null>(null);
  const [secondCamera, setSecondCamera] = useState(initialSecondCamera);
  const [view, setView] = useState<RoomView>("first");
  const [photoError, setPhotoError] = useState("");
  const [openingSecondPhoto, setOpeningSecondPhoto] = useState(false);

  const upload = useRef<symbol | null>(null);
  const selection = useRef<{ view: RoomView }>({ view: "first" });
  const photoUrl = useRef<string | null>(null);

  const isSecond = view === "second" && secondPhoto !== null;
  const settings = isSecond ? secondCamera : firstCamera;
  const activePhoto = isSecond ? secondPhoto : firstPhoto;
  const setCamera = isSecond ? setSecondCamera : setFirstCamera;

  useEffect(() => {
    return () => {
      upload.current = null;
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    };
  }, []);

  function selectView(view: RoomView) {
    selection.current = { view };
    setView(view);
  }

  async function openSecondPhoto(file: File): Promise<boolean> {
    if (upload.current) return false;

    const request = Symbol();
    const requestedFrom = selection.current;
    upload.current = request;
    setOpeningSecondPhoto(true);
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
    } finally {
      if (upload.current === request) {
        upload.current = null;
        setOpeningSecondPhoto(false);
      }
    }
  }

  function adjustCamera(key: keyof CameraSettings, value: number) {
    setCamera((camera) => ({ ...camera, [key]: value }));
  }

  function resetCamera() {
    setCamera(isSecond ? initialSecondCamera : initialCameraSettings);
  }

  function restoreCameras(cameras: CameraSettings[], expectedSecondUrl: string | null) {
    if (upload.current) {
      throw new Error("Wait for the photo to finish opening, then load the scene again.");
    }
    if (photoUrl.current !== expectedSecondUrl) {
      throw new Error("The loaded photos changed. Select the scene file again.");
    }

    setFirstCamera(cameras[0]);
    if (cameras[1]) setSecondCamera(cameras[1]);
  }

  const sceneViews: OpenRoomView[] = [{ photo: firstPhoto, camera: firstCamera }];
  if (secondPhoto) sceneViews.push({ photo: secondPhoto, camera: secondCamera });

  return {
    sceneViews,
    view,
    selectView,
    settings,
    activePhoto,
    secondPhoto,
    photoError,
    openingSecondPhoto,
    openSecondPhoto,
    adjustCamera,
    resetCamera,
    restoreCameras,
  };
}
