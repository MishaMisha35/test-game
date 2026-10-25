import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GameManager } from "../src/game/GameManager";

const screenshotPath = (name: string) =>
  join(tmpdir(), `eternal-realms-${name}.png`);

declare global {
  interface Window {
    __game: GameManager;
  }
}

/** Positioning is fixture setup only; movement, collisions, damage, rewards and UI
 * transitions below all run through the real controls and simulation. */
async function placePlayer(page: Page, x: number, z: number, yaw = 0) {
  await page.evaluate(
    async ({ x, z, yaw }) => {
      const source = "/src/game/WorldManager.ts";
      const { terrainHeight } = await import(source);
      const g = window.__game,
        p = g.player;
      g.input.reset();
      p.velocity.set(0, 0, 0);
      p.verticalVelocity = 0;
      p.yaw = yaw;
      g.physics.teleport(p.actor, x, terrainHeight(x, z), z);
      g.physics.step();
      p.sync();
      g.cameraController.yaw = yaw;
      g.cameraController.snap(p.position);
    },
    { x, z, yaw },
  );
}
async function placeEnemy(page: Page, index: number, x: number, z: number) {
  await page.evaluate(
    async ({ index, x, z }) => {
      const source = "/src/game/WorldManager.ts";
      const { terrainHeight } = await import(source);
      const g = window.__game,
        e = g.enemies.enemies[index];
      if (!e.actor) throw new Error("Fixture enemy was already defeated");
      g.physics.teleport(e.actor, x, terrainHeight(x, z), z);
      g.physics.step();
      g.enemies.sync();
      e.home.copy(e.position);
      e.state = "patrol";
      e.timer = 0;
    },
    { index, x, z },
  );
}
async function softwareQuality(page: Page) {
  await page.evaluate(() => {
    const g = window.__game;
    g.action("quality", 0);
    if (g.settings.value.adaptiveQuality) g.action("adaptiveQuality");
    // Headless CI has a CPU rasterizer rather than a gaming GPU.
    g.renderer.setPixelRatio(0.4);
    g.pipeline.resize();
  });
}
async function begin(page: Page) {
  await page.goto("/?test=1");
  await page.bringToFront();
  await page.waitForFunction(() => Boolean(window.__game), { timeout: 40_000 });
  await softwareQuality(page);
  await page.locator('[data-action="start"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__game.phase))
    .toBe("playing");
  await expect
    .poll(() => page.evaluate(() => window.__game.player.actor.grounded))
    .toBe(true);
}
async function attack(page: Page, heavy = false) {
  await expect
    .poll(() => page.evaluate(() => window.__game.player.attackCooldown))
    .toBe(0);
  await expect
    .poll(() => page.evaluate(() => window.__game.player.stamina))
    .toBeGreaterThanOrEqual(heavy ? 27 : 14);
  if (heavy) await page.keyboard.down("Shift");
  await page.locator("#game-canvas").click({ position: { x: 720, y: 430 } });
  await expect
    .poll(() =>
      page.evaluate(
        (heavy) =>
          window.__game.player.attacking &&
          window.__game.player.heavy === heavy,
        heavy,
      ),
    )
    .toBe(true);
  if (heavy) await page.keyboard.up("Shift");
}

/** Guarding opponents can survive the old one-light-hit recipe. Break their
 * finite guard with an actual charged attack rather than assuming old damage. */
async function chargedFinisher(page: Page, index: number) {
  if (
    await page.evaluate(
      (index) => window.__game.enemies.enemies[index].health <= 0,
      index,
    )
  )
    return;
  await expect
    .poll(() => page.evaluate(() => window.__game.player.attackCooldown))
    .toBe(0);
  await expect
    .poll(() => page.evaluate(() => window.__game.player.stamina))
    .toBeGreaterThan(38);
  const target = await page.evaluate(
    (index) => ({
      x: window.__game.enemies.enemies[index].position.x,
      z: window.__game.enemies.enemies[index].position.z,
    }),
    index,
  );
  await placePlayer(page, target.x, target.z + 2);
  const swing = await page.evaluate(() => window.__game.player.swingId);
  await page.keyboard.down("t");
  await page.waitForFunction(
    () => {
      const p = window.__game.player;
      return (p.charging && p.chargeRatio >= 0.78) || (p.attacking && p.heavy);
    },
    undefined,
    { polling: "raf", timeout: 20_000 },
  );
  await page.keyboard.up("t");
  await expect
    .poll(() => page.evaluate(() => window.__game.player.swingId))
    .toBe(swing + 1);
  // Complete the real swing before the caller stages another live actor; an
  // enemy entering the same active cleave is correctly eligible for damage.
  await expect
    .poll(() => page.evaluate(() => window.__game.player.attackCooldown))
    .toBe(0);
}

// Each test owns its browser context and save storage.
test("menu, real movement and camera, jumping, obstacle collision and RPG UI", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?test=1");
  await page.waitForFunction(() => Boolean(window.__game), { timeout: 40_000 });
  await softwareQuality(page);
  await page.screenshot({
    path: screenshotPath("menu"),
    timeout: 15_000,
  });
  await page.locator('[data-action="start"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__game.player.actor.grounded))
    .toBe(true);
  const start = await page.evaluate(() => window.__game.player.position.z);
  await page.keyboard.down("w");
  await expect
    .poll(() => page.evaluate(() => window.__game.player.position.z))
    .toBeLessThan(start - 2);
  await page.keyboard.up("w");
  await expect
    .poll(() => page.evaluate(() => window.__game.player.velocity.length()))
    .toBeLessThan(0.1);
  const ground = await page.evaluate(() => window.__game.player.position.y);
  await page.keyboard.press("Space");
  await expect
    .poll(() => page.evaluate(() => window.__game.player.position.y))
    .toBeGreaterThan(ground + 0.6);
  await expect
    .poll(() => page.evaluate(() => window.__game.player.actor.grounded))
    .toBe(true);
  expect(
    await page.evaluate(() => window.__game.player.position.y),
  ).toBeCloseTo(ground, 0);

  const originalYaw = await page.evaluate(
    () => window.__game.cameraController.yaw,
  );
  await page.mouse.move(720, 420);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(840, 420, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await expect
    .poll(() => page.evaluate(() => window.__game.cameraController.yaw))
    .not.toBe(originalYaw);

  // Choose an actual tall, axis-aligned collision box with empty approach space.
  const obstacle = await page.evaluate(() =>
    window.__game.world.obstacles.find(
      (o) =>
        o.height > 2 &&
        o.hx > 0.8 &&
        o.hz > 0.8 &&
        !o.rotation &&
        Math.abs(o.x) < 40 &&
        o.z > -25 &&
        o.z < 25,
    ),
  );
  expect(obstacle).toBeDefined();
  if (!obstacle) throw new Error("No suitable actual obstacle found");
  await placePlayer(page, obstacle.x, obstacle.z + obstacle.hz + 2.5);
  const collisionStart = await page.evaluate(() => window.__game.time);
  await page.keyboard.down("w");
  await expect
    .poll(() =>
      page.evaluate((start) => window.__game.time - start, collisionStart),
    )
    .toBeGreaterThan(2);
  await page.keyboard.up("w");
  const blockedZ = await page.evaluate(() => window.__game.player.position.z);
  expect(blockedZ).toBeGreaterThan(obstacle.z + obstacle.hz);
  expect(obstacle.z + obstacle.hz + 2.5 - blockedZ).toBeGreaterThan(1);

  await placePlayer(page, 0, 17);
  await page.keyboard.press("i");
  await expect
    .poll(() => page.evaluate(() => window.__game.panel))
    .toBe("inventory");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => window.__game.panel))
    .toBe("none");
  await page.keyboard.press("m");
  await expect.poll(() => page.evaluate(() => window.__game.panel)).toBe("map");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => window.__game.panel))
    .toBe("none");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => window.__game.phase))
    .toBe("paused");
  await page.locator('[data-action="resume"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__game.phase))
    .toBe("playing");
  await page.screenshot({ path: screenshotPath("gameplay") });
  expect(errors).toEqual([]);
});

