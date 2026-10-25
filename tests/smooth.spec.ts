import { expect, test, type Page } from "@playwright/test";
import type { GameManager } from "../src/game/GameManager";

declare global {
  interface Window {
    __game: GameManager;
  }
}

/** Placement is a test fixture; all actions, timing, collisions and UI changes
 * below go through real keyboard/mouse input and the running simulation. */
async function place(page: Page, x: number, z: number) {
  await page.evaluate(
    async ({ x, z }) => {
      const path = "/src/game/WorldManager.ts";
      const { terrainHeight } = await import(path);
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
async function placeEnemy(page: Page, index: number, x: number, z: number) {
  await page.evaluate(
    async ({ index, x, z }) => {
      const path = "/src/game/WorldManager.ts";
      const { terrainHeight } = await import(path);
      const g = window.__game,
        e = g.enemies.enemies[index];
      if (!e.actor) throw new Error("Fixture enemy has already died");
      g.physics.teleport(e.actor, x, terrainHeight(x, z), z);
      g.physics.step();
      g.enemies.sync();
      e.previousPosition.copy(e.position);
      e.home.copy(e.position);
      e.state = "patrol";
      e.timer = 0;
    },
    { index, x, z },
  );
}
async function ciResolution(page: Page) {
  await page.evaluate(() => {
    const g = window.__game;
    // The software rasterizer is used only by tests; game quality remains a real preset.
    g.renderer.setPixelRatio(0.4);
    g.pipeline.resize();
  });
}
async function begin(page: Page) {
  await page.goto("/?test=1");
  await page.bringToFront();
  await page.waitForFunction(() => Boolean(window.__game), undefined, {
    timeout: 60_000,
  });
  await page.evaluate(() => {
    const g = window.__game;
    g.action("quality", 0);
    if (g.settings.value.adaptiveQuality) g.action("adaptiveQuality");
  });
  await ciResolution(page);
  await page.locator('[data-action="start"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__game.phase))
    .toBe("playing");
  await place(page, 0, 35);
}
async function frames(page: Page, count = 3) {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const next = () => {
          if (--count <= 0) resolve();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
    count,
  );
}

test("smooth movement, dodge window, camera controls and persistent focused settings", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await begin(page);
  const origin = await page.evaluate(() => window.__game.player.position.z);
  await page.keyboard.down("w");
  await expect
    .poll(() => page.evaluate(() => window.__game.player.position.z))
    .toBeLessThan(origin - 2);
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
    .poll(() => page.evaluate(() => window.__game.player.grounded))
    .toBe(true);
  expect(
    await page.evaluate(() => window.__game.player.position.y),
  ).toBeCloseTo(ground, 0);

  await place(page, 0, 35);
  await page.evaluate(() => {
    const target = window as unknown as {
      __dodgeSamples: Array<{ remaining: number; immune: boolean }>;
    };
    target.__dodgeSamples = [];
    let recording = true;
    const sample = () => {
      const p = window.__game.player;
      target.__dodgeSamples.push({
        remaining: p.dodgeTime,
        immune: p.dodgeInvulnerable,
      });
      if (recording) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    setTimeout(() => {
      recording = false;
    }, 15_000);
  });
  const dodgeStart = await page.evaluate(() => ({
    x: window.__game.player.position.x,
    z: window.__game.player.position.z,
    stamina: window.__game.player.stamina,
  }));
  await page.keyboard.press("q");
  await expect
    .poll(() => page.evaluate(() => window.__game.player.dodgeCooldown))
    .toBeGreaterThan(0.1);
  await expect
    .poll(() => page.evaluate(() => window.__game.player.dodgeTime))
    .toBe(0);
  const afterDodge = await page.evaluate(() => ({
    x: window.__game.player.position.x,
    z: window.__game.player.position.z,
    stamina: window.__game.player.stamina,
    immune: window.__game.player.dodgeInvulnerable,
  }));
  const distance = Math.hypot(
    afterDodge.x - dodgeStart.x,
    afterDodge.z - dodgeStart.z,
  );
  expect(distance).toBeGreaterThan(4.05);
  expect(distance).toBeLessThan(4.65);
  expect(afterDodge.stamina).toBeLessThan(dodgeStart.stamina);
  expect(afterDodge.immune).toBe(false);
  const samples = await page.evaluate(
    () =>
      (
        window as unknown as {
          __dodgeSamples: Array<{ remaining: number; immune: boolean }>;
        }
      ).__dodgeSamples,
  );
  expect(samples.some((s) => s.remaining > 0 && s.immune)).toBe(true);
  expect(samples.some((s) => s.remaining > 0 && !s.immune)).toBe(true);

  const shoulder = await page.evaluate(
    () => window.__game.cameraController.shoulder,
  );
  await page.keyboard.press("b");
  await expect
    .poll(() => page.evaluate(() => window.__game.cameraController.shoulder))
    .toBe(-shoulder);
  const beforeZoom = await page.evaluate(
    () => window.__game.cameraController.distance,
  );
  await page.mouse.move(720, 430);
  await page.mouse.wheel(0, 120);
  await expect
    .poll(() => page.evaluate(() => window.__game.cameraController.distance))
    .toBeGreaterThan(beforeZoom);
  const zoomed = await page.evaluate(
    () => window.__game.cameraController.distance,
  );
  await frames(page, 5);
  expect(
    await page.evaluate(() => window.__game.cameraController.distance),
  ).toBeCloseTo(zoomed, 5);
  await page.mouse.wheel(0, 20_000);
  await frames(page, 2);
  expect(
    await page.evaluate(() => window.__game.cameraController.distance),
  ).toBeLessThanOrEqual(10);
  await page.mouse.wheel(0, -20_000);
  await frames(page, 2);
  expect(
    await page.evaluate(() => window.__game.cameraController.distance),
  ).toBeGreaterThanOrEqual(2.8);

  await page.keyboard.press("Escape");
  await page.locator('.pause-panel [data-action="settings"]').click();
  const sliders = [
    ["sensitivity", 1.2],
    ["fov", 70],
    ["cameraEffects", 0.75],
  ] as const;
  for (const [action, target] of sliders) {
    const slider = page.locator(
      `.settings-panel input[data-action="${action}"]`,
    );
    await slider.focus();
    await page.keyboard.press("Home");
    const count = action === "sensitivity" ? 9 : action === "fov" ? 20 : 15;
    for (let n = 0; n < count; n++) await page.keyboard.press("ArrowRight");
    await expect
      .poll(() =>
        page.evaluate((action) => window.__game.settings.value[action], action),
      )
      .toBeCloseTo(target, 2);
    await expect(slider).toBeFocused();
    await frames(page, 2);
    await expect(slider).toBeFocused();
  }
  const quality = page.locator('.settings-panel select[data-action="quality"]');
  for (const [index, preset] of ["low", "medium", "high", "ultra"].entries()) {
    await quality.selectOption(String(index));
    await quality.focus();
    await expect
      .poll(() => page.evaluate(() => window.__game.quality))
      .toBe(preset);
    await ciResolution(page);
    await frames(page, 1);
    await expect(quality).toBeFocused();
  }
  await quality.selectOption("0");
  await ciResolution(page);
  const blur = page.locator('.settings-panel button[data-action="motionBlur"]');
  await blur.click();
  await expect(blur).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => window.__game.settings.value.motionBlur))
    .toBe(true);
  await ciResolution(page);
  await blur.click();
  await expect(blur).toHaveAttribute("aria-pressed", "false");
  await ciResolution(page);
  const adaptive = page.locator(
    '.settings-panel button[data-action="adaptiveQuality"]',
  );
  await adaptive.click();
  await expect(adaptive).toHaveAttribute("aria-pressed", "true");
  await adaptive.click();
  await expect(adaptive).toHaveAttribute("aria-pressed", "false");
  await ciResolution(page);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__game), undefined, {
    timeout: 60_000,
  });
  await ciResolution(page);
  const restored = await page.evaluate(() => window.__game.settings.value);
  expect(restored).toMatchObject({
    quality: "low",
    sensitivity: 1.2,
    fov: 70,
    cameraEffects: 0.75,
    motionBlur: false,
    adaptiveQuality: false,
  });
  expect(errors).toEqual([]);
});

