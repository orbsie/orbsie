import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import World from "../components/world";
import { useOrb } from "../lib/store";
import { projectSchema } from "../lib/protocol";
import "./player.css";
import { configureGeneratedGeometryResolver } from "../lib/use-generated-geometry";
import {
  generatedModelPath,
  MAX_GENERATED_MODEL_BYTES,
} from "../lib/generated-models";
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
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
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
  return (
    <main data-ready={ready}>
      <div className="canvas">
        {loaded && <World onReady={() => setReady(true)} onError={setError} />}
      </div>
      <header>
        <a href="https://orbsie.com">◉ orbsie</a>
        <span>{s.project.title}</span>
        <button
          onClick={() =>
            s.set({
              score: [],
              gameScore: 0,
              won: false,
              lost: false,
              reset: s.reset + 1,
            })
          }
        >
          ↻ Restart
        </button>
      </header>
      {(!ready || error) && (
        <div className="message">{error || "Opening your little world…"}</div>
      )}
      <div className="score" hidden={!ready || Boolean(error)}>
        {s.project.game ? (
          `Score: ${s.gameScore}`
        ) : (
          <>
            ◆ {collectibles.filter((e) => s.score.includes(e.id)).length} /{" "}
            {collectibles.length}
          </>
        )}
      </div>
      <footer>
        W A S D / Arrow keys to move · Space to jump · Click flowers to bloom
      </footer>
      <div className="controls">
        {["w", "a", "s", "d", " "].map((key, i) => (
          <button
            key={key}
            aria-label={["Forward", "Left", "Back", "Right", "Jump"][i]}
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
          <button
            onClick={() =>
              s.set({
                score: [],
                gameScore: 0,
                won: false,
                lost: false,
                reset: s.reset + 1,
              })
            }
          >
            Play again
          </button>
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<PlayerApp />);