test("NPC quest, treasure rewards, potion and save restoration", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await begin(page);
  await placePlayer(page, 5, 17);
  await page.keyboard.press("e");
  await expect
    .poll(() => page.evaluate(() => window.__game.questAccepted))
    .toBe(true);
  const chest = await page.evaluate(() =>
    window.__game.world.interactables.find((i) => i.type === "chest")!,
  );
  await placePlayer(page, chest.x, chest.z + 1.8);
  await page.keyboard.press("e");
  await expect
    .poll(() => page.evaluate(() => window.__game.player.gold))
    .toBe(25);
  expect(await page.evaluate(() => window.__game.player.potions)).toBe(4);
  await page.keyboard.press("e");
  expect(await page.evaluate(() => window.__game.player.gold)).toBe(25);
  // Missing health is a fixture; the actual potion control applies healing/cost.
  await page.evaluate(() => {
    window.__game.player.health = 30;
  });
  await page.keyboard.press("h");
  await expect
    .poll(() => page.evaluate(() => window.__game.player.health))
    .toBeGreaterThanOrEqual(95);
  expect(await page.evaluate(() => window.__game.player.potions)).toBe(3);
  // Save through the actual pause button, mutate live state, load via the public action.
  // The menu Continue button is exercised again afterwards.
  await page.keyboard.press("Escape");
  await page.locator('[data-action="save"]').click();
  const saved = await page.evaluate(() => window.__game.saves.load()!);
  await page.evaluate(() => {
    const g = window.__game;
    g.player.gold = 1;
    g.questAccepted = false;
  });
  await page.evaluate(() => window.__game.action("load"));
  expect(await page.evaluate(() => window.__game.player.gold)).toBe(25);
  await page.keyboard.press("Escape");
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="continue"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__game.phase))
    .toBe("playing");
  expect(await page.evaluate(() => window.__game.player.gold)).toBe(25);
  expect(await page.evaluate(() => window.__game.questAccepted)).toBe(true);
  expect(
    await page.evaluate(
      (id) => window.__game.world.interactables.find((i) => i.id === id)!.used,
      chest.id,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => window.__game.player.position.x),
  ).toBeCloseTo(saved.position.x, 1);
  expect(errors).toEqual([]);
});

