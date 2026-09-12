import { createRoot } from "react-dom/client";
import { _roots } from "@react-three/fiber";
import World from "../src/components/world";
import {
  beginPlayerPointerInput,
  endPlayerPointerInput,
  type PlayerInputLatencySnapshot,
} from "../src/lib/player-input";
import { blankProject } from "../src/lib/protocol";
import { useOrb } from "../src/lib/store";

type InputLatencyFixture = {
  ready: () => boolean;
  setPlaying: (playing: boolean) => void;
  status: () => unknown;
};

const snapshots: PlayerInputLatencySnapshot[] = [];
let worldReady = false;
const project = blankProject();
project.id = "input-consumption-latency";
project.title = "Input consumption latency fixture";
await useOrb.getState().load(project, true);
useOrb.setState({
  phase: "editing",
  playing: true,
  building: false,
  error: "",
});

function rendererState() {
  const canvas = document.querySelector("canvas");
  return canvas ? _roots.get(canvas)?.store.getState() : undefined;
}

function recordSnapshot(snapshot: PlayerInputLatencySnapshot) {
  snapshots.push({
    sampleCount: snapshot.sampleCount,
    samplesMs: [...snapshot.samplesMs],
  });
  if (snapshots.length > 128) snapshots.shift();
}

function InputButton({ label, keyName }: { label: string; keyName: string }) {
  return (
    <button
      aria-label={label}
      style={{
        position: "relative",
        zIndex: 2,
        width: 120,
        height: 64,
        margin: 8,
        touchAction: "none",
      }}
      onPointerDown={(event) => beginPlayerPointerInput(event, keyName)}
      onPointerUp={(event) => endPlayerPointerInput(event, keyName)}
      onPointerCancel={(event) => endPlayerPointerInput(event, keyName)}
    >
      {label}
    </button>
  );
}

function Fixture() {
  return (
    <>
      <World onReady={() => (worldReady = true)} onInputLatency={recordSnapshot} />
      <div
        style={{
          position: "fixed",
          left: 12,
          top: 12,
          zIndex: 2,
          display: "flex",
        }}
      >
        <InputButton label="Move d" keyName="d" />
        <InputButton label="Jump" keyName=" " />
      </div>
    </>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<Fixture />);

const fixture: InputLatencyFixture = {
  ready: () => worldReady,
  setPlaying: (playing) => useOrb.getState().set({ playing }),
  status: () => ({
    snapshots: snapshots.map((snapshot) => ({
      sampleCount: snapshot.sampleCount,
      samplesMs: [...snapshot.samplesMs],
    })),
    latest: snapshots.at(-1) ?? null,
    renderer: (() => {
      const renderer = rendererState()?.gl;
      const context = renderer?.getContext();
      if (!renderer || !context) return { status: "unavailable" };
      const debug = context.getExtension("WEBGL_debug_renderer_info") as {
        UNMASKED_RENDERER_WEBGL: number;
        UNMASKED_VENDOR_WEBGL: number;
      } | null;
      return {
        status: "ready",
        renderer: debug
          ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL)
          : context.getParameter(context.RENDERER),
        vendor: debug
          ? context.getParameter(debug.UNMASKED_VENDOR_WEBGL)
          : context.getParameter(context.VENDOR),
        webglVersion: context.getParameter(context.VERSION),
      };
    })(),
  }),
};
(window as unknown as { inputLatencyFixture: InputLatencyFixture }).inputLatencyFixture = fixture;
