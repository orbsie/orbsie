"use client";
import dynamic from "next/dynamic";
import { markExperience } from "@/lib/experience-metrics";
import { capturePublicationThumbnail } from "@/lib/publication-thumbnail";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
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
import {
  connectionNoticeCopy,
  noticeForGenerationCode,
} from "@/lib/connection-messages";
import { CHATGPT_STALE_CONNECTION_CODE } from "@/lib/chatgpt-connection-errors";
import { modelModesForProvider, type CatalogModel } from "@/lib/model-modes";
import { modelRankingMetadata } from "@/lib/model-rankings";
import {
  scopedValue,
  createProjectScope,
  readPublication,
  type ProjectValue,
  type Publication,
} from "@/lib/project-state";
import {
  assertCloudJournalBaseline,
  authoringReviewEligibleForConnection,
  useOrb,
} from "@/lib/store";
import {
  beginPlayerPointerInput,
  endPlayerPointerInput,
} from "@/lib/player-input";
import {
  recoveredGenerationInput,
  recoveredGenerationProject,
} from "@/lib/generation-journal";
import {
  latestCloudGenerationRun,
  settleCloudGenerationRecovery,
  startCloudGenerationRun,
} from "@/lib/cloud-generation-journal";
import { uploadCloudGeneratedModels } from "@/lib/cloud-generated-models";
import {
  isGenerationReady,
  type GenerationConnection,
} from "@/lib/generation-connection";
import { committed, projectSchema, type Project } from "@/lib/protocol";
import { createSceneBinding } from "@/lib/scene-binding";
import {
  startOpenRouterOAuth,
  consumeOpenRouterOAuthCallback,
  exchangeOpenRouterCode,
} from "@/lib/openrouter-oauth";
import {
  encodeOAuthDraft,
  decodeOAuthDraft,
  type OAuthDraft,
} from "@/lib/oauth-draft";
const OAUTH_DRAFT_KEY = "orbsie-openrouter-draft";
const OAUTH_PENDING_KEY = "orbsie-openrouter-oauth";
const OAUTH_STORAGE_MESSAGE =
  "OpenRouter sign-in needs browser storage. Enable site storage and try again.";
import { exportWorld, shareWorld, decodeWorld } from "@/lib/export";
import {
  exportGenerationDiagnostics,
  recordStartupDiagnostic,
} from "@/lib/generation-diagnostics-client";
import { parcelTransitionController } from "@/lib/parcel-transition";
import ChatGPTConnection, {
  parseChatGPTSnapshot,
  parseChatGPTModels,
  type ChatGPTModelOption,
  type ProviderSessionUser,
} from "./chatgpt-connection";
import ModelQualitySelector from "./model-quality-selector";
import {
  modelQualityOptions,
  isCurrentCatalogRequest,
  parseCatalogModels,
  selectedModelQuality,
} from "../lib/model-quality-presets";
import { GraphicsGuidance } from "./graphics-guidance";
import {
  clearChatGPTStartupPreference,
  readChatGPTStartupPreference,
  writeChatGPTStartupPreference,
  type ChatGPTStartupPreference,
} from "../lib/chatgpt-startup-preference";
import {
  restoreChatGPTStartup,
  type ChatGPTStartupRestoreResult,
} from "../lib/chatgpt-startup-restore";
import type { ChatGPTPresetLabel } from "../lib/chatgpt-model-presets";
const World = dynamic(() => import("./world"), {
  ssr: false,
  loading: () => (
    <div className="world-loading">
      <span className="loading-orb" />
    </div>
  ),
});
type Connection = GenerationConnection;
type RendererAvailability = "initializing" | "ready" | "unavailable";
type ProviderLogoKind = "chatgpt" | "openrouter" | "gateway";
type ChatGPTRestoreStatus =
  "idle" | "restoring" | "transient" | "reconnect" | "selection-required";

const providerLogoSources: Record<ProviderLogoKind, string> = {
  chatgpt: "/providers/openai.svg",
  openrouter: "/providers/openrouter.svg",
  gateway: "/providers/vercel.svg",
};

function providerLogoKind(provider: string): ProviderLogoKind | undefined {
  if (provider === "chatgpt-hosted") return "chatgpt";
  if (provider === "openrouter" || provider === "gateway") return provider;
  return undefined;
}

function parseProviderSessionUser(value: unknown): ProviderSessionUser | null {
  if (!value || typeof value !== "object") return null;
  const user = value as Record<string, unknown>;
  if (
    typeof user.id !== "string" ||
    user.id.length === 0 ||
    typeof user.name !== "string" ||
    typeof user.isAnonymous !== "boolean"
  )
    return null;
  return {
    id: user.id,
    name: user.name,
    isAnonymous: user.isAnonymous,
  };
}

function ProviderLogo({
  provider,
  className = "",
}: {
  provider: ProviderLogoKind;
  className?: string;
}) {
  return (
    <img
      className={`provider-logo ${className}`.trim()}
      src={providerLogoSources[provider]}
      alt=""
      aria-hidden="true"
      width={20}
      height={20}
      draggable={false}
    />
  );
}

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
type CloudBaseline = { revision: number; snapshotToken: string };

function canonicalizeSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeSnapshot);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeSnapshot(entry)]),
    );
  return value;
}

function sameSnapshot(left: unknown, right: unknown) {
  return (
    JSON.stringify(canonicalizeSnapshot(left)) ===
    JSON.stringify(canonicalizeSnapshot(right))
  );
}