test("enemy detection, geometric melee and projectile hits, death and respawn", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await begin(page);
  await placeEnemy(page, 0, 0, 3);
  await placePlayer(page, 0, 8);
  await expect
    .poll(() => page.evaluate(() => window.__game.enemies.enemies[0].state))
    .not.toBe("patrol");
  await expect
    .poll(() => page.evaluate(() => window.__game.player.health), {
      timeout: 20_000,
    })
    .toBeLessThan(120);
  // A real attack well outside weapon range cannot damage the target.
  await placePlayer(page, 0, 15);
  const untouched = await page.evaluate(
    () => window.__game.enemies.enemies[0].health,
  );
  await attack(page);
  await expect
    .poll(() => page.evaluate(() => window.__game.player.attackCooldown))
    .toBe(0);
  expect(
    await page.evaluate(() => window.__game.enemies.enemies[0].health),
  ).toBe(untouched);
  // Set up an unobstructed close-range attack against an active enemy.
  await placeEnemy(page, 0, 0, 3);
  await placePlayer(page, 0, 5);
  await attack(page);
  await expect
    .poll(() => page.evaluate(() => window.__game.enemies.enemies[0].health))
    .toBeLessThan(untouched);
  // Ember has a genuine moving projectile and swept hitbox, not instant damage.
  await placeEnemy(page, 0, 0, 3);
  await placePlayer(page, 0, 10);
  const beforeSpell = await page.evaluate(
    () => window.__game.enemies.enemies[0].health,
  );
  const mana = await page.evaluate(() => window.__game.player.mana);
  await page.keyboard.press("f");
  await expect
    .poll(() => page.evaluate(() => window.__game.enemies.enemies[0].health))
    .toBeLessThan(beforeSpell);
  expect(await page.evaluate(() => window.__game.player.mana)).toBeLessThan(
    mana,
  );
  await chargedFinisher(page, 0);
  await expect
    .poll(() => page.evaluate(() => window.__game.enemies.enemies[0].health))
    .toBe(0);
  expect(
    await page.evaluate(() => window.__game.enemies.enemies[0].state),
  ).toBe("dead");
  expect(await page.evaluate(() => window.__game.player.gold)).toBe(15);

  await placeEnemy(page, 1, 0, 3);
  await placePlayer(page, 0, 5);
  await page.evaluate(() => {
    const p = window.__game.player;
    p.health = 1;
    p.invulnerable = 0;
  });
  await expect
    .poll(() => page.evaluate(() => window.__game.phase), { timeout: 20_000 })
    .toBe("dead");
  expect(await page.evaluate(() => window.__game.player.health)).toBe(0);
  await page.screenshot({ path: screenshotPath("death") });
  await page.locator('[data-action="restart"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__game.phase))
    .toBe("playing");
  expect(await page.evaluate(() => window.__game.player.health)).toBe(
    await page.evaluate(() => window.__game.player.maxHealth),
  );
  expect(
    await page.evaluate(() => window.__game.player.position.z),
  ).toBeCloseTo(17, 0);
  expect(errors).toEqual([]);
});

