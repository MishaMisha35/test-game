import { expect, test, type Page } from "@playwright/test";
import type { GameManager } from "../src/game/GameManager";
import type { LegacySaveData } from "../src/game/SaveSystem";

declare global {
  interface Window {
    __game: GameManager;
  }
}

/** Placement only stages an unobstructed arena. Health, resources, attack timers,
 * damage, AI decisions and rewards always use the running game and real inputs. */
async function placePlayer(page: Page, x: number, z: number) {
  await page.evaluate(
    async ({ x, z }) => {
      const source = "/src/game/WorldManager.ts";
      const { terrainHeight } = await import(source);
      const g = window.__game,
        p = g.player;
      g.input.reset();
      p.velocity.set(0, 0, 0);
      p.verticalVelocity = 0;
      p.yaw = 0;
      g.physics.teleport(p.actor, x, terrainHeight(x, z), z);
      g.physics.step();
      p.sync();
      p.resetInterpolation();
      g.cameraController.yaw = 0;
      g.cameraController.snap(p.position);
    },
    { x, z },
  );
  await expect
    .poll(() => page.evaluate(() => window.__game.player.grounded))
    .toBe(true);
}

async function placeEnemy(page: Page, id: number, x: number, z: number) {
  await page.evaluate(
    async ({ id, x, z }) => {
      const source = "/src/game/WorldManager.ts";
      const { terrainHeight } = await import(source);
      const g = window.__game,
        e = g.enemies.enemies[id];
      if (!e.actor)
        throw new Error("The fixture cannot revive a defeated enemy");
      g.physics.teleport(e.actor, x, terrainHeight(x, z), z);
      g.physics.step();
      g.enemies.sync();
      e.previousPosition.copy(e.position);
      e.home.copy(e.position);
      e.state = "patrol";
      e.timer = 0;
    },
    { id, x, z },
  );
}

async function ready(page: Page) {
  await page.goto("/?test=1");
  await page.bringToFront();
  await page.waitForFunction(() => Boolean(window.__game), undefined, {
    timeout: 60_000,
  });
  await page.evaluate(() => {
    const g = window.__game;
    g.action("quality", 0);
    if (g.settings.value.adaptiveQuality) g.action("adaptiveQuality");
    // CPU rasterization is a test constraint, not an in-game quality promise.
    g.renderer.setPixelRatio(0.4);
    g.pipeline.resize();
  });
}

async function begin(page: Page) {
  await ready(page);
  await page.locator('[data-action="start"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__game.phase))
    .toBe("playing");
  await placePlayer(page, 0, 35);
}

type CombatSample = {
  swing: number;
  phase: string;
  health: number;
  power: number;
};

test("legacy Continue preserves Chapter I progress and writes v2 only on saving", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const legacy: LegacySaveData = {
    version: 1,
    name: "Returning Wayfarer",
    position: { x: 0, y: 0, z: 35 },
    health: 100,
    mana: 80,
    stamina: 90,
    level: 2,
    xp: 45,
    gold: 75,
    potions: 4,
    kills: 1,
    questAccepted: true,
    questComplete: false,
    deadEnemies: [0],
    openedChests: ["chest-clearing"],
    upgrades: { warrior: 1, mage: 1, rogue: 1 },
    bossDefeated: false,
  };
  await page.addInitScript((save) => {
    localStorage.setItem("eternal-realms-v1", JSON.stringify(save));
  }, legacy);
  await ready(page);
  expect(await page.evaluate(() => window.__game.saves.load()?.version)).toBe(
    2,
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("eternal-realms-v1")!).version,
    ),
  ).toBe(1);
  await page.locator('[data-action="continue"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__game.phase))
    .toBe("playing");
  expect(
    await page.evaluate(() => ({
      name: window.__game.name,
      gold: window.__game.player.gold,
      level: window.__game.player.level,
      xp: window.__game.player.xp,
      upgrades: window.__game.player.upgrades,
      kills: window.__game.enemies.kills,
      questAccepted: window.__game.questAccepted,
      questComplete: window.__game.questComplete,
      originalDefeat: window.__game.enemies.enemies[0].state,
      guardian: window.__game.enemies.boss.state,
      miniHealth: window.__game.enemies.miniBoss.health,
      opened: window.__game.world.interactables.find(
        (i) => i.id === "chest-clearing",
      )!.used,
    })),
  ).toEqual({
    name: legacy.name,
    gold: 75,
    level: 2,
    xp: 45,
    upgrades: legacy.upgrades,
    kills: 1,
    questAccepted: true,
    questComplete: false,
    originalDefeat: "dead",
    guardian: "dormant",
    miniHealth: 240,
    opened: true,
  });
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("eternal-realms-v1")!).version,
    ),
  ).toBe(1);
  await page.keyboard.press("Escape");
  await page.locator('[data-action="save"]').click();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("eternal-realms-v1")!),
    ),
  ).toMatchObject({
    version: 2,
    gold: 75,
    deadEnemies: [0],
    miniBossDefeated: false,
    questAccepted: true,
    questComplete: false,
  });
  expect(errors).toEqual([]);
});

