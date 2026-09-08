"use client";
import { assertModelingCommand } from "./modeling-policy";
import {
  buildLocalModel,
  type ModelingConnection,
} from "./modeling-connection";
import { deriveAssetPolicy, enforceAssetPolicy } from "./asset-policy";
import {
  generationRequest,
  type GenerationConnection,
} from "./generation-connection";
import { create } from "zustand";
import { get, update } from "idb-keyval";
import {
  blankProject,
  commandSchema,
  committed,
  projectSchema,
  applyOperation,
  type Project,
  type Command,
  type Cursor,
} from "./protocol";
export type Phase = "landing" | "descending" | "editing";
type LocalHistory = { project: Project; history: Project[]; future: Project[] };
const HISTORY_LIMIT = 20;
function readLocalHistory(
  value: unknown,
  project: Project,
): LocalHistory | undefined {
  if (!value || typeof value !== "object") return;
  const record = value as Partial<LocalHistory>;
  const saved = projectSchema.safeParse(record.project);
  if (
    !saved.success ||
    JSON.stringify(saved.data) !== JSON.stringify(projectSchema.parse(project))
  )
    return;
  const valid = (entries: unknown, future = false) => {
    if (!Array.isArray(entries)) return [];
    const bounded = future
      ? entries.slice(0, HISTORY_LIMIT)
      : entries.slice(-HISTORY_LIMIT);
    return bounded.flatMap((entry) => {
      const parsed = projectSchema.safeParse(entry);
      return parsed.success &&
        parsed.data.id === project.id &&
        parsed.data.revision <= project.revision
        ? [committed(parsed.data)]
        : [];
    });
  };
  return {
    project: saved.data,
    history: valid(record.history),
    future: valid(record.future, true),
  };
}
interface State {
  project: Project;
  phase: Phase;
  playing: boolean;
  building: boolean;
  selected?: string;
  modelingConnection?: ModelingConnection;
  history: Project[];
  future: Project[];
  score: string[];
  won: boolean;
  notice: string;
  error: string;
  generationErrorCode?: string;
  saved: boolean;
  recovered?: Project;
  drafts: Project[];
  draftHistory: Record<string, LocalHistory>;
  readOnly: boolean;
  reset: number;
  set: (patch: Partial<State>) => void;
  run: (prompt: string, connection?: GenerationConnection) => Promise<void>;
  stop: () => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
  recover: () => Promise<void>;
  preserveLocalCopy: () => Promise<void>;
  loadCloud: (project: Project, isCurrent?: () => boolean) => Promise<boolean>;
  load: (p: Project, play?: boolean) => void;
  collect: (id: string) => void;
}
type LeaseStorage = Pick<Storage, "getItem" | "setItem">;
type DraftLease = { owner: string; expiresAt: number };
const LEASE_MS = 45000;
const tabId = crypto.randomUUID();
let leasedProject: string | undefined;
let leaseTimer: ReturnType<typeof setInterval> | undefined;
export function claimDraftLease(
  storage: LeaseStorage,
  projectId: string,
  owner: string,
  now: number,
) {
  const key = `orbsie-writer:${projectId}`;
  let lease: DraftLease | undefined;
  try {
    lease = JSON.parse(storage.getItem(key) ?? "null") ?? undefined;
  } catch {
    lease = undefined;
  }
  if (lease && lease.owner !== owner && lease.expiresAt > now) return false;
  storage.setItem(key, JSON.stringify({ owner, expiresAt: now + LEASE_MS }));
  try {
    return (
      (JSON.parse(storage.getItem(key) ?? "null") as DraftLease | null)
        ?.owner === owner
    );
  } catch {
    return false;
  }
}
export function releaseDraftLease(
  storage: LeaseStorage & Pick<Storage, "removeItem">,
  projectId: string,
  owner: string,
) {
  const key = `orbsie-writer:${projectId}`;
  try {
    const lease = JSON.parse(
      storage.getItem(key) ?? "null",
    ) as DraftLease | null;
    if (lease?.owner === owner) storage.removeItem(key);
  } catch {}
}
let leaseListeners = false;
function activateWriter(projectId: string) {
  if (typeof window === "undefined") return true;
  if (!claimDraftLease(localStorage, projectId, tabId, Date.now()))
    return false;
  leasedProject = projectId;
  if (!leaseListeners) {
    leaseListeners = true;
    window.addEventListener("pagehide", () => {
      if (leasedProject) releaseDraftLease(localStorage, leasedProject, tabId);
    });
    window.addEventListener("storage", (event) => {
      if (!leasedProject || event.key !== `orbsie-writer:${leasedProject}`)
        return;
      try {
        const next = JSON.parse(event.newValue ?? "null") as DraftLease | null;
        if (next && next.owner !== tabId) {
          useOrb.setState({
            readOnly: true,
            error:
              "Another tab took over this world. This tab is now read-only so your drafts cannot overwrite each other.",
          });
        }
      } catch {}
    });
  }
  if (!leaseTimer)
    leaseTimer = setInterval(() => {
      if (leasedProject)
        claimDraftLease(localStorage, leasedProject, tabId, Date.now());
    }, LEASE_MS / 3);
  return true;
}
async function withDraftWriteLock(
  projectId: string,
  write: () => Promise<boolean>,
) {
  if (typeof navigator === "undefined" || !navigator.locks) return write();
  return navigator.locks.request(
    `orbsie-write:${projectId}`,
    { mode: "exclusive" },
    write,
  );
}
let active: AbortController | undefined;
let baseline: Project | undefined;
export const useOrb = create<State>((setState, getState) => ({
  project: blankProject(),
  phase: "landing",
  playing: false,
  building: false,
  history: [],
  future: [],
  score: [],
  won: false,
  notice: "",
  error: "",
  saved: false,
  drafts: [],
  draftHistory: {},
  readOnly: false,
  reset: 0,
  set: setState,
  async save() {
    const captured = getState();
    const capturedProject = captured.project;
    const capturedBaseline = baseline;
    const isCurrent = () => getState().project === capturedProject;
    try {
      if (!activateWriter(capturedProject.id)) {
        if (isCurrent())
          setState({
            readOnly: true,
            error:
              "This world is open in another tab. Continue there, or wait a moment before editing here.",
          });
        return;
      }
      const snapshot = committed(capturedProject, capturedBaseline);
      const history = readLocalHistory(
        {
          project: snapshot,
          history: captured.history,
          future: captured.future,
        },
        snapshot,
      )!;
      const wrote = await withDraftWriteLock(snapshot.id, async () => {
        let accepted = false;
        await update<Record<string, Project>>("orbsie-library", (library) => {
          const existing = library?.[snapshot.id];
          if (existing && existing.revision > snapshot.revision) return library;
          accepted = true;
          return { ...library, [snapshot.id]: snapshot };
        });
        if (!accepted) return false;
        await update<Record<string, LocalHistory>>(
          "orbsie-history",
          (records) => ({
            ...records,
            [snapshot.id]: history,
          }),
        );

        // A switched world still keeps its own library/history checkpoint, but
        // must not replace the compatibility pointer for the newly selected world.
        await update("orbsie-draft", (current) =>
          isCurrent() ? { ...history, savedAt: Date.now() } : current,
        );
        return true;
      });
      if (!wrote) {
        if (isCurrent())
          setState({
            readOnly: true,
            error:
              "A newer local draft was saved in another tab. This tab was made read-only.",
          });
        return;
      }
      if (!isCurrent()) return;
      setState({
        draftHistory: { ...getState().draftHistory, [snapshot.id]: history },
        saved: true,
        recovered: snapshot,
        drafts: [
          snapshot,
          ...getState().drafts.filter((p) => p.id !== snapshot.id),
        ],
      });
    } catch {
      if (isCurrent())
        setState({
          error:
            "This browser could not save your draft. Export it before closing.",
        });
    }
  },
  async loadCloud(project, isCurrent = () => true) {
    if (!isCurrent()) return false;
    if (!activateWriter(project.id))
      throw Error("This cloud world is being edited in another tab.");
    await getState().preserveLocalCopy();
    if (!isCurrent()) return false;
    // Explicit cloud-open replaces the local baseline only after preserving
    // both the current draft and any divergent saved branch at the target ID.
    let recovered: Project | undefined;
    await withDraftWriteLock(project.id, async () => {
      await update<Record<string, Project>>("orbsie-library", (library) => {
        if (!isCurrent()) return library ?? {};
        const existing = library?.[project.id];
        if (existing && JSON.stringify(existing) !== JSON.stringify(project)) {
          recovered = {
            ...existing,
            id: crypto.randomUUID(),
            title: `${existing.title} (local recovery)`,
          };
        }
        return {
          ...library,
          ...(recovered ? { [recovered.id]: recovered } : {}),
          [project.id]: project,
        };
      });
      return true;
    });
    if (!isCurrent()) return false;
    if (recovered) setState({ drafts: [recovered, ...getState().drafts] });
    getState().load(project);
    const opened = getState().project;
    await getState().save();
    return getState().project === opened;
  },
  async preserveLocalCopy() {
    const copy = {
      ...committed(getState().project, baseline),
      id: crypto.randomUUID(),
      title: `${getState().project.title} (local recovery)`,
    };
    // A distinct identity preserves a divergent branch even after the cloud ID is saved.
    await update<Record<string, Project>>("orbsie-library", (library) => ({
      ...library,
      [copy.id]: copy,
    }));
    setState({ drafts: [copy, ...getState().drafts] });
  },
  async recover() {
    const currentProject = getState().project;
    try {
      const draft = await get("orbsie-draft");
      const library = await get<Record<string, Project>>("orbsie-library");
      const records = await get<Record<string, unknown>>("orbsie-history");
      if (getState().project !== currentProject) return;
      const drafts = Object.entries(library ?? {}).flatMap(([id, value]) => {
        const parsed = projectSchema.safeParse(value);
        return parsed.success && parsed.data.id === id ? [parsed.data] : [];
      });
      const saved = projectSchema.safeParse(draft?.project);
      const recovered = saved.success
        ? (drafts.find((p) => p.id === saved.data.id) ?? saved.data)
        : undefined;
      if (recovered && !drafts.some((p) => p.id === recovered.id))
        drafts.push(recovered);
      const draftHistory = Object.fromEntries(
        drafts.flatMap((project) => {
          const history =
            readLocalHistory(records?.[project.id], project) ??
            readLocalHistory(draft, project);
          return history ? [[project.id, history]] : [];
        }),
      );
      setState({ recovered, drafts, draftHistory });
    } catch {
      if (getState().project === currentProject)
        setState({
          error:
            "The saved draft could not be read. You can start a new world.",
        });
    }
  },
  load(project, play = false) {
    active?.abort();
    active = undefined;
    baseline = project;
    const writer = play || activateWriter(project.id);
    const history = play
      ? undefined
      : readLocalHistory(getState().draftHistory[project.id], project);
    const saved = getState().drafts.some(
      (draft) =>
        draft.id === project.id &&
        JSON.stringify(draft) === JSON.stringify(project),
    );
    setState({
      project: projectSchema.parse(project),
      saved,
      phase: "editing",
      playing: play,
      building: false,
      score: [],
      won: false,
      selected: undefined,
      history: history?.history ?? [],
      future: history?.future ?? [],
      recovered: undefined,
      readOnly: !writer,
      ...(!writer
        ? {
            error:
              "This world is open in another tab. This copy is read-only until that tab closes.",
          }
        : { error: "" }),
    });
  },
  collect(id) {
    const s = getState();
    if (!s.score.includes(id)) setState({ score: [...s.score, id] });
  },
  stop() {
    active?.abort();
    active = undefined;
    const s = getState();
    setState({
      phase: s.phase === "descending" ? "editing" : s.phase,
      building: false,
      project: committed(s.project, baseline),
      notice: "Stopped. Finished objects are safe.",
    });
    void getState().save();
  },
  undo() {
    const s = getState();
    if (s.readOnly || s.building || !s.history.length) return;
    setState({
      project: { ...s.history.at(-1)!, revision: s.project.revision + 1 },
      future: [s.project, ...s.future].slice(0, HISTORY_LIMIT),
      history: s.history.slice(0, -1),
      selected: undefined,
      notice: "Previous change restored.",
    });
    void getState().save();
  },
  redo() {
    const s = getState();
    if (s.readOnly || s.building || !s.future.length) return;
    setState({
      project: { ...s.future[0], revision: s.project.revision + 1 },
      history: [...s.history, s.project].slice(-HISTORY_LIMIT),
      future: s.future.slice(1),
    });
    void getState().save();
  },
  async run(prompt, connection = { provider: "free", model: "", key: "" }) {
    if (!activateWriter(getState().project.id)) {
      setState({
        readOnly: true,
        error:
          "This world is being edited in another tab. Your local copy was not changed.",
      });
      return;
    }
    active?.abort();
    active = undefined;
    const controller = new AbortController();
    active = controller;
    const { signal } = controller;
    const modelingConnection = getState().modelingConnection;
    const before =
      getState().phase === "landing"
        ? blankProject()
        : committed(getState().project, baseline);
    baseline = before;
    const initial = before.entities.length === 0;
    const selected = initial ? undefined : getState().selected;
    const assetPolicy = deriveAssetPolicy(prompt, selected, before);
    const project = {
      ...before,
      title: initial
        ? prompt.toLowerCase().includes("garden")
          ? "The daydream garden"
          : "A pocketful of sunshine"
        : before.title,
      messages: [
        ...before.messages,
        {
          role: "user" as const,
          text: prompt,
          ...(selected ? { entityId: selected } : {}),
        },
      ],
    };
    setState({
      project,
      phase: initial ? "descending" : "editing",
      ...(initial ? { score: [], won: false, selected: undefined } : {}),
      building: true,
      error: "",
      generationErrorCode: undefined,
      notice: "",
      saved: false,
      history: initial
        ? [before]
        : [...getState().history, before].slice(-HISTORY_LIMIT),
      future: [],
    });
    if (initial)
      setTimeout(
        () => {
          if (
            !signal.aborted &&
            getState().project.id === project.id &&
            getState().phase === "descending"
          )
            setState({ phase: "editing" });
        },
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 100
          : 4200,
      );
    let cursor: Cursor = {
      runId: crypto.randomUUID(),
      sequence: 0,
      seen: new Set(),
    };
    let lastAppliedCommand: Command["type"] | undefined;
    const apply = async (command: Command) => {
      if (signal.aborted || active !== controller) return false;
      let s = getState();
      command = enforceAssetPolicy(
        s.project,
        commandSchema.parse(command),
        assetPolicy,
      );
      assertModelingCommand(command, !!modelingConnection);
      if (
        command.type === "set_geometry" &&
        command.geometry.kind === "generated"
      ) {
        const model = await buildLocalModel(
          modelingConnection!,
          command.geometry.job,
          {
            signal,
            onProgress: (event) => {
              if (!signal.aborted && active === controller)
                setState({ notice: `Building locally: ${event.message}` });
            },
          },
        );
        if (signal.aborted || active !== controller) return false;
        command = { ...command, geometry: { ...command.geometry, model } };
        s = getState();
      }
      const result = applyOperation(
        s.project,
        {
          version: 1,
          projectId: s.project.id,
          runId: cursor.runId,
          sequence: cursor.sequence + 1,
          operationId: crypto.randomUUID(),
          baseRevision: s.project.revision,
          command,
        },
        cursor,
      );
      cursor = result.cursor;
      lastAppliedCommand = command.type;
      setState({ project: result.project });
      const checkpoint =
        (command.type === "set_geometry" &&
          command.geometry.detail === "refined") ||
        command.type === "set_material" ||
        command.type === "set_transform" ||
        command.type === "set_behavior" ||
        command.type === "set_environment" ||
        command.type === "remove_entity" ||
        command.type === "commit_revision";
      if (checkpoint) await getState().save();
      return !signal.aborted && active === controller;
    };
    try {
      await getState().save();
      if (signal.aborted || active !== controller) return;
      {
        const request = generationRequest(connection, {
          prompt,
          project,
          selected,
          localModeling: !!modelingConnection,
        });
        const response = await fetch(request.url, { ...request.init, signal });
        if (!response.ok) {
          const body = await response.json();
          if (active === controller && !signal.aborted)
            setState({
              generationErrorCode:
                typeof body.code === "string" ? body.code : undefined,
            });
          throw Error(body.error ?? "Connection failed. Your world is safe.");
        }
        if (signal.aborted || active !== controller) return;
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          if (pending.length > 100000)
            throw Error("The provider sent an oversized scene update.");
          const lines = pending.split("\n");
          pending = lines.pop()!;
          for (const line of lines) {
            if (!line.trim()) continue;
            const record = JSON.parse(line);
            if (record.error) throw Error(record.error);
            if (!(await apply(record))) {
              await reader.cancel().catch(() => undefined);
              return;
            }
          }
        }
        if (pending.trim() && !(await apply(JSON.parse(pending)))) return;
        if (lastAppliedCommand !== "commit_revision")
          throw Error(
            "The connection ended before committing the scene. Finished objects are safe; try continuing your request.",
          );
      }
      if (active === controller && !signal.aborted) {
        setState({
          building: false,
          notice: "Your world is saved on this device.",
        });
        await getState().save();
      }
    } catch (error) {
      if (active === controller && !signal.aborted) {
        setState({
          building: false,
          project: committed(getState().project, before),
          error: signal.aborted
            ? ""
            : error instanceof Error
              ? error.message
              : "Something went wrong. Your finished world is safe.",
        });
        await getState().save();
      }
    } finally {
      if (active === controller) active = undefined;
    }
  },
}));
