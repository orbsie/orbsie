"use client";
import { create } from "zustand";
import { get, set, update } from "idb-keyval";
import {
  blankProject,
  committed,
  projectSchema,
  applyOperation,
  type Project,
  type Command,
  type Cursor,
} from "./protocol";
import { fixtureCommands, fixtureEdit } from "./fixtures";
export type Phase = "landing" | "descending" | "editing";
interface State {
  project: Project;
  phase: Phase;
  playing: boolean;
  building: boolean;
  selected?: string;
  history: Project[];
  future: Project[];
  score: string[];
  won: boolean;
  notice: string;
  error: string;
  saved: boolean;
  recovered?: Project;
  drafts: Project[];
  readOnly: boolean;
  reset: number;
  set: (patch: Partial<State>) => void;
  run: (
    prompt: string,
    demo?: boolean,
    connection?: { provider: string; model: string; key: string },
  ) => Promise<void>;
  stop: () => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
  recover: () => Promise<void>;
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
let active: AbortController | undefined;
let baseline: Project | undefined;
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Stopped", "AbortError"));
      },
      { once: true },
    );
  });
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
  readOnly: false,
  reset: 0,
  set: setState,
  async save() {
    try {
      const s = getState();
      if (!activateWriter(s.project.id)) {
        setState({
          readOnly: true,
          error:
            "This world is open in another tab. Continue there, or wait a moment before editing here.",
        });
        return;
      }
      await set("orbsie-draft", {
        project: committed(s.project),
        history: s.history.slice(-20),
        savedAt: Date.now(),
      });
      const snapshot = committed(s.project, baseline);
      await update<Record<string, Project>>("orbsie-library", (library) => ({
        ...library,
        [snapshot.id]: snapshot,
      }));
      setState({
        saved: true,
        recovered: snapshot,
        drafts: [
          snapshot,
          ...getState().drafts.filter((p) => p.id !== snapshot.id),
        ],
      });
    } catch {
      setState({
        error:
          "This browser could not save your draft. Export it before closing.",
      });
    }
  },
  async recover() {
    try {
      const draft = await get("orbsie-draft");
      const library = await get<Record<string, Project>>("orbsie-library");
      const drafts = Object.values(library ?? {}).map((p) =>
        projectSchema.parse(p),
      );
      if (draft)
        setState({
          recovered: projectSchema.parse(draft.project),
          drafts: drafts.length ? drafts : [projectSchema.parse(draft.project)],
        });
    } catch {
      setState({
        error: "The saved draft could not be read. You can start a new world.",
      });
    }
  },
  load(project, play = false) {
    active?.abort();
    baseline = project;
    const writer = play || activateWriter(project.id);
    setState({
      project: projectSchema.parse(project),
      phase: "editing",
      playing: play,
      building: false,
      score: [],
      won: false,
      selected: undefined,
      history: [],
      future: [],
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
      building: false,
      project: committed(s.project, baseline),
      notice: "Stopped. Finished objects are safe.",
    });
    void getState().save();
  },
  undo() {
    const s = getState();
    if (s.building || !s.history.length) return;
    setState({
      project: s.history.at(-1)!,
      future: [s.project, ...s.future],
      history: s.history.slice(0, -1),
      selected: undefined,
      notice: "Previous change restored.",
    });
    void getState().save();
  },
  redo() {
    const s = getState();
    if (s.building || !s.future.length) return;
    setState({
      project: s.future[0],
      history: [...s.history, s.project],
      future: s.future.slice(1),
    });
    void getState().save();
  },
  async run(prompt, demo = true, connection) {
    if (!activateWriter(getState().project.id)) {
      setState({
        readOnly: true,
        error:
          "This world is being edited in another tab. Your local copy was not changed.",
      });
      return;
    }
    active?.abort();
    const controller = new AbortController();
    active = controller;
    const { signal } = controller;
    const before =
      getState().phase === "landing"
        ? blankProject()
        : committed(getState().project, baseline);
    baseline = before;
    const initial = before.entities.length === 0;
    const selected = initial ? undefined : getState().selected;
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
      notice: "",
      saved: false,
      history: initial ? [before] : [...getState().history, before].slice(-30),
      future: [],
    });
    if (initial)
      setTimeout(
        () => {
          if (getState().phase === "descending") setState({ phase: "editing" });
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
    const apply = (command: Command) => {
      if (signal.aborted || active !== controller) return;
      const s = getState();
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
      setState({ project: result.project });
      if (
        command.type === "set_geometry" &&
        command.geometry.detail === "refined"
      )
        void getState().save();
    };
    try {
      if (demo) {
        const commands = initial
          ? fixtureCommands(prompt.toLowerCase().includes("garden"))
          : fixtureEdit(project, prompt, selected);
        for (const command of commands) {
          await pause(command.type === "reserve_entity" ? 170 : 240, signal);
          apply(command);
        }
      } else {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, project, selected, ...connection }),
          signal,
        });
        if (!response.ok) {
          const body = await response.json();
          throw Error(body.error ?? "Connection failed. Your world is safe.");
        }
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
            apply(record);
          }
        }
        if (pending.trim()) apply(JSON.parse(pending));
      }
      if (active === controller) {
        setState({
          building: false,
          notice: "Your world is saved on this device.",
        });
        await getState().save();
      }
    } catch (error) {
      if (active === controller) {
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
    }
  },
}));
