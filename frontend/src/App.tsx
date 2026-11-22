import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

import type { FloorDraft } from "./floorDraft";
import { openRoomPhoto, sampleRoom, type RoomPhoto } from "./photo";
import { RoomEditor } from "./RoomEditor";
import {
  copyConflictedDraft,
  getProject,
  getProjects,
  ProjectConflict,
  saveProject,
  type SavedProject,
} from "./savedProjects";

type SaveSession = { readonly baseRevision: number };
type ActiveRoom =
  | { photo: RoomPhoto; project?: never; saveSession?: never }
  | { photo: RoomPhoto; project: SavedProject; saveSession: SaveSession };
type SaveState = "saving" | "saved" | "failed" | "conflict";
type PendingEdit = { project: SavedProject; session: SaveSession };
type ProjectToOpen = { project: SavedProject; preserveDraft?: PendingEdit };

const saveMessages: Record<SaveState, string> = {
  saving: "Saving project…",
  saved: "Saved in this browser",
  failed: "Project could not be saved in this browser",
  conflict: "Unsaved: a newer version was saved in another tab.",
};

export function App() {
  const [room, setRoom] = useState<ActiveRoom>({ photo: sampleRoom });
  const [loading, setLoading] = useState(false);
  const [recoveringConflict, setRecoveringConflict] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<SavedProject[] | null>(null);
  const [projectsUnavailable, setProjectsUnavailable] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});

  const input = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const activeObjectUrl = useRef<string | null>(null);
  const focusSelectedHeading = useRef(false);
  const projectListRead = useRef({ id: 0, failed: false });
  const saveQueue = useRef(Promise.resolve());
  const recentEdits = useRef(new Map<string, PendingEdit>());
  const committed = useRef(new Map<string, SavedProject>());
  const savedRevisions = useRef(new WeakMap<SaveSession, number>());

  const saveState = room.project && (saveStates[room.project.id] ?? "saved");
  const saveMessage = saveState ? saveMessages[saveState] : "";

  const refreshProjects = useCallback(async () => {
    const read = projectListRead.current;
    const id = ++read.id;

    try {
      const stored = await getProjects();
      if (id !== read.id) return;

      const latest = new Map(stored.map((project) => [project.id, project]));

      // The read can finish after a draft has been saved or edited in this tab.
      for (const [projectId, project] of committed.current) {
        const fromStorage = latest.get(projectId);
        if (!fromStorage || (fromStorage.revision ?? 0) < project.revision) {
          latest.set(projectId, project);
        }
      }

      for (const [projectId, { project }] of recentEdits.current) {
        latest.set(projectId, project);
      }

      setProjects([...latest.values()]);
      read.failed = false;
      setProjectsUnavailable(false);
    } catch {
      if (id !== read.id) return;

      read.failed = true;
      setProjectsUnavailable(true);
    }
  }, []);

  const queueSave = useCallback(
    (project: SavedProject, session: SaveSession) => {
      const edit = { project, session };
      recentEdits.current.set(project.id, edit);
      setSaveStates((current) => ({ ...current, [project.id]: "saving" }));
      setProjects((current) => [project, ...(current ?? []).filter(({ id }) => id !== project.id)]);

      const write = saveQueue.current.then(async () => {
        // Reading a newer draft in another editor session cannot advance this edit's revision.
        const revision = savedRevisions.current.get(session) ?? session.baseRevision;
        const saved = await saveProject(project, revision);
        savedRevisions.current.set(session, saved.revision);
        committed.current.set(project.id, saved);
        return saved;
      });
      saveQueue.current = write.then(
        () => undefined,
        () => undefined,
      );
      void write.then(
        (saved) => {
          if (projectListRead.current.failed) void refreshProjects();
          if (recentEdits.current.get(project.id) !== edit) return;

          recentEdits.current.delete(project.id);
          setProjects((current) => [saved, ...(current ?? []).filter(({ id }) => id !== saved.id)]);
          setSaveStates((current) => ({ ...current, [project.id]: "saved" }));
        },
        (error: unknown) => {
          if (recentEdits.current.get(project.id) === edit) {
            setSaveStates((current) => ({
              ...current,
              [project.id]: error instanceof ProjectConflict ? "conflict" : "failed",
            }));
          }
        },
      );
    },
    [refreshProjects],
  );

  const onDraftChange = useCallback(
    (draft: FloorDraft) => {
      if (room.project)
        queueSave({ ...room.project, draft, updatedAt: Date.now() }, room.saveSession);
    },
    [room.project, room.saveSession, queueSave],
  );

  useEffect(() => {
    const read = projectListRead.current;

    return () => {
      read.id += 1;
      requestId.current += 1;
      if (activeObjectUrl.current) URL.revokeObjectURL(activeObjectUrl.current);
    };
  }, []);

  function selectRoom(next: ActiveRoom) {
    if (activeObjectUrl.current) URL.revokeObjectURL(activeObjectUrl.current);

    activeObjectUrl.current = next.photo.url.startsWith("blob:") ? next.photo.url : null;
    setRoom(next);
    setShowProjects(false);
  }

  async function loadPhoto(original: Blob, name: string, selection?: ProjectToOpen) {
    const request = ++requestId.current;
    const saved = selection?.project;
    const preserveDraft = selection?.preserveDraft;
    let preparedPhoto: RoomPhoto | undefined;

    setError("");
    setLoading(true);
    if (preserveDraft) setRecoveringConflict(true);

    try {
      const id = saved?.id ?? crypto.randomUUID();
      const photo = await openRoomPhoto(original, name, !saved);
      preparedPhoto = photo;

      if (preserveDraft) {
        if (request !== requestId.current) return;

        const recovery = await copyConflictedDraft(preserveDraft.project).catch(() => {
          throw new Error("The draft copy could not be saved. Your draft is still here.");
        });
        if (!recovery)
          throw new Error("The saved version could not be opened. Your draft is still here.");

        const { copy, saved: stored } = recovery;
        committed.current.set(copy.id, copy);
        if (recentEdits.current.get(id) !== preserveDraft) {
          setProjects((current) => [copy, ...(current ?? [])]);
          throw new Error("The draft changed during recovery. Your latest edits are still here.");
        }

        recentEdits.current.delete(id);
        setProjects((current) => [
          copy,
          stored,
          ...(current ?? []).filter((project) => project.id !== id),
        ]);
        setSaveStates((current) => ({ ...current, [id]: "saved" }));
        void refreshProjects();

        if (request !== requestId.current) return;

        focusSelectedHeading.current = true;
        selectRoom({ photo, project: stored, saveSession: { baseRevision: stored.revision ?? 0 } });
      } else if (saved) {
        const stored = await getProject(id).catch(() => undefined);
        if (request !== requestId.current) return;

        const lastWrite = committed.current.get(id);
        const newest =
          stored && (stored.revision ?? 0) >= (lastWrite?.revision ?? 0) ? stored : lastWrite;
        const unsaved = recentEdits.current.get(id);
        const project = unsaved?.project ?? newest ?? saved;
        const saveSession = unsaved?.session ?? { baseRevision: project.revision ?? 0 };

        focusSelectedHeading.current = true;
        selectRoom({ photo, project, saveSession });
      } else {
        if (request !== requestId.current) return;

        const project = {
          id,
          name,
          original,
          draft: { outline: photo.outline, corners: null },
          updatedAt: Date.now(),
          revision: 0,
        };
        const saveSession = { baseRevision: 0 };

        focusSelectedHeading.current = false;
        selectRoom({ photo, project, saveSession });
        queueSave(project, saveSession);
      }
      preparedPhoto = undefined;
    } catch (reason) {
      if (request === requestId.current) {
        setError(reason instanceof Error ? reason.message : "The photo could not be opened.");
      }
    } finally {
      if (preparedPhoto) URL.revokeObjectURL(preparedPhoto.url);
      if (request === requestId.current) setLoading(false);
      if (preserveDraft) setRecoveringConflict(false);
    }
  }

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void loadPhoto(file, file.name);
  }

  function openProject(stored: SavedProject) {
    const project = recentEdits.current.get(stored.id)?.project ?? stored;
    void loadPhoto(project.original, project.name, { project });
  }

  function openSavedVersion() {
    if (!room.project || loading || recoveringConflict) return;

    const preserveDraft = recentEdits.current.get(room.project.id);
    if (!preserveDraft) return;

    const { project } = preserveDraft;
    void loadPhoto(project.original, project.name, { project, preserveDraft });
  }

  function openSample() {
    requestId.current += 1;
    setLoading(false);
    setError("");
    focusSelectedHeading.current = true;
    selectRoom({ photo: sampleRoom });
  }

  function toggleProjects() {
    if (!showProjects) void refreshProjects();
    setShowProjects(!showProjects);
  }

  function focusHeading(heading: HTMLHeadingElement | null) {
    if (heading && focusSelectedHeading.current) {
      focusSelectedHeading.current = false;
      heading.focus();
    }
  }

  function retrySave() {
    if (!room.project) return;

    const edit = recentEdits.current.get(room.project.id);

    if (edit) queueSave({ ...edit.project, updatedAt: Date.now() }, edit.session);
  }

  return (
    <>
      <header className="app-header" inert={recoveringConflict}>
        <div className="header-content">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Same Angle
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="secondary-button"
              aria-expanded={showProjects}
              aria-controls="saved-projects"
              onClick={toggleProjects}
            >
              Saved projects
            </button>
            <input
              type="file"
              aria-label="Room photo"
              accept="image/jpeg,image/png,.jpg,.jpeg,.png"
              hidden
              ref={input}
              onChange={handleUpload}
            />
            <button
              type="button"
              className="secondary-button"
              onClick={() => input.current?.click()}
            >
              Open photo
            </button>
          </div>
        </div>
      </header>
      <section
        id="saved-projects"
        className="project-tray"
        hidden={!showProjects}
        inert={recoveringConflict}
        aria-labelledby="saved-projects-title"
      >
        <h2 id="saved-projects-title">Projects on this device</h2>
        {projectsUnavailable && <p>Local project storage is unavailable.</p>}
        {projects === null ? (
          projectsUnavailable ? null : (
            <output>Loading projects…</output>
          )
        ) : projects.length === 0 ? (
          <p>Open a photo to start a project.</p>
        ) : (
          <ul className="project-list">
            {[...projects]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => openProject(project)}
                  >
                    <strong>{project.name}</strong>
                    <span>{new Date(project.updatedAt).toLocaleString()}</span>
                    {(saveStates[project.id] === "failed" ||
                      saveStates[project.id] === "conflict") && <span>Unsaved in this tab</span>}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>
      {loading && <output className="notice">Opening photo…</output>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <RoomEditor
        key={room.photo.url}
        photo={room.photo}
        initialDraft={room.project?.draft}
        onDraftChange={onDraftChange}
        saveMessage={saveMessage}
        onRetrySave={saveState === "failed" ? retrySave : undefined}
        onOpenSavedVersion={saveState === "conflict" ? openSavedVersion : undefined}
        recoveringConflict={recoveringConflict}
        onOpenSample={openSample}
        headingRef={focusHeading}
      />
    </>
  );
}