export default function Orbsie() {
  const s = useOrb();
  const [prompt, setPrompt] = useState("");
  const [rendererAvailability, setRendererAvailability] =
    useState<RendererAvailability>("initializing");
  const [rendererMode, setRendererMode] = useState<
    "webgl" | "software" | "unknown"
  >("unknown");
  const [graphicsError, setGraphicsError] = useState("");
  const [graphicsAdvisory, setGraphicsAdvisory] = useState(false);
  const [graphicsHelpVisible, setGraphicsHelpVisible] = useState(false);
  const [rendererRetryToken, setRendererRetryToken] = useState(0);
  const rendererAvailabilityRef = useRef<RendererAvailability>("initializing");
  const submittedPrompt = useRef<string | null>(null);
  const setRendererState = useCallback((next: RendererAvailability) => {
    rendererAvailabilityRef.current = next;
    setRendererAvailability(next);
  }, []);
  const handleRendererReady = useCallback(
    (renderer: "webgl" | "software" = "webgl") => {
      if (rendererAvailabilityRef.current === "unavailable") return;
      setRendererMode(renderer);
      if (renderer === "webgl") {
        setGraphicsError("");
        setGraphicsAdvisory(false);
        setGraphicsHelpVisible(false);
      } else {
        setGraphicsAdvisory(true);
        setGraphicsHelpVisible(true);
      }
      setRendererState("ready");
    },
    [setRendererState],
  );
  const handleRendererFallback = useCallback((message: string) => {
    setGraphicsError(message);
    setGraphicsAdvisory(true);
    setGraphicsHelpVisible(true);
  }, []);
  const handleRendererError = useCallback(
    (message: string) => {
      const current = useOrb.getState();
      const wasBuilding = current.building;
      const interruptedPrompt = wasBuilding ? submittedPrompt.current : null;
      setRendererState("unavailable");
      setGraphicsError(message);
      setGraphicsAdvisory(false);
      setGraphicsHelpVisible(true);
      parcelTransitionController.markRendererUnavailable();
      if (wasBuilding) current.stop();
      setPrompt((draft) =>
        draft.trim() ? draft : wasBuilding ? (interruptedPrompt ?? "") : draft,
      );
      useOrb.getState().set({ notice: "" });
      if (useOrb.getState().phase === "descending")
        useOrb.getState().set({ phase: "editing" });
    },
    [setRendererState],
  );
  const retryRenderer = useCallback(() => {
    if (rendererAvailabilityRef.current !== "unavailable" && !graphicsAdvisory)
      return;
    setGraphicsError("");
    setGraphicsAdvisory(false);
    setGraphicsHelpVisible(false);
    setRendererState("initializing");
    setRendererRetryToken((token) => token + 1);
  }, [graphicsAdvisory, setRendererState]);
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
  const activeProvider = useRef(connection.provider);
  const connectionVersion = useRef(0);
  const setConnection = useCallback((next: Connection, restoring = false) => {
    connectionVersion.current++;
    if (!restoring) {
      chatGPTRestoreRequest.current?.abort();
      chatGPTRestoreRequest.current = null;
      chatGPTStartupSessionRequest.current?.abort();
      chatGPTStartupSessionRequest.current = null;
      chatGPTStartupConfigRequest.current?.abort();
      chatGPTStartupConfigRequest.current = null;
      setChatGPTStartupNeedsSession(false);
      setChatGPTStartupNeedsConfig(false);
      setChatGPTRestoreStatus("idle");
    }
    setConnectionState(next);
    if (next.provider !== "chatgpt-hosted") clearChatGPTStartupPreference();
  }, []);
  const [oauthBusy, setOAuthBusy] = useState(false);
  const [oauthMessage, setOAuthMessage] = useState("");
  const oauthCompletion = useRef<Promise<string> | null>(null);
  const oauthDraft = useRef<OAuthDraft | null>(null);
  const oauthController = useRef<AbortController | null>(null);
  const oauthEffectInstance = useRef(0);
  async function connectOpenRouter(): Promise<boolean> {
    setOAuthBusy(true);
    setOAuthMessage("");
    try {
      const current = useOrb.getState();
      if (current.building)
        throw Error("Finish or stop generation before connecting.");
      if (current.project.entities.length) {
        current.set({ saved: false });
        await current.save();
        if (!useOrb.getState().saved)
          throw Error("Save your world before connecting.");
      }
      const { authorizationUrl, transaction } = await startOpenRouterOAuth(
        location.origin,
      );
      sessionStorage.setItem(
        OAUTH_DRAFT_KEY,
        encodeOAuthDraft({
          version: 1,
          state: transaction.state,
          createdAt: transaction.createdAt,
          prompt,
          projectId: current.project.id,
          selectedId: current.selected,
        }),
      );
      sessionStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify(transaction));
      location.assign(authorizationUrl);
      return true;
    } catch {
      setOAuthBusy(false);
      setOAuthMessage(
        "Could not start sign-in. Check that your world can be saved and try again.",
      );
      return false;
    }
  }
  useEffect(() => {
    if (modal !== "account") {
      setProviderHint("");
      setResetArmed(false);
      return;
    }
    void s.loadDrafts();
    navigator.storage
      ?.estimate?.()
      .then(({ usage }) =>
        setStorageUsage(
          usage && usage > 0
            ? usage >= 1048576
              ? `${Math.round(usage / 1048576)} MB`
              : `${Math.max(1, Math.round(usage / 1024))} KB`
            : "",
        ),
      )
      .catch(() => undefined);
  }, [modal, s.loadDrafts]);
  useEffect(() => {
    const continuation = s.interruptedReviewContinuation;
    if (!continuation) return;
    const expire = () => {
      const current = useOrb.getState().interruptedReviewContinuation;
      if (current === continuation && current.expiresAt <= Date.now())
        useOrb.getState().set({ interruptedReviewContinuation: undefined });
    };
    const delay = continuation.expiresAt - Date.now();
    if (delay <= 0) {
      expire();
      return;
    }
    const timer = window.setTimeout(expire, delay);
    return () => window.clearTimeout(timer);
  }, [s.interruptedReviewContinuation]);
  useEffect(() => {
    let current = true;
    const effectInstance = ++oauthEffectInstance.current;
    const version = connectionVersion.current;
    const callbackUrl = new URL(location.href);
    if (
      !oauthCompletion.current &&
      callbackUrl.searchParams.get("orbsie_oauth") === "openrouter"
    ) {
      // Consume synchronously so Strict Mode and reload cannot exchange twice.
      let pending: string | null = null;
      let storageBlocked = false;
      try {
        pending = sessionStorage.getItem(OAUTH_PENDING_KEY);
        sessionStorage.removeItem(OAUTH_PENDING_KEY);
        const draft = sessionStorage.getItem(OAUTH_DRAFT_KEY);
        sessionStorage.removeItem(OAUTH_DRAFT_KEY);
        oauthDraft.current = decodeOAuthDraft(
          draft,
          callbackUrl.searchParams.get("state") ?? "",
        );
        if (oauthDraft.current) setPrompt(oauthDraft.current.prompt);
      } catch {
        storageBlocked = true;
      }
      for (const key of [
        "orbsie_oauth",
        "state",
        "code",
        "error",
        "error_description",
      ])
        callbackUrl.searchParams.delete(key);
      const original = location.href;
      history.replaceState(
        history.state,
        "",
        callbackUrl.pathname + callbackUrl.search + callbackUrl.hash,
      );
      if (storageBlocked)
        oauthCompletion.current = Promise.reject(Error(OAUTH_STORAGE_MESSAGE));
      else {
        const controller = new AbortController();
        oauthController.current = controller;
        oauthCompletion.current = Promise.resolve().then(() => {
          if (!pending) throw Error("Missing sign-in attempt.");
          return exchangeOpenRouterCode({
            callback: consumeOpenRouterOAuthCallback(
              original,
              JSON.parse(pending),
            ),
            signal: controller.signal,
          });
        });
      }
    }
    if (oauthCompletion.current) {
      setOAuthBusy(true);
      void oauthCompletion.current
        .then((key) => {
          if (!current || connectionVersion.current !== version) return;
          setConnection({ provider: "openrouter", key, model: "" });
          setOAuthMessage("OpenRouter connected. Choose a model to continue.");
          setModal("settings");
        })
        .catch((error) => {
          if (!current) return;
          setOAuthMessage(
            error instanceof Error && error.message === OAUTH_STORAGE_MESSAGE
              ? OAUTH_STORAGE_MESSAGE
              : "OpenRouter sign-in expired or could not be completed. Try connecting again.",
          );
          setModal("settings");
        })
        .finally(() => {
          if (current) {
            setOAuthBusy(false);
            oauthController.current = null;
            oauthCompletion.current = null;
          }
        });
    }
    const abortOnPageHide = () => {
      current = false;
      oauthController.current?.abort();
    };
    const recoverFromPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted || !oauthController.current) return;
      // A callback has already been consumed before this exchange began. If
      // the page entered BFCache, let the user start a fresh transaction
      // rather than leaving the controls locked or retrying the old code.
      current = false;
      oauthController.current?.abort();
      oauthController.current = null;
      oauthCompletion.current = null;
      setOAuthBusy(false);
      setOAuthMessage("OpenRouter sign-in was interrupted. Try again.");
      setModal("settings");
    };
    window.addEventListener("pagehide", abortOnPageHide);
    window.addEventListener("pageshow", recoverFromPageShow);
    return () => {
      current = false;
      window.removeEventListener("pagehide", abortOnPageHide);
      window.removeEventListener("pageshow", recoverFromPageShow);
      // Strict Mode rehearses an effect with cleanup followed immediately by
      // a second setup. Defer cancellation so rehearsal does not abort the
      // consumed callback; a real unmount has no replacement setup.
      queueMicrotask(() => {
        if (oauthEffectInstance.current === effectInstance)
          oauthController.current?.abort();
      });
    };
  }, []);
  useEffect(() => {
    const draft = oauthDraft.current;
    if (!draft || draft.projectId !== s.project.id) return;
    if (
      draft.selectedId &&
      s.project.entities.some((entity) => entity.id === draft.selectedId)
    )
      s.set({ selected: draft.selectedId });
    oauthDraft.current = null;
  }, [s.project.id]);
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
        offline: false,
      };
      setTrial({ enabled: next.enabled, remaining: next.remaining });
      return next;
    } catch {
      const offline =
        typeof navigator !== "undefined" && navigator.onLine === false;
      setTrial({ enabled: false, remaining: 0 });
      return { enabled: false, remaining: 0, offline };
    }
  };
  const [sheet, setSheet] = useState(true);
  const [shareUrl, setShareUrl] = useState("");
  const [modalError, setModalError] = useState("");
  const [modalNotice, setModalNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [modelsProvider, setModelsProvider] = useState("");
  const [modelCatalogCache, setModelCatalogCache] = useState<
    Record<string, CatalogModel[]>
  >({});
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false);
  const [modelCatalogError, setModelCatalogError] = useState(false);
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
    isAdmin: false,
    chatgptHosted: false,
    chatgptGeneration: false,
    authoringReview: false,
  });
  const [authoringReviewOptOut, setAuthoringReviewOptOut] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [signup, setSignup] = useState(false);
  const [providerHint, setProviderHint] = useState("");
  const [chatGPTStartRequest, setChatGPTStartRequest] = useState(0);
  const [chatGPTModels, setChatGPTModels] = useState<ChatGPTModelOption[]>([]);
  const [chatGPTModelsStatus, setChatGPTModelsStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const chatGPTModelsRequest = useRef<AbortController | null>(null);
  const [chatGPTRestoreStatus, setChatGPTRestoreStatus] =
    useState<ChatGPTRestoreStatus>("idle");
  const [chatGPTPreferredTier, setChatGPTPreferredTier] =
    useState<ChatGPTPresetLabel | null>(null);
  const chatGPTRestoreRequest = useRef<AbortController | null>(null);
  const chatGPTStartupSessionRequest = useRef<AbortController | null>(null);
  const chatGPTStartupConfigRequest = useRef<AbortController | null>(null);
  const [chatGPTStartupNeedsSession, setChatGPTStartupNeedsSession] =
    useState(false);
  const [chatGPTStartupNeedsConfig, setChatGPTStartupNeedsConfig] =
    useState(false);
  const previousConnectionProvider = useRef(connection.provider);
  const modelCatalogRequest = useRef<AbortController | null>(null);
  const [storageUsage, setStorageUsage] = useState("");
  const [resetArmed, setResetArmed] = useState(false);
  const [user, setUser] = useState<{ name: string } | null>(null);
  const providerSession = useRef<Promise<ProviderSessionUser> | null>(null);
  const providerSessionController = useRef<AbortController | null>(null);
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
  useEffect(() => {
    const providerChanged =
      previousConnectionProvider.current !== connection.provider;
    previousConnectionProvider.current = connection.provider;
    activeProvider.current = connection.provider;
    modelCatalogRequest.current?.abort();
    modelCatalogRequest.current = null;
    setModelCatalogLoading(false);
    if (connection.provider !== "chatgpt-hosted") {
      chatGPTModelsRequest.current?.abort();
      chatGPTModelsRequest.current = null;
      setChatGPTModels([]);
      setChatGPTModelsStatus("idle");
      if (providerChanged) {
        chatGPTRestoreRequest.current?.abort();
        chatGPTRestoreRequest.current = null;
        setChatGPTRestoreStatus("idle");
      }
    }
  }, [connection.provider]);
  useEffect(
    () => () => {
      modelCatalogRequest.current?.abort();
      chatGPTModelsRequest.current?.abort();
      chatGPTRestoreRequest.current?.abort();
      chatGPTStartupSessionRequest.current?.abort();
      chatGPTStartupConfigRequest.current?.abort();
    },
    [],
  );
  const captureCloudRequest = () => {
    const inProject = projectScope.current.capture();
    const generation = accountGeneration.current;
    return () => inProject() && generation === accountGeneration.current;
  };
  const resolveCloudJournalBaseline = async (
    project: Project,
    accountVersion: number,
    options: {
      allowMissing?: boolean;
      requireJournalRun?: boolean;
      continuation?: NonNullable<
        ReturnType<typeof useOrb.getState>["interruptedReviewContinuation"]
      >;
    } = {},
  ): Promise<CloudBaseline | null> => {
    const stillCurrent = () => {
      const state = useOrb.getState();
      return (
        accountGeneration.current === accountVersion &&
        state.project.id === project.id &&
        state.project.revision === project.revision &&
        (!options.continuation ||
          state.interruptedReviewContinuation === options.continuation)
      );
    };
    const assertCurrentScene = async (expectedDigest?: string) => {
      if (!stillCurrent())
        throw Error(
          "The account or saved scene changed during cloud recovery.",
        );
      let binding: Awaited<ReturnType<typeof createSceneBinding>>;
      try {
        binding = await createSceneBinding(
          committed(useOrb.getState().project),
        );
      } catch {
        throw Error(
          "The saved scene could not be verified for cloud recovery.",
        );
      }
      if (!stillCurrent())
        throw Error(
          "The account or saved scene changed during cloud recovery.",
        );
      if (expectedDigest && binding.digest !== expectedDigest)
        throw Error("The saved scene changed during cloud recovery.");
      return binding;
    };

    const localBinding = await assertCurrentScene();
    const current = useOrb.getState();
    if (
      options.allowMissing &&
      !current.saved &&
      project.revision === 0 &&
      project.entities.length === 0 &&
      project.messages.length === 0
    ) {
      await assertCurrentScene(localBinding.digest);
      return null;
    }
    let response: Response;
    try {
      response = await fetch(
        `/api/projects?id=${encodeURIComponent(project.id)}`,
        {
          credentials: "same-origin",
          redirect: "error",
          cache: "no-store",
        },
      );
    } catch {
      throw Error("Cloud recovery could not verify the saved world.");
    }
    if (!stillCurrent())
      throw Error("The account or saved scene changed during cloud recovery.");
    if (response.status === 404 && options.allowMissing) {
      const current = useOrb.getState();
      if (
        !current.saved &&
        project.revision === 0 &&
        project.entities.length === 0 &&
        project.messages.length === 0
      ) {
        await assertCurrentScene(localBinding.digest);
        return null;
      }
    }
    if (response.status === 404)
      throw Error("The saved world has no available cloud checkpoint.");
    if (!response.ok)
      throw Error("Cloud recovery could not verify the saved world.");
    const data = (await response.json().catch(() => null)) as {
      project?: {
        id?: unknown;
        revision?: unknown;
        snapshotToken?: unknown;
        snapshot?: unknown;
      };
    } | null;
    if (!stillCurrent())
      throw Error("The account or saved scene changed during cloud recovery.");
    const remote = data?.project;
    const parsedSnapshot = projectSchema.safeParse(remote?.snapshot);
    if (
      !remote ||
      remote.id !== project.id ||
      !Number.isInteger(remote.revision) ||
      typeof remote.snapshotToken !== "string" ||
      !/^[a-f0-9]{64}$/.test(remote.snapshotToken) ||
      !parsedSnapshot.success ||
      parsedSnapshot.data.id !== project.id ||
      parsedSnapshot.data.revision !== remote.revision
    )
      throw Error("Cloud recovery returned an invalid saved-world checkpoint.");
    const baseline = {
      revision: remote.revision as number,
      snapshotToken: remote.snapshotToken,
    };
    const savedProject = committed(project);
    if (
      !options.requireJournalRun &&
      sameSnapshot(parsedSnapshot.data, savedProject)
    ) {
      await assertCurrentScene(localBinding.digest);
      return baseline;
    }

    let run: Awaited<ReturnType<typeof latestCloudGenerationRun>>;
    try {
      run = await latestCloudGenerationRun(project.id);
    } catch {
      throw Error("The cloud recovery checkpoint could not be verified.");
    }
    await assertCurrentScene(localBinding.digest);
    if (
      run.state !== "complete" ||
      run.projectId !== project.id ||
      run.checkpoint.id !== project.id ||
      !run.cloudBaselineCurrent ||
      run.baseRevision !== baseline.revision
    )
      throw Error(
        "A newer cloud save exists or the recovery checkpoint is no longer current. Open the latest account world before continuing.",
      );
    let checkpointBinding: Awaited<ReturnType<typeof createSceneBinding>>;
    try {
      checkpointBinding = await createSceneBinding(run.checkpoint);
    } catch {
      throw Error("The cloud recovery checkpoint could not be verified.");
    }
    const latestLocalBinding = await assertCurrentScene(localBinding.digest);
    if (checkpointBinding.digest !== latestLocalBinding.digest)
      throw Error(
        "The saved scene no longer matches its cloud recovery checkpoint. Open the latest account world before continuing.",
      );
    return baseline;
  };
  const clearAccountState = () => {
    providerSessionController.current?.abort();
    providerSessionController.current = null;
    providerSession.current = null;
    chatGPTRestoreRequest.current?.abort();
    chatGPTRestoreRequest.current = null;
    chatGPTStartupSessionRequest.current?.abort();
    chatGPTStartupSessionRequest.current = null;
    chatGPTStartupConfigRequest.current?.abort();
    chatGPTStartupConfigRequest.current = null;
    setChatGPTStartupNeedsSession(false);
    setChatGPTStartupNeedsConfig(false);
    setChatGPTRestoreStatus("idle");
    setChatGPTPreferredTier(null);
    clearChatGPTStartupPreference();
    connectionVersion.current++;
    accountGeneration.current++;
    if (connection.provider === "chatgpt-hosted")
      setConnection({ provider: "openrouter", model: "", key: "" });
    setCloudBaseline(null);
    setCloudProjects([]);
    setConflict(null);
    setPublicationRecord(null);
    setShareUrl("");
    setModalError("");
  };

  const ensureProviderSession = useCallback(() => {
    if (providerSession.current) return providerSession.current;
    const generation = accountGeneration.current;
    const controller = new AbortController();
    providerSessionController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    const promise = (async () => {
      const response = await fetch("/api/provider-session", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw Error("Could not start a private Orbsie session.");
      }
      if (!response.ok)
        throw Error("Could not start a private Orbsie session.");
      const user = parseProviderSessionUser(
        data && typeof data === "object"
          ? (data as { user?: unknown }).user
          : undefined,
      );
      if (!user) throw Error("Could not start a private Orbsie session.");
      if (generation !== accountGeneration.current)
        throw Error("Could not start a private Orbsie session.");
      setUser(user);
      return user;
    })();
    providerSession.current = promise;
    void promise.then(
      () => {
        window.clearTimeout(timeout);
        if (providerSessionController.current === controller)
          providerSessionController.current = null;
        if (providerSession.current === promise) providerSession.current = null;
      },
      () => {
        window.clearTimeout(timeout);
        if (providerSessionController.current === controller)
          providerSessionController.current = null;
        if (providerSession.current === promise) providerSession.current = null;
      },
    );
    return promise;
  }, []);
  const consumeChatGPTStartRequest = useCallback(
    () => setChatGPTStartRequest(0),
    [],
  );

  const loadProviderModels = useCallback(
    (provider: string, force = false) => {
      if (provider !== "openrouter" && provider !== "gateway") return;
      const cached = modelCatalogCache[provider];
      if (!force && cached) {
        modelCatalogRequest.current?.abort();
        modelCatalogRequest.current = null;
        setModelsProvider(provider);
        setModels(cached);
        setModelCatalogLoading(false);
        setModelCatalogError(false);
        return;
      }
      modelCatalogRequest.current?.abort();
      modelCatalogRequest.current = null;
      const controller = new AbortController();
      modelCatalogRequest.current = controller;
      const generation = accountGeneration.current;
      setModelsProvider(provider);
      setModels([]);
      setModelCatalogLoading(true);
      setModelCatalogError(false);
      void fetch(`/api/models?provider=${provider}`, {
        signal: controller.signal,
        credentials: "same-origin",
        cache: "no-store",
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw Error(data.error);
          return data;
        })
        .then((data) => {
          if (
            !isCurrentCatalogRequest(
              controller,
              modelCatalogRequest.current,
              generation,
              accountGeneration.current,
              provider,
              activeProvider.current,
            )
          )
            return;
          const next = parseCatalogModels(data.models);
          if (!next) throw Error("Model catalog invalid");
          setModelCatalogCache((current) => ({ ...current, [provider]: next }));
          setModelsProvider(provider);
          setModels(next);
          setConnectionState((current) => {
            if (current.provider !== provider || current.model) return current;
            const balanced = modelModesForProvider(provider).find(
              (mode) =>
                mode.label === "Balanced" &&
                next.some((model: CatalogModel) => model.id === mode.id),
            );
            return { ...current, model: balanced?.id ?? "" };
          });
        })
        .catch(() => {
          if (
            isCurrentCatalogRequest(
              controller,
              modelCatalogRequest.current,
              generation,
              accountGeneration.current,
              provider,
              activeProvider.current,
            )
          )
            setModelCatalogError(true);
        })
        .finally(() => {
          if (
            isCurrentCatalogRequest(
              controller,
              modelCatalogRequest.current,
              generation,
              accountGeneration.current,
              provider,
              activeProvider.current,
            )
          ) {
            modelCatalogRequest.current = null;
            setModelCatalogLoading(false);
          }
        });
    },
    [modelCatalogCache],
  );

  const loadChatGPTModels = useCallback(
    (force = false) => {
      if (!force && chatGPTModelsStatus === "ready") return;
      chatGPTModelsRequest.current?.abort();
      const controller = new AbortController();
      chatGPTModelsRequest.current = controller;
      const generation = accountGeneration.current;
      setChatGPTModelsStatus("loading");
      void fetch("/api/chatgpt/models", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw Error("ChatGPT model catalog unavailable");
          return data;
        })
        .then((data) => {
          if (
            controller.signal.aborted ||
            generation !== accountGeneration.current ||
            activeProvider.current !== "chatgpt-hosted" ||
            chatGPTModelsRequest.current !== controller
          )
            return;
          const next = parseChatGPTModels(data);
          if (!next) throw Error("ChatGPT model catalog invalid");
          setChatGPTModels(next);
          setChatGPTModelsStatus("ready");
        })
        .catch(() => {
          if (
            !controller.signal.aborted &&
            generation === accountGeneration.current &&
            activeProvider.current === "chatgpt-hosted" &&
            chatGPTModelsRequest.current === controller
          )
            setChatGPTModelsStatus("error");
        });
    },
    [chatGPTModelsStatus],
  );

  const beginChatGPTStartupRestore = useCallback(
    (
      preference: ChatGPTStartupPreference,
      expectedVersion = connectionVersion.current,
      expectedProvider = activeProvider.current,
    ) => {
      chatGPTRestoreRequest.current?.abort();
      const controller = new AbortController();
      chatGPTRestoreRequest.current = controller;
      const generation = accountGeneration.current;
      setChatGPTPreferredTier(preference.tier);
      setChatGPTStartupNeedsSession(false);
      setChatGPTStartupNeedsConfig(false);
      setChatGPTRestoreStatus("restoring");
      const startedAt = performance.now();
      const stageDurations: Partial<Record<"status" | "models", number>> = {};
      const isCurrent = () =>
        !controller.signal.aborted &&
        chatGPTRestoreRequest.current === controller &&
        generation === accountGeneration.current &&
        expectedVersion === connectionVersion.current &&
        expectedProvider === activeProvider.current;
      void restoreChatGPTStartup({
        preference,
        fetcher: async (input, init) => {
          const stage = input.endsWith("/models") ? "models" : "status";
          const stageStartedAt = performance.now();
          try {
            return await fetch(input, init);
          } finally {
            stageDurations[stage] = performance.now() - stageStartedAt;
          }
        },
        signal: controller.signal,
        isCurrent,
        parseStatus: (value) => {
          const snapshot = parseChatGPTSnapshot(value);
          return snapshot ? { authStatus: snapshot.authStatus } : null;
        },
        parseModels: (value) => parseChatGPTModels(value),
      })
        .then((result: ChatGPTStartupRestoreResult) => {
          if (!isCurrent() || result.kind === "stale") return;
          const durationMs = performance.now() - startedAt;
          const stageDuration = (stage: "status" | "models") =>
            Math.max(0, Math.floor(stageDurations[stage] ?? durationMs));
          if (result.kind === "transient") {
            recordStartupDiagnostic({
              stage: result.stage === "models" ? "catalog" : "status",
              outcome: "transient",
              tier: preference.tier,
              durationMs: stageDuration(result.stage),
            });
          } else if (result.kind === "reconnect") {
            recordStartupDiagnostic({
              stage: result.stage === "models" ? "catalog" : "status",
              outcome: "reconnect",
              tier: preference.tier,
              durationMs: stageDuration(result.stage),
            });
          } else {
            recordStartupDiagnostic({
              stage: "status",
              outcome: "ready",
              tier: preference.tier,
              durationMs: stageDuration("status"),
            });
            recordStartupDiagnostic({
              stage: "catalog",
              outcome:
                result.kind === "selection-required"
                  ? "selection-required"
                  : "ready",
              tier: preference.tier,
              durationMs: stageDuration("models"),
            });
          }
          chatGPTRestoreRequest.current = null;
          if (result.kind === "restored") {
            setChatGPTModels(result.models as ChatGPTModelOption[]);
            setChatGPTModelsStatus("ready");
            setChatGPTRestoreStatus("idle");
            setConnection(
              {
                provider: "chatgpt-hosted",
                model: result.model,
                effort: result.effort,
                quality: result.tier,
                key: "",
              },
              true,
            );
            return;
          }
          if (result.kind === "selection-required") {
            setChatGPTModels(result.models as ChatGPTModelOption[]);
            setChatGPTModelsStatus("ready");
            setConnection(
              {
                provider: "chatgpt-hosted",
                model: "",
                quality: result.tier,
                key: "",
              },
              true,
            );
            setChatGPTRestoreStatus("selection-required");
            return;
          }
          setChatGPTRestoreStatus(
            result.kind === "transient" ? "transient" : "reconnect",
          );
        })
        .catch(() => {
          if (!isCurrent()) return;
          chatGPTRestoreRequest.current = null;
          recordStartupDiagnostic({
            stage: "status",
            outcome: "transient",
            tier: preference.tier,
            durationMs: performance.now() - startedAt,
          });
          setChatGPTRestoreStatus("transient");
        });
    },
    [setConnection],
  );

  const restoreChatGPTStartupSession = useCallback(
    (
      preference: ChatGPTStartupPreference,
      expectedVersion = connectionVersion.current,
      expectedProvider = activeProvider.current,
    ) => {
      chatGPTStartupSessionRequest.current?.abort();
      chatGPTRestoreRequest.current?.abort();
      const controller = new AbortController();
      chatGPTStartupSessionRequest.current = controller;
      const generation = accountGeneration.current;
      setChatGPTPreferredTier(preference.tier);
      setChatGPTStartupNeedsConfig(false);
      setChatGPTRestoreStatus("restoring");
      setChatGPTStartupNeedsSession(true);
      const startedAt = performance.now();
      const isCurrent = () =>
        !controller.signal.aborted &&
        chatGPTStartupSessionRequest.current === controller &&
        generation === accountGeneration.current &&
        expectedVersion === connectionVersion.current &&
        expectedProvider === activeProvider.current;
      void fetch("/api/auth/get-session", {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw Error("Session unavailable");
          return response.json();
        })
        .then((data) => {
          if (!isCurrent()) return;
          chatGPTStartupSessionRequest.current = null;
          // Better Auth returns JSON null when the session cookie is missing.
          if (data === null) {
            recordStartupDiagnostic({
              stage: "session",
              outcome: "reconnect",
              tier: preference.tier,
              durationMs: performance.now() - startedAt,
            });
            setChatGPTStartupNeedsSession(true);
            setChatGPTRestoreStatus("reconnect");
            return;
          }
          if (
            !data ||
            typeof data !== "object" ||
            !Object.prototype.hasOwnProperty.call(data, "user")
          ) {
            recordStartupDiagnostic({
              stage: "session",
              outcome: "transient",
              tier: preference.tier,
              durationMs: performance.now() - startedAt,
            });
            setChatGPTStartupNeedsSession(true);
            setChatGPTRestoreStatus("transient");
            return;
          }
          if (data.user === null) {
            recordStartupDiagnostic({
              stage: "session",
              outcome: "reconnect",
              tier: preference.tier,
              durationMs: performance.now() - startedAt,
            });
            setChatGPTStartupNeedsSession(true);
            setChatGPTRestoreStatus("reconnect");
            return;
          }
          if (
            typeof data.user !== "object" ||
            typeof (data.user as { name?: unknown }).name !== "string"
          ) {
            recordStartupDiagnostic({
              stage: "session",
              outcome: "transient",
              tier: preference.tier,
              durationMs: performance.now() - startedAt,
            });
            setChatGPTStartupNeedsSession(true);
            setChatGPTRestoreStatus("transient");
            return;
          }
          recordStartupDiagnostic({
            stage: "session",
            outcome: "ready",
            tier: preference.tier,
            durationMs: performance.now() - startedAt,
          });
          setUser(data.user);
          void refreshCloud();
          setChatGPTStartupNeedsSession(false);
          beginChatGPTStartupRestore(
            preference,
            expectedVersion,
            expectedProvider,
          );
        })
        .catch(() => {
          if (!isCurrent()) return;
          chatGPTStartupSessionRequest.current = null;
          recordStartupDiagnostic({
            stage: "session",
            outcome: "transient",
            tier: preference.tier,
            durationMs: performance.now() - startedAt,
          });
          setChatGPTStartupNeedsSession(true);
          setChatGPTRestoreStatus("transient");
        });
    },
    [beginChatGPTStartupRestore],
  );

  const restoreChatGPTStartupConfig = useCallback(
    (
      preference: ChatGPTStartupPreference,
      expectedVersion = connectionVersion.current,
      expectedProvider = activeProvider.current,
    ) => {
      chatGPTStartupConfigRequest.current?.abort();
      chatGPTStartupSessionRequest.current?.abort();
      chatGPTRestoreRequest.current?.abort();
      const controller = new AbortController();
      chatGPTStartupConfigRequest.current = controller;
      const generation = accountGeneration.current;
      setChatGPTPreferredTier(preference.tier);
      setChatGPTStartupNeedsSession(false);
      setChatGPTStartupNeedsConfig(true);
      setChatGPTRestoreStatus("restoring");
      const startedAt = performance.now();
      const isCurrent = () =>
        !controller.signal.aborted &&
        chatGPTStartupConfigRequest.current === controller &&
        generation === accountGeneration.current &&
        expectedVersion === connectionVersion.current &&
        expectedProvider === activeProvider.current;
      void fetch("/api/config", {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw Error("Configuration unavailable");
          const value: unknown = await response.json();
          if (!value || typeof value !== "object")
            throw Error("Configuration invalid");
          return value as typeof capabilities;
        })
        .then((nextCapabilities) => {
          if (!isCurrent()) return;
          chatGPTStartupConfigRequest.current = null;
          recordStartupDiagnostic({
            stage: "configuration",
            outcome: "ready",
            tier: preference.tier,
            durationMs: performance.now() - startedAt,
          });
          setCapabilities(nextCapabilities);
          setChatGPTStartupNeedsConfig(false);
          if (!nextCapabilities.accounts || !nextCapabilities.chatgptHosted) {
            setChatGPTStartupNeedsSession(true);
            setChatGPTRestoreStatus("reconnect");
            return;
          }
          restoreChatGPTStartupSession(
            preference,
            expectedVersion,
            expectedProvider,
          );
        })
        .catch(() => {
          if (!isCurrent()) return;
          chatGPTStartupConfigRequest.current = null;
          recordStartupDiagnostic({
            stage: "configuration",
            outcome: "transient",
            tier: preference.tier,
            durationMs: performance.now() - startedAt,
          });
          setChatGPTStartupNeedsConfig(true);
          setChatGPTStartupNeedsSession(false);
          setChatGPTRestoreStatus("transient");
        });
    },
    [restoreChatGPTStartupSession],
  );

  const retryChatGPTStartupRestore = useCallback(() => {
    const preference = readChatGPTStartupPreference();
    if (!preference) {
      setChatGPTRestoreStatus("idle");
      return;
    }
    if (chatGPTStartupNeedsConfig) {
      restoreChatGPTStartupConfig(
        preference,
        connectionVersion.current,
        activeProvider.current,
      );
      return;
    }
    if (chatGPTStartupNeedsSession) {
      restoreChatGPTStartupSession(
        preference,
        connectionVersion.current,
        activeProvider.current,
      );
      return;
    }
    beginChatGPTStartupRestore(
      preference,
      connectionVersion.current,
      activeProvider.current,
    );
  }, [
    beginChatGPTStartupRestore,
    chatGPTStartupNeedsConfig,
    chatGPTStartupNeedsSession,
    restoreChatGPTStartupConfig,
    restoreChatGPTStartupSession,
  ]);

  const useChatGPT = (
    model: string,
    effort: string,
    preset?: ChatGPTPresetLabel | null,
  ) => {
    if (preset) {
      setChatGPTPreferredTier(preset);
      writeChatGPTStartupPreference(preset);
    } else {
      setChatGPTPreferredTier(null);
      clearChatGPTStartupPreference();
    }
    setChatGPTRestoreStatus("idle");
    setConnection({
      provider: "chatgpt-hosted",
      model,
      effort,
      quality: preset ?? undefined,
      key: "",
    });
    setModal(null);
  };
  const disconnectChatGPT = useCallback(
    (explicit = false) => {
      if (connection.provider === "chatgpt-hosted") {
        chatGPTModelsRequest.current?.abort();
        chatGPTModelsRequest.current = null;
        setChatGPTModels([]);
        setChatGPTModelsStatus("idle");
        setConnection({ provider: "chatgpt-hosted", model: "", key: "" });
      }
      if (explicit) {
        setChatGPTPreferredTier(null);
        clearChatGPTStartupPreference();
        setChatGPTRestoreStatus("idle");
      }
    },
    [connection.provider, setConnection],
  );
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
  const chatFollowsLatest = useRef(true);
  const chatAutoScroll = useRef(false);
  const chatUserScrollIntent = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLElement>(null);
  const gameplayRegion = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const focusGameplayRegion = useCallback(() => {
    gameplayRegion.current?.focus({ preventScroll: true });
  }, []);
  const scrollChatToLatest = useCallback(() => {
    const element = chat.current;
    if (!element) return;
    chatAutoScroll.current = true;
    element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
    window.requestAnimationFrame(() => {
      chatAutoScroll.current = false;
      chatFollowsLatest.current = true;
    });
  }, []);
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
  const qualityOptions = modelQualityOptions(
    connection.provider,
    modelsProvider === connection.provider ? models : [],
    chatGPTModels,
  );
  const selectedQuality =
    selectedModelQuality(
      connection.provider,
      connection.model,
      connection.effort,
      qualityOptions,
    ) ??
    (connection.provider === "chatgpt-hosted" &&
    chatGPTRestoreStatus === "selection-required"
      ? chatGPTPreferredTier
      : null);
  const qualityCatalogStatus =
    connection.provider === "chatgpt-hosted"
      ? chatGPTModelsStatus
      : modelsProvider !== connection.provider
        ? "idle"
        : modelCatalogLoading
          ? "loading"
          : modelCatalogError
            ? "error"
            : "ready";
  const qualityProviderLabel =
    connection.provider === "chatgpt-hosted"
      ? "ChatGPT"
      : connection.provider === "openrouter"
        ? "OpenRouter"
        : "AI Gateway";
  const reviewAllowanceAvailable = trial.enabled && trial.remaining > 0;
  const authoringReviewEligible = authoringReviewEligibleForConnection(
    capabilities.authoringReview,
    connection,
    reviewAllowanceAvailable,
  );
  const authoringReviewEnabled =
    authoringReviewEligible && !authoringReviewOptOut;
  const selectQuality = (
    option: ReturnType<typeof modelQualityOptions>[number],
  ) => {
    if (!option.available || !option.model) return;
    if (connection.provider === "chatgpt-hosted") {
      const tier = option.label as ChatGPTPresetLabel;
      setChatGPTPreferredTier(tier);
      writeChatGPTStartupPreference(tier);
      setChatGPTRestoreStatus("idle");
    }
    setConnection({
      ...connection,
      model: option.model,
      quality: option.label,
      ...(connection.provider === "chatgpt-hosted" && option.effort
        ? { effort: option.effort }
        : {}),
    });
  };
  const latestActivityId = s.authoringActivity.at(-1)?.id;
  const lastUserMessageIndex =
    s.authoringActivity.length > 0
      ? s.project.messages.reduce(
          (last, message, index) => (message.role === "user" ? index : last),
          -1,
        )
      : -1;
  const messagesBeforeActivity =
    lastUserMessageIndex >= 0
      ? s.project.messages.slice(0, lastUserMessageIndex + 1)
      : s.project.messages;
  const messagesAfterActivity =
    lastUserMessageIndex >= 0
      ? s.project.messages.slice(lastUserMessageIndex + 1)
      : [];
  const nonterminalActivity = s.authoringActivity.filter(
    (activity) =>
      activity.kind !== "completed" &&
      activity.kind !== "cancelled" &&
      activity.kind !== "failed",
  );
  const terminalActivity = s.authoringActivity.filter(
    (activity) =>
      activity.kind === "completed" ||
      activity.kind === "cancelled" ||
      activity.kind === "failed",
  );
  const latestTerminalActivity = terminalActivity.at(-1);
  const interruptedReviewFailureMatches =
    s.authoringActivity.length === 0 ||
    (latestTerminalActivity?.kind === "failed" &&
      latestTerminalActivity.projectId === s.project.id &&
      latestTerminalActivity.revision === s.project.revision);
  const reviewContinuation =
    s.reviewContinuation?.projectId === s.project.id &&
    s.reviewContinuation.revision === s.project.revision &&
    latestTerminalActivity?.kind === "failed" &&
    latestTerminalActivity.projectId === s.project.id &&
    latestTerminalActivity.revision === s.project.revision
      ? s.reviewContinuation
      : undefined;
  const interruptedReviewContinuation =
    s.interruptedReviewContinuation?.projectId === s.project.id &&
    s.interruptedReviewContinuation.revision === s.project.revision &&
    s.interruptedReviewContinuation.expiresAt > Date.now() &&
    s.saved &&
    interruptedReviewFailureMatches
      ? s.interruptedReviewContinuation
      : undefined;
  const renderProjectMessage = (
    m: (typeof s.project.messages)[number],
    index: number,
  ) => (
    <div key={`message-${index}`} className={`message ${m.role}`}>
      {m.role === "assistant" && <span className="assistant-icon">✧</span>}
      <div>
        {m.entityId && (
          <span className="entity-chip">
            <Leaf size={12} />
            {s.project.entities.find((e) => e.id === m.entityId)?.label ??
              "Selected object"}
          </span>
        )}
        <p>{m.text}</p>
      </div>
    </div>
  );
  const renderAuthoringActivity = (
    activity: (typeof s.authoringActivity)[number],
    latest: boolean,
  ) => (
    <div
      key={activity.id}
      className={`message assistant authoring-activity-message${latest ? " authoring-activity-latest" : ""} is-${activity.kind}`}
      role={latest ? "status" : undefined}
      aria-live={latest ? "polite" : undefined}
      aria-atomic={latest ? "true" : undefined}
      aria-label={latest ? "Latest creation update" : undefined}
      data-project-id={activity.projectId}
      data-run-id={activity.runId}
    >
      <span className="assistant-icon" aria-hidden="true">
        {latest && s.building ? <span className="pulse-orb" /> : "✧"}
      </span>
      <div>
        <p>{activity.message}</p>
      </div>
    </div>
  );
  useLayoutEffect(() => {
    parcelTransitionController.setTarget(landing ? 0 : 1);
    return parcelTransitionController.attachUi(composer.current);
  }, [landing, publicView, s.phase]);
  useEffect(() => {
    const refresh = () => {
      parcelTransitionController.refreshUi();
      if (chatFollowsLatest.current) scrollChatToLatest();
    };
    window.addEventListener("resize", refresh);
    return () => window.removeEventListener("resize", refresh);
  }, [scrollChatToLatest]);
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
    const initialAccountGeneration = accountGeneration.current;
    const initialConnectionVersion = connectionVersion.current;
    const initialProvider = activeProvider.current;
    const startupPreference = readChatGPTStartupPreference();
    if (startupPreference) {
      setChatGPTPreferredTier(startupPreference.tier);
      setChatGPTStartupNeedsConfig(true);
      setChatGPTRestoreStatus("restoring");
    }
    const startupStillCurrent = () =>
      Boolean(
        startupPreference &&
        initialAccountGeneration === accountGeneration.current &&
        initialConnectionVersion === connectionVersion.current &&
        initialProvider === activeProvider.current,
      );
    void refreshTrial();
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
    const configStartedAt = performance.now();
    fetch("/api/config", { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error("Configuration unavailable");
        const value: unknown = await r.json();
        if (!value || typeof value !== "object")
          throw Error("Configuration invalid");
        return value as typeof capabilities;
      })
      .then((c) => {
        const startupCurrent = startupStillCurrent();
        if (startupCurrent)
          recordStartupDiagnostic({
            stage: "configuration",
            outcome: "ready",
            tier: startupPreference!.tier,
            durationMs: performance.now() - configStartedAt,
          });
        setCapabilities(c);
        if (startupCurrent && (!c.accounts || !c.chatgptHosted)) {
          setChatGPTStartupNeedsConfig(false);
          setChatGPTStartupNeedsSession(true);
          setChatGPTRestoreStatus("reconnect");
        }
        if (
          c.accounts &&
          initialAccountGeneration === accountGeneration.current
        ) {
          if (
            startupPreference &&
            c.chatgptHosted &&
            initialConnectionVersion === connectionVersion.current &&
            initialProvider === activeProvider.current
          ) {
            setChatGPTStartupNeedsConfig(false);
            restoreChatGPTStartupSession(
              startupPreference,
              initialConnectionVersion,
              initialProvider,
            );
            return;
          }
          const sessionStartedAt = performance.now();
          fetch("/api/auth/get-session", {
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
          })
            .then(async (r) => {
              if (!r.ok) throw Error("Session unavailable");
              return r.json();
            })
            .then((d) => {
              if (startupStillCurrent()) {
                const sessionUser = parseProviderSessionUser(d?.user);
                const sessionOutcome =
                  d === null || d?.user === null
                    ? "reconnect"
                    : sessionUser
                      ? "ready"
                      : "transient";
                recordStartupDiagnostic({
                  stage: "session",
                  outcome: sessionOutcome,
                  tier: startupPreference!.tier,
                  durationMs: performance.now() - sessionStartedAt,
                });
              }
              const sessionUser = parseProviderSessionUser(d?.user);
              if (
                sessionUser &&
                initialAccountGeneration === accountGeneration.current &&
                (!startupPreference || startupStillCurrent())
              ) {
                setUser(sessionUser);
                void refreshCloud();
              }
            })
            .catch(() => {
              if (startupStillCurrent())
                recordStartupDiagnostic({
                  stage: "session",
                  outcome: "transient",
                  tier: startupPreference!.tier,
                  durationMs: performance.now() - sessionStartedAt,
                });
              if (startupStillCurrent()) {
                setChatGPTPreferredTier(startupPreference!.tier);
                setChatGPTStartupNeedsSession(true);
                setChatGPTRestoreStatus("transient");
              }
            });
        }
      })
      .catch(() => {
        if (startupStillCurrent())
          recordStartupDiagnostic({
            stage: "configuration",
            outcome: "transient",
            tier: startupPreference!.tier,
            durationMs: performance.now() - configStartedAt,
          });
        if (startupStillCurrent()) {
          setChatGPTPreferredTier(startupPreference!.tier);
          setChatGPTStartupNeedsSession(false);
          setChatGPTStartupNeedsConfig(true);
          setChatGPTRestoreStatus("transient");
        }
      });
  }, [restoreChatGPTStartupSession]);
  useEffect(() => {
    if (!chatFollowsLatest.current) return;
    const frame = window.requestAnimationFrame(() => {
      scrollChatToLatest();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [latestActivityId, s.project.messages.length, scrollChatToLatest]);
  useEffect(() => {
    const element = chat.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (chatFollowsLatest.current) scrollChatToLatest();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [landing, scrollChatToLatest]);
  useEffect(() => {
    if (modal) {
      dialog.current?.showModal();
      setModalError("");
    } else {
      dialog.current?.close();
      setModalNotice("");
    }
  }, [modal]);
  useEffect(() => {
    if (modal !== "settings" || connection.provider === "chatgpt-hosted")
      return;
    setModelSearch("");
    loadProviderModels(connection.provider);
  }, [connection.provider, loadProviderModels, modal]);
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
      if (
        data.state === "READY" &&
        data.servedRevision === useOrb.getState().project.revision
      )
        markExperience(projectId, "publishReady");
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
  const createGenerationJournal = (
    originProjectId: string,
    accountVersion: number,
    baselineOverride?: CloudBaseline | null,
  ) => {
    const originBaseline =
      baselineOverride === undefined ? cloudVersion : baselineOverride;
    let lastJournalRunId: string | undefined;
    let lastJournalAcknowledgement:
      { revision: number; snapshotToken: string } | undefined;
    return user
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
              useOrb.getState().project.id === project.id &&
              useOrb.getState().project.revision === project.revision;
            if (
              !current() ||
              !(await uploadCloudGeneratedModels(project, current))
            )
              throw Error(
                "Generation account changed before cloud recovery could start.",
              );
            let baseRevision =
              project.id === originProjectId
                ? (originBaseline?.revision ?? null)
                : null;
            let baseSnapshotToken =
              project.id === originProjectId
                ? (originBaseline?.snapshotToken ?? null)
                : null;
            if (lastJournalRunId && lastJournalRunId !== runId) {
              const latestResponse = await fetch(
                `/api/projects?id=${encodeURIComponent(project.id)}`,
                { cache: "no-store" },
              );
              const latest = await latestResponse.json().catch(() => ({}));
              if (!current())
                throw Error(
                  "Generation account changed before cloud recovery could start.",
                );
              if (!latestResponse.ok || !latest.project)
                throw Error(
                  latest.error ??
                    "Cloud recovery could not read the reviewed world.",
                );
              if (!lastJournalAcknowledgement)
                throw Error(
                  "Cloud recovery could not verify the reviewed world.",
                );
              try {
                assertCloudJournalBaseline(lastJournalAcknowledgement, {
                  revision: latest.project.revision,
                  snapshotToken: latest.project.snapshotToken,
                });
              } catch (error) {
                setConflict(latest.project);
                throw error;
              }
              baseRevision = lastJournalAcknowledgement.revision;
              baseSnapshotToken = lastJournalAcknowledgement.snapshotToken;
            }
            const response = await fetch("/api/projects", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                project,
                baseRevision,
                baseSnapshotToken,
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
            lastJournalAcknowledgement = {
              revision: result.revision,
              snapshotToken: result.snapshotToken,
            };
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
            lastJournalRunId = runId;
            return run;
          },
        }
      : undefined;
  };
  const submit = async (
    e?: FormEvent,
    text = prompt,
    selectedOverride?: string | null,
    retrying = false,
  ) => {
    e?.preventDefault();
    if (submission.current.checking) return;
    dictation.cancel();
    const instruction = text.trim();
    if (!instruction) return;
    if (
      chatGPTPreferredTier &&
      chatGPTRestoreStatus !== "idle" &&
      connection.provider !== "chatgpt-hosted"
    )
      return;
    submission.current.checking = true;
    const sequence = ++submission.current.sequence;
    const current = useOrb.getState();
    const originalWorld = captureCloudRequest();
    const selectedConnectionVersion = connectionVersion.current;
    try {
      if (rendererAvailabilityRef.current !== "ready") return;
      let selectedConnection: Connection & { authoringReview?: boolean } = {
        ...connection,
        renderer: rendererMode,
      };
      let reviewOptIn =
        !authoringReviewOptOut &&
        authoringReviewEligibleForConnection(
          capabilities.authoringReview,
          connection,
          reviewAllowanceAvailable,
        );
      if (!isGenerationReady(connection)) {
        if (connection.provider === "chatgpt-hosted") {
          setModal("settings");
          return;
        }
        const allowance = await refreshTrial();
        if (
          rendererAvailabilityRef.current !== "ready" ||
          !originalWorld() ||
          (!retrying && textarea.current?.value !== text) ||
          connectionVersion.current !== selectedConnectionVersion
        )
          return;
        if (!allowance.enabled || allowance.remaining < 1) {
          if (!textarea.current?.value) setPrompt(instruction);
          if (allowance.offline) {
            useOrb.getState().set({
              error: connectionNoticeCopy("offline"),
            });
            return;
          }
          setModalNotice(
            connectionNoticeCopy(
              allowance.enabled ? "free-exhausted" : "free-unavailable",
              { signedIn: Boolean(user) },
            ),
          );
          setModal(user || !capabilities.accounts ? "settings" : "account");
          return;
        }
        selectedConnection = {
          provider: "free",
          model: "",
          key: "",
          renderer: rendererMode,
        };
        reviewOptIn =
          !authoringReviewOptOut &&
          authoringReviewEligibleForConnection(
            capabilities.authoringReview,
            selectedConnection,
            allowance.enabled && allowance.remaining > 0,
          );
      }
      if (rendererAvailabilityRef.current !== "ready") return;
      selectedConnection = {
        ...selectedConnection,
        authoringReview: reviewOptIn,
      };
      const accountVersion = accountGeneration.current;
      const originProjectId = current.project.id;
      const requestProject = useOrb.getState().project;
      const selectedCandidate =
        selectedOverride !== undefined
          ? selectedOverride
          : useOrb.getState().selected;
      const selectedId =
        requestProject.id === originProjectId &&
        selectedCandidate &&
        requestProject.entities.some(
          (entity) => entity.id === selectedCandidate,
        )
          ? selectedCandidate
          : undefined;
      let baselineOverride: CloudBaseline | null | undefined;
      if (user && selectedConnection.authoringReview) {
        try {
          baselineOverride = await resolveCloudJournalBaseline(
            requestProject,
            accountVersion,
            { allowMissing: true },
          );
        } catch (error) {
          if (originalWorld() && sequence === submission.current.sequence) {
            setCloudBaseline(null);
            useOrb.getState().set({
              error:
                error instanceof Error
                  ? error.message
                  : "Cloud recovery could not verify the saved world.",
            });
          }
          return;
        }
        if (
          !originalWorld() ||
          sequence !== submission.current.sequence ||
          connectionVersion.current !== selectedConnectionVersion ||
          rendererAvailabilityRef.current !== "ready" ||
          (!retrying && textarea.current?.value !== text)
        )
          return;
        setCloudBaseline(
          baselineOverride
            ? { projectId: originProjectId, value: baselineOverride }
            : null,
        );
      }
      submittedPrompt.current = instruction;
      setPrompt("");
      const journal = createGenerationJournal(
        originProjectId,
        accountVersion,
        baselineOverride,
      );
      useOrb.getState().set({ selected: selectedId });
      const retryFeedback =
        retrying && current.generationRecovery?.projectId === originProjectId
          ? current.generationRecovery.feedback
          : undefined;
      const generation = useOrb
        .getState()
        .run(instruction, selectedConnection, journal, retryFeedback);
      const generationWorld = captureCloudRequest();
      submission.current.checking = false;
      await generation;
      const failedRecovery = useOrb.getState().generationRecovery;
      if (
        failedRecovery?.projectId === originProjectId &&
        failedRecovery.projectId === useOrb.getState().project.id &&
        generationWorld() &&
        !textarea.current?.value
      )
        setPrompt(failedRecovery.prompt);
      const providerFailure = useOrb.getState().generationErrorCode;
      if (
        selectedConnection.provider === "chatgpt-hosted" &&
        (providerFailure === "CHATGPT_CONNECTION_REQUIRED" ||
          providerFailure === CHATGPT_STALE_CONNECTION_CODE) &&
        generationWorld() &&
        connectionVersion.current === selectedConnectionVersion &&
        submission.current.sequence === sequence
      ) {
        setConnection({
          ...selectedConnection,
          model: "",
          effort: undefined,
          key: "",
        });
        if (!textarea.current?.value) setPrompt(instruction);
        setModal("settings");
      }
      if (
        selectedConnection.provider !== "free" &&
        (providerFailure === "PROVIDER_AUTH_REJECTED" ||
          providerFailure === "PROVIDER_ACCESS_DENIED") &&
        generationWorld() &&
        connectionVersion.current === selectedConnectionVersion &&
        submission.current.sequence === sequence
      ) {
        setConnection({
          ...selectedConnection,
          ...(providerFailure === "PROVIDER_AUTH_REJECTED" ? { key: "" } : {}),
        });
        setOAuthMessage(useOrb.getState().error);
        setModalNotice(
          connectionNoticeCopy(
            providerFailure === "PROVIDER_AUTH_REJECTED"
              ? "provider-key-rejected"
              : "provider-access-denied",
            { signedIn: Boolean(user) },
          ),
        );
        if (!textarea.current?.value) setPrompt(instruction);
        setModal("settings");
      }
      const quotaExceeded =
        useOrb.getState().generationErrorCode === "FREE_LIMIT_REACHED";
      const providerUnavailable =
        noticeForGenerationCode(useOrb.getState().generationErrorCode) ===
        "free-unavailable";
      if (selectedConnection.provider === "free") {
        await refreshTrial();
        if (
          quotaExceeded &&
          generationWorld() &&
          connectionVersion.current === selectedConnectionVersion &&
          submission.current.sequence === sequence
        ) {
          if (!textarea.current?.value) setPrompt(instruction);
          setModalNotice(
            connectionNoticeCopy("free-exhausted", {
              signedIn: Boolean(user),
            }),
          );
          setModal(user || !capabilities.accounts ? "settings" : "account");
        }
        if (
          providerUnavailable &&
          generationWorld() &&
          connectionVersion.current === selectedConnectionVersion &&
          submission.current.sequence === sequence
        ) {
          if (!textarea.current?.value) setPrompt(instruction);
          setModalNotice(connectionNoticeCopy("free-unavailable"));
          setModal("settings");
        }
      }
    } finally {
      if (submission.current.sequence === sequence) {
        submission.current.checking = false;
        submittedPrompt.current = null;
      }
    }
  };
  const generationRecovery =
    s.generationRecovery?.projectId === s.project.id
      ? s.generationRecovery
      : undefined;
  const dismissGenerationFailure = () => {
    s.set({
      error: "",
      notice: "",
      generationErrorCode: undefined,
      generationRecovery: undefined,
    });
  };
  const restoreLastWorking = () => {
    const current = useOrb.getState();
    const recovery = current.generationRecovery;
    if (!recovery || recovery.projectId !== current.project.id) return;
    const selectedId =
      recovery.selected &&
      recovery.checkpoint.entities.some(
        (entity) => entity.id === recovery.selected,
      )
        ? recovery.selected
        : undefined;
    current.set({
      project: recovery.checkpoint,
      selected: selectedId,
      error: "",
      notice: "Last working world restored.",
      generationErrorCode: undefined,
      generationRecovery: undefined,
    });
    void useOrb.getState().save();
  };
  const retryFailedGeneration = () => {
    const current = useOrb.getState();
    const recovery = current.generationRecovery;
    if (
      !recovery ||
      recovery.projectId !== current.project.id ||
      current.building ||
      submission.current.checking
    )
      return;
    const selectedId =
      recovery.selected &&
      current.project.entities.some((entity) => entity.id === recovery.selected)
        ? recovery.selected
        : undefined;
    current.set({ selected: selectedId, error: "", notice: "" });
    setPrompt(recovery.prompt);
    void submit(undefined, recovery.prompt, selectedId ?? null, true);
  };
  const draftReviewContinuation = () => {
    const current = useOrb.getState();
    const continuation = current.reviewContinuation;
    if (!continuation) return;
    if (
      continuation.projectId !== current.project.id ||
      continuation.revision !== current.project.revision
    ) {
      current.set({ reviewContinuation: undefined });
      return;
    }
    current.set({ selected: undefined });
    setPrompt(
      `Continue improving the scene and address this remaining review finding: ${continuation.issue}`,
    );
    window.requestAnimationFrame(() => textarea.current?.focus());
  };
  const draftInterruptedReviewContinuation = () => {
    const current = useOrb.getState();
    const continuation = current.interruptedReviewContinuation;
    if (!continuation) return;
    if (
      continuation.projectId !== current.project.id ||
      continuation.revision !== current.project.revision ||
      !current.saved
    ) {
      current.set({ interruptedReviewContinuation: undefined });
      return;
    }
    current.set({ selected: undefined });
    setPrompt(
      `Continue improving the saved scene based on the original request: ${continuation.prompt}`,
    );
    window.requestAnimationFrame(() => textarea.current?.focus());
  };
  const resumeInterruptedReview = async () => {
    if (submission.current.checking) return;
    const current = useOrb.getState();
    const continuation = current.interruptedReviewContinuation;
    if (
      !continuation ||
      current.building ||
      current.readOnly ||
      !current.saved ||
      current.project.id !== continuation.projectId ||
      current.project.revision !== continuation.revision ||
      rendererAvailabilityRef.current !== "ready"
    )
      return;

    submission.current.checking = true;
    const sequence = ++submission.current.sequence;
    let accountVersion: number | undefined;
    try {
      let resumeConnection: Connection;
      if (continuation.provider === "free") {
        resumeConnection = {
          provider: "free",
          model: "",
          key: "",
          renderer: rendererMode,
        };
      } else {
        const originalConnectionReady =
          connection.provider === continuation.provider &&
          connection.model === continuation.model &&
          connection.effort === continuation.effort &&
          isGenerationReady(connection) &&
          (continuation.provider !== "chatgpt-hosted" ||
            chatGPTRestoreStatus === "idle");
        if (!originalConnectionReady) {
          const providerName =
            continuation.provider === "gateway"
              ? "AI Gateway"
              : continuation.provider === "chatgpt-hosted"
                ? "ChatGPT"
                : "OpenRouter";
          current.set({
            error: `Reconnect ${providerName} with the original model and settings to resume this review.`,
          });
          setModal("settings");
          return;
        }
        resumeConnection = { ...connection, renderer: rendererMode };
      }
      current.set({ error: "", notice: "" });
      accountVersion = accountGeneration.current;
      let baselineOverride: CloudBaseline | null | undefined;
      if (user) {
        baselineOverride = await resolveCloudJournalBaseline(
          current.project,
          accountVersion,
          { requireJournalRun: true, continuation },
        );
        if (!baselineOverride)
          throw Error("The saved review's cloud checkpoint is unavailable.");
        setCloudBaseline({
          projectId: current.project.id,
          value: baselineOverride,
        });
      }
      const journal = createGenerationJournal(
        current.project.id,
        accountVersion,
        baselineOverride,
      );
      await current.resumeInterruptedReview(resumeConnection, journal);
    } catch (error) {
      const latest = useOrb.getState();
      if (
        accountVersion !== undefined &&
        accountGeneration.current === accountVersion &&
        latest.project.id === current.project.id &&
        latest.project.revision === current.project.revision &&
        latest.interruptedReviewContinuation === continuation
      )
        latest.set({
          error:
            error instanceof Error
              ? error.message
              : "Cloud recovery could not verify the saved review.",
        });
    } finally {
      if (continuation.provider === "free") await refreshTrial();
      if (submission.current.sequence === sequence)
        submission.current.checking = false;
    }
  };
  const reset = () => {
    s.set({
      score: [],
      gameScore: 0,
      won: false,
      lost: false,
      reset: s.reset + 1,
    });
    focusGameplayRegion();
  };
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
  const downloadDiagnostics = () => {
    try {
      const blob = new Blob([exportGenerationDiagnostics()], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "orbsie-generation-diagnostics.json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setModalError("Diagnostics could not be downloaded.");
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
      const recovered = recoveredGenerationProject(run);
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
          thumbnail: capturePublicationThumbnail(),
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
  const adminReset = async () => {
    setBusy(true);
    setModalError("");
    try {
      const response = await fetch("/api/trial/reset-recent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Reset unavailable.");
      setModalError(
        `Cleared ${data.cleared} visitor limit rows. Visitors active in the last 5 minutes can claim free prompts again.`,
      );
      await refreshTrial();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Reset failed.");
    } finally {
      setBusy(false);
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
      data-renderer-availability={rendererAvailability}
    >
      <div className="sky-texture" aria-hidden="true" />
      <div className="cosmic-backdrop" aria-hidden="true" />
      <div
        ref={gameplayRegion}
        className="scene gameplay-region"
        role="region"
        aria-label="Gameplay area"
        tabIndex={-1}
      >
        <World
          key={rendererRetryToken}
          rendererRetryToken={rendererRetryToken}
          onRendererReady={handleRendererReady}
          onRendererFallback={handleRendererFallback}
          onError={handleRendererError}
        />
      </div>
      {(rendererAvailability === "unavailable" ||
        (graphicsAdvisory && graphicsHelpVisible)) && (
        <div
          className={`graphics-error ${graphicsAdvisory ? "is-advisory" : ""}`.trim()}
          role={graphicsAdvisory ? "status" : "alert"}
          aria-live={graphicsAdvisory ? "polite" : "assertive"}
        >
          <GraphicsGuidance
            advisory={graphicsAdvisory}
            detail={graphicsError}
            onRetry={retryRenderer}
            onDismiss={
              graphicsAdvisory ? () => setGraphicsHelpVisible(false) : undefined
            }
            onDownload={!publicView ? download : undefined}
          />
        </div>
      )}
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
                focusGameplayRegion();
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
          ref={composer}
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
              <div
                className="chat-messages"
                ref={chat}
                tabIndex={0}
                onWheel={() => {
                  chatUserScrollIntent.current = true;
                }}
                onTouchMove={() => {
                  chatUserScrollIntent.current = true;
                }}
                onPointerDown={() => {
                  chatUserScrollIntent.current = true;
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "ArrowUp" ||
                    event.key === "ArrowDown" ||
                    event.key === "PageUp" ||
                    event.key === "PageDown" ||
                    event.key === "Home" ||
                    event.key === "End" ||
                    event.key === " "
                  )
                    chatUserScrollIntent.current = true;
                }}
                onScroll={(event) => {
                  if (chatAutoScroll.current || !chatUserScrollIntent.current)
                    return;
                  chatUserScrollIntent.current = false;
                  const element = event.currentTarget;
                  chatFollowsLatest.current =
                    element.scrollHeight -
                      element.scrollTop -
                      element.clientHeight <
                    32;
                }}
              >
                {messagesBeforeActivity.map(renderProjectMessage)}
                {nonterminalActivity.map((activity, index) =>
                  renderAuthoringActivity(
                    activity,
                    terminalActivity.length === 0 &&
                      index === nonterminalActivity.length - 1,
                  ),
                )}
                {messagesAfterActivity.map((message, index) =>
                  renderProjectMessage(
                    message,
                    messagesBeforeActivity.length + index,
                  ),
                )}
                {terminalActivity.map((activity, index) =>
                  renderAuthoringActivity(
                    activity,
                    index === terminalActivity.length - 1,
                  ),
                )}
                {reviewContinuation && (
                  <div className="review-continuation">
                    <button
                      type="button"
                      aria-label={`Draft a follow-up prompt to address: ${reviewContinuation.issue}`}
                      data-testid="authoring-review-continuation"
                      onClick={draftReviewContinuation}
                    >
                      Address the remaining issue <ArrowUpRight size={12} />
                    </button>
                  </div>
                )}
                {interruptedReviewContinuation && (
                  <div className="review-continuation">
                    <button
                      type="button"
                      aria-label="Resume the saved scene review"
                      data-testid="interrupted-review-resume"
                      disabled={
                        s.building ||
                        submission.current.checking ||
                        s.readOnly ||
                        !s.saved ||
                        rendererAvailability !== "ready"
                      }
                      onClick={() => void resumeInterruptedReview()}
                    >
                      Resume review <ArrowUpRight size={12} />
                    </button>
                    <p className="review-continuation-cost">
                      {interruptedReviewContinuation.provider === "free"
                        ? "Uses one free prompt."
                        : `Uses up to three model calls through the original ${
                            interruptedReviewContinuation.provider === "gateway"
                              ? "AI Gateway"
                              : interruptedReviewContinuation.provider ===
                                  "chatgpt-hosted"
                                ? "ChatGPT"
                                : "OpenRouter"
                          } connection.`}
                    </p>
                    <button
                      type="button"
                      aria-label="Draft a prompt to continue improving the saved scene"
                      data-testid="interrupted-review-continuation"
                      onClick={draftInterruptedReviewContinuation}
                    >
                      Continue improving <ArrowUpRight size={12} />
                    </button>
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
            {chatGPTRestoreStatus !== "idle" && (
              <div
                className="setup-note"
                role={
                  chatGPTRestoreStatus === "transient" ||
                  chatGPTRestoreStatus === "reconnect"
                    ? "alert"
                    : "status"
                }
                data-testid="chatgpt-startup-restore"
              >
                {chatGPTRestoreStatus === "restoring" &&
                  "Restoring your ChatGPT connection…"}
                {chatGPTRestoreStatus === "transient" && (
                  <>
                    ChatGPT is temporarily unavailable. Your saved choice is
                    still here.
                    <button
                      type="button"
                      className="text-button"
                      onClick={retryChatGPTStartupRestore}
                    >
                      Retry
                    </button>
                  </>
                )}
                {chatGPTRestoreStatus === "reconnect" && (
                  <>
                    ChatGPT needs to be connected again. Your saved quality
                    choice is still here.
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setModal("settings")}
                    >
                      Reconnect ChatGPT
                    </button>
                  </>
                )}
                {chatGPTRestoreStatus === "selection-required" && (
                  <>
                    Saved ChatGPT quality “{chatGPTPreferredTier}” is not
                    available in this catalog. Choose another quality.
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setModal("settings")}
                    >
                      Choose quality
                    </button>
                  </>
                )}
              </div>
            )}
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
            {capabilities.authoringReview && (
              <label
                className="setup-note authoring-review-choice"
                data-testid="authoring-review-toggle"
              >
                <input
                  type="checkbox"
                  checked={authoringReviewEnabled}
                  disabled={!authoringReviewEligible}
                  onChange={(event) =>
                    setAuthoringReviewOptOut(!event.target.checked)
                  }
                />
                <span>
                  <strong>Review the rendered scene</strong>
                  <small>
                    {authoringReviewEligible
                      ? "Up to four model calls, including this generation."
                      : "Connect a provider or restore your free allowance to enable review."}
                  </small>
                </span>
              </label>
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
              {isGenerationReady(connection) &&
              connection.provider !== "free" ? (
                <ModelQualitySelector
                  providerLabel={qualityProviderLabel}
                  leading={
                    providerLogoKind(connection.provider) ? (
                      <ProviderLogo
                        provider={providerLogoKind(connection.provider)!}
                        className="provider-logo-inline"
                      />
                    ) : undefined
                  }
                  selected={selectedQuality}
                  options={qualityOptions}
                  status={qualityCatalogStatus}
                  onOpen={() =>
                    connection.provider === "chatgpt-hosted"
                      ? loadChatGPTModels()
                      : loadProviderModels(connection.provider)
                  }
                  onRetry={() =>
                    connection.provider === "chatgpt-hosted"
                      ? loadChatGPTModels(true)
                      : loadProviderModels(connection.provider, true)
                  }
                  onSelect={selectQuality}
                />
              ) : (
                <button
                  type="button"
                  className="mode-button"
                  onClick={() => setModal("settings")}
                >
                  {providerLogoKind(connection.provider) ? (
                    <ProviderLogo
                      provider={providerLogoKind(connection.provider)!}
                      className="provider-logo-inline"
                    />
                  ) : (
                    <span className="mode-dot" />
                  )}
                  {connection.provider === "chatgpt-hosted"
                    ? "Choose ChatGPT model"
                    : trial.enabled && trial.remaining > 0
                      ? `${trial.remaining} free prompt${trial.remaining === 1 ? "" : "s"}`
                      : "Connect provider"}
                  <ChevronDown size={12} />
                </button>
              )}
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
                    disabled={
                      !prompt.trim() || rendererAvailability !== "ready"
                    }
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
              {isGenerationReady(connection) && connection.provider !== "free"
                ? connection.provider === "chatgpt-hosted"
                  ? `ChatGPT · ${selectedQuality ?? "Custom model"}`
                  : "AI key added"
                : connection.provider === "chatgpt-hosted"
                  ? "Choose ChatGPT model"
                  : trial.enabled && trial.remaining > 0
                    ? `${trial.remaining} free prompt${trial.remaining === 1 ? "" : "s"} left`
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
                    onPointerDown={(e) => beginPlayerPointerInput(e, key)}
                    onPointerUp={(e) => endPlayerPointerInput(e, key)}
                    onPointerCancel={(e) => endPlayerPointerInput(e, key)}
                    onLostPointerCapture={(e) => endPlayerPointerInput(e, key)}
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
          <span className="toast-copy">{s.error || s.notice}</span>
          {s.error && (
            <div className="toast-actions">
              {generationRecovery && (
                <>
                  <button
                    type="button"
                    className="toast-action retry"
                    disabled={s.building}
                    onClick={retryFailedGeneration}
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    className="toast-action"
                    onClick={restoreLastWorking}
                  >
                    Use last working
                  </button>
                </>
              )}
              <button
                type="button"
                className="toast-action"
                onClick={downloadDiagnostics}
              >
                Download diagnostics
              </button>
            </div>
          )}
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={dismissGenerationFailure}
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
                {providerLogoKind(connection.provider) ? (
                  <ProviderLogo
                    provider={providerLogoKind(connection.provider)!}
                    className="provider-logo-modal"
                  />
                ) : (
                  <Sparkles />
                )}
              </span>
              <h2>A little creative power</h2>
              <p>
                {connection.provider === "chatgpt-hosted"
                  ? "Your ChatGPT account is connected for this browser session."
                  : "Connect your AI account or API key to create and edit your world."}
              </p>
              {modalNotice && (
                <div className="setup-note" role="status">
                  {modalNotice}
                </div>
              )}
              {capabilities.chatgptHosted ? (
                <ChatGPTConnection
                  signedIn={Boolean(user)}
                  ensureProviderSession={ensureProviderSession}
                  startRequest={chatGPTStartRequest}
                  onStartRequestConsumed={consumeChatGPTStartRequest}
                  generationEnabled={capabilities.chatgptGeneration}
                  onUseChatGPT={useChatGPT}
                  onDisconnect={disconnectChatGPT}
                />
              ) : (
                <p className="fine-print">
                  ChatGPT connection is unavailable here — OpenRouter and
                  Gateway use their own billing.
                </p>
              )}
              {trial.enabled &&
                trial.remaining > 0 &&
                s.generationErrorCode !== "FREE_PROVIDER_UNAVAILABLE" && (
                  <button
                    className="primary full"
                    disabled={oauthBusy}
                    onClick={() => {
                      setConnection({
                        provider: "openrouter",
                        model: "",
                        key: "",
                      });
                      setModal(null);
                    }}
                  >
                    Use {trial.remaining} free prompt
                    {trial.remaining === 1 ? "" : "s"}
                  </button>
                )}
              {capabilities.isAdmin && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void adminReset()}
                >
                  Reset free-prompt limits for visitors active in the last 5
                  minutes
                </button>
              )}
              {connection.provider === "chatgpt-hosted" ? (
                <div className="setup-note">
                  <strong>
                    ChatGPT · {connection.model} · {connection.effort} reasoning
                  </strong>
                  <button
                    className="text-button"
                    onClick={() =>
                      setConnection({
                        provider: "openrouter",
                        model: "",
                        key: "",
                      })
                    }
                  >
                    Choose another provider
                  </button>
                </div>
              ) : (
                <>
                  <label>
                    Provider
                    <select
                      aria-label="Provider"
                      value={connection.provider}
                      disabled={oauthBusy}
                      onChange={(e) =>
                        setConnection({
                          ...connection,
                          provider: e.target.value,
                          model: "",
                          key: "",
                          effort: undefined,
                        })
                      }
                    >
                      <option value="openrouter">OpenRouter</option>
                      <option value="gateway">Vercel AI Gateway</option>
                    </select>
                  </label>
                  {connection.provider === "openrouter" && (
                    <button
                      type="button"
                      className="primary full"
                      disabled={oauthBusy || s.building}
                      onClick={() => void connectOpenRouter()}
                    >
                      <ProviderLogo provider="openrouter" />
                      {oauthBusy ? "Connecting…" : "Connect with OpenRouter"}
                    </button>
                  )}
                  {oauthMessage && (
                    <p className="fine-print" role="status">
                      {oauthMessage}
                    </p>
                  )}
                  <div
                    className="model-modes"
                    role="group"
                    aria-label="Creation quality"
                  >
                    {modelModesForProvider(connection.provider).map((mode) => {
                      const available = models.some(
                        (model) => model.id === mode.id,
                      );
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          aria-pressed={connection.model === mode.id}
                          disabled={!available || oauthBusy}
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
                      Estimated 3D suitability, highest first; unranked models
                      lack comparable evidence.{" "}
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
                        disabled={oauthBusy}
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
                          disabled={oauthBusy}
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
                      disabled={oauthBusy}
                      onChange={(e) =>
                        setConnection({ ...connection, key: e.target.value })
                      }
                      placeholder="Kept in memory for this tab only"
                    />
                  </label>
                  <p className="fine-print">
                    Your key stays in this tab only and is sent through Orbsie
                    to your provider.
                  </p>
                </>
              )}
              {connection.provider !== "chatgpt-hosted" && (
                <button
                  className="primary full"
                  disabled={oauthBusy || !isGenerationReady(connection)}
                  onClick={() => setModal(null)}
                >
                  Continue with this connection
                  <ArrowUpRight size={16} />
                </button>
              )}
              {connection.key && connection.provider !== "chatgpt-hosted" && (
                <button
                  className="text-button"
                  disabled={oauthBusy}
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
              <div className="local-data-row">
                <span className="fine-print">
                  Content-free troubleshooting history stays on this device.
                </span>
                <button
                  type="button"
                  className="text-button diagnostics-download"
                  onClick={downloadDiagnostics}
                >
                  Download diagnostics
                </button>
                {resetArmed ? (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setResetArmed(false);
                      void (async () => {
                        setBusy(true);
                        try {
                          await s.resetLocalData();
                          location.reload();
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }}
                  >
                    Really delete? Tap again to erase local drafts
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => setResetArmed(true)}
                  >
                    Reset saved data on this device
                  </button>
                )}
              </div>
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
              {modalNotice && (
                <div className="setup-note" role="status">
                  {modalNotice}
                </div>
              )}
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
                  {capabilities.isAdmin && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void adminReset()}
                    >
                      Reset free-prompt limits for visitors active in the last 5
                      minutes
                    </button>
                  )}
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
                      id="account-email"
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
              {!user && (
                <>
                  <p className="fine-print">
                    Or connect a provider to keep creating
                  </p>
                  <div className="connection-choice">
                    {capabilities.chatgptHosted && (
                      <button
                        type="button"
                        disabled={oauthBusy || busy}
                        onClick={() => {
                          setChatGPTStartRequest((request) => request + 1);
                          setModal("settings");
                        }}
                      >
                        <ProviderLogo provider="chatgpt" />
                        <strong>Connect ChatGPT</strong>
                        <span>
                          Use your ChatGPT subscription in this browser.
                        </span>
                        <ArrowUpRight />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={oauthBusy || busy}
                      onClick={() => {
                        void connectOpenRouter().then((started) => {
                          if (!started)
                            setProviderHint(
                              "Could not start sign-in. Check that your world can be saved and try again.",
                            );
                        });
                      }}
                    >
                      <ProviderLogo provider="openrouter" />
                      <strong>Connect with OpenRouter</strong>
                      <span>OpenRouter OAuth — their billing.</span>
                      <ArrowUpRight />
                    </button>
                    <button
                      type="button"
                      disabled={oauthBusy || busy}
                      onClick={() => {
                        setConnection({
                          ...connection,
                          provider: "gateway",
                          model: "",
                          key: "",
                          effort: undefined,
                        });
                        setModal("settings");
                      }}
                    >
                      <ProviderLogo provider="gateway" />
                      <strong>Connect Vercel AI Gateway</strong>
                      <span>Bring your Vercel AI Gateway API key.</span>
                      <ArrowUpRight />
                    </button>
                  </div>
                  {providerHint && (
                    <p className="fine-print" role="status">
                      {providerHint}
                    </p>
                  )}
                </>
              )}
              <div className="local-data-row">
                {storageUsage && (
                  <span className="fine-print">
                    Saved data: ~{storageUsage}
                  </span>
                )}
                <button
                  type="button"
                  className="text-button diagnostics-download"
                  onClick={downloadDiagnostics}
                >
                  Download diagnostics
                </button>
                {resetArmed ? (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setResetArmed(false);
                      void (async () => {
                        setBusy(true);
                        try {
                          await s.resetLocalData();
                          location.reload();
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }}
                  >
                    Really delete? Tap again to erase local drafts
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => setResetArmed(true)}
                  >
                    Reset saved data on this device
                  </button>
                )}
              </div>
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
