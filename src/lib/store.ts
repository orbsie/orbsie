"use client";
import { ZodError } from "zod";
import {
  appendCloudGenerationOperation,
  cancelCloudGenerationRun,
} from "./cloud-generation-journal";
import type { GenerationRun } from "./generation-journal";
import {
  uploadCloudGeneratedModels,
  downloadCloudGeneratedModels,
} from "./cloud-generated-models";
import { assertModelingCommand } from "./modeling-policy";
import { buildBrowserModel } from "./browser-modeling-connection";
import {
  canonicalBrowserProceduralSource,
  hashBrowserProceduralSource,
} from "./browser-procedural";
import { evaluateBrowserProceduralInWorker } from "./browser-procedural-queue";
import type { BrowserModelRecipe } from "./browser-modeling";
import { deriveAssetPolicy, enforceAssetPolicy } from "./asset-policy";
import { GAME_RULES_RESTART_NOTICE } from "./game-session";
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
  parseModelCommandForProcessing,
  type Project,
  type Command,
  type ModelCommand,
  type Cursor,
} from "./protocol";
import {
  beginExperience,
  finishExperience,
  markExperience,
  noteReservation,
  noteSceneUpdate,
} from "./experience-metrics";
export type GenerationJournalConnection = {
  isCurrent: () => boolean;
  begin: (
    project: Project,
    runId: string,
    prompt: string,
    selected?: string,
  ) => Promise<GenerationRun>;
};
export type Phase = "landing" | "descending" | "editing";
type LocalHistory = { project: Project; history: Project[]; future: Project[] };
const HISTORY_LIMIT = 20;
function browserModelingAvailable() {
  return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}
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
  history: Project[];
  future: Project[];
  score: string[];
  won: boolean;
  lost: boolean;
  gameScore: number;
  ruleRestartCount: number;
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
  run: (
    prompt: string,
    connection?: GenerationConnection,
    journal?: GenerationJournalConnection,
  ) => Promise<void>;
  stop: () => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
  recover: () => Promise<void>;
  preserveLocalCopy: () => Promise<void>;
  loadCloud: (
    project: Project,
    isCurrent?: () => boolean,
    isInstalledCurrent?: () => boolean,
  ) => Promise<boolean>;
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
let activeExperience: { projectId: string; token: string } | undefined;
function finishActiveExperience(outcome: "success" | "error" | "cancelled") {
  const experience = activeExperience;
  if (!experience) return;
  activeExperience = undefined;
  finishExperience(experience.projectId, experience.token, outcome);
}
export const useOrb = create<State>((setState, getState) => ({
  project: blankProject(),
  phase: "landing",
  playing: false,
  building: false,
  history: [],
  future: [],
  score: [],
  won: false,
  lost: false,
  gameScore: 0,
  notice: "",
  ruleRestartCount: 0,
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
  async loadCloud(
    project,
    isCurrent = () => true,
    isInstalledCurrent = () => true,
  ) {
    const startingProject = getState().project;
    const canInstall = () =>
      isCurrent() && getState().project === startingProject;
    if (!canInstall()) return false;
    if (!(await downloadCloudGeneratedModels(project, canInstall)))
      return false;
    if (!activateWriter(project.id))
      throw Error("This cloud world is being edited in another tab.");
    await getState().preserveLocalCopy();
    if (!canInstall()) return false;
    // Explicit cloud-open replaces the local baseline only after preserving
    // both the current draft and any divergent saved branch at the target ID.
    let recovered: Project | undefined;
    await withDraftWriteLock(project.id, async () => {
      await update<Record<string, Project>>("orbsie-library", (library) => {
        if (!canInstall()) return library ?? {};
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
    if (!canInstall()) return false;
    if (recovered) setState({ drafts: [recovered, ...getState().drafts] });
    getState().load(project);
    const opened = getState().project;
    await getState().save();
    return isInstalledCurrent() && getState().project === opened;
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
    finishActiveExperience("cancelled");
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
      lost: false,
      gameScore: 0,
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
    finishActiveExperience("cancelled");
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
  async run(
    prompt,
    connection = { provider: "free", model: "", key: "" },
    journal,
  ) {
    if (!activateWriter(getState().project.id)) {
      setState({
        readOnly: true,
        error:
          "This world is being edited in another tab. Your local copy was not changed.",
      });
      return;
    }
    finishActiveExperience("cancelled");
    active?.abort();
    active = undefined;
    const controller = new AbortController();
    active = controller;
    const { signal } = controller;
    const before =
      getState().phase === "landing"
        ? blankProject()
        : committed(getState().project, baseline);
    const ruleRestartsBeforeGeneration = getState().ruleRestartCount;
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
    const experienceToken = beginExperience(project.id);
    activeExperience = { projectId: project.id, token: experienceToken };
    let experienceFinished = false;
    const finishRunExperience = (
      outcome: "success" | "error" | "cancelled",
    ) => {
      if (experienceFinished) return;
      experienceFinished = true;
      finishExperience(project.id, experienceToken, outcome);
      if (activeExperience?.token === experienceToken)
        activeExperience = undefined;
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
    let durableRun: GenerationRun | undefined;
    const journalCurrent = () =>
      !signal.aborted &&
      active === controller &&
      (!journal || journal.isCurrent());
    const cancelDurable = () => {
      if (durableRun?.state === "running")
        void cancelCloudGenerationRun(durableRun.id).catch(() => undefined);
    };
    signal.addEventListener("abort", cancelDurable, { once: true });
    let lastAppliedCommand: Command["type"] | undefined;
    const apply = async (input: ModelCommand) => {
      if (signal.aborted || active !== controller) return false;
      let s = getState();
      let modelCommand = enforceAssetPolicy(
        s.project,
        parseModelCommandForProcessing(
          input,
          false,
          browserModelingAvailable(),
        ),
        assetPolicy,
      );
      assertModelingCommand(modelCommand, false, browserModelingAvailable());
      let command: Command;
      if (
        modelCommand.type === "set_geometry" &&
        modelCommand.geometry.kind === "generated"
      ) {
        const entityId = modelCommand.id;
        const job = modelCommand.geometry.job;
        if (!("backend" in job))
          throw Error(
            "This modeling job is unsupported. Request a browser-manifold recipe instead.",
          );
        let recipe: BrowserModelRecipe;
        let authoring:
          | {
              source: ReturnType<typeof canonicalBrowserProceduralSource>;
              sourceHash: string;
            }
          | undefined;
        if (job.backend === "browser-procedural") {
          const source = canonicalBrowserProceduralSource(job.source);
          const sourceHash = await hashBrowserProceduralSource(source);
          recipe = await evaluateBrowserProceduralInWorker(source, { signal });
          if (signal.aborted || active !== controller) return false;
          authoring = { source, sourceHash };
        } else {
          recipe = job.recipe;
        }
        const model = await buildBrowserModel(recipe, {
          signal,
          color:
            s.project.entities.find((entity) => entity.id === entityId)
              ?.color ?? "#6ead60",
        });
        if (signal.aborted || active !== controller) return false;
        command = commandSchema.parse({
          ...modelCommand,
          geometry: {
            ...modelCommand.geometry,
            job:
              authoring === undefined
                ? { backend: "browser-manifold", recipe }
                : {
                    backend: "browser-manifold",
                    recipe,
                    authoring,
                  },
            model,
          },
        });
        s = getState();
      } else command = commandSchema.parse(modelCommand);
      const envelope = {
        version: 1 as const,
        projectId: s.project.id,
        runId: cursor.runId,
        sequence: cursor.sequence + 1,
        operationId: crypto.randomUUID(),
        baseRevision: s.project.revision,
        command,
      };
      const result = applyOperation(s.project, envelope, cursor);
      if (journal && durableRun) {
        if (!journalCurrent()) return false;
        if (
          command.type === "set_geometry" &&
          command.geometry.kind === "generated" &&
          !(await uploadCloudGeneratedModels(result.project, journalCurrent))
        )
          return false;
        const acknowledged = await appendCloudGenerationOperation(
          envelope,
          signal,
        );
        if (!journalCurrent()) return false;
        if (
          JSON.stringify(acknowledged.checkpoint) !==
          JSON.stringify(projectSchema.parse(result.project))
        )
          throw Error(
            "The cloud checkpoint differs from this update. Recover it before continuing.",
          );
        durableRun = acknowledged;
      }
      // Keep the newest finished shape if a later operation is interrupted.
      baseline = committed(result.project, baseline);
      cursor = result.cursor;
      lastAppliedCommand = command.type;
      const updatedId =
        command.type === "reserve_entity"
          ? command.entity.id
          : command.type === "set_geometry" ||
              command.type === "set_material" ||
              command.type === "set_transform" ||
              command.type === "set_behavior"
            ? command.id
            : undefined;
      const updatedEntity = updatedId
        ? result.project.entities.find((entity) => entity.id === updatedId)
        : undefined;
      if (updatedEntity)
        noteSceneUpdate(project.id, updatedEntity, experienceToken);
      if (
        command.type === "set_group_transform" ||
        command.type === "set_parent"
      ) {
        // Parent edits redraw stable child entities without replacing geometry.
        const groups = new Map(
          (result.project.groups ?? []).map((group) => [group.id, group]),
        );
        for (const entity of result.project.entities) {
          let parentId = entity.parentId;
          let affected = entity.id === command.id;
          for (let depth = 0; parentId && depth < 32; depth++) {
            if (parentId === command.id) {
              affected = true;
              break;
            }
            parentId = groups.get(parentId)?.parentId;
          }
          if (affected) noteSceneUpdate(project.id, entity, experienceToken);
        }
      }
      setState({ project: result.project });
      if (command.type === "reserve_entity")
        noteReservation(project.id, command.entity.id, experienceToken);
      const checkpoint =
        (command.type === "set_geometry" &&
          command.geometry.detail === "refined") ||
        command.type === "set_material" ||
        command.type === "set_transform" ||
        command.type === "set_behavior" ||
        command.type === "set_game" ||
        command.type === "set_environment" ||
        command.type === "remove_entity" ||
        command.type === "create_group" ||
        command.type === "set_group_transform" ||
        command.type === "remove_group" ||
        command.type === "set_parent" ||
        command.type === "commit_revision";
      if (checkpoint) await getState().save();
      return !signal.aborted && active === controller;
    };
    try {
      await getState().save();
      if (signal.aborted || active !== controller) return;
      if (journal) {
        if (!journalCurrent()) return;
        durableRun = await journal.begin(
          project,
          cursor.runId,
          prompt,
          selected,
        );
        if (!journalCurrent()) {
          cancelDurable();
          return;
        }
      }
      {
        const request = generationRequest(connection, {
          prompt,
          project,
          selected,
          localModeling: false,
          browserModeling: browserModelingAvailable(),
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
        markExperience(project.id, "generationComplete", experienceToken);
        finishRunExperience("success");
        setState({
          building: false,
          notice:
            getState().ruleRestartCount !== ruleRestartsBeforeGeneration
              ? GAME_RULES_RESTART_NOTICE
              : "Your world is saved on this device.",
        });
        await getState().save();
      }
    } catch (error) {
      if (active === controller && !signal.aborted) {
        finishRunExperience("error");
        setState({
          building: false,
          project: committed(getState().project, baseline),
          error: signal.aborted
            ? ""
            : error instanceof ZodError
              ? "The model returned an invalid scene change. Try a simpler edit. Your finished world is safe."
              : error instanceof Error
                ? error.message
                : "Something went wrong. Your finished world is safe.",
        });
        await getState().save();
      }
    } finally {
      signal.removeEventListener("abort", cancelDurable);
      if (durableRun?.state === "running") cancelDurable();
      if (active === controller) {
        finishRunExperience("cancelled");
        active = undefined;
        setState({ building: false });
      }
    }
  },
}));