test("buffered light chain hits a real enemy and a timed right-click parries its attack", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await begin(page);
  await placeEnemy(page, 0, 0, 33.3);
  const originalHealth = await page.evaluate(
    () => window.__game.enemies.enemies[0].health,
  );
  await page.mouse.move(720, 430);
  await page.mouse.click(720, 430);
  await page.waitForFunction(
    () => {
      const p = window.__game.player;
      return p.attacking && p.attackTime <= 0.24 && p.attackTime > 0.04;
    },
    undefined,
    { polling: "raf", timeout: 20_000 },
  );
  await page.mouse.click(720, 430);
  await expect
    .poll(() => page.evaluate(() => window.__game.player.comboIndex))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.__game.enemies.enemies[0].health))
    .toBeLessThan(originalHealth - 40);
  await expect
    .poll(() => page.evaluate(() => window.__game.player.attacking))
    .toBe(false);
  // A different, uninjured enemy supplies the real telegraphed attack for parrying.
  await placeEnemy(page, 0, 25, 30);
  await place(page, 0, 35);
  await placeEnemy(page, 1, 0, 33.3);
  await expect
    .poll(() => page.evaluate(() => window.__game.player.invulnerable))
    .toBe(0);
  await page.waitForFunction(
    () => {
      const e = window.__game.enemies.enemies[1];
      return e.state === "windup" && e.timer <= 0.13 && e.timer > 0;
    },
    undefined,
    { polling: "raf", timeout: 30_000 },
  );
  const health = await page.evaluate(() => window.__game.player.health);
  await page.mouse.down({ button: "right" });
  await expect
    .poll(() => page.evaluate(() => window.__game.enemies.enemies[1].state), {
      intervals: [20, 40, 80, 100],
      timeout: 10_000,
    })
    .toBe("stunned");
  expect(await page.evaluate(() => window.__game.player.health)).toBe(health);
  await page.mouse.up({ button: "right" });
  expect(errors).toEqual([]);
});
