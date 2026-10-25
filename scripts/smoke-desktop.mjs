import { _electron as electron } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "..");
const executable = process.argv[2];
const version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const testOnlyFlags =
  process.env.ETERNAL_TEST_NO_SANDBOX === "1" ? ["--no-sandbox"] : [];
const resultDir = join(root, "test-results", executable ? `desktop-packaged-${version}` : `desktop-${version}`);
await mkdir(resultDir, { recursive: true });
const errors = [];
const desktop = await electron.launch({
  ...(executable ? { executablePath: resolve(executable) } : {}),
  args: [
    ...(executable ? [] : [join(root, "electron", "main.cjs")]),
    "--diagnostics",
    ...testOnlyFlags,
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
  env: {
    ...process.env,
    XDG_CONFIG_HOME:
      process.env.XDG_CONFIG_HOME || "/tmp/eternal-desktop-test-config",
    XDG_CACHE_HOME:
      process.env.XDG_CACHE_HOME || "/tmp/eternal-desktop-test-cache",
  },
  timeout: 60000,
});
try {
  const page = await desktop.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.waitForFunction(() => !!window.__game, undefined, {
    timeout: 60000,
  });
  await page.evaluate(()=>{
    const g=window.__game;
    if(g.settings?.value.adaptiveQuality)g.action('adaptiveQuality');
    g.action('quality',2);
  });
  const start = await page.evaluate(() => {
    const g = window.__game;
    return {
      phase: g.phase,
      canvas: {
        width: g.renderer.domElement.width,
        height: g.renderer.domElement.height,
      },
      objects: g.scene.children.length,
    };
  });
  assert.equal(start.phase, "menu");
  assert(start.canvas.width > 900 && start.canvas.height > 500);
  assert(start.objects > 50);
  await page.screenshot({ path: join(resultDir, "desktop-menu.png") });
  const highMetrics=await page.evaluate(()=>new Promise(resolve=>{
    const renderer=window.__game.renderer;renderer.info.autoReset=false;
    requestAnimationFrame(()=>{renderer.info.reset();requestAnimationFrame(()=>{
      resolve({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory},pixelRatio:renderer.getPixelRatio(),quality:window.__game.quality});renderer.info.autoReset=true;
    });});
  }));
  // Exercise the shipped Low setting on this software-rendered test host.
  await page.evaluate(() => window.__game.action('quality',0));
  // Exercise the real integrated game, not a synthetic replacement scene.
  await page
    .getByRole("button", { name: "Begin your journey", exact: true })
    .click();
  await page.waitForFunction(
    () => window.__game.phase === "playing" && window.__game.input.active,
    undefined,
    { timeout: 30000 },
  );
  const before = await page.evaluate(() => ({
    ...window.__game.player.position,
  }));
  await page.keyboard.down("w");
  try {
    await page.waitForFunction(
      (origin) => {
        const p = window.__game.player.position;
        return Math.hypot(p.x - origin.x, p.z - origin.z) > 0.4;
      },
      before,
      { timeout: 30000 },
    );
  } finally {
    await page.keyboard.up("w");
  }
  const after = await page.evaluate(() => ({
    ...window.__game.player.position,
  }));
  assert(
    Math.hypot(after.x - before.x, after.z - before.z) > 0.3,
    "Character must actually move",
  );
  assert(after.y > -3, "Character must remain above the ground");
  // CDP page.keyboard bypasses Electron's native before-input-event hook.
  // Send a native input event so this checks the shipped F11 handler itself.
  await desktop.evaluate(({BrowserWindow})=>{
    const contents=BrowserWindow.getAllWindows()[0].webContents;
    contents.sendInputEvent({type:'keyDown',keyCode:'F11'});
    contents.sendInputEvent({type:'keyUp',keyCode:'F11'});
  });
  let fullscreen = false;
  for(let attempt=0;attempt<50;attempt++){
    fullscreen=await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen());
    if(fullscreen)break;
    await page.waitForTimeout(100);
  }
  assert(fullscreen, "F11 must switch native fullscreen");
  // CDP page.keyboard bypasses Electron's native before-input-event hook.
  // Send a native input event so this checks the shipped F11 handler itself.
  await desktop.evaluate(({BrowserWindow})=>{
    const contents=BrowserWindow.getAllWindows()[0].webContents;
    contents.sendInputEvent({type:'keyDown',keyCode:'F11'});
    contents.sendInputEvent({type:'keyUp',keyCode:'F11'});
  });
  await page.evaluate(() => window.__game.action("save"));
  const saved = await page.evaluate(() => window.__game.saves.hasSave());
  assert(saved, "The packaged game must be able to save locally");
  await page.screenshot({ path: join(resultDir, "desktop-playing.png") });
  assert.deepEqual(errors, [], "No renderer errors");
  const report = {
    version, highMetrics,
    target: executable || "development Electron",
    rendering:
      "SwiftShader; explicit High menu capture with adaptive resolution off, then shipped Low preset; not a hardware benchmark",
    menu: start,
    movement: { before, after },
    fullscreen,
    saved,
    rendererErrors: errors,
  };
  await writeFile(
    join(resultDir, "results.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await desktop.close();
}
