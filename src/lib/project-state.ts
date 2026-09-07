export type ProjectValue<T> = { projectId: string; value: T };

export function scopedValue<T>(
  record: ProjectValue<T> | null,
  projectId: string,
): T | null {
  return record?.projectId === projectId ? record.value : null;
}

// Track transitions synchronously, including switching away and back while a request waits.
export function createProjectScope(projectId: string) {
  let generation = 0;
  return {
    select(nextId: string) {
      if (nextId === projectId) return false;
      projectId = nextId;
      generation++;
      return true;
    },
    capture() {
      const started = generation;
      return () => started === generation;
    },
  };
}

export type Publication = {
  servedRevision?: number | null;
  state: string;
  url?: string;
  deploymentUrl?: string;
  error?: string;
};

export async function readPublication(
  response: Response,
  current: () => boolean,
): Promise<Publication | null | undefined> {
  if (!current()) return undefined;
  if (response.status === 404) return null;
  const data = await response.json();
  if (!current()) return undefined;
  return response.ok ? data : { state: "ERROR", error: data.error };
}
