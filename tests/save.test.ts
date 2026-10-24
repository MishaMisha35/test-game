import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveSystem, SAVE_KEY, type SaveData } from "../src/game/SaveSystem";

const fixture = (): SaveData => ({
  version: 1,
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
    { version: 2 },
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
