import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SaveSystem,
  SAVE_KEY,
  isSaveData,
  isLegacySaveData,
  migrateSaveData,
  type SaveData,
  type LegacySaveData,
} from "../src/game/SaveSystem";

const fixture = (): SaveData => ({
  version: 2,
  name: "Wanderer",
  position: { x: 0, y: 2, z: 17 },
  health: 80,
  mana: 40,
  stamina: 60,
  level: 2,
  xp: 120,
  gold: 80,
  potions: 3,
  kills: 2,
  questAccepted: true,
  questComplete: false,
  deadEnemies: [0, 1],
  openedChests: ["forest-chest"],
  upgrades: { warrior: 1, mage: 0, rogue: 0 },
  bossDefeated: false,
  miniBossDefeated: false,
});

describe("saved progress", () => {
  let stored: Map<string, string>;
  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("roundtrips actual progress including world state and upgrades", () => {
    const saves = new SaveSystem();
    expect(saves.hasSave()).toBe(false);
    expect(saves.save(fixture())).toBe(true);
    expect(saves.load()).toEqual(fixture());
    expect(saves.hasSave()).toBe(true);
    saves.clear();
    expect(saves.hasSave()).toBe(false);
  });
  it("does not mutate a previous valid save when asked to save invalid data", () => {
    const saves = new SaveSystem();
    saves.save(fixture());
    expect(saves.save({ ...fixture(), health: NaN })).toBe(false);
    expect(saves.load()).toEqual(fixture());
  });
  it.each([
    { version: 3 },
    { health: -1 },
    { mana: "10" },
    { stamina: null },
    { level: 0 },
    { xp: -1 },
    { gold: 2.5 },
    { potions: -3 },
    { kills: 5 },
    { questAccepted: "yes" },
    { deadEnemies: [0, 7] },
    { deadEnemies: [0, 0] },
    { openedChests: [123] },
    { position: { x: 1000, y: 2, z: 0 } },
    { position: { x: 0, y: -11, z: 0 } },
    { upgrades: { warrior: -1, mage: 0, rogue: 0 } },
    { name: "" },
  ])("rejects corrupted or incompatible state %j", (change) => {
    stored.set(SAVE_KEY, JSON.stringify({ ...fixture(), ...change }));
    expect(new SaveSystem().load()).toBeNull();
  });
  it("migrates a real legacy slot without modifying its original serialized bytes", () => {
    const current = fixture();
    const { miniBossDefeated: _, version: __, ...fields } = current;
    const legacy: LegacySaveData = {
      ...fields,
      version: 1,
      name: "Original Wayfarer",
      position: { x: -12, y: 1.5, z: -45 },
      health: 47,
      mana: 19,
      stamina: 23,
      gold: 160,
      upgrades: { warrior: 2, mage: 3, rogue: 1 },
    };
    const raw = JSON.stringify(legacy);
    stored.set(SAVE_KEY, raw);
    const saves = new SaveSystem();
    expect(isLegacySaveData(legacy)).toBe(true);
    expect(isSaveData(legacy)).toBe(false);
    expect(saves.load()).toEqual({
      ...legacy,
      version: 2,
      miniBossDefeated: false,
    });
    expect(saves.hasSave()).toBe(true);
    expect(stored.get(SAVE_KEY)).toBe(raw);
  });
  it("preserves a completed legacy chapter and all its earned progress", () => {
    const { miniBossDefeated: _, ...fields } = fixture();
    const legacy: LegacySaveData = {
      ...fields,
      version: 1,
      kills: 4,
      questComplete: true,
      bossDefeated: true,
      deadEnemies: [0, 1, 2, 3, 4],
    };
    stored.set(SAVE_KEY, JSON.stringify(legacy));
    expect(new SaveSystem().load()).toEqual({
      ...legacy,
      version: 2,
      miniBossDefeated: false,
    });
  });
  it("writes the migrated version only when explicitly saving", () => {
    const { miniBossDefeated: _, ...fields } = fixture();
    const legacy: LegacySaveData = { ...fields, version: 1 };
    stored.set(SAVE_KEY, JSON.stringify(legacy));
    const saves = new SaveSystem(),
      migrated = saves.load()!;
    expect(JSON.parse(stored.get(SAVE_KEY)!).version).toBe(1);
    expect(saves.save(migrated)).toBe(true);
    expect(JSON.parse(stored.get(SAVE_KEY)!).version).toBe(2);
    expect(saves.load()).toEqual(migrated);
  });
  it("does not invent a Guardian defeat from an inconsistent legacy flag", () => {
    const { miniBossDefeated: _, ...fields } = fixture();
    const legacy: LegacySaveData = {
      ...fields,
      version: 1,
      bossDefeated: true,
    };
    const migrated = migrateSaveData(legacy)!;
    expect(migrated.bossDefeated).toBe(false);
    expect(migrated.deadEnemies).toEqual([0, 1]);
    expect(legacy.bossDefeated).toBe(true);
  });
  it("keeps a recorded legacy Guardian defeat when its redundant flag was false", () => {
    const { miniBossDefeated: _, ...fields } = fixture();
    const legacy: LegacySaveData = {
      ...fields,
      version: 1,
      bossDefeated: false,
      deadEnemies: [0, 1, 4],
    };
    const migrated = migrateSaveData(legacy)!;
    expect(migrated.bossDefeated).toBe(true);
    expect(migrated.deadEnemies).toEqual([0, 1, 4]);
    expect(legacy.bossDefeated).toBe(false);
  });
  it("loads an independent miniboss defeat without completing Chapter I", () => {
    const data = {
      ...fixture(),
      miniBossDefeated: true,
      deadEnemies: [0, 1, 5],
    };
    const saves = new SaveSystem();
    expect(saves.save(data)).toBe(true);
    expect(saves.load()).toEqual(data);
    expect(saves.load()!.questComplete).toBe(false);
    expect(saves.load()!.bossDefeated).toBe(false);
    expect(saves.load()!.kills).toBe(2);
  });
  it("supports all six defeated actors while the ward count remains four", () => {
    const data = {
      ...fixture(),
      kills: 4,
      questComplete: true,
      bossDefeated: true,
      miniBossDefeated: true,
      deadEnemies: [0, 1, 2, 3, 4, 5],
    };
    expect(new SaveSystem().save(data)).toBe(true);
    expect(new SaveSystem().load()).toEqual(data);
  });
  it.each([
    { miniBossDefeated: true },
    { deadEnemies: [0, 1, 5] },
    { miniBossDefeated: "yes" },
    { miniBossDefeated: null },
    { miniBossDefeated: undefined },
    { bossDefeated: true },
    { deadEnemies: [0, 1, 4] },
    { deadEnemies: [0, 1, 6] },
    { miniBossDefeated: true, deadEnemies: [0, 1, 5, 5] },
  ])("rejects contradictory or malformed v2 progress %j", (change) => {
    const corrupt = { ...fixture(), ...change };
    expect(isSaveData(corrupt)).toBe(false);
    expect(migrateSaveData(corrupt)).toBeNull();
    stored.set(SAVE_KEY, JSON.stringify(corrupt));
    expect(new SaveSystem().load()).toBeNull();
  });
  it.each([
    { health: -1 },
    { deadEnemies: [0, 1, 5] },
    { deadEnemies: [0, 0] },
    { position: { x: 0, y: Infinity, z: 17 } },
    { upgrades: { warrior: "2", mage: 0, rogue: 0 } },
  ])(
    "rejects corrupt legacy records instead of partially migrating %j",
    (change) => {
      const { miniBossDefeated: _, ...fields } = fixture();
      const legacy = { ...fields, version: 1, ...change };
      expect(isLegacySaveData(legacy)).toBe(false);
      expect(migrateSaveData(legacy)).toBeNull();
    },
  );
  it("migration returns independent nested data and discards unknown fields", () => {
    const { miniBossDefeated: _, ...fields } = fixture();
    const legacy = { ...fields, version: 1, unrecognized: "not a save field" };
    const migrated = migrateSaveData(legacy)!;
    migrated.position.x = 42;
    migrated.upgrades.warrior = 9;
    migrated.deadEnemies.push(3);
    expect(legacy.position.x).toBe(0);
    expect(legacy.upgrades.warrior).toBe(1);
    expect(legacy.deadEnemies).toEqual([0, 1]);
    expect("unrecognized" in migrated).toBe(false);
  });
  it("allows a dead character save so the game can handle respawn", () => {
    expect(new SaveSystem().save({ ...fixture(), health: 0 })).toBe(true);
  });
  it("handles malformed JSON and denied storage without interrupting gameplay", () => {
    stored.set(SAVE_KEY, "{broken");
    expect(new SaveSystem().load()).toBeNull();
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("Storage denied");
      },
      setItem() {
        throw new Error("Quota exceeded");
      },
      removeItem() {
        throw new Error("Storage denied");
      },
    });
    expect(new SaveSystem().load()).toBeNull();
    expect(new SaveSystem().save(fixture())).toBe(false);
    expect(() => new SaveSystem().clear()).not.toThrow();
  });
});
