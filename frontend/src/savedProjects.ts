import type { FloorDraft } from "./floorDraft";

export type SavedProject = {
  id: string;
  name: string;
  original: Blob;
  draft: FloorDraft;
  updatedAt: number;
  revision: number;
};

type ProjectDraft = Omit<SavedProject, "original">;
type OriginalPhoto = Pick<SavedProject, "id" | "original">;

const projectStore = "rooms";
const photoStore = "photos";

export class ProjectConflict extends Error {}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("same-angle-studio", 1);

    open.onupgradeneeded = () => {
      open.result.createObjectStore(projectStore, { keyPath: "id" });
      open.result.createObjectStore(photoStore, { keyPath: "id" });
    };

    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => () => T,
): Promise<T> {
  const database = await openDatabase();

  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction([projectStore, photoStore], mode);
      const read = operation(transaction);

      transaction.oncomplete = () => resolve(read());
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Local project storage was interrupted."));
    });
  } finally {
    database.close();
  }
}

export function getProjects(): Promise<SavedProject[]> {
  return transaction("readonly", (transaction) => {
    const rooms: IDBRequest<ProjectDraft[]> = transaction.objectStore(projectStore).getAll();
    const images: IDBRequest<OriginalPhoto[]> = transaction.objectStore(photoStore).getAll();

    return () => {
      const originals = new Map(images.result.map(({ id, original }) => [id, original]));
      return rooms.result.flatMap((room) => {
        const original = originals.get(room.id);
        return original ? [{ ...room, original }] : [];
      });
    };
  });
}

export function getProject(id: string): Promise<SavedProject | undefined> {
  return transaction("readonly", (transaction) => {
    const room: IDBRequest<ProjectDraft | undefined> = transaction
      .objectStore(projectStore)
      .get(id);
    const photo: IDBRequest<OriginalPhoto | undefined> = transaction
      .objectStore(photoStore)
      .get(id);

    return () =>
      room.result && photo.result ? { ...room.result, original: photo.result.original } : undefined;
  });
}

export function copyConflictedDraft({
  original,
  ...draft
}: SavedProject): Promise<{ copy: SavedProject; saved: SavedProject } | undefined> {
  const copy = {
    ...draft,
    id: crypto.randomUUID(),
    name: `${draft.name} (local draft)`,
    updatedAt: Date.now(),
    revision: 1,
  };

  // Read the saved revision and write the copy together so no other write can land between them.
  return transaction("readwrite", (transaction) => {
    const rooms = transaction.objectStore(projectStore);
    const photos = transaction.objectStore(photoStore);
    const savedDraft: IDBRequest<ProjectDraft | undefined> = rooms.get(draft.id);
    const savedPhoto: IDBRequest<OriginalPhoto | undefined> = photos.get(draft.id);
    let result: { copy: SavedProject; saved: SavedProject } | undefined;

    savedPhoto.onsuccess = () => {
      if (!savedDraft.result || !savedPhoto.result) return;

      rooms.add(copy);
      photos.add({ id: copy.id, original });
      result = {
        copy: { ...copy, original },
        saved: { ...savedDraft.result, original: savedPhoto.result.original },
      };
    };

    return () => result;
  });
}

export async function saveProject(
  { original, ...project }: SavedProject,
  expectedRevision: number,
): Promise<SavedProject> {
  let conflict = false;
  const revision = expectedRevision + 1;

  try {
    return await transaction("readwrite", (transaction) => {
      const rooms = transaction.objectStore(projectStore);
      const existing: IDBRequest<ProjectDraft | undefined> = rooms.get(project.id);

      existing.onsuccess = () => {
        if ((existing.result?.revision ?? 0) !== expectedRevision) {
          conflict = true;
          transaction.abort();
          return;
        }

        rooms.put({ ...project, revision });
        if (!existing.result) {
          transaction.objectStore(photoStore).add({ id: project.id, original });
        }
      };

      return () => ({ ...project, original, revision });
    });
  } catch (error) {
    if (conflict) throw new ProjectConflict();
    throw error;
  }
}
