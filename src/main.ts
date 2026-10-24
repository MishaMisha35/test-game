import "./ui/style.css";
import { PhysicsWorld } from "./game/PhysicsWorld";
import { GameManager } from "./game/GameManager";

const loading = document.createElement("div");
loading.id = "loading";
loading.innerHTML =
  '<div class="loading-mark">◇</div><p>ETERNAL REALMS</p><span>Awakening the Elderwood…</span>';
document.body.append(loading);
async function boot() {
  try {
    await PhysicsWorld.init();
    const game = new GameManager(document.getElementById("app")!);
    // Diagnostic access is opt-in and omitted from ordinary production launches.
    if (new URLSearchParams(location.search).has("test"))
      (window as unknown as { __game: GameManager }).__game = game;
    loading.remove();
  } catch (error) {
    console.error("Unable to initialize Eternal Realms", error);
    loading.innerHTML =
      '<div class="loading-mark">◇</div><p>The realm could not awaken</p><span>This game needs GPU acceleration and WebGL 2. Update your graphics driver, then restart the game.</span><button onclick="location.reload()">Try again</button>';
  }
}
void boot();