test("charged active windows defeat the optional two-phase Warden without completing Chapter I", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await begin(page);
  // Keep the genuine full-health boss, its AI and collision capsule, away from other encounters.
  await placeEnemy(page, 5, 0, 33.1);
  await placePlayer(page, 0, 35);
  await expect(page.locator("#boss-name")).toHaveText("THORNBOUND WARDEN");
  await expect(page.locator("#boss-phase")).toContainText("OPTIONAL ENCOUNTER");
  const initialPotions = await page.evaluate(
    () => window.__game.player.potions,
  );
  let usedPotions = 0;
  let sawPhaseTwo = false;
  for (let attack = 0; attack < 5; attack++) {
    if (await page.evaluate(() => window.__game.enemies.miniBoss.health <= 0))
      break;
    await expect
      .poll(() => page.evaluate(() => window.__game.player.attackCooldown))
      .toBe(0);
    await expect
      .poll(() => page.evaluate(() => window.__game.player.stamina))
      .toBeGreaterThan(38);
    if (
      await page.evaluate(
        () =>
          window.__game.player.health < 80 && window.__game.player.potions > 0,
      )
    ) {
      await page.keyboard.press("h");
      usedPotions++;
    }
    const position = await page.evaluate(() => ({
      x: window.__game.enemies.miniBoss.position.x,
      z: window.__game.enemies.miniBoss.position.z,
    }));
    await placePlayer(page, position.x, position.z + 2.1);
    const before = await page.evaluate(() => ({
      swing: window.__game.player.swingId,
      health: window.__game.enemies.miniBoss.health,
      stamina: window.__game.player.stamina,
    }));
    if (attack === 0)
      await page.evaluate(() => {
        const target = window as unknown as {
          __combatSamples: CombatSample[];
          __stopCombatSample: boolean;
        };
        target.__combatSamples = [];
        target.__stopCombatSample = false;
        const sample = () => {
          const g = window.__game;
          target.__combatSamples.push({
            swing: g.player.swingId,
            phase: g.player.attackPhase,
            health: g.enemies.miniBoss.health,
            power: g.player.chargePower,
          });
          if (!target.__stopCombatSample) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
    await page.keyboard.down("t");
    await page.waitForFunction(
      () => {
        const p = window.__game.player;
        return (
          (p.charging && p.chargeRatio >= 0.78) || (p.attacking && p.heavy)
        );
      },
      undefined,
      { polling: "raf", timeout: 20_000 },
    );
    await page.keyboard.up("t");
    await expect
      .poll(() => page.evaluate(() => window.__game.player.swingId))
      .toBe(before.swing + 1);
    await expect
      .poll(() => page.evaluate(() => window.__game.enemies.miniBoss.health))
      .toBeLessThan(before.health);
    await expect
      .poll(() => page.evaluate(() => window.__game.player.attackCooldown))
      .toBe(0);
    if (attack === 0) {
      const samples = await page.evaluate(() => {
        const target = window as unknown as {
          __combatSamples: CombatSample[];
          __stopCombatSample: boolean;
        };
        target.__stopCombatSample = true;
        return target.__combatSamples;
      });
      const paidSwing = samples.filter((s) => s.swing === before.swing + 1);
      expect(
        paidSwing.some(
          (s) => s.phase === "windup" && s.health === before.health,
        ),
      ).toBe(true);
      expect(paidSwing.some((s) => s.phase === "active")).toBe(true);
      expect(paidSwing.some((s) => s.phase === "recovery")).toBe(true);
      const changed = paidSwing.filter(
        (s, i) =>
          s.health < (i === 0 ? before.health : paidSwing[i - 1].health),
      );
      expect(changed).toHaveLength(1);
      expect(changed[0].phase).toBe("active");
      const actualDamage = before.health - changed[0].health;
      expect(actualDamage).toBe(Math.round(48 * (1 + 0.9 * changed[0].power)));
      expect(actualDamage).toBeGreaterThan(80);
      expect(
        await page.evaluate(() => window.__game.player.stamina),
      ).toBeLessThan(before.stamina - 20);
    }
    sawPhaseTwo ||= await page.evaluate(
      () => window.__game.enemies.miniBoss.phase === 2,
    );
  }
  expect(sawPhaseTwo).toBe(true);
  expect(await page.evaluate(() => window.__game.enemies.miniBoss.health)).toBe(
    0,
  );
  expect(
    await page.evaluate(() => ({
      phase: window.__game.phase,
      quest: window.__game.questComplete,
      kills: window.__game.enemies.kills,
      guardian: window.__game.enemies.boss.state,
      gold: window.__game.player.gold,
      level: window.__game.player.level,
      xp: window.__game.player.xp,
      potions: window.__game.player.potions,
    })),
  ).toEqual({
    phase: "playing",
    quest: false,
    kills: 0,
    guardian: "dormant",
    gold: 80,
    level: 2,
    xp: 0,
    potions: initialPotions - usedPotions + 1,
  });
  expect(await page.evaluate(() => window.__game.saves.load())).toMatchObject({
    version: 2,
    deadEnemies: [5],
    miniBossDefeated: true,
    bossDefeated: false,
    questComplete: false,
  });
  await page.keyboard.press("Escape");
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="continue"]').click();
  expect(await page.evaluate(() => window.__game.enemies.miniBoss.state)).toBe(
    "dead",
  );
  expect(await page.evaluate(() => window.__game.enemies.boss.state)).toBe(
    "dormant",
  );
  expect(await page.evaluate(() => window.__game.enemies.kills)).toBe(0);
  expect(errors).toEqual([]);
});

test("a real shield parry opens a single empowered counterattack", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await begin(page);
  // The new-game grace period deliberately ignores incoming hits, including
  // their parry reactions. Let it expire before staging the real attack.
  await expect
    .poll(() => page.evaluate(() => window.__game.player.invulnerable))
    .toBe(0);
  await placeEnemy(page, 0, 0, 33.3);
  await page.mouse.move(720, 430);
  const before = await page.evaluate(() => ({
    playerHealth: window.__game.player.health,
    enemyHealth: window.__game.enemies.enemies[0].health,
  }));
  await page.waitForFunction(
    () => {
      const e = window.__game.enemies.enemies[0];
      return e.state === "windup" && e.timer <= 0.1 && e.timer > 0;
    },
    undefined,
    { polling: "raf", timeout: 30_000 },
  );
  await page.mouse.down({ button: "right" });
  await expect
    .poll(() => page.evaluate(() => window.__game.player.counterWindow), {
      intervals: [20, 40, 80],
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__game.player.health)).toBe(
    before.playerHealth,
  );
  expect(
    await page.evaluate(() => window.__game.enemies.enemies[0].state),
  ).toBe("stunned");
  await page.mouse.up({ button: "right" });
  await page.mouse.click(720, 430);
  await expect
    .poll(() => page.evaluate(() => window.__game.enemies.enemies[0].health))
    .toBe(before.enemyHealth - 44);
  expect(await page.evaluate(() => window.__game.player.counterWindow)).toBe(0);
  await expect
    .poll(() => page.evaluate(() => window.__game.player.attackCooldown))
    .toBe(0);
  expect(await page.evaluate(() => window.__game.player.counterAttack)).toBe(
    false,
  );
  expect(errors).toEqual([]);
});