test("all four wards and two-phase guardian can be defeated through real attacks", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await begin(page);
  for (let index = 0; index < 4; index++) {
    if (
      await page.evaluate(
        () =>
          window.__game.player.health < 70 && window.__game.player.potions > 0,
      )
    )
      await page.keyboard.press("h");
    await placeEnemy(page, index, 0, 3);
    await placePlayer(page, 0, 5);
    await expect
      .poll(() =>
        page.evaluate(
          (index) => window.__game.enemies.enemies[index].state,
          index,
        ),
      )
      .not.toBe("patrol");
    // Keep the original spell + light attack sequence, then punish a surviving
    // guard with a paid charged heavy. The upgraded AI may block the first hit.
    await expect
      .poll(() => page.evaluate(() => window.__game.player.spellCooldown))
      .toBe(0);
    await page.keyboard.press("f");
    await expect
      .poll(() =>
        page.evaluate(
          (index) => window.__game.enemies.enemies[index].health,
          index,
        ),
      )
      .toBeLessThan(72);
    const target = await page.evaluate(
      (index) => ({
        x: window.__game.enemies.enemies[index].position.x,
        z: window.__game.enemies.enemies[index].position.z,
      }),
      index,
    );
    await placePlayer(page, target.x, target.z + 2);
    await attack(page);
    await expect
      .poll(() => page.evaluate(() => window.__game.player.attackCooldown))
      .toBe(0);
    await chargedFinisher(page, index);
    await expect
      .poll(() =>
        page.evaluate(
          (index) => window.__game.enemies.enemies[index].health,
          index,
        ),
      )
      .toBe(0);
    expect(
      await page.evaluate(
        (index) => window.__game.enemies.enemies[index].health,
        index,
      ),
    ).toBe(0);
  }
  expect(await page.evaluate(() => window.__game.enemies.kills)).toBe(4);
  if (
    await page.evaluate(
      () => window.__game.player.health < window.__game.player.maxHealth - 10,
    )
  )
    await page.keyboard.press("h");
  await placePlayer(page, 0, -56);
  await expect
    .poll(() => page.evaluate(() => window.__game.enemies.boss.state))
    .not.toBe("dormant");
  let witnessedPhaseTwo = false;
  for (let swing = 0; swing < 14; swing++) {
    if (await page.evaluate(() => window.__game.enemies.boss.health <= 0))
      break;
    if (
      await page.evaluate(
        () =>
          window.__game.player.health < 70 && window.__game.player.potions > 0,
      )
    )
      await page.keyboard.press("h");
    const boss = await page.evaluate(() => ({
      x: window.__game.enemies.boss.position.x,
      z: window.__game.enemies.boss.position.z,
    }));
    await placePlayer(page, boss.x, boss.z + 2.2);
    await attack(page, true);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__game.phase === "victory" ||
            window.__game.player.attackCooldown === 0,
        ),
      )
      .toBe(true);
    witnessedPhaseTwo ||= await page.evaluate(
      () => window.__game.enemies.boss.phase === 2,
    );
  }
  expect(witnessedPhaseTwo).toBe(true);
  expect(await page.evaluate(() => window.__game.enemies.boss.health)).toBe(0);
  expect(await page.evaluate(() => window.__game.phase)).toBe("victory");
  expect(await page.evaluate(() => window.__game.questComplete)).toBe(true);
  expect(
    await page.evaluate(() => window.__game.saves.load()!.bossDefeated),
  ).toBe(true);
  await page.screenshot({ path: screenshotPath("victory") });
  expect(errors).toEqual([]);
});
