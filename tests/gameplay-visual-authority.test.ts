import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  playableEntities,
  type SoftwareGeometryEntry,
} from "../src/components/software-world";
import {
  gameplayEntityForVisualState,
  stepGameplay,
  type PlayerState,
} from "../src/lib/gameplay";
import { formationRecipeIdentity } from "../src/lib/formation-completion";
import {
  displayedGameplayRecipeMatchesCurrent,
  displayedGameplayRecipeScopeForProject,
  gameplayEntityFromDisplayedRecipe,
  recordDisplayedGameplayRecipe,
  type DisplayedGameplayRecipeRegistry,
  type DisplayedGameplayRecipeScope,
} from "../src/lib/gameplay-visual-authority";
import { entitySchema, type Entity, type Project } from "../src/lib/protocol";

function project(entities: Entity[]): Project {
  return { entities } as Project;
}

function assetEntity(
  id: string,
  assetId: "kenney.nature.tree-default" | "kenney.nature.mushroom-red",
  behavior?: Entity["behavior"],
): Entity {
  return entitySchema.parse({
    id,
    label: id,
    position: [0, 0, 0],
    stage: "ready",
    behavior,
    geometry: { kind: "asset", assetId, detail: "refined" },
  });
}

const generatedMetadata = {
  version: 1,
  sha256: "a".repeat(64),
  bytes: 1024,
  source: "local-blender",
  blenderVersion: "4.0.2",
  bounds: { min: [-1, 0, -1], max: [1, 1, 1] },
  createdAt: "2026-09-08T00:00:00Z",
};

function generatedEntity(
  id: string,
  options: {
    metadata?: boolean;
    platform?: boolean;
    behavior?: Entity["behavior"];
  } = {},
): Entity {
  return entitySchema.parse({
    id,
    label: id,
    position: [0, 0, 0],
    stage: "ready",
    behavior: options.behavior,
    geometry: {
      kind: "generated",
      collision: options.platform ? "platform" : "none",
      detail: "refined",
      job: {
        version: 1,
        parts: [{ id: "body", shape: "box", color: "#6ead60" }],
      },
      ...(options.metadata ? { model: generatedMetadata } : {}),
    },
  });
}

function stepWith(
  entities: Entity[],
  state: PlayerState,
): ReturnType<typeof stepGameplay> {
  return stepGameplay(
    state,
    { x: 0, z: 0, jump: false },
    entities,
    [],
    0,
    0.02,
  );
}

