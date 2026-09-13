import type { GameProgramStatus } from "./game-program";
import type { PlayerState, Vec3 } from "./gameplay";

export type GameplayObservationEntity = {
  id: string;
  behavior: string | null;
  stage: string;
  position: Vec3;
  scale: Vec3;
};

export type GameplayObservation = {
  renderer: "webgl" | "software";
  projectId: string;
  revision: number;
  atMs: number;
  simulationDeltaMs: number;
  playing: boolean;
  player: {
    position: Vec3;
    velocityY: number;
    groundedOn?: string;
    supportPosition?: Vec3;
  };
  entities: GameplayObservationEntity[];
  contacts: string[];
  platformContacts: string[];
  bounceContacts: string[];
  platformContactCounts: Record<string, number>;
  bounceContactCounts: Record<string, number>;
  collected: string[];
  scoreIds: string[];
  gameScore: number;
  status: GameProgramStatus | null;
  won: boolean;
  lost: boolean;
  reset: number;
  sessionGeneration: number;
};

type GameplayObservationGlobal = typeof globalThis & {
  __ORBSIE_GAMEPLAY_READ_REQUESTED__?: boolean;
  __ORBSIE_GAMEPLAY_READ__?: () => GameplayObservation;
};

type GameplayObservationInput = Omit<
  GameplayObservation,
  | "atMs"
  | "platformContacts"
  | "bounceContacts"
  | "platformContactCounts"
  | "bounceContactCounts"
> & {
  platformContactId?: string;
  bounceContactId?: string;
};

let accumulatorKey = "";
let platformContactCounts: Record<string, number> = Object.create(null);
let bounceContactCounts: Record<string, number> = Object.create(null);
const MAX_CONTACT_EVENTS = 4096;

export function gameplayObservationRequested(): boolean {
  return (
    (globalThis as GameplayObservationGlobal)
      .__ORBSIE_GAMEPLAY_READ_REQUESTED__ === true
  );
}

/**
 * Publish copied primitive state for the opt-in browser acceptance harness.
 * The callback closes over no store, session, geometry, or mutator.
 */
export function publishGameplayObservation(
  value: GameplayObservationInput,
): void {
  const target = globalThis as GameplayObservationGlobal;
  if (target.__ORBSIE_GAMEPLAY_READ_REQUESTED__ !== true) return;
  const nextKey = [
    value.projectId,
    value.revision,
    value.renderer,
    value.reset,
    value.sessionGeneration,
  ].join(":");
  if (nextKey !== accumulatorKey) {
    accumulatorKey = nextKey;
    platformContactCounts = Object.create(null);
    bounceContactCounts = Object.create(null);
  }
  if (value.platformContactId)
    platformContactCounts[value.platformContactId] = Math.min(
      MAX_CONTACT_EVENTS,
      (platformContactCounts[value.platformContactId] ?? 0) + 1,
    );
  if (value.bounceContactId)
    bounceContactCounts[value.bounceContactId] = Math.min(
      MAX_CONTACT_EVENTS,
      (bounceContactCounts[value.bounceContactId] ?? 0) + 1,
    );
  const copyPlayer = (player: PlayerState) => ({
    position: [...player.position] as Vec3,
    velocityY: player.velocityY,
    ...(player.groundedOn ? { groundedOn: player.groundedOn } : {}),
    ...(player.supportPosition
      ? { supportPosition: [...player.supportPosition] as Vec3 }
      : {}),
  });
  const { platformContactId, bounceContactId, ...base } = value;
  const snapshot: GameplayObservation = {
    ...base,
    atMs: performance.now(),
    player: copyPlayer(value.player),
    entities: value.entities.map((entity) => ({
      ...entity,
      position: [...entity.position] as Vec3,
      scale: [...entity.scale] as Vec3,
    })),
    contacts: [...value.contacts],
    platformContacts: platformContactId ? [platformContactId] : [],
    bounceContacts: bounceContactId ? [bounceContactId] : [],
    platformContactCounts: Object.assign(
      Object.create(null),
      platformContactCounts,
    ),
    bounceContactCounts: Object.assign(
      Object.create(null),
      bounceContactCounts,
    ),
    collected: [...value.collected],
    scoreIds: [...value.scoreIds],
  };
  const freeze = (entry: unknown): unknown => {
    if (entry && typeof entry === "object" && !Object.isFrozen(entry)) {
      Object.freeze(entry);
      for (const child of Object.values(entry)) freeze(child);
    }
    return entry;
  };
  freeze(snapshot);
  target.__ORBSIE_GAMEPLAY_READ__ = () => snapshot;
}
