import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import World from "../components/world";
import { useOrb } from "../lib/store";
import { projectSchema } from "../lib/protocol";
import "./player.css";
import { configureGeneratedGeometryResolver } from "../lib/use-generated-geometry";
import {
  beginPlayerPointerInput,
  endPlayerPointerInput,
} from "../lib/player-input";
import {
  generatedModelPath,
  MAX_GENERATED_MODEL_BYTES,
} from "../lib/generated-models";
import { playerControlsHelp } from "../lib/player-controls";
import { GraphicsGuidance } from "../components/graphics-guidance";
configureGeneratedGeometryResolver(async (hash, signal) => {
  const response = await fetch(`./${generatedModelPath(hash)}`, {
    signal,
    redirect: "error",
    credentials: "omit",
  });
  if (!response.ok || !response.body)
    throw Error("This world's generated model is missing.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_GENERATED_MODEL_BYTES)
        throw Error("The generated model exceeds its size budget.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
});
function PlayerApp() {
  const s = useOrb();
  const [error, setError] = useState("");
  const [graphicsError, setGraphicsError] = useState("");
  const [graphicsHelpVisible, setGraphicsHelpVisible] = useState(false);
  const [softwareRenderer, setSoftwareRenderer] = useState(false);
  const [rendererRetryToken, setRendererRetryToken] = useState(0);
  const [rendererReady, setRendererReady] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [touchDevice, setTouchDevice] = useState(false);
  const gameplayRegion = useRef<HTMLDivElement>(null);
  const focusGameplayRegion = () =>
    gameplayRegion.current?.focus({ preventScroll: true });
  const resetGame = () => {
    s.set({
      score: [],
      gameScore: 0,
      won: false,
      lost: false,
      reset: s.reset + 1,
    });
    focusGameplayRegion();
  };
  const ready = rendererReady && sceneReady;
  const retryRenderer = () => {
    if (!graphicsError) return;
    setGraphicsError("");
    setGraphicsHelpVisible(false);
    setSoftwareRenderer(false);
    setRendererReady(false);
    setSceneReady(false);
    setRendererRetryToken((token) => token + 1);
  };
  const collectibles = s.project.entities.filter(
    (e) => e.stage === "ready" && e.behavior?.type === "collect",
  );
  useEffect(() => {
    fetch("./project.json")
      .then((r) => {
        if (!r.ok) throw Error("Could not open this world.");
        return r.json();
      })
      .then((p) => {
        s.load(projectSchema.parse(p), true);
        s.set({ readOnly: true });
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(any-pointer: coarse)");
    const update = () =>
      setTouchDevice(media.matches || navigator.maxTouchPoints > 0);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return (
    <main
      className={touchDevice ? "touch-layout" : undefined}
      data-ready={ready && !error}
    >
      <div
        ref={gameplayRegion}
        className="canvas gameplay-region"
        role="region"
        aria-label="Gameplay area"
        tabIndex={-1}
      >
        {loaded && (
          <World
            key={rendererRetryToken}
            rendererRetryToken={rendererRetryToken}
            onReady={() => setSceneReady(true)}
            onRendererReady={(renderer) => {
              setRendererReady(true);
              if (renderer === "webgl") {
                setGraphicsError("");
                setGraphicsHelpVisible(false);
                setSoftwareRenderer(false);
              }
            }}
            onRendererFallback={(message) => {
              setGraphicsError(message);
              setGraphicsHelpVisible(true);
              setSoftwareRenderer(true);
            }}
            onError={(message) => {
              setGraphicsError(message);
              setGraphicsHelpVisible(true);
              setSoftwareRenderer(false);
              setRendererReady(false);
              setSceneReady(false);
            }}
          />
        )}
      </div>
      <header>
        <a href="https://orbsie.com">◉ orbsie</a>
        <span>{s.project.title}</span>
        <button onClick={resetGame}>↻ Restart</button>
      </header>
      {graphicsError && graphicsHelpVisible ? (
        <div className="message graphics-player-error" role="status">
          <GraphicsGuidance
            standalone
            advisory={softwareRenderer}
            detail={graphicsError}
            onRetry={retryRenderer}
            onDismiss={
              softwareRenderer ? () => setGraphicsHelpVisible(false) : undefined
            }
          />
        </div>
      ) : (
        (!ready || error) && (
          <div className="message">{error || "Opening your little world…"}</div>
        )
      )}
      <div
        className="score"
        hidden={
          !ready ||
          Boolean(error) ||
          (!softwareRenderer && Boolean(graphicsError))
        }
      >
        {s.project.game ? (
          `Score: ${s.gameScore}`
        ) : (
          <>
            ◆ {collectibles.filter((e) => s.score.includes(e.id)).length} /{" "}
            {collectibles.length}
          </>
        )}
      </div>
      <footer>{playerControlsHelp(s.project, touchDevice)}</footer>
      <div className="controls">
        {["w", "a", "s", "d", " "].map((key, i) => (
          <button
            key={key}
            aria-label={["Forward", "Left", "Back", "Right", "Jump"][i]}
            onPointerDown={(e) => beginPlayerPointerInput(e, key)}
            onPointerUp={(e) => endPlayerPointerInput(e, key)}
            onPointerCancel={(e) => endPlayerPointerInput(e, key)}
            onLostPointerCapture={(e) => endPlayerPointerInput(e, key)}
          >
            {["↑", "←", "↓", "→", "↗"][i]}
          </button>
        ))}
      </div>
      {(s.won || s.lost) && (
        <div className="win">
          <h1>{s.lost ? "Try another adventure" : "Adventure complete"}</h1>
          <p>
            {s.project.game
              ? `Final score: ${s.gameScore}`
              : "You found every crystal and made it home."}
          </p>
          <button onClick={resetGame}>Play again</button>
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<PlayerApp />);
