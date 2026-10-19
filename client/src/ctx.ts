import type * as THREE from 'three';
import type { Repo, AgentInfo } from '../../shared/types.ts';
import type { Engine, DayNight } from './engine.ts';
import type { Input } from './input.ts';
import type { Player } from './player.ts';
import type { Interactions, Labels } from './interact.ts';

/** Everything game systems share. Created in main.ts. */
export interface GameCtx {
  engine: Engine;
  input: Input;
  player: Player;
  interactions: Interactions;
  labels: Labels;
  dayNight: DayNight | null;
  repos: Repo[];
  /** Live agent registry, kept fresh from the WebSocket (by agent id). */
  agents: Map<string, AgentInfo>;
  /** Go inside a repo's building. */
  enterBuilding(repo: Repo): Promise<void>;
  /** Leave the current interior and return to the city at that building's door. */
  exitBuilding(): void;
}

export interface Scene3D {
  scene: THREE.Scene;
  update(dt: number): void;
  dispose(): void;
}
