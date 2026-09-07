import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import World from "../components/world";
import { useOrb } from "../lib/store";
import { projectSchema } from "../lib/protocol";
import "./player.css";
function PlayerApp() {
  const s = useOrb();
  const [error, setError] = useState("");
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
        setReady(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main>
      <div className="canvas">
        <World />
      </div>
      <header>
        <a href="https://orbsie.com">◉ orbsie</a>
        <span>{s.project.title}</span>
        <button
          onClick={() => s.set({ score: [], won: false, reset: s.reset + 1 })}
        >
          ↻ Restart
        </button>
      </header>
      {!ready && (
        <div className="message">{error || "Opening your little world…"}</div>
      )}
      <div className="score">
        ◆ {collectibles.filter((e) => s.score.includes(e.id)).length} /{" "}
        {collectibles.length}
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
      {s.won && (
        <div className="win">
          <h1>
            A little adventure,
            <br />
            beautifully done.
          </h1>
          <p>You found every crystal and made it home.</p>
          <button
            onClick={() => s.set({ score: [], won: false, reset: s.reset + 1 })}
          >
            Play again
          </button>
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<PlayerApp />);
