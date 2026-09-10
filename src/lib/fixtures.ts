import type {
  Command,
  Entity,
  Project,
  ProceduralGeometryRecipe,
} from "./protocol";
const e = (
  id: string,
  label: string,
  kind: ProceduralGeometryRecipe["kind"],
  position: Entity["position"],
  color: string,
  scale: Entity["scale"] = [1, 1, 1],
  behavior: Entity["behavior"] = { type: "static" },
): Entity => ({
  id,
  label,
  position,
  color,
  scale,
  geometry: { kind, detail: "refined" },
  behavior,
  stage: "ready",
});
export function fixtureEntities(garden = false): Entity[] {
  if (garden)
    return [
      e("pond", "Lily pond", "pond", [0, 0.06, 0], "#72cdd0", [1.8, 1, 1.4]),
      ...Array.from({ length: 12 }, (_, i) =>
        e(
          `flower-${i}`,
          `Flower ${i + 1}`,
          "flower",
          [
            Math.cos(i * 2.4) * (3 + (i % 3)),
            0,
            Math.sin(i * 2.4) * (3 + (i % 3)),
          ],
          ["#f29aba", "#ffd588", "#bbafe8"][i % 3],
          [1, 1 + (i % 3) * 0.3, 1],
          { type: "bloom" },
        ),
      ),
      e("tree-0", "Willow", "tree", [-5, 0, -3], "#75a96c", [1.4, 1.5, 1.4]),
      e("arch", "Garden arch", "arch", [0, 0, -5], "#f4dbaa", [1.5, 1.5, 1]),
    ];
  return [
    e(
      "tree-0",
      "Friendly tree",
      "tree",
      [-4.5, 0, 1],
      "#6d9d58",
      [1.25, 1.35, 1.25],
    ),
    e("tree-1", "Little tree", "tree", [4, 0, 3], "#8fb866"),
    e("pond", "Quiet pond", "pond", [-3, 0.04, -3], "#7bced0", [1.6, 1, 1.25]),
    e(
      "platform-0",
      "First platform",
      "platform",
      [0, 0.3, 1],
      "#eedda5",
      [1.5, 0.6, 1.5],
      { type: "move", speed: 0.7, amplitude: 0.6, axis: "y" },
    ),
    e(
      "platform-1",
      "Middle platform",
      "platform",
      [1, 0.6, -1.5],
      "#efc79c",
      [1.5, 0.7, 1.5],
      { type: "move", speed: 1, amplitude: 0.8, axis: "x" },
    ),
    e(
      "platform-2",
      "Last platform",
      "platform",
      [0, 0.7, -4],
      "#ddc4e9",
      [1.6, 0.7, 1.6],
      { type: "move", speed: 0.6, amplitude: 0.5, axis: "y" },
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      e(
        `crystal-${i}`,
        `Crystal ${i + 1}`,
        "crystal",
        [[-2, 2, 3, -1, 2][i], 0.8, [3, 2, -1, -3, -5][i]],
        "#a1f0d7",
        [0.6, 0.6, 0.6],
        { type: "collect" },
      ),
    ),
    e(
      "portal",
      "Sunlight portal",
      "arch",
      [0, 0, -6.5],
      "#eddbb7",
      [1.2, 1.2, 1.2],
      { type: "portal" },
    ),
    e("tree-2", "Tall tree", "tree", [5, 0, -4], "#77a664", [1.15, 1.6, 1.15]),
    e("rock", "Pebbles", "rock", [-5, 0, 4], "#bed0bc", [1.3, 0.7, 1]),
  ];
}
export function* fixtureCommands(garden = false): Generator<Command> {
  const entities = fixtureEntities(garden);
  for (const entity of entities) {
    yield {
      type: "reserve_entity",
      entity: { ...entity, geometry: undefined, stage: "seed" },
    };
    yield {
      type: "set_geometry",
      id: entity.id,
      geometry: { ...entity.geometry!, detail: "coarse" },
    };
    yield { type: "set_geometry", id: entity.id, geometry: entity.geometry! };
  }
  yield {
    type: "commit_revision",
    message: garden
      ? "Your little garden is ready. Click a flower to help it bloom. Select an object in Edit to change it."
      : "Your island is alive! Collect five crystals, explore the moving platforms, and find the portal. You can play now or change any object.",
  };
}
export function* fixtureEdit(
  project: Project,
  prompt: string,
  selected?: string,
): Generator<Command> {
  const p = prompt.toLowerCase();
  const target =
    (p.includes("middle platform")
      ? project.entities.find((e) => e.id === "platform-1")
      : project.entities.find((e) => e.id === selected)) ??
    project.entities.find((e) =>
      p.includes("platform")
        ? e.id === "platform-1"
        : e.geometry?.kind === "tree",
    );
  let changed = false;
  if (target) {
    if (p.includes("mushroom")) {
      yield {
        type: "set_geometry",
        id: target.id,
        geometry: { kind: "mushroom", detail: "refined" },
      };
      yield { type: "set_material", id: target.id, color: "#ed99b5" };
      changed = true;
    }
    if (p.includes("tall") || p.includes("giant") || p.includes("bigger")) {
      yield {
        type: "set_transform",
        id: target.id,
        scale: [
          target.scale[0] * 1.3,
          target.scale[1] * 1.5,
          target.scale[2] * 1.3,
        ],
      };
      changed = true;
    }
    if (p.includes("pink") && !p.includes("mushroom")) {
      yield { type: "set_material", id: target.id, color: "#ed99b5" };
      changed = true;
    }
    if (p.includes("slow")) {
      yield {
        type: "set_behavior",
        id: target.id,
        behavior: { type: "move", speed: 0.3, amplitude: 0.8, axis: "x" },
      };
      changed = true;
    }
    if (p.includes("move") || p.includes("moving")) {
      yield {
        type: "set_behavior",
        id: target.id,
        behavior: { type: "move", speed: 0.6, amplitude: 1, axis: "y" },
      };
      changed = true;
    }
  }
  if (p.includes("crystal") && (p.includes("add") || p.includes("more"))) {
    for (let i = 0; i < 2; i++) {
      const entity = e(
        `crystal-${project.revision}-${i}`,
        "New crystal",
        "crystal",
        [i * 3 - 2, 0.8, 0],
        "#a1f0d7",
        [0.6, 0.6, 0.6],
        { type: "collect" },
      );
      yield {
        type: "reserve_entity",
        entity: { ...entity, geometry: undefined, stage: "seed" },
      };
      yield { type: "set_geometry", id: entity.id, geometry: entity.geometry! };
    }
    changed = true;
  }
  yield {
    type: "commit_revision",
    message: changed
      ? "Done. I kept the rest of your world in place. This is a scripted demo edit; connect an AI provider for open-ended changes."
      : "This demo supports making a tree a giant pink mushroom, moving or slowing a platform, and adding two crystals. Connect an AI provider for other ideas.",
  };
}