describe("gameplay authority without a visual lease", () => {
  it("keeps metadata-backed ready assets collectible in both renderer paths", () => {
    const collectible = assetEntity(
      "asset-collectible",
      "kenney.nature.tree-default",
      {
        type: "collect",
      },
    );
    const webglPlayable = gameplayEntityForVisualState(collectible, false);
    const softwarePlayable = playableEntities(
      project([collectible]),
      new Map(),
    )[0];

    expect(webglPlayable.stage).toBe("ready");
    expect(softwarePlayable.stage).toBe("ready");
    for (const playable of [webglPlayable, softwarePlayable]) {
      const result = stepWith([playable], {
        position: [0, 0.5, 0],
        velocityY: 0,
      });
      expect(result.collected).toContain(collectible.id);
      expect(result.contacts).toContain(collectible.id);
    }
  });

  it("keeps generated metadata platforms supportive in both renderer paths", () => {
    const platform = generatedEntity("generated-platform", {
      metadata: true,
      platform: true,
    });
    const webglPlayable = gameplayEntityForVisualState(platform, false);
    const softwarePlayable = playableEntities(
      project([platform]),
      new Map(),
    )[0];

    expect(webglPlayable.stage).toBe("ready");
    expect(softwarePlayable.stage).toBe("ready");
    for (const playable of [webglPlayable, softwarePlayable]) {
      const result = stepWith([playable], {
        position: [0, 1.43, 0],
        velocityY: -2,
      });
      expect(result.groundedOn).toBe(platform.id);
      expect(result.platformContactId).toBe(platform.id);
      expect(result.contacts).toContain(platform.id);
    }
  });

  it("keeps the last-good displayed recipe during a pending replacement", () => {
    const oldDisplayed = assetEntity(
      "replacement",
      "kenney.nature.tree-default",
      { type: "collect" },
    );
    const current = assetEntity("replacement", "kenney.nature.mushroom-red", {
      type: "collect",
    });
    const webglPlayable = gameplayEntityForVisualState(
      current,
      false,
      oldDisplayed,
    );
    const displayedGeometry = new THREE.BoxGeometry();
    const entry: SoftwareGeometryEntry = {
      geometry: displayedGeometry,
      ready: true,
      sourceRecipe: oldDisplayed.geometry,
      sourceStage: oldDisplayed.stage,
    };
    const softwarePlayable = playableEntities(
      project([current]),
      new Map([[current.id, entry]]),
    )[0];

    for (const playable of [webglPlayable, softwarePlayable]) {
      expect(playable.geometry).toBe(oldDisplayed.geometry);
      expect(playable.stage).toBe("ready");
      expect(
        stepWith([playable], { position: [0, 0.5, 0], velocityY: 0 }).collected,
      ).toContain(current.id);
    }
    displayedGeometry.dispose();
  });

  it("uses an entity-scoped display record when another entity loaded the same replacement asset", () => {
    const oldDisplayed = assetEntity(
      "pending-entity",
      "kenney.nature.tree-default",
      { type: "collect" },
    );
    const pendingReplacement = assetEntity(
      "pending-entity",
      "kenney.nature.mushroom-red",
      { type: "collect" },
    );
    const otherLoadedEntity = assetEntity(
      "other-entity",
      "kenney.nature.mushroom-red",
    );
    const displayed: DisplayedGameplayRecipeRegistry = new Map();
    recordDisplayedGameplayRecipe(
      displayed,
      oldDisplayed,
      formationRecipeIdentity(oldDisplayed),
    );
    recordDisplayedGameplayRecipe(
      displayed,
      otherLoadedEntity,
      formationRecipeIdentity(otherLoadedEntity),
    );

    const webglPending = gameplayEntityFromDisplayedRecipe(
      pendingReplacement,
      displayed,
      formationRecipeIdentity(pendingReplacement),
    );
    const webglLoadedOther = gameplayEntityFromDisplayedRecipe(
      otherLoadedEntity,
      displayed,
      formationRecipeIdentity(otherLoadedEntity),
    );
    expect(webglPending.geometry).toBe(oldDisplayed.geometry);
    expect(webglLoadedOther.geometry).toBe(otherLoadedEntity.geometry);
    expect(
      stepWith([webglPending], {
        position: [0.32, 0.5, 0],
        velocityY: 0,
      }).collected,
    ).toContain(pendingReplacement.id);

    const pendingGeometry = new THREE.BoxGeometry();
    const loadedGeometry = new THREE.BoxGeometry();
    const softwareGeometryEntries = new Map([
      [
        pendingReplacement.id,
        {
          geometry: pendingGeometry,
          ready: true,
          sourceRecipe: oldDisplayed.geometry,
          sourceStage: oldDisplayed.stage,
        },
      ],
      [
        otherLoadedEntity.id,
        {
          geometry: loadedGeometry,
          ready: true,
          sourceRecipe: otherLoadedEntity.geometry,
          sourceStage: otherLoadedEntity.stage,
        },
      ],
    ]) as Map<string, SoftwareGeometryEntry>;
    const softwarePlayable = playableEntities(
      project([pendingReplacement, otherLoadedEntity]),
      softwareGeometryEntries,
    );
    expect(softwarePlayable[0].geometry).toBe(oldDisplayed.geometry);
    expect(softwarePlayable[1].geometry).toBe(otherLoadedEntity.geometry);
    expect(
      stepWith([softwarePlayable[0]], {
        position: [0.32, 0.5, 0],
        velocityY: 0,
      }).collected,
    ).toContain(pendingReplacement.id);

    recordDisplayedGameplayRecipe(
      displayed,
      pendingReplacement,
      formationRecipeIdentity(pendingReplacement),
    );
    const afterCommit = gameplayEntityFromDisplayedRecipe(
      pendingReplacement,
      displayed,
      formationRecipeIdentity(pendingReplacement),
    );
    expect(afterCommit.geometry).toBe(pendingReplacement.geometry);
    expect(
      stepWith([afterCommit], {
        position: [0.32, 0.5, 0],
        velocityY: 0,
      }).collected,
    ).not.toContain(pendingReplacement.id);
    softwareGeometryEntries.set(pendingReplacement.id, {
      geometry: pendingGeometry,
      ready: true,
      sourceRecipe: pendingReplacement.geometry,
      sourceStage: pendingReplacement.stage,
    });
    const softwareAfterCommit = playableEntities(
      project([pendingReplacement, otherLoadedEntity]),
      softwareGeometryEntries,
    )[0];
    expect(softwareAfterCommit.geometry).toBe(pendingReplacement.geometry);
    expect(
      stepWith([softwareAfterCommit], {
        position: [0.32, 0.5, 0],
        velocityY: 0,
      }).collected,
    ).not.toContain(pendingReplacement.id);
    pendingGeometry.dispose();
    loadedGeometry.dispose();
  });

  it("scopes layout commits to the new project before pruning removed ids", () => {
    const previousProjectEntity = assetEntity(
      "shared-id",
      "kenney.nature.tree-default",
    );
    const nextProjectEntity = assetEntity(
      "shared-id",
      "kenney.nature.mushroom-red",
    );
    let scope: DisplayedGameplayRecipeScope = {
      projectId: "project-a",
      registry: new Map(),
    };
    recordDisplayedGameplayRecipe(
      scope.registry,
      previousProjectEntity,
      formationRecipeIdentity(previousProjectEntity),
    );
    const previousRegistry = scope.registry;

    scope = displayedGameplayRecipeScopeForProject(scope, "project-b");
    expect(scope.registry).not.toBe(previousRegistry);
    expect(scope.registry.size).toBe(0);

    // A child layout effect can now commit into B before the parent prunes ids.
    recordDisplayedGameplayRecipe(
      scope.registry,
      nextProjectEntity,
      formationRecipeIdentity(nextProjectEntity),
    );
    const currentIds = new Set([nextProjectEntity.id]);
    for (const id of scope.registry.keys())
      if (!currentIds.has(id)) scope.registry.delete(id);

    expect(scope.registry.get(nextProjectEntity.id)?.geometry).toBe(
      nextProjectEntity.geometry,
    );
    expect(previousRegistry.get(previousProjectEntity.id)?.geometry).toBe(
      previousProjectEntity.geometry,
    );
  });

  it("requires the committed objective recipe identity to match the current ready entity", () => {
    const previousRecipe = assetEntity(
      "objective",
      "kenney.nature.tree-default",
    );
    const currentRecipe = assetEntity(
      "objective",
      "kenney.nature.mushroom-red",
    );
    const registry: DisplayedGameplayRecipeRegistry = new Map();
    recordDisplayedGameplayRecipe(
      registry,
      previousRecipe,
      formationRecipeIdentity(previousRecipe),
    );

    expect(
      displayedGameplayRecipeMatchesCurrent(
        registry.get(currentRecipe.id),
        formationRecipeIdentity(currentRecipe),
        currentRecipe.stage,
      ),
    ).toBe(false);
    expect(
      displayedGameplayRecipeMatchesCurrent(
        registry.get(previousRecipe.id),
        formationRecipeIdentity(previousRecipe),
        "seed",
      ),
    ).toBe(false);

    recordDisplayedGameplayRecipe(
      registry,
      currentRecipe,
      formationRecipeIdentity(currentRecipe),
    );
    expect(
      displayedGameplayRecipeMatchesCurrent(
        registry.get(currentRecipe.id),
        formationRecipeIdentity(currentRecipe),
        currentRecipe.stage,
      ),
    ).toBe(true);
  });

  it("does not invent collision authority for generated jobs without bounds metadata", () => {
    const provisional = generatedEntity("provisional-platform", {
      platform: true,
    });
    const webglPlayable = gameplayEntityForVisualState(provisional, false);
    const softwarePlayable = playableEntities(
      project([provisional]),
      new Map(),
    )[0];

    expect(webglPlayable.stage).toBe("seed");
    expect(softwarePlayable.stage).toBe("seed");
    for (const playable of [webglPlayable, softwarePlayable]) {
      const result = stepWith([playable], {
        position: [0, 1.43, 0],
        velocityY: -2,
      });
      expect(result.groundedOn).toBeUndefined();
      expect(result.platformContactId).toBeUndefined();
      expect(result.contacts).not.toContain(provisional.id);
    }
  });
});
