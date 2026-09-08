"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  Download,
  Globe2,
  Leaf,
  LoaderCircle,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Undo2,
  X,
  Link2,
  MousePointer2,
  Sun,
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  Mic,
  MicOff,
} from "lucide-react";
import { useDictation } from "@/lib/use-dictation";
import { modelModes, type CatalogModel } from "@/lib/model-modes";
import { modelRankingMetadata } from "@/lib/model-rankings";
import {
  scopedValue,
  createProjectScope,
  readPublication,
  type ProjectValue,
  type Publication,
} from "@/lib/project-state";
import { useOrb } from "@/lib/store";
import { recoveredGenerationInput } from "@/lib/generation-journal";
import {
  latestCloudGenerationRun,
  settleCloudGenerationRecovery,
  startCloudGenerationRun,
} from "@/lib/cloud-generation-journal";
import { uploadCloudGeneratedModels } from "@/lib/cloud-generated-models";
import {
  checkModelingConnection,
  readModelingLink,
  type ModelingConnection,
} from "@/lib/modeling-connection";
import {
  readCompanionLink,
  type GenerationConnection,
} from "@/lib/generation-connection";
import { committed } from "@/lib/protocol";
import { exportWorld, shareWorld, decodeWorld } from "@/lib/export";
const World = dynamic(() => import("./world"), {
  ssr: false,
  loading: () => (
    <div className="world-loading">
      <span className="loading-orb" />
    </div>
  ),
});
type Connection = GenerationConnection;
const tokenPrice = (value: number | null | undefined) =>
  value == null
    ? "—"
    : `$${value.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
const terminalPublicationStates = new Set([
  "READY",
  "ERROR",
  "CANCELED",
  "PROTECTED",
]);
type CloudProject = {
  snapshotToken: string;
  id: string;
  title: string;
  revision: number;
  snapshot: ReturnType<typeof useOrb.getState>["project"];
  updated_at: string;
  public_url?: string | null;
  publication_revision?: number | null;
};
export default function Orbsie() {
  const s = useOrb();
  const [prompt, setPrompt] = useState("");
  const dictation = useDictation(prompt, setPrompt, (message) =>
    s.set({ error: message }),
  );
  const [modal, setModal] = useState<"settings" | "share" | "account" | null>(
    null,
  );
  const [connection, setConnectionState] = useState<Connection>({
    provider: "openrouter",
    model: "",
    key: "",
  });
  const [builderLink, setBuilderLink] = useState("");
  const [builderConnecting, setBuilderConnecting] = useState(false);
  const builderVersion = useRef(0);
  const pendingBuilder = useRef<ModelingConnection | null>(null);
  async function connectBuilder(
    link: ModelingConnection,
    signal?: AbortSignal,
  ) {
    const version = ++builderVersion.current;
    setBuilderConnecting(true);
    try {
      await checkModelingConnection(link, signal);
      if (signal?.aborted || version !== builderVersion.current) return;
      pendingBuilder.current = null;
      setBuilderLink("");
      s.set({
        modelingConnection: link,
        notice: "Local Blender is connected.",
        error: "",
      });
    } catch {
      if (!signal?.aborted && version === builderVersion.current) {
        pendingBuilder.current = null;
        const message =
          "Could not connect to local Blender. Keep the companion running and use its new connection link.";
        s.set({ error: message });
        setModalError(message);
      }
    } finally {
      if (!signal?.aborted && version === builderVersion.current)
        setBuilderConnecting(false);
    }
  }
  const connectionVersion = useRef(0);
  const setConnection = (next: Parameters<typeof setConnectionState>[0]) => {
    connectionVersion.current++;
    setConnectionState(next);
  };
  const [trial, setTrial] = useState({ enabled: false, remaining: 0 });
  const refreshTrial = async () => {
    try {
      const response = await fetch("/api/trial", { cache: "no-store" });
      if (!response.ok) throw Error("Allowance unavailable");
      const data = await response.json();
      const next = {
        enabled: data.enabled === true,
        remaining: Number.isInteger(data.remaining)
          ? Math.max(0, data.remaining)
          : 0,
      };
      setTrial(next);
      return next;
    } catch {
      setTrial({ enabled: false, remaining: 0 });
      return { enabled: false, remaining: 0 };
    }
  };
  const pendingCompanion = useRef<ReturnType<typeof readCompanionLink>>(null);
  const [sheet, setSheet] = useState(true);
  const [shareUrl, setShareUrl] = useState("");
  const [modalError, setModalError] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const visibleModels = models.filter((model) =>
    `${model.name} ${model.id}`
      .toLowerCase()
      .includes(modelSearch.trim().toLowerCase()),
  );
  const [capabilities, setCapabilities] = useState({
    accounts: false,
    publishing: false,
    google: false,
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [signup, setSignup] = useState(false);
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [cloudBaseline, setCloudBaseline] = useState<ProjectValue<{
    revision: number;
    snapshotToken: string;
  }> | null>(null);
  const cloudVersion = scopedValue(cloudBaseline, s.project.id);
  const cloudRevision = cloudVersion?.revision ?? null;
  const [cloudProjects, setCloudProjects] = useState<CloudProject[]>([]);
  const [conflict, setConflict] = useState<CloudProject | null>(null);
  const [publicationRecord, setPublicationRecord] =
    useState<ProjectValue<Publication> | null>(null);
  const publication = scopedValue(publicationRecord, s.project.id);
  const publicationNeedsPolling =
    publication != null && !terminalPublicationStates.has(publication.state);
  const projectScope = useRef(createProjectScope(s.project.id));
  const accountGeneration = useRef(0);
  const captureCloudRequest = () => {
    const inProject = projectScope.current.capture();
    const generation = accountGeneration.current;
    return () => inProject() && generation === accountGeneration.current;
  };
  const clearAccountState = () => {
    connectionVersion.current++;
    accountGeneration.current++;
    setCloudBaseline(null);
    setCloudProjects([]);
    setConflict(null);
    setPublicationRecord(null);
    setShareUrl("");
    setModalError("");
  };
  useEffect(
    () =>
      useOrb.subscribe((state) => {
        if (projectScope.current.select(state.project.id)) {
          setCloudBaseline(null);
          setPublicationRecord(null);
          setConflict(null);
          setShareUrl("");
          setModalError("");
          setBusy(false);
        }
      }),
    [],
  );
  const [objectList, setObjectList] = useState(false);
  const [publicView, setPublicView] = useState(false);
  const chat = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const landing = s.phase === "landing";
  const selected = s.project.entities.find((e) => e.id === s.selected);
  const total = s.project.entities.filter(
    (e) => e.stage === "ready" && e.behavior?.type === "collect",
  ).length;
  const collected = s.project.entities.filter(
    (e) =>
      e.stage === "ready" &&
      e.behavior?.type === "collect" &&
      s.score.includes(e.id),
  ).length;
  const refreshCloud = async () => {
    const isCurrent = captureCloudRequest();
    const projectId = useOrb.getState().project.id;
    const response = await fetch("/api/projects");
    if (!response.ok) return;
    const data = await response.json();
    if (!isCurrent()) return;
    setCloudProjects(data.projects ?? []);
    const current = data.projects?.find(
      (project: CloudProject) => project.id === useOrb.getState().project.id,
    );
    if (
      current &&
      JSON.stringify(current.snapshot) ===
        JSON.stringify(committed(useOrb.getState().project))
    )
      setCloudBaseline({
        projectId,
        value: {
          revision: current.revision,
          snapshotToken: current.snapshotToken,
        },
      });
    else setCloudBaseline(null);
  };
  useEffect(() => {
    const companionController = new AbortController();
    const connectingVersion = connectionVersion.current;
    try {
      const builder = pendingBuilder.current ?? readModelingLink(location.hash);
      if (builder) {
        pendingBuilder.current = builder;
        history.replaceState(null, "", location.pathname + location.search);
        void connectBuilder(builder, companionController.signal);
      }
    } catch {
      history.replaceState(null, "", location.pathname + location.search);
      s.set({
        error:
          "This Blender connection link is invalid. Open a new link from the companion.",
      });
    }
    try {
      const link = pendingCompanion.current ?? readCompanionLink(location.hash);
      if (link) {
        pendingCompanion.current = link;
        history.replaceState(null, "", location.pathname + location.search);
        void fetch(`${link.url}/health`, {
          headers: { Authorization: `Bearer ${link.token}` },
          credentials: "omit",
          mode: "cors",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.any([
            companionController.signal,
            AbortSignal.timeout(8000),
          ]),
        })
          .then(async (response) => {
            if (!response.ok) throw Error();
            const health = await response.json();
            if (
              health.protocolVersion !== 1 ||
              health.effort !== "low" ||
              typeof health.model !== "string" ||
              health.model.length > 150 ||
              !["ready", "busy"].includes(health.status)
            )
              throw Error();
            if (companionController.signal.aborted) return;
            if (connectionVersion.current !== connectingVersion) {
              pendingCompanion.current = null;
              return;
            }
            pendingCompanion.current = null;
            setConnection({
              provider: "chatgpt-local",
              model: health.model,
              key: link.token,
              url: link.url,
            });
            s.set({ notice: "ChatGPT is connected on this computer." });
          })
          .catch(() => {
            if (
              !companionController.signal.aborted &&
              connectionVersion.current === connectingVersion
            ) {
              pendingCompanion.current = null;
              s.set({
                error:
                  "Could not connect to local ChatGPT. Keep the companion running and open its new connection link.",
              });
            }
          });
      }
    } catch {
      history.replaceState(null, "", location.pathname + location.search);
      s.set({
        error:
          "This local ChatGPT connection link is invalid. Open a new link from the companion.",
      });
    }
    void refreshTrial();
    const initialAccountGeneration = accountGeneration.current;
    if (location.hash.startsWith("#orb=")) {
      try {
        const project = decodeWorld(location.hash.slice(5));
        s.load(project, true);
        s.set({ readOnly: true });
        setPublicView(true);
      } catch {
        s.set({ error: "This shared world could not be opened." });
      }
    } else void s.recover();
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => {
        setCapabilities(c);
        if (
          c.accounts &&
          initialAccountGeneration === accountGeneration.current
        )
          fetch("/api/auth/get-session")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (
                d?.user &&
                initialAccountGeneration === accountGeneration.current
              ) {
                setUser(d.user);
                void refreshCloud();
              }
            })
            .catch(() => {});
      })
      .catch(() => {});
    return () => companionController.abort();
  }, []);
  useEffect(() => {
    chat.current?.scrollTo({
      top: chat.current.scrollHeight,
      behavior: "smooth",
    });
  }, [s.project.messages.length]);
  useEffect(() => {
    if (modal) {
      dialog.current?.showModal();
      setModalError("");
    } else dialog.current?.close();
  }, [modal]);
  useEffect(() => {
    if (
      !modal ||
      modal !== "settings" ||
      connection.provider === "chatgpt-local"
    )
      return;
    const controller = new AbortController();
    setModels([]);
    setModelSearch("");
    fetch(`/api/models?provider=${connection.provider}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error);
        return data;
      })
      .then((d) => {
        if (controller.signal.aborted) return;
        setModels(d.models ?? []);
        setConnection((current) => ({
          ...current,
          model:
            current.model ||
            (d.models?.some(
              (model: { id: string }) => model.id === modelModes[1].id,
            )
              ? modelModes[1].id
              : ""),
        }));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setModalError(
            "The model catalog is unavailable. Please reopen settings to retry.",
          );
      });
    return () => controller.abort();
  }, [modal, connection.provider]);
  useEffect(() => {
    if (
      !user ||
      !capabilities.publishing ||
      (modal !== "share" && !publicationNeedsPolling)
    )
      return;
    const projectId = s.project.id;
    const inProject = captureCloudRequest();
    let cancelled = false;
    const isCurrent = () => !cancelled && inProject();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      const response = await fetch(
        `/api/publish?projectId=${encodeURIComponent(s.project.id)}`,
      );
      const data = await readPublication(response, isCurrent);
      if (data === undefined) return;
      setPublicationRecord(data ? { projectId, value: data } : null);
      if (!data) return;
      if (!terminalPublicationStates.has(data.state))
        timer = setTimeout(() => void poll(), 2500);
    };
    const poll = () =>
      check().catch(() => {
        if (isCurrent() && modal === "share")
          setModalError("Publication status could not be loaded.");
        if (isCurrent() && publicationNeedsPolling)
          timer = setTimeout(() => void poll(), 2500);
      });
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    modal,
    user,
    capabilities.publishing,
    s.project.id,
    publicationNeedsPolling,
    publication?.state,
  ]);
  useEffect(() => {
    dictation.cancel();
  }, [modal, s.phase, s.selected, s.playing, dictation.cancel]);
  const submission = useRef({ checking: false, sequence: 0 });
  const submit = async (e?: FormEvent, text = prompt) => {
    e?.preventDefault();
    if (submission.current.checking) return;
    dictation.cancel();
    const instruction = text.trim();
    if (!instruction) return;
    submission.current.checking = true;
    const sequence = ++submission.current.sequence;
    const originalWorld = captureCloudRequest();
    const selectedConnectionVersion = connectionVersion.current;
    try {
      let selectedConnection = connection;
      if (!connection.key.trim() || !connection.model) {
        const allowance = await refreshTrial();
        if (
          !originalWorld() ||
          textarea.current?.value !== text ||
          connectionVersion.current !== selectedConnectionVersion
        )
          return;
        if (!allowance.enabled || allowance.remaining < 1) {
          setModal(user || !capabilities.accounts ? "settings" : "account");
          return;
        }
        selectedConnection = { provider: "free", model: "", key: "" };
      }
      setPrompt("");
      const accountVersion = accountGeneration.current;
      const originProjectId = s.project.id;
      const journal = user
        ? {
            isCurrent: () => accountGeneration.current === accountVersion,
            begin: async (
              project: typeof s.project,
              runId: string,
              intent: string,
              selected?: string,
            ) => {
              const current = () =>
                accountGeneration.current === accountVersion &&
                useOrb.getState().project.id === project.id;
              if (
                !current() ||
                !(await uploadCloudGeneratedModels(project, current))
              )
                throw Error(
                  "Generation account changed before cloud recovery could start.",
                );
              const response = await fetch("/api/projects", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  project,
                  baseRevision:
                    project.id === originProjectId ? cloudRevision : null,
                  baseSnapshotToken:
                    project.id === originProjectId
                      ? (cloudVersion?.snapshotToken ?? null)
                      : null,
                }),
              });
              const result = await response.json();
              if (!current())
                throw Error(
                  "Generation account changed before cloud recovery could start.",
                );
              if (!response.ok) {
                if (response.status === 409 && result.conflict)
                  setConflict(result.conflict);
                throw Error(
                  result.error ??
                    "Cloud recovery could not save the starting world.",
                );
              }
              setCloudBaseline({
                projectId: project.id,
                value: {
                  revision: result.revision,
                  snapshotToken: result.snapshotToken,
                },
              });
              const run = await startCloudGenerationRun({
                project,
                runId,
                prompt: intent,
                selected,
              });
              if (!current())
                throw Error(
                  "Generation account changed before cloud recovery could start.",
                );
              return run;
            },
          }
        : undefined;
      const generation = s.run(instruction, selectedConnection, journal);
      const generationWorld = captureCloudRequest();
      submission.current.checking = false;
      await generation;
      const quotaExceeded =
        useOrb.getState().generationErrorCode === "FREE_LIMIT_REACHED";
      if (selectedConnection.provider === "free") {
        await refreshTrial();
        if (
          quotaExceeded &&
          generationWorld() &&
          connectionVersion.current === selectedConnectionVersion &&
          submission.current.sequence === sequence &&
          !textarea.current?.value
        ) {
          setPrompt(instruction);
          setModal(user || !capabilities.accounts ? "settings" : "account");
        }
      }
    } finally {
      if (submission.current.sequence === sequence)
        submission.current.checking = false;
    }
  };
  const reset = () =>
    s.set({
      score: [],
      gameScore: 0,
      won: false,
      lost: false,
      reset: s.reset + 1,
    });
  const download = async () => {
    setBusy(true);
    try {
      await exportWorld(s.project);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    setBusy(true);
    setShareUrl("");
    try {
      const url = shareWorld(s.project);
      setShareUrl(url);
      await navigator.clipboard.writeText(url);
      s.set({ notice: "Play link copied." });
    } catch (error) {
      setModalError(
        error instanceof Error
          ? error.message
          : "Could not copy the play link. Use the displayed link or download the world.",
      );
    } finally {
      setBusy(false);
    }
  };
  const recoverGeneration = async () => {
    const isCurrent = captureCloudRequest();
    const projectId = s.project.id;
    setBusy(true);
    setModalError("");
    try {
      let run = await latestCloudGenerationRun(projectId);
      const response = await fetch(
        `/api/projects?id=${encodeURIComponent(projectId)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!isCurrent()) return;
      if (!response.ok)
        throw Error(data.error ?? "Cloud world is unavailable.");
      if (
        !run.cloudBaselineCurrent ||
        data.project.revision !== run.baseRevision
      )
        throw Error(
          "A newer cloud save exists. Open that version before recovering generation.",
        );
      if (useOrb.getState().project.revision > run.checkpoint.revision)
        throw Error(
          "Your local world is newer than this checkpoint. Export or save it before opening an older recovery.",
        );
      run = await settleCloudGenerationRecovery(run);
      if (useOrb.getState().project.revision > run.checkpoint.revision)
        throw Error(
          "Your local world is newer than this checkpoint. Export or save it before opening an older recovery.",
        );
      if (!isCurrent()) return;
      const recovered = committed(run.checkpoint);
      if (
        !(await useOrb.getState().loadCloud(recovered, isCurrent, isCurrent))
      ) {
        if (isCurrent())
          throw Error(
            "Your local world changed during recovery. Try again after saving your edits.",
          );
        return;
      }
      if (!isCurrent()) return;
      setCloudBaseline({
        projectId,
        value: {
          revision: data.project.revision,
          snapshotToken: data.project.snapshotToken,
        },
      });
      setModal(null);
      const recoveryInput = recoveredGenerationInput(run);
      setPrompt(recoveryInput.prompt);
      useOrb.getState().set({
        selected: recoveryInput.selected,
        notice:
          run.state === "complete"
            ? "Recovered the completed generation. Save it to your account when ready."
            : "Recovered finished work. Send the continuation to start a new generation request.",
      });
    } catch (error) {
      if (isCurrent())
        setModalError(
          error instanceof Error
            ? error.message
            : "Could not recover generation.",
        );
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };
  const cloudSave = async () => {
    const projectId = s.project.id;
    const isCurrent = captureCloudRequest();
    setBusy(true);
    try {
      if (!(await uploadCloudGeneratedModels(s.project, isCurrent))) return;
      const response = await fetch("/api/projects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: s.project,
          baseRevision: cloudRevision,
          baseSnapshotToken: cloudVersion?.snapshotToken ?? null,
        }),
      });
      const data = await response.json();
      if (!isCurrent()) return;
      if (response.status === 409 && data.conflict) {
        setConflict(data.conflict);
        throw Error(data.error);
      }
      if (!response.ok) throw Error(data.error);
      setCloudBaseline({
        projectId,
        value: { revision: data.revision, snapshotToken: data.snapshotToken },
      });
      setConflict(null);
      await refreshCloud();
      if (!isCurrent()) return;
      s.set({
        notice: data.archivePending
          ? "Saved to your account. The backup archive will be retried later."
          : "Saved to your account.",
      });
    } catch (e) {
      if (isCurrent())
        s.set({ error: e instanceof Error ? e.message : "Cloud save failed." });
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };
  const publish = async () => {
    const projectId = s.project.id;
    const isCurrent = captureCloudRequest();
    setBusy(true);
    setModalError("");
    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: s.project.id,
          revision: s.project.revision,
        }),
      });
      const data = await response.json();
      if (!isCurrent()) return;
      if (!response.ok) throw Error(data.error);
      setShareUrl(data.url);
      setPublicationRecord({ projectId, value: data });
      setModalError("Deployment submitted. This status will update here.");
    } catch (e) {
      if (isCurrent())
        setModalError(e instanceof Error ? e.message : "Publishing failed.");
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };
  const authenticate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setModalError("");
    try {
      const response = await fetch(
        `/api/auth/${signup ? "sign-up" : "sign-in"}/email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            ...(signup ? { name } : {}),
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.message ?? "Sign-in failed.");
      clearAccountState();
      setUser(data.user);
      await refreshCloud();
      setPassword("");
      setModal(null);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main
      className={`app ${landing ? "is-landing" : "is-workspace"} ${publicView ? "is-public" : ""} ${sheet ? "sheet-open" : "sheet-closed"}`}
    >
      <div className="sky-texture" aria-hidden="true" />
      <div className="cosmic-backdrop" aria-hidden="true" />
      <div className="scene">
        <World />
      </div>
      {landing && (
        <div className="orbital-lines" aria-hidden="true">
          <i />
          <i />
        </div>
      )}
      <header className="topbar">
        <button
          className="wordmark"
          aria-label="Orbsie home"
          onClick={() => {
            if (s.building) s.stop();
            s.set({ phase: "landing", playing: false, readOnly: false });
            setPublicView(false);
            history.replaceState(null, "", location.pathname);
          }}
        >
          <span className="brand-orb" />
        </button>
        <div className="header-actions">
          {!landing && !publicView && (
            <>
              <span className="saved">
                <span />
                {s.saved ? "Saved on this device" : "Local draft"}
              </span>
              <button
                className="icon-button"
                aria-label="Connections"
                onClick={() => setModal("settings")}
              >
                <Settings2 size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Your account and cloud worlds"
                onClick={() => setModal("account")}
              >
                <Globe2 size={17} />
              </button>
              <button
                className="primary small"
                onClick={() => setModal("share")}
              >
                <ArrowUpRight size={16} />
                Share Orb
              </button>
            </>
          )}
          {landing && (
            <>
              <button
                className="icon-button"
                aria-label="Your worlds"
                onClick={() => setModal("account")}
              >
                <Globe2 size={19} />
              </button>
              <button
                className="icon-button"
                aria-label="Connections"
                onClick={() => setModal("settings")}
              >
                <Settings2 size={19} />
              </button>
            </>
          )}
          {publicView && (
            <a className="primary small" href="/">
              Make your own <ArrowUpRight size={15} />
            </a>
          )}
        </div>
      </header>
      <h1 className="sr-only">Create a world</h1>
      {!landing && !publicView && (
        <>
          <div className="workspace-heading">
            <button
              className="back-button"
              onClick={() => {
                s.stop();
                s.set({ phase: "landing", playing: false });
              }}
            >
              <ChevronLeft size={14} />
              Back to planet
            </button>
            <h2>{s.project.title}</h2>
          </div>
          <div className="play-toolbar">
            <button
              className={!s.playing ? "active" : ""}
              onClick={() => s.set({ playing: false })}
            >
              <MousePointer2 size={14} />
              Edit
            </button>
            <button
              className={s.playing ? "active" : ""}
              onClick={() => {
                s.set({ playing: true, selected: undefined });
                setSheet(false);
              }}
            >
              <Play size={14} fill="currentColor" />
              Play
            </button>
            <span />
            <button
              aria-label="Undo last change"
              disabled={!s.history.length || s.building}
              onClick={s.undo}
            >
              <Undo2 size={16} />
            </button>
            <button
              aria-label="Redo last change"
              disabled={!s.future.length || s.building}
              onClick={s.redo}
            >
              <Redo2 size={16} />
            </button>
          </div>
        </>
      )}
      {!publicView && (
        <section
          className={`composer-shell ${landing ? "landing-composer" : "chat-panel"}`}
          aria-label={landing ? "Create a world" : "World conversation"}
        >
          {!landing && (
            <>
              <button
                className="sheet-handle"
                onClick={() => setSheet(!sheet)}
                aria-expanded={sheet}
              >
                <span />
                <ChevronDown size={15} />
              </button>
              <div className="chat-header">
                <span className="little-spark">
                  <Sparkles size={17} />
                </span>
                <div>
                  <strong>Your world</strong>
                  <span>Your creative companion</span>
                </div>
                <button
                  className="icon-button"
                  aria-label="Show objects"
                  onClick={() => setObjectList(!objectList)}
                >
                  <Leaf size={17} />
                </button>
              </div>
              <div className="chat-messages" ref={chat}>
                {s.project.messages.map((m, i) => (
                  <div key={i} className={`message ${m.role}`}>
                    {m.role === "assistant" && (
                      <span className="assistant-icon">✧</span>
                    )}
                    <div>
                      {m.entityId && (
                        <span className="entity-chip">
                          <Leaf size={12} />
                          {s.project.entities.find((e) => e.id === m.entityId)
                            ?.label ?? "Selected object"}
                        </span>
                      )}
                      <p>{m.text}</p>
                    </div>
                  </div>
                ))}
                {s.building && (
                  <div className="building-message">
                    <span className="pulse-orb" />
                    <div>
                      Creating…
                      <span>
                        {
                          s.project.entities.filter((e) => e.stage === "ready")
                            .length
                        }{" "}
                        objects
                      </span>
                    </div>
                  </div>
                )}
                {!s.building && s.project.entities.length > 0 && (
                  <div className="suggested-edits">
                    <button
                      onClick={() => {
                        setPrompt("Make this a giant pink mushroom");
                        textarea.current?.focus();
                      }}
                    >
                      Make a giant pink mushroom <Plus size={12} />
                    </button>
                    <button
                      onClick={() => {
                        setPrompt(
                          "Make the middle platform slower and add two more crystals",
                        );
                        textarea.current?.focus();
                      }}
                    >
                      A little more adventure <Plus size={12} />
                    </button>
                  </div>
                )}
              </div>
              {objectList && (
                <div className="object-list" aria-label="Objects">
                  {s.project.entities.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => {
                        s.set({ selected: e.id, playing: false });
                        setObjectList(false);
                      }}
                    >
                      {e.label}
                      <span>{e.stage}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <form className="prompt-form" onSubmit={submit}>
            {selected && !landing && (
              <div className="selection-chip">
                <Leaf size={13} />
                {selected.label}
                <button
                  type="button"
                  aria-label="Clear selected object"
                  onClick={() => s.set({ selected: undefined })}
                >
                  <X size={13} />
                </button>
              </div>
            )}
            <label className="sr-only" htmlFor="prompt">
              {selected ? "Change this object" : "What experience to build?"}
            </label>
            <textarea
              ref={textarea}
              id="prompt"
              value={prompt}
              onChange={(e) => {
                dictation.cancel();
                setPrompt(e.target.value);
              }}
              placeholder={
                selected
                  ? "What would you like to change?"
                  : landing
                    ? "What experience to build?"
                    : "A little taller? A little more magical?"
              }
              rows={landing ? 2 : 3}
              maxLength={4000}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="composer-bottom">
              <button
                type="button"
                className="mode-button"
                onClick={() => {
                  setModal("settings");
                }}
              >
                <span className="mode-dot" />
                {connection.key && connection.model
                  ? connection.provider === "chatgpt-local"
                    ? "ChatGPT on this computer"
                    : connection.provider === "openrouter"
                      ? "OpenRouter"
                      : "AI Gateway"
                  : trial.enabled && trial.remaining > 0
                    ? `${trial.remaining} free prompts`
                    : "Connect provider"}
                <ChevronDown size={12} />
              </button>
              <div className="composer-actions">
                {dictation.listening && (
                  <span className="dictation-status" role="status">
                    Listening…
                  </span>
                )}
                <button
                  type="button"
                  className={`dictation-button ${dictation.listening ? "is-listening" : ""}`}
                  aria-label={
                    dictation.listening ? "Stop dictation" : "Dictate prompt"
                  }
                  aria-pressed={dictation.listening}
                  title={
                    dictation.supported === false
                      ? "Speech input unavailable in this browser"
                      : "Dictate using your browser’s speech service"
                  }
                  onClick={dictation.toggle}
                >
                  {dictation.listening ? (
                    <Square size={16} fill="currentColor" />
                  ) : dictation.supported === false ? (
                    <MicOff size={18} />
                  ) : (
                    <Mic size={18} />
                  )}
                </button>
                {s.building ? (
                  <button
                    type="button"
                    className="create-button"
                    onClick={s.stop}
                  >
                    <Square size={13} />
                    Stop
                  </button>
                ) : (
                  <button
                    className="create-button"
                    type="submit"
                    disabled={!prompt.trim()}
                  >
                    {landing ? "Create" : "Change this"}
                    <ArrowUp size={16} />
                  </button>
                )}
              </div>
            </div>
          </form>
          {!landing && (
            <div className="panel-foot">
              <span className="mode-dot" />
              {connection.key
                ? "AI connected"
                : trial.enabled && trial.remaining > 0
                  ? `${trial.remaining} free prompts left`
                  : "Connect to keep creating"}
            </div>
          )}
        </section>
      )}
      {landing && (
        <>
          {s.recovered && (
            <button
              className="resume-pill"
              aria-label="Continue your saved world"
              onClick={() => s.load(s.recovered!)}
            >
              <RotateCcw size={14} />
              Resume <ArrowUpRight size={14} />
            </button>
          )}
        </>
      )}
      {!landing && (
        <>
          <div className="scene-caption">
            <Sun size={15} />
            {s.phase === "descending"
              ? "Finding a place for your imagination…"
              : s.playing
                ? "Your world. Your little adventure."
                : "Click an object to make it your own."}
          </div>
          {s.playing && (
            <>
              <div className="game-hud">
                <span className="crystal-symbol">◆</span>
                <strong>
                  {s.project.game ? (
                    s.gameScore
                  ) : (
                    <>
                      {collected} <span>/ {total}</span>
                    </>
                  )}
                </strong>
                <span>
                  {s.project.game
                    ? "Score"
                    : total
                      ? "Crystals collected"
                      : "Explore your garden"}
                </span>
                <button
                  className="icon-button"
                  aria-label="Restart game"
                  onClick={reset}
                >
                  <RotateCcw size={16} />
                </button>
              </div>
              <div className="keyboard-hint">
                <kbd>W</kbd>
                <kbd>A</kbd>
                <kbd>S</kbd>
                <kbd>D</kbd> Move <span>·</span>
                <kbd>space</kbd> Jump
              </div>
              <div className="touch-controls">
                {[
                  { key: "w", icon: ArrowUp },
                  { key: "a", icon: ArrowLeft },
                  { key: "s", icon: ArrowDown },
                  { key: "d", icon: ArrowRight },
                  { key: " ", icon: ArrowUpRight },
                ].map(({ key, icon: Icon }) => (
                  <button
                    key={key}
                    aria-label={key === " " ? "Jump" : `Move ${key}`}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      window.dispatchEvent(
                        new CustomEvent("orbsie-input", {
                          detail: { key, down: true },
                        }),
                      );
                    }}
                    onPointerUp={() =>
                      window.dispatchEvent(
                        new CustomEvent("orbsie-input", {
                          detail: { key, down: false },
                        }),
                      )
                    }
                    onPointerCancel={() =>
                      window.dispatchEvent(
                        new CustomEvent("orbsie-input", {
                          detail: { key, down: false },
                        }),
                      )
                    }
                  >
                    <Icon size={21} />
                  </button>
                ))}
              </div>
            </>
          )}
          {(s.won || s.lost) && (
            <div className="win-card">
              <span>✧</span>
              <h2>{s.lost ? "Try another adventure" : "Adventure complete"}</h2>
              <p>
                {s.project.game
                  ? `Final score: ${s.gameScore}`
                  : "You found every crystal and made it home."}
              </p>
              <button className="primary" onClick={reset}>
                <RotateCcw size={15} />
                One more adventure
              </button>
            </div>
          )}
        </>
      )}
      {(s.error || s.notice) && (
        <div className={`toast ${s.error ? "error" : ""}`} role="status">
          {s.error || s.notice}
          <button
            aria-label="Dismiss message"
            onClick={() => s.set({ error: "", notice: "" })}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className="modal"
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setModal(null);
        }}
      >
        <div className="modal-inner">
          <button
            className="modal-close icon-button"
            aria-label="Close dialog"
            onClick={() => setModal(null)}
          >
            <X size={19} />
          </button>
          {modal === "settings" && (
            <>
              <span className="modal-symbol">
                <Sparkles />
              </span>
              <h2>A little creative power</h2>
              <p>
                {connection.provider === "chatgpt-local"
                  ? "Your ChatGPT account is connected through the companion on this computer."
                  : "Connect your API key to create and edit your world."}
              </p>
              <p className="fine-print">
                {s.modelingConnection
                  ? "Blender is ready to build models on this computer."
                  : "For local Blender modeling, start the companion and connect its private link. Your world renders on this device."}
              </p>
              {s.modelingConnection ? (
                <button
                  className="secondary full"
                  onClick={() => {
                    builderVersion.current++;
                    pendingBuilder.current = null;
                    s.stop();
                    s.set({
                      modelingConnection: undefined,
                      notice: "Local Blender disconnected.",
                    });
                  }}
                >
                  Disconnect local Blender
                </button>
              ) : (
                <>
                  <label>
                    Local Blender connection link
                    <input
                      type="password"
                      autoComplete="off"
                      value={builderLink}
                      onChange={(event) => setBuilderLink(event.target.value)}
                      placeholder="Paste the companion link"
                    />
                  </label>
                  <button
                    className="secondary full"
                    disabled={builderConnecting || !builderLink.trim()}
                    onClick={() => {
                      try {
                        const link = readModelingLink(
                          new URL(builderLink.trim()).hash,
                        );
                        if (!link) throw Error();
                        void connectBuilder(link);
                      } catch {
                        s.set({
                          error:
                            "Paste the complete connection link from the local Blender companion.",
                        });
                      }
                    }}
                  >
                    {builderConnecting
                      ? "Connecting Blender…"
                      : "Connect local Blender"}
                  </button>
                </>
              )}
              {trial.enabled && trial.remaining > 0 && (
                <button
                  className="primary full"
                  onClick={() => {
                    setConnection({
                      provider: "openrouter",
                      model: "",
                      key: "",
                    });
                    setModal(null);
                  }}
                >
                  Use {trial.remaining} free prompts
                </button>
              )}
              {connection.provider === "chatgpt-local" ? (
                <p className="fine-print">
                  ChatGPT · {connection.model} · Low reasoning. Keep the
                  companion running. Reopen its connection link after refreshing
                  this page.
                </p>
              ) : (
                <>
                  <label>
                    Provider
                    <select
                      aria-label="Provider"
                      value={connection.provider}
                      onChange={(e) =>
                        setConnection({
                          ...connection,
                          provider: e.target.value,
                          model: "",
                          key: "",
                        })
                      }
                    >
                      <option value="openrouter">OpenRouter</option>
                      <option value="gateway">Vercel AI Gateway</option>
                    </select>
                  </label>
                  <div
                    className="model-modes"
                    role="group"
                    aria-label="Creation quality"
                  >
                    {modelModes.map((mode) => {
                      const available = models.some(
                        (model) => model.id === mode.id,
                      );
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          aria-pressed={connection.model === mode.id}
                          disabled={!available}
                          title={
                            available
                              ? mode.description
                              : "Unavailable in this provider's catalog"
                          }
                          onClick={() =>
                            setConnection({ ...connection, model: mode.id })
                          }
                        >
                          <strong>{mode.label}</strong>
                        </button>
                      );
                    })}
                  </div>
                  <details className="advanced-models">
                    <summary>Advanced</summary>
                    <p className="fine-print" id="model-ranking-note">
                      Estimated 3D suitability, highest first. Ranking is a
                      guide for Orbsie; unranked models lack comparable 3D
                      evidence.{" "}
                      <a
                        className="model-ranking-source"
                        href={modelRankingMetadata.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ranking source
                      </a>{" "}
                      · {modelRankingMetadata.snapshotDate}
                    </p>
                    <label>
                      Find a model
                      <input
                        type="search"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="Search models"
                      />
                    </label>
                    <p className="fine-print" id="model-pricing-note">
                      Estimated USD / 1M tokens. — means unavailable. Actual
                      provider charges can vary.
                    </p>
                    <div className="model-catalog-heading" aria-hidden="true">
                      <span>Model</span>
                      <span>Input</span>
                      <span>Cached input</span>
                      <span>Output</span>
                    </div>
                    <div
                      className="model-catalog"
                      role="group"
                      aria-label="Advanced models"
                      aria-describedby="model-ranking-note model-pricing-note"
                    >
                      {visibleModels.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          className="model-catalog-row"
                          aria-pressed={connection.model === model.id}
                          data-model-id={model.id}
                          onClick={() =>
                            setConnection({ ...connection, model: model.id })
                          }
                        >
                          <span className="model-catalog-name">
                            <span className="model-rank">
                              {model.qualityRank == null
                                ? "—"
                                : model.qualityRank}
                            </span>
                            <span>
                              <strong>{model.name}</strong>
                              {model.qualityRank == null && (
                                <small>Unranked</small>
                              )}
                            </span>
                          </span>
                          <span className="model-token-price">
                            <span>Input</span>
                            <strong>{tokenPrice(model.inputPrice)}</strong>
                          </span>
                          <span className="model-token-price">
                            <span>Cached input</span>
                            <strong>
                              {tokenPrice(model.cachedInputPrice)}
                            </strong>
                          </span>
                          <span className="model-token-price">
                            <span>Output</span>
                            <strong>{tokenPrice(model.outputPrice)}</strong>
                          </span>
                        </button>
                      ))}
                      {models.length > 0 && visibleModels.length === 0 && (
                        <p className="fine-print" role="status">
                          No models match your search.
                        </p>
                      )}
                      {models.length === 0 && (
                        <p className="fine-print" role="status">
                          No models available yet.
                        </p>
                      )}
                    </div>
                  </details>
                  <label>
                    API key
                    <input
                      type="password"
                      autoComplete="off"
                      value={connection.key}
                      onChange={(e) =>
                        setConnection({ ...connection, key: e.target.value })
                      }
                      placeholder="Kept in memory for this tab only"
                    />
                  </label>
                  <p className="fine-print">
                    Your key is sent through Orbsie to your selected provider
                    and kept only in this tab. Your world saves on this device.
                    Sign in when you're ready to publish.
                  </p>
                </>
              )}
              <button
                className="primary full"
                disabled={!connection.key.trim() || !connection.model}
                onClick={() => setModal(null)}
              >
                Continue with this connection
                <ArrowUpRight size={16} />
              </button>
              {connection.key && (
                <button
                  className="text-button"
                  onClick={() => {
                    s.stop();
                    setConnection({
                      provider: "openrouter",
                      model: "",
                      key: "",
                    });
                  }}
                >
                  Disconnect and clear key
                </button>
              )}
              <p className="fine-print">
                Use ChatGPT on this computer with the local companion: run{" "}
                <code>node scripts/run-chatgpt-companion.mjs</code> from your
                Orbsie checkout and open the connection link it prints. Your
                ChatGPT sign-in stays with Codex on your computer.
              </p>
            </>
          )}
          {modal === "share" && (
            <>
              <span className="modal-symbol">
                <Globe2 />
              </span>
              <h2>Let your little world out.</h2>
              <p>
                Share this playable revision, or take your world with you as a
                standalone game.
              </p>
              <button className="share-option" onClick={share} disabled={busy}>
                <Link2 />
                <div>
                  <strong>Copy a play link</strong>
                  <span>Anyone with the link can play. No account needed.</span>
                </div>
                <ArrowUpRight size={18} />
              </button>
              {shareUrl && (
                <label>
                  Play URL
                  <input
                    readOnly
                    value={shareUrl}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
              )}
              <button
                className="share-option"
                onClick={download}
                disabled={busy}
              >
                <Download />
                <div>
                  <strong>Download your world</strong>
                  <span>
                    Independent game, source, and project data as a ZIP.
                  </span>
                </div>
                {busy ? (
                  <LoaderCircle size={18} className="spin" />
                ) : (
                  <ArrowUpRight size={18} />
                )}
              </button>
              <div className="publish-box">
                <strong>A home of its own</strong>
                <p>
                  Publish to a dedicated Vercel project with a permanent URL.
                </p>
                {!capabilities.publishing ? (
                  <span className="setup-note">
                    Dedicated publishing needs cloud storage and deployment
                    credentials. Play links and downloads work now.
                  </span>
                ) : (
                  <>
                    {publication && (
                      <div className="setup-note" role="status">
                        Publication: {publication.state.toLowerCase()}
                        {publication.error ? ` — ${publication.error}` : ""}
                      </div>
                    )}
                    {publication?.state === "READY" && publication.url ? (
                      <a className="primary full" href={publication.url}>
                        Open published Orb
                      </a>
                    ) : null}
                    {publication?.state !== "READY" ||
                    publication.servedRevision !== s.project.revision ? (
                      <button
                        className="primary full"
                        disabled={busy}
                        onClick={() =>
                          user ? void publish() : setModal("account")
                        }
                      >
                        {busy
                          ? "Publishing…"
                          : user
                            ? publication
                              ? publication.state === "READY"
                                ? "Publish updated Orb"
                                : "Retry publication"
                              : "Publish Orb"
                            : "Sign in to publish"}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </>
          )}
          {modal === "account" && (
            <>
              <span className="modal-symbol">
                <Globe2 />
              </span>
              <h2>
                {user ? `Hello, ${user.name}.` : "A home for your worlds."}
              </h2>
              <p>
                Your draft is saved on this device. An account adds cloud saving
                and ownership.
              </p>
              {s.drafts.map((draft) => (
                <button
                  key={draft.id}
                  className="share-option"
                  onClick={() => {
                    s.load(draft);
                    setModal(null);
                  }}
                >
                  <Sun />
                  <div>
                    <strong>{draft.title}</strong>
                    <span>
                      {draft.entities.length} objects · On this device
                    </span>
                  </div>
                  <ArrowUpRight size={18} />
                </button>
              ))}
              {user && cloudProjects.length > 0 && (
                <>
                  <p className="fine-print">Saved to your account</p>
                  {cloudProjects.map((cloud) => (
                    <button
                      key={`cloud-${cloud.id}`}
                      className="share-option"
                      onClick={() => {
                        const generation = accountGeneration.current;
                        const isCurrent = captureCloudRequest();
                        void s
                          .loadCloud(cloud.snapshot, isCurrent)
                          .then((opened) => {
                            if (
                              !opened ||
                              generation !== accountGeneration.current ||
                              useOrb.getState().project.id !== cloud.id
                            )
                              return;
                            setCloudBaseline({
                              projectId: cloud.id,
                              value: {
                                revision: cloud.revision,
                                snapshotToken: cloud.snapshotToken,
                              },
                            });
                            setConflict(null);
                            setModal(null);
                          })
                          .catch((error: unknown) => {
                            if (isCurrent())
                              setModalError(
                                error instanceof Error
                                  ? error.message
                                  : "Could not open the cloud world. Your current draft is retained.",
                              );
                          });
                      }}
                    >
                      <Globe2 />
                      <div>
                        <strong>{cloud.title}</strong>
                        <span>Revision {cloud.revision} · Cloud</span>
                      </div>
                      <ArrowUpRight size={18} />
                    </button>
                  ))}
                </>
              )}
              {!capabilities.accounts ? (
                <div className="setup-note">
                  Cloud accounts are not connected yet. You can create, play,
                  save locally, and export your world today.
                </div>
              ) : user ? (
                <>
                  <button
                    className="primary full"
                    disabled={busy}
                    onClick={cloudSave}
                  >
                    Save current world to cloud
                  </button>
                  <button
                    className="share-option"
                    disabled={busy || s.building}
                    onClick={() => void recoverGeneration()}
                  >
                    <RotateCcw size={18} /> Recover latest generation
                  </button>
                  {conflict && (
                    <div className="setup-note" role="alert">
                      A newer cloud copy exists at revision {conflict.revision}.
                      Your local copy remains on this device.
                      <button
                        className="text-button"
                        onClick={() => {
                          const generation = accountGeneration.current;
                          const isCurrent = captureCloudRequest();
                          void s
                            .loadCloud(conflict.snapshot, isCurrent)
                            .then((opened) => {
                              if (
                                !opened ||
                                generation !== accountGeneration.current ||
                                useOrb.getState().project.id !== conflict.id
                              )
                                return;
                              setCloudBaseline({
                                projectId: conflict.id,
                                value: {
                                  revision: conflict.revision,
                                  snapshotToken: conflict.snapshotToken,
                                },
                              });
                              setConflict(null);
                              setModal(null);
                            })
                            .catch((error: unknown) => {
                              if (isCurrent())
                                setModalError(
                                  error instanceof Error
                                    ? error.message
                                    : "Could not open the cloud world. Your current draft is retained.",
                                );
                            });
                        }}
                      >
                        Open cloud copy
                      </button>
                    </div>
                  )}
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const response = await fetch("/api/auth/sign-out", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: "{}",
                        });
                        if (!response.ok)
                          throw Error("Sign-out failed. Please try again.");
                        clearAccountState();
                        setUser(null);
                        setConnection({
                          provider: "openrouter",
                          model: "",
                          key: "",
                        });
                      } catch (e) {
                        setModalError(
                          e instanceof Error
                            ? e.message
                            : "Sign-out failed. Please try again.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <form onSubmit={authenticate}>
                  {signup && (
                    <label>
                      Your name
                      <input
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                  )}
                  <label>
                    Email
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={
                        signup ? "new-password" : "current-password"
                      }
                    />
                  </label>
                  <button className="primary full" disabled={busy}>
                    {signup ? "Create account" : "Sign in"}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setSignup(!signup)}
                  >
                    {signup
                      ? "Already have an account? Sign in"
                      : "New here? Create an account"}
                  </button>
                </form>
              )}
            </>
          )}
          {modalError && (
            <div className="setup-note" role="alert">
              {modalError}
            </div>
          )}
        </div>
      </dialog>
    </main>
  );
}
