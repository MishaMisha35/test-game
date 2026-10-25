/** Native visual evidence for Combat Evolution. Actor placement is a fixture;
 * the existing forest, real AI, models, camera and HUD render unchanged. */
import { _electron as electron } from "@playwright/test";
import { mkdir, writeFile, readFile, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
const folder = join(root, "test-results", `combat-visual-${version}`);
const docs = join(root, "docs", "validation");
await mkdir(folder, { recursive: true });
await mkdir(docs, { recursive: true });
const errors = [];
const app = await electron.launch({
  args: [
    join(root, "electron", "main.cjs"),
    "--diagnostics",
    ...(process.env.ETERNAL_TEST_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
  env: {
    ...process.env,
    XDG_CONFIG_HOME: "/tmp/eternal-combat-visual-config",
    XDG_CACHE_HOME: "/tmp/eternal-combat-visual-cache",
  },
  timeout: 60_000,
});

try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.waitForFunction(() => !!window.__game, undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    const g = window.__game;
    if (g.settings.value.adaptiveQuality) g.action("adaptiveQuality");
    g.action("quality", 0);
  });
  await page.getByRole("button", { name: "Begin your journey", exact: true }).click();
  await page.waitForFunction(() => window.__game.phase === "playing" && window.__game.input.active);
  await page.evaluate(() => {
    const g = window.__game, p = g.player, boss = g.enemies.miniBoss;
    g.input.reset();
    p.velocity.set(0, 0, 0);
    p.verticalVelocity = 0;
    p.yaw = 0;
    // The nearby floor settles through normal Rapier gravity/contact. No boss
    // health, AI, timing, rewards or attack outcomes are replaced by fixtures.
    g.physics.teleport(p.actor, boss.home.x, boss.home.y + 0.6, boss.home.z + 3.8);
    g.physics.step();
    p.sync();
    p.resetInterpolation();
    g.cameraController.yaw = 0;
    g.cameraController.pitch = 0.2;
    g.cameraController.distance = 7.8;
    g.cameraController.snap(p.position);
    g.time = 0;
  });
  await page.waitForFunction(() => {
    const g = window.__game;
    return g.player.grounded && g.enemies.activeBoss(g.player.position)?.miniBoss;
  }, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__game.action("quality", 2));
  await page.waitForFunction(() => {
    const g = window.__game;
    return g.quality === "high" && g.renderer.getPixelRatio() === 1 &&
      document.querySelector("#boss-name")?.textContent === "THORNBOUND WARDEN" &&
      !document.querySelector("#boss-bar")?.classList.contains("hidden");
  }, undefined, { timeout: 60_000 });

  const capture = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game, renderer = g.renderer;
    renderer.info.autoReset = false;
    requestAnimationFrame(() => {
      renderer.info.reset();
      requestAnimationFrame(() => {
        const boss = g.enemies.miniBoss;
        resolve({
          quality: g.quality,
          adaptiveQuality: g.settings.value.adaptiveQuality,
          pixelRatio: renderer.getPixelRatio(),
          canvas: { width: renderer.domElement.width, height: renderer.domElement.height },
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          points: renderer.info.render.points,
          memory: { ...renderer.info.memory },
          sceneObjects: g.scene.children.length,
          phase: g.phase,
          playerHealth: g.player.health,
          boss: {
            id: boss.id,
            name: boss.name,
            state: boss.state,
            phase: boss.phase,
            health: boss.health,
            maxHealth: boss.maxHealth,
            position: { x: boss.position.x, y: boss.position.y, z: boss.position.z },
          },
          bossHudVisible: !document.querySelector("#boss-bar")?.classList.contains("hidden"),
        });
        renderer.info.autoReset = true;
      });
    });
  }));
  assert.equal(capture.quality, "high");
  assert.equal(capture.adaptiveQuality, false);
  assert.equal(capture.pixelRatio, 1);
  assert.equal(capture.phase, "playing");
  assert.equal(capture.boss.health, 240);
  assert.equal(capture.bossHudVisible, true);
  await page.screenshot({ path: join(folder, "high-warden.png"), timeout: 60_000 });
  assert.deepEqual(errors, [], "No renderer errors during the real mini-boss encounter");
  const report = {
    version,
    renderer: "SwiftShader; shipped High preset, pixel ratio 1 and adaptive resolution disabled; not a hardware FPS benchmark",
    fixture: "Only player placement near the existing forest encounter; AI and full enemy health remain real",
    capture,
    rendererErrors: errors,
  };
  await writeFile(join(folder, "report.json"), JSON.stringify(report, null, 2));
  await cp(join(folder, "high-warden.png"), join(docs, "combat-warden.png"));
  await cp(join(folder, "report.json"), join(docs, "combat-visual-results.json"));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close();
}
