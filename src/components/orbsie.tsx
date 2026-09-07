"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
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
  KeyRound,
  Mic,
  MicOff,
} from "lucide-react";
import { useDictation } from "@/lib/use-dictation";
import { useOrb } from "@/lib/store";
import { exportWorld, shareWorld, decodeWorld } from "@/lib/export";
const World = dynamic(() => import("./world"), {
  ssr: false,
  loading: () => (
    <div className="world-loading">
      <span className="loading-orb" />
    </div>
  ),
});
type Connection = { provider: string; model: string; key: string };
export default function Orbsie() {
  const s = useOrb();
  const [prompt, setPrompt] = useState("");
  const dictation = useDictation(prompt, setPrompt, (message) =>
    s.set({ error: message }),
  );
  const [modal, setModal] = useState<"settings" | "share" | "account" | null>(
    null,
  );
  const [connection, setConnection] = useState<Connection>({
    provider: "openrouter",
    model: "",
    key: "",
  });
  const [demo, setDemo] = useState(true);
  const [sheet, setSheet] = useState(true);
  const [shareUrl, setShareUrl] = useState("");
  const [modalError, setModalError] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
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
  const [cloudRevision, setCloudRevision] = useState<number | null>(null);
  const [objectList, setObjectList] = useState(false);
  const [publicView, setPublicView] = useState(false);
  const chat = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const landing = s.phase === "landing";
  const selected = s.project.entities.find((e) => e.id === s.selected);
  const total = s.project.entities.filter(
    (e) => e.behavior?.type === "collect",
  ).length;
  useEffect(() => {
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
        if (c.accounts)
          fetch("/api/auth/get-session")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d?.user) setUser(d.user);
            })
            .catch(() => {});
      })
      .catch(() => {});
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
    if (!modal || modal !== "settings") return;
    fetch(`/api/models?provider=${connection.provider}`)
      .then((r) => r.json())
      .then((d) => setModels(d.models ?? []))
      .catch(() => setModels([]));
  }, [modal, connection.provider]);
  useEffect(() => {
    dictation.cancel();
  }, [modal, s.phase, s.selected, s.playing, dictation.cancel]);
  const submit = (e?: FormEvent, text = prompt) => {
    e?.preventDefault();
    dictation.cancel();
    if (!text.trim()) return;
    if (!demo && (!connection.key || !connection.model)) {
      setModal("settings");
      return;
    }
    setPrompt("");
    void s.run(text.trim(), demo, connection);
  };
  const reset = () => s.set({ score: [], won: false, reset: s.reset + 1 });
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
    try {
      const url = shareWorld(s.project);
      setShareUrl(url);
      await navigator.clipboard.writeText(url);
      s.set({ notice: "Play link copied." });
    } catch {
      setShareUrl(shareWorld(s.project));
    } finally {
      setBusy(false);
    }
  };
  const cloudSave = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/projects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: s.project,
          baseRevision: cloudRevision,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setCloudRevision(data.revision);
      s.set({ notice: "Saved to your account." });
    } catch (e) {
      s.set({ error: e instanceof Error ? e.message : "Cloud save failed." });
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
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
      if (!response.ok) throw Error(data.error);
      setShareUrl(data.url);
      setModalError(
        "Deployment submitted. Open the link after the Vercel build completes.",
      );
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Publishing failed.");
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
      setUser(data.user);
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
                  <span>
                    {demo ? "Interactive demo" : "Your creative companion"}
                  </span>
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
                onClick={() => setModal("settings")}
              >
                <span className="mode-dot" />
                {demo
                  ? "Demo"
                  : connection.provider === "openrouter"
                    ? "OpenRouter"
                    : "AI Gateway"}
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
              {demo ? "Scripted demo" : "AI connected"}
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
                  {s.score.length} <span>/ {total}</span>
                </strong>
                <span>
                  {total ? "Crystals collected" : "Explore your garden"}
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
          {s.won && (
            <div className="win-card">
              <span>✧</span>
              <h2>
                A little adventure,
                <br />
                beautifully done.
              </h2>
              <p>You found every crystal and made it home.</p>
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
                Explore the demo, or connect your own AI to make something
                entirely yours.
              </p>
              <div className="connection-choice">
                <button
                  className={demo ? "chosen" : ""}
                  onClick={() => setDemo(true)}
                >
                  <Sun size={18} />
                  <strong>Interactive demo</strong>
                  <span>
                    Play with a scripted island or garden. No key needed.
                  </span>
                  {demo && <Check size={16} />}
                </button>
                <button
                  className={!demo ? "chosen" : ""}
                  onClick={() => setDemo(false)}
                >
                  <KeyRound size={18} />
                  <strong>Your AI connection</strong>
                  <span>Open-ended ideas, using your own API credits.</span>
                  {!demo && <Check size={16} />}
                </button>
              </div>
              {!demo && (
                <>
                  <label>
                    Provider
                    <select
                      value={connection.provider}
                      onChange={(e) =>
                        setConnection({
                          ...connection,
                          provider: e.target.value,
                          model: "",
                        })
                      }
                    >
                      <option value="openrouter">OpenRouter</option>
                      <option value="gateway">Vercel AI Gateway</option>
                    </select>
                  </label>
                  <label>
                    Model
                    <select
                      value={connection.model}
                      onChange={(e) =>
                        setConnection({ ...connection, model: e.target.value })
                      }
                    >
                      <option value="">Choose a model</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
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
                    Your key is sent only to Orbsie’s authenticated relay and
                    your selected provider. It is never saved with your world.{" "}
                    {user ? "" : "Sign in before generating."}
                  </p>
                  {!capabilities.accounts && (
                    <div className="setup-note">
                      AI creation will be available when account storage is
                      connected. The interactive demo works now.
                    </div>
                  )}
                </>
              )}
              <button className="primary full" onClick={() => setModal(null)}>
                Continue {demo ? "with the demo" : "with this connection"}
                <ArrowUpRight size={16} />
              </button>
              {connection.key && (
                <button
                  className="text-button"
                  onClick={() => {
                    setConnection({ ...connection, key: "" });
                    setDemo(true);
                  }}
                >
                  Disconnect and clear key
                </button>
              )}
              <p className="fine-print">
                ChatGPT subscription connection is being evaluated and is not
                available in this build.
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
                  <button
                    className="primary full"
                    disabled={busy || !user}
                    onClick={publish}
                  >
                    {busy
                      ? "Publishing…"
                      : user
                        ? "Publish Orb"
                        : "Sign in to publish"}
                  </button>
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
                    className="text-button"
                    onClick={async () => {
                      await fetch("/api/auth/sign-out", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: "{}",
                      });
                      setUser(null);
                      setConnection({ ...connection, key: "" });
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
