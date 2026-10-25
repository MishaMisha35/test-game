import type { QualityPreset } from "./SettingsSystem";
export type Phase = "menu" | "playing" | "paused" | "dead" | "victory";
export type Panel =
  "none" | "inventory" | "journal" | "map" | "skills" | "settings" | "help";
export type EnemyKind = "wraith" | "guardian";
export interface Point {
  x: number;
  z: number;
}
export interface HudState {
  phase: Phase;
  panel: Panel;
  name: string;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  stamina: number;
  maxStamina: number;
  xp: number;
  nextLevel: number;
  level: number;
  gold: number;
  potions: number;
  kills: number;
  totalEnemies: number;
  questAccepted: boolean;
  questComplete: boolean;
  bossAwake: boolean;
  bossHealth: number;
  bossMaxHealth: number;
  position: Point;
  heading: number;
  location: string;
  time: string;
  interaction: string;
  message: string;
  spellCooldown: number;
  dodgeCooldown: number;
  muted: boolean;
  quality: QualityPreset;
  fov: number;
  cameraEffects: number;
  motionBlur: boolean;
  adaptiveQuality: boolean;
  timeOfDay: number;
  combo: number;
  parryReady: boolean;
  hasSave: boolean;
  enemies: Array<Point & { boss: boolean; alive: boolean }>;
  objective: Point;
  fps: number;
  sensitivity: number;
}
export type UIAction =
  | "start"
  | "continue"
  | "resume"
  | "restart"
  | "menu"
  | "save"
  | "load"
  | "heal"
  | "sound"
  | "quality"
  | "sensitivity"
  | "fov"
  | "cameraEffects"
  | "motionBlur"
  | "adaptiveQuality"
  | "acceptQuest"
  | "close"
  | "inventory"
  | "journal"
  | "map"
  | "skills"
  | "settings"
  | "help"
  | "upgradeWarrior"
  | "upgradeMage"
  | "upgradeRogue";
export interface WorldObstacle {
  x: number;
  z: number;
  hx: number;
  hz: number;
  height: number;
  rotation?: number;
}
export interface Interactable {
  id: string;
  type: "npc" | "chest" | "shrine";
  x: number;
  z: number;
  label: string;
  used: boolean;
}
export const SPAWN = { x: 0, z: 17 };
export const ENEMY_SPAWNS = [
  { x: -12, z: -10 },
  { x: 9, z: -18 },
  { x: -4, z: -33 },
  { x: 20, z: -37 },
];
export const BOSS_SPAWN = { x: 0, z: -58 };
