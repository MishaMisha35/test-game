interface SaveFields {
  name: string;
  position: { x: number; y: number; z: number };
  health: number;
  mana: number;
  stamina: number;
  level: number;
  xp: number;
  gold: number;
  potions: number;
  kills: number;
  questAccepted: boolean;
  questComplete: boolean;
  deadEnemies: number[];
  openedChests: string[];
  upgrades: { warrior: number; mage: number; rogue: number };
  bossDefeated: boolean;
}

/** The original single-chapter format remains readable without rewriting its slot. */
export interface LegacySaveData extends SaveFields {
  version: 1;
}

export interface SaveData extends SaveFields {
  version: 2;
  miniBossDefeated: boolean;
}

// Keep the existing slot so an update can discover a player's original progress.
export const SAVE_KEY = "eternal-realms-v1";
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = (value: unknown): value is number =>
  nonnegative(value) && Number.isSafeInteger(value);
const between = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

function validFields(
  value: Record<string, unknown>,
  maximumEnemyID: number,
): boolean {
  if (
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    value.name.length > 40
  )
    return false;
  if (
    !record(value.position) ||
    !between(value.position.x, -65, 65) ||
    !between(value.position.y, -10, 100) ||
    !between(value.position.z, -85, 65)
  )
    return false;
  if (!["health", "mana", "stamina"].every((key) => nonnegative(value[key])))
    return false;
  if (
    !["level", "xp", "gold", "potions", "kills"].every((key) =>
      integer(value[key]),
    )
  )
    return false;
  if ((value.level as number) < 1 || (value.kills as number) > 4) return false;
  if (
    !["questAccepted", "questComplete", "bossDefeated"].every(
      (key) => typeof value[key] === "boolean",
    )
  )
    return false;
  if (
    !record(value.upgrades) ||
    !["warrior", "mage", "rogue"].every((key) =>
      integer((value.upgrades as Record<string, unknown>)[key]),
    )
  )
    return false;
  if (
    !Array.isArray(value.deadEnemies) ||
    value.deadEnemies.length > maximumEnemyID + 1 ||
    !value.deadEnemies.every((id) => integer(id) && id <= maximumEnemyID) ||
    new Set(value.deadEnemies).size !== value.deadEnemies.length
  )
    return false;
  if (
    !Array.isArray(value.openedChests) ||
    value.openedChests.length > 100 ||
    !value.openedChests.every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= 64,
    ) ||
    new Set(value.openedChests).size !== value.openedChests.length
  )
    return false;
  return true;
}

/** Retains the original v1 acceptance rules, including old redundant boss flags. */
export function isLegacySaveData(value: unknown): value is LegacySaveData {
  return record(value) && value.version === 1 && validFields(value, 4);
}

/** Current saves must agree with their recorded world defeats. */
export function isSaveData(value: unknown): value is SaveData {
  if (!record(value) || value.version !== 2 || !validFields(value, 5))
    return false;
  if (typeof value.miniBossDefeated !== "boolean") return false;
  const defeated = value.deadEnemies as number[];
  return (
    value.miniBossDefeated === defeated.includes(5) &&
    value.bossDefeated === defeated.includes(4)
  );
}

function copyFields(value: SaveFields): SaveFields {
  return {
    name: value.name,
    position: { x: value.position.x, y: value.position.y, z: value.position.z },
    health: value.health,
    mana: value.mana,
    stamina: value.stamina,
    level: value.level,
    xp: value.xp,
    gold: value.gold,
    potions: value.potions,
    kills: value.kills,
    questAccepted: value.questAccepted,
    questComplete: value.questComplete,
    deadEnemies: [...value.deadEnemies],
    openedChests: [...value.openedChests],
    upgrades: {
      warrior: value.upgrades.warrior,
      mage: value.upgrades.mage,
      rogue: value.upgrades.rogue,
    },
    bossDefeated: value.bossDefeated,
  };
}

/** Pure migration: callers can inspect old progress before choosing to save v2. */
export function migrateSaveData(value: unknown): SaveData | null {
  if (isSaveData(value))
    return {
      ...copyFields(value),
      version: 2,
      miniBossDefeated: value.miniBossDefeated,
    };
  if (!isLegacySaveData(value)) return null;
  return {
    ...copyFields(value),
    version: 2,
    miniBossDefeated: false,
    // A legacy flag alone cannot create a defeated boss. Preserve a concrete
    // recorded defeat even if the old redundant flag happened to disagree.
    bossDefeated: value.deadEnemies.includes(4),
  };
}

/** Optional local saves: denied or corrupted storage never interrupts gameplay. */
export class SaveSystem {
  save(data: SaveData): boolean {
    if (!isSaveData(data)) return false;
    try {
      const knownFields: SaveData = {
        ...copyFields(data),
        version: 2,
        miniBossDefeated: data.miniBossDefeated,
      };
      globalThis.localStorage.setItem(SAVE_KEY, JSON.stringify(knownFields));
      return true;
    } catch {
      return false;
    }
  }

  load(): SaveData | null {
    try {
      const serialized = globalThis.localStorage.getItem(SAVE_KEY);
      return serialized === null
        ? null
        : migrateSaveData(JSON.parse(serialized));
    } catch {
      return null;
    }
  }

  hasSave(): boolean {
    return this.load() !== null;
  }

  clear(): void {
    try {
      globalThis.localStorage.removeItem(SAVE_KEY);
    } catch {
      /* Storage may be disabled. */
    }
  }
}
