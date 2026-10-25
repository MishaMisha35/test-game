import type { HudState, UIAction } from "../game/types";
import "./style.css";
const icons: Record<string, string> = {
  sword:
    '<path d="m17 3 4 0 0 4-11 11-4-4Z"/><path d="m4 13 7 7M6 17l-3 4m1-1 2 2"/>',
  spark:
    '<path d="m12 2 2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4Z"/>',
  shield:
    '<path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5Z"/><path d="m8 11 3 3 5-6"/>',
  bag: '<path d="M5 8h14l2 13H3ZM8 8V6a4 4 0 0 1 8 0v2M9 13h6"/>',
  book: '<path d="M12 5C8 2 3 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-3-2-7-2-10 1v15"/>',
  map: '<path d="m2 5 7-3 6 3 7-3v17l-7 3-6-3-7 3ZM9 2v17M15 5v17"/>',
  settings:
    '<path d="m10 2 4 0 1 4 4 1 3 3-3 3v4l-4 1-1 4h-4l-1-4-4-1v-4l-3-3 3-3 4-1Z"/><circle cx="12" cy="12" r="3"/>',
  sound: '<path d="m3 9 4 0 5-5v16l-5-5H3ZM16 8q5 4 0 8M19 4q9 8 0 16"/>',
  mute: '<path d="m3 9 4 0 5-5v16l-5-5H3ZM17 9l6 6m0-6-6 6"/>',
  save: '<path d="M3 2h15l3 3v17H3ZM7 2v7h9V2M7 22v-9h10v9"/>',
  arrow: '<path d="M3 12h17m-6-6 6 6-6 6"/>',
  potion: '<path d="M9 2h6v3l-1 1v3c7 7 7 12-2 12S3 16 10 9V6L9 5ZM7 14h10"/>',
  dodge:
    '<path d="m5 5 5-2-1 6 7 2 3-4M9 9l-3 7-4 3m7-4 6 5 5-1"/><circle cx="15" cy="4" r="2"/>',
  flame:
    '<path d="M12 2c3 6-2 7 2 10 1-3 3-3 3-5 8 12 0 16-5 15C2 21 2 12 6 8c0 5 3 6 3 3-1-4 2-5 3-9Z"/>',
  heart: '<path d="M12 21 3 12C-4 3 8-1 12 7c4-8 16-4 9 5Z"/>',
  eye: '<path d="M2 12c5-9 15-9 20 0-5 9-15 9-20 0Z"/><circle cx="12" cy="12" r="3"/>',
  close: '<path d="m5 5 14 14M5 19 19 5"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="m12 6 4 6-4 6-4-6Z"/>',
  crown: '<path d="m3 6 5 5 4-8 4 8 5-5-3 14H6ZM6 17h12"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 1 1 4 3c-1 1-1 2-1 3m0 3v1"/>',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.spark}</svg>`;
const esc = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const button = (
  action: UIAction,
  label: string,
  kind = "",
  symbol = "",
  disabled = false,
) =>
  `<button type="button" class="${kind}" data-action="${action}" ${disabled ? "disabled" : ""}>${symbol ? icon(symbol) : ""}<span>${label}</span></button>`;
export class UIManager {
  private state?: HudState;
  private lastUpdate = 0;
  private lastPanel = "";
  private lastMessage = "";
  private toastTimer = 0;
  private container: HTMLElement;
  constructor(
    private root: HTMLElement,
    private onAction: (action: UIAction, value?: number) => void,
  ) {
    this.container = document.createElement("div");
    this.container.id = "game-ui";
    root.append(this.container);
    this.container.innerHTML = `
  <div class="menu-shade" id="menu-shade"></div><div class="vignette"></div>
  <header class="topbar"><div class="brand" aria-label="Eternal Realms"><span class="brand-mark">E</span><span>ETERNAL REALMS<small>SHADOW OF THE ANCIENTS</small></span></div><nav class="top-actions">${button("help", "Field guide", "quiet", "book")}${button("settings", "Settings", "icon-button", "settings")}${button("sound", "Sound", "icon-button sound-button", "sound")}</nav></header>
  <section class="menu-content" id="menu-content"><p class="eyebrow"><span></span> A NEW CHAPTER AWAITS</p><h1>A forgotten world.<br><em>An unwritten<br class="wide-break"> legend.</em></h1><p class="menu-lore">Beyond the veil of an ancient forest, something stirs.<br>Take up your blade. Follow the light. Find your own way.</p><div class="menu-buttons">${button("start", "Begin your journey", "primary", "arrow")}${button("continue", "Continue journey", "secondary", "save")}</div><div class="menu-note"><i></i> CHAPTER I <span>THE WHISPERING VEIL</span></div></section>
  <aside class="vista-label" id="vista-label"><span class="tiny">THE BORDERLANDS</span><h3>The Whispering Veil</h3><p>Where the old world still remembers.</p><span class="vista-line"></span><small>38° 24′ N &nbsp; · &nbsp; 12° 08′ E</small></aside>
  <footer class="menu-footer" id="menu-footer"><span>AN ADVENTURE BEGINS WITH A SINGLE STEP.</span><span>v0.2 <i>✦</i> ULTRA SMOOTH</span></footer>
  <div id="hud" class="hidden"><div class="player-name"><span class="avatar">${icon("shield")}</span><span><small>THE WAYFARER</small><b id="hero-name">Wanderer</b></span><span class="level">LV <b id="level">1</b></span></div>
  <div class="compass"><div class="compass-rule"></div><span id="compass-heading">N</span><b>◆</b><small id="location">The Whispering Veil</small></div>
  <aside class="quest-card"><p class="tiny">THE ANCIENTS' CALL</p><div class="quest-title"><span class="quest-diamond">◇</span><h3 id="quest-title">A light in the darkness</h3></div><p id="quest-detail">Speak to the keeper by the village.</p><button type="button" data-action="journal" class="text-link">View journal <kbd>J</kbd></button></aside>
  <div class="boss-bar hidden" id="boss-bar"><small>THE FALLEN GUARDIAN</small><div><i id="boss-fill"></i></div><span id="boss-health"></span></div>
  <div class="vitals"><div class="vitals-heading"><span id="health-label">100 / 100</span><small>VITALITY</small></div><div class="bar health"><i id="health-fill"></i></div><div class="resource"><span>${icon("spark")}</span><div class="bar mana"><i id="mana-fill"></i></div><small id="mana-label"></small></div><div class="resource"><span>${icon("dodge")}</span><div class="bar stamina"><i id="stamina-fill"></i></div><small id="stamina-label"></small></div><div class="xp-line"><span id="xp-label">0 / 100 XP</span><i><b id="xp-fill"></b></i></div></div>
  <div class="hotbar"><div class="slot" id="magic-slot"><div>${icon("flame")}<kbd>F</kbd><span id="spell-cooldown"></span></div><small>Cast spell</small></div><div class="slot" id="dodge-slot"><div>${icon("dodge")}<kbd>Q</kbd><span id="dodge-cooldown"></span></div><small>Evade</small></div><button class="slot" data-action="heal" id="heal-slot"><div>${icon("potion")}<kbd>H</kbd><b id="potion-count">3</b></div><small>Restore</small></button><span class="hotbar-divider"></span><button class="small-slot" data-action="inventory" aria-label="Inventory">${icon("bag")}<kbd>I</kbd></button><button class="small-slot" data-action="map" aria-label="Map">${icon("map")}<kbd>M</kbd></button><button class="small-slot" data-action="skills" aria-label="Skills">${icon("spark")}<kbd>K</kbd></button></div>
  <div id="combat-cue" class="combat-cue hidden" aria-hidden="true"></div>
  <div class="interact hidden" id="interact"><kbd>E</kbd><span id="interaction-label"></span></div>
  <div class="minimap-shell"><div class="minimap-heading"><span id="map-time">17:30</span><button data-action="map" aria-label="Open world map">${icon("map")}</button></div><svg id="minimap" viewBox="0 0 180 180" aria-label="Minimap"></svg><div class="minimap-footer"><span id="region-name">BORDERLANDS</span><b>N ↑</b></div></div>
  <div class="game-hints"><span><kbd>W A S D</kbd> Move</span><span><kbd>Mouse</kbd> Look</span><span><kbd>LMB</kbd> Attack</span><span><kbd>Esc</kbd> Pause</span></div></div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <div id="panel-layer" class="panel-layer hidden"></div>
  <div id="outcome" class="outcome hidden"></div>`;
    this.container.addEventListener("click", this.click);
    this.container.addEventListener("input", this.input);
    this.container.addEventListener("change", this.change);
  }
  private click = (event: Event) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLOptionElement
    )
      return;
    const el = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-action]",
    );
    if (!el || el.hasAttribute("disabled")) return;
    event.preventDefault();
    event.stopPropagation();
    this.onAction(el.dataset.action as UIAction);
  };
  private input = (event: Event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement)) return;
    const action = el.dataset.action as UIAction;
    if (["sensitivity", "fov", "cameraEffects"].includes(action)) {
      const value = Number(el.value);
      el.setAttribute(
        "aria-valuetext",
        action === "fov"
          ? `${value} degrees`
          : action === "cameraEffects"
            ? `${Math.round(value * 100)} percent`
            : `${value.toFixed(1)} times`,
      );
      this.onAction(action, value);
    }
  };
  private change = (event: Event) => {
    const el = event.target;
    if (el instanceof HTMLSelectElement && el.dataset.action === "quality")
      this.onAction("quality", Number(el.value));
  };
  /** Update settings in place so keyboard focus survives changes to the renderer. */
  private syncSettings(s: HudState) {
    const values: Record<string, number> = {
      sensitivity: s.sensitivity,
      fov: s.fov,
      cameraEffects: s.cameraEffects,
    };
    for (const [action, value] of Object.entries(values)) {
      const control = this.container.querySelector<HTMLInputElement>(
        `input[data-action="${action}"]`,
      );
      if (!control) continue;
      if (document.activeElement !== control) control.value = String(value);
      control.setAttribute(
        "aria-valuetext",
        action === "fov"
          ? `${value} degrees`
          : action === "cameraEffects"
            ? `${Math.round(value * 100)} percent`
            : `${value.toFixed(1)} times`,
      );
      const text =
        action === "fov"
          ? `${Math.round(value)}°`
          : action === "cameraEffects"
            ? value === 0
              ? "Off"
              : `${Math.round(value * 100)}%`
            : `${value.toFixed(1)}×`;
      const output = this.container.querySelector<HTMLOutputElement>(
        `output[data-value="${action}"]`,
      );
      if (output && output.textContent !== text) output.textContent = text;
    }
    const quality = this.container.querySelector<HTMLSelectElement>(
      'select[data-action="quality"]',
    );
    if (quality && document.activeElement !== quality)
      quality.value = String(
        ["low", "medium", "high", "ultra"].indexOf(s.quality),
      );
    const toggles: Array<[UIAction, boolean]> = [
      ["sound", !s.muted],
      ["motionBlur", s.motionBlur],
      ["adaptiveQuality", s.adaptiveQuality],
    ];
    for (const [action, enabled] of toggles) {
      const control = this.container.querySelector<HTMLButtonElement>(
        `.settings-panel button[data-action="${action}"]`,
      );
      if (!control) continue;
      control.setAttribute("aria-pressed", String(enabled));
      if (action === "sound" && control.dataset.enabled !== String(enabled)) {
        const svg = control.querySelector("svg");
        if (svg) svg.outerHTML = icon(enabled ? "sound" : "mute");
      }
      control.dataset.enabled = String(enabled);
      const span = control.querySelector("span");
      if (span)
        span.textContent =
          action === "sound"
            ? enabled
              ? "Sound on"
              : "Sound off"
            : enabled
              ? "On"
              : "Off";
      control.classList.toggle("enabled", enabled);
    }
  }
  private get(id: string) {
    return this.container.querySelector<HTMLElement>("#" + id)!;
  }
  private set(id: string, text: unknown) {
    const e = this.get(id);
    const v = String(text);
    if (e.textContent !== v) e.textContent = v;
  }
  private fill(id: string, v: number, max: number) {
    this.get(id).style.width =
      `${Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100))}%`;
  }
  update(state: HudState) {
    this.state = state;
    const now = performance.now();
    if (now - this.lastUpdate < 60) return;
    this.lastUpdate = now;
    const menu = state.phase === "menu";
    ["menu-content", "menu-shade", "vista-label", "menu-footer"].forEach((id) =>
      this.get(id).classList.toggle("hidden", !menu),
    );
    this.get("hud").classList.toggle("hidden", menu);
    this.container.classList.toggle("is-playing", !menu);
    this.container.querySelector<HTMLButtonElement>(
      '[data-action="continue"]',
    )!.disabled = !state.hasSave;
    this.container.querySelectorAll(".sound-button").forEach((el) => {
      el.innerHTML =
        icon(state.muted ? "mute" : "sound") + "<span>Sound</span>";
      el.setAttribute(
        "aria-label",
        state.muted ? "Enable sound" : "Mute sound",
      );
    });
    this.set("hero-name", state.name);
    this.set("level", state.level);
    this.set("health-label", `${Math.ceil(state.health)} / ${state.maxHealth}`);
    this.fill("health-fill", state.health, state.maxHealth);
    this.set("mana-label", Math.ceil(state.mana));
    this.fill("mana-fill", state.mana, state.maxMana);
    this.set("stamina-label", Math.ceil(state.stamina));
    this.fill("stamina-fill", state.stamina, state.maxStamina);
    this.set("xp-label", `${state.xp} / ${state.nextLevel} XP`);
    this.fill("xp-fill", state.xp, state.nextLevel);
    this.set("potion-count", state.potions);
    this.get("heal-slot").toggleAttribute("disabled", state.potions <= 0);
    this.set(
      "spell-cooldown",
      state.spellCooldown > 0 ? state.spellCooldown.toFixed(1) : "",
    );
    this.set(
      "dodge-cooldown",
      state.dodgeCooldown > 0 ? state.dodgeCooldown.toFixed(1) : "",
    );
    this.get("magic-slot").classList.toggle("cooling", state.spellCooldown > 0);
    this.get("magic-slot").style.setProperty(
      "--cooldown-angle",
      `${Math.min(1, Math.max(0, state.spellCooldown / 1.6)) * 360}deg`,
    );
    this.get("dodge-slot").style.setProperty(
      "--cooldown-angle",
      `${Math.min(1, Math.max(0, state.dodgeCooldown / 1.1)) * 360}deg`,
    );
    const combatCue = state.parryReady
      ? "GUARD · PERFECT WINDOW"
      : state.combo > 0
        ? `CHAIN ×${state.combo}`
        : "";
    this.set("combat-cue", combatCue);
    this.get("combat-cue").classList.toggle(
      "hidden",
      !combatCue || state.phase !== "playing" || state.panel !== "none",
    );
    this.get("combat-cue").classList.toggle("guard-ready", state.parryReady);
    this.get("dodge-slot").classList.toggle("cooling", state.dodgeCooldown > 0);
    this.set("location", state.location);
    this.set("map-time", state.time);
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const angle = ((((-state.heading * 180) / Math.PI) % 360) + 360) % 360;
    this.set("compass-heading", directions[Math.round(angle / 45) % 8]);
    this.set(
      "quest-title",
      state.questComplete
        ? "The veil is lifted"
        : state.questAccepted
          ? "Silence the ancient curse"
          : "A light in the darkness",
    );
    this.set(
      "quest-detail",
      state.questComplete
        ? "The Guardian has fallen. The borderlands remember your name."
        : state.questAccepted
          ? state.kills < state.totalEnemies
            ? `Defeat the corrupted sentinels · ${state.kills} / ${state.totalEnemies}`
            : "Face the Fallen Guardian at the northern ruins."
          : "Speak to the keeper by the village.",
    );
    this.get("boss-bar").classList.toggle(
      "hidden",
      !state.bossAwake || state.bossHealth <= 0,
    );
    this.fill("boss-fill", state.bossHealth, state.bossMaxHealth);
    this.set(
      "boss-health",
      `${Math.ceil(state.bossHealth)} / ${state.bossMaxHealth}`,
    );
    this.get("interact").classList.toggle(
      "hidden",
      !state.interaction || state.phase !== "playing" || state.panel !== "none",
    );
    this.set("interaction-label", state.interaction);
    this.get("minimap").innerHTML = this.map(state, false);
    const signature =
      state.panel === "settings"
        ? `${state.phase}|settings`
        : [
            state.phase,
            state.panel,
            state.potions,
            state.gold,
            state.level,
            state.kills,
            state.questAccepted,
            state.questComplete,
            state.muted,
            state.quality,
            state.hasSave,
            state.health | 0,
            state.maxStamina,
          ].join("|");
    if (signature !== this.lastPanel) {
      this.lastPanel = signature;
      this.renderPanel(state);
    }
    if (state.panel === "settings") this.syncSettings(state);
    if (state.panel === "map") {
      const map = this.container.querySelector("#world-map");
      if (map) map.innerHTML = this.map(state, true);
    }
    if (state.message !== this.lastMessage) {
      this.lastMessage = state.message;
      if (state.message) this.notify(state.message);
    }
  }
  private map(state: HudState, large: boolean) {
    const xy = (x: number, z: number) => [
      12 + ((x + 65) / 130) * 156,
      12 + ((z + 85) / 150) * 156,
    ];
    const [px, py] = xy(state.position.x, state.position.z),
      [ox, oy] = xy(state.objective.x, state.objective.z);
    return `<defs><radialGradient id="map-ground${large ? "l" : ""}"><stop stop-color="#354c3f"/><stop offset="1" stop-color="#172b29"/></radialGradient><pattern id="map-grid${large ? "l" : ""}" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0v20" fill="none" stroke="#a2ad8c" stroke-opacity=".08" stroke-width=".5"/></pattern></defs><rect width="180" height="180" fill="url(#map-ground${large ? "l" : ""})"/><path d="M0 37Q37 23 58 55T83 92T78 151L57 180H39q29-40 24-64T41 69T0 55Z" fill="#5c8b8f" opacity=".45"/><path d="M125 0q-24 39-11 55t10 47-22 78" fill="none" stroke="#90a479" stroke-opacity=".19" stroke-width="23"/><path d="M90 141 91 118 81 99 94 81 91 64 99 44 90 27" fill="none" stroke="#c1b48b" stroke-width="2" stroke-dasharray="3 3" opacity=".5"/><path d="m84 26 6-8 7 8-7 7Z" fill="none" stroke="#bcab81" stroke-width="1"/><g fill="#829176" opacity=".4">${[
      [24, 87],
      [35, 120],
      [145, 60],
      [137, 113],
      [56, 23],
      [154, 145],
      [26, 51],
      [48, 156],
    ]
      .map(([x, y]) => `<path d="m${x} ${y - 6}-4 8h8Z"/>`)
      .join(
        "",
      )}</g><rect width="180" height="180" fill="url(#map-grid${large ? "l" : ""})"/>${state.enemies
      .filter((e) => e.alive)
      .map((e) => {
        const [x, y] = xy(e.x, e.z);
        return `<circle cx="${x}" cy="${y}" r="${e.boss ? 3 : 1.9}" fill="${e.boss ? "#d7b66c" : "#d87d6d"}"/>`;
      })
      .join(
        "",
      )}<path d="m${ox} ${oy - 4} 4 4-4 4-4-4Z" fill="none" stroke="#e0c485" stroke-width="1.3"/><circle cx="${px}" cy="${py}" r="7" fill="#dcead4" opacity=".13"/><g transform="translate(${px},${py}) rotate(${angleForMap(state.heading)})"><path d="M0-5 3 4 0 2-3 4Z" fill="#fff4ce"/></g>${large ? '<text x="90" y="16" text-anchor="middle" fill="#b9b994" font-size="5" letter-spacing="1">ANCIENT SANCTUM</text><text x="113" y="146" fill="#b9b994" font-size="5">ELDERWOOD</text><text x="20" y="95" fill="#86afb1" font-size="4" transform="rotate(-55 20 95)">THE SILVER RUN</text>' : ""}`;
  }
  private renderPanel(s: HudState) {
    const layer = this.get("panel-layer");
    const outcome = this.get("outcome");
    if (s.phase === "dead" || s.phase === "victory") {
      const victory = s.phase === "victory";
      outcome.classList.remove("hidden");
      outcome.innerHTML = `<div class="outcome-inner"><span class="outcome-seal">${icon(victory ? "crown" : "sword")}</span><p class="eyebrow">${victory ? "CHAPTER I · COMPLETE" : "THE VEIL CLAIMS ANOTHER"}</p><h2>${victory ? "A light endures." : "Your story is not over."}</h2><p>${victory ? "The Fallen Guardian is at peace. For the first time in an age,<br>the forest draws a quiet breath." : "Rest a moment, wayfarer. The ancient road will wait.<br>Return to the village and take up your blade again."}</p><div class="outcome-stats"><span><b>${s.kills}</b> SENTINELS DEFEATED</span><span><b>${s.level}</b> HERO LEVEL</span><span><b>${s.gold}</b> GOLD IN PURSE</span></div><div class="menu-buttons">${button("restart", victory ? "Return to the realm" : "Rise again", "primary", "arrow")}${button("menu", "Return to title", "secondary")}</div></div>`;
    } else outcome.classList.add("hidden");
    if (s.panel === "none" && s.phase !== "paused") {
      layer.classList.add("hidden");
      layer.innerHTML = "";
      return;
    }
    layer.classList.remove("hidden");
    if (s.panel === "none" && s.phase === "paused") {
      layer.innerHTML = `<section class="panel pause-panel" role="dialog" aria-modal="true" aria-labelledby="panel-title"><p class="eyebrow">A MOMENT OF STILLNESS</p><h2 id="panel-title">Journey paused</h2><p class="panel-subtitle">The old world can wait.</p><div class="pause-actions">${button("resume", "Return to the realm", "primary", "arrow")}${button("save", "Save journey", "secondary", "save")}${button("load", "Load saved journey", "secondary", "book", !s.hasSave)}${button("settings", "Settings", "secondary", "settings")}${button("help", "Field guide", "secondary", "help")}${button("menu", "Return to title", "text-link")}</div></section>`;
      return;
    }
    const title =
      {
        inventory: "Your belongings",
        journal: "The wayfarer’s journal",
        map: "The borderlands",
        skills: "An inner awakening",
        settings: "Shape your experience",
        help: "The field guide",
      }[s.panel as Exclude<typeof s.panel, "none">] || "";
    const eyebrow =
      {
        inventory: "EQUIPMENT & PROVISIONS",
        journal: "CHRONICLES OF THE VEIL",
        map: "WORLD ATLAS · CHAPTER I",
        skills: "PATHS OF THE WAYFARER",
        settings: "SETTINGS",
        help: "EVERY JOURNEY STARTS SOMEWHERE",
      }[s.panel as Exclude<typeof s.panel, "none">] || "";
    let body = "";
    if (s.panel === "inventory")
      body = `<div class="inventory-heading"><span>WAYFARER’S PACK</span><span>${icon("coin")} ${s.gold} gold</span></div><div class="inventory-grid"><article class="item equipped"><div class="item-art">${icon("sword")}</div><small>EQUIPPED · MAIN HAND</small><h3>Wayfarer’s blade</h3><p>A faithful steel longsword.<br>LMB · Shift + LMB for a heavy strike.</p><span class="item-tag">COMMON · SWORD</span></article><article class="item"><div class="item-art potion-art">${icon("potion")}<b>×${s.potions}</b></div><small>CONSUMABLE</small><h3>Crimson draught</h3><p>A little warmth for the road.<br>Restores health when wounded.</p>${button("heal", "Drink potion", "secondary", "potion", s.potions <= 0 || s.health >= s.maxHealth)}</article></div><div class="inventory-stats"><span>Level <b>${s.level}</b></span><span>Maximum health <b>${s.maxHealth}</b></span><span>Maximum mana <b>${s.maxMana}</b></span><span>Maximum stamina <b>${s.maxStamina}</b></span></div><p class="panel-note">Find chests among the ruins and defeat corrupted sentinels to gather provisions and gold.</p>`;
    if (s.panel === "journal")
      body = `<div class="journal-layout"><div class="journal-sidebar"><span class="tiny">MAIN JOURNEY</span><div class="journal-active">${icon("spark")} The ancients’ call</div><small>CHAPTER I</small></div><article class="journal-body"><span class="status-badge">${s.questComplete ? "COMPLETE" : s.questAccepted ? "IN PROGRESS" : "UNDISCOVERED"}</span><h3>The ancients’ call</h3><p>The forest is restless. Corrupted sentinels stalk the old road, and a forgotten guardian watches over the northern sanctum. The keeper of Elderwood may know how to break the curse.</p><ul class="objectives"><li class="${s.questAccepted ? "complete" : ""}"><span>${s.questAccepted ? "✓" : "◇"}</span> Speak to the village keeper</li><li class="${s.kills >= s.totalEnemies ? "complete" : ""}"><span>${s.kills >= s.totalEnemies ? "✓" : "◇"}</span> Defeat the corrupted sentinels <b>${s.kills} / ${s.totalEnemies}</b></li><li class="${s.questComplete ? "complete" : ""}"><span>${s.questComplete ? "✓" : "◇"}</span> Defeat the Fallen Guardian</li></ul><div class="journal-reward"><small>THE REWARD</small><p>A quieter forest. A name the borderlands will remember.</p></div></article></div>`;
    if (s.panel === "map")
      body = `<div class="world-map-wrap"><svg id="world-map" viewBox="0 0 180 180" aria-label="World map">${this.map(s, true)}</svg><span class="map-north">N<br>↑</span></div><div class="map-legend"><span><i class="player-dot"></i>You</span><span><i class="enemy-dot"></i>Sentinel</span><span><i class="objective-dot"></i>Journey objective</span><span>${s.position.x.toFixed(0)}, ${s.position.z.toFixed(0)}</span></div>`;
    if (s.panel === "skills")
      body = `<p class="panel-description">Choose the path that calls to you. Each training costs <b>40 gold</b> and permanently strengthens your hero.</p><div class="skills-grid">${[
        [
          "sword",
          "WARRIOR",
          "Strength of steel",
          "+5 melee damage",
          "upgradeWarrior",
        ],
        ["spark", "MAGE", "The ember within", "+8 spell damage", "upgradeMage"],
        [
          "dodge",
          "ROGUE",
          "A lighter step",
          "+15 maximum stamina",
          "upgradeRogue",
        ],
      ]
        .map(
          ([ic, branch, name, effect, action]) =>
            `<article class="skill-card"><span class="skill-symbol">${icon(ic)}</span><small>${branch}</small><h3>${name}</h3><p>${effect}</p>${button(action as UIAction, "Train · 40 gold", "secondary", "coin", s.gold < 40)}</article>`,
        )
        .join(
          "",
        )}</div><p class="panel-note">Your purse holds ${s.gold} gold. Training can be repeated.</p>`;
    if (s.panel === "settings")
      body = `<div class="settings-row"><div><h3>Soundscape</h3><p>Atmosphere, footsteps and the clash of steel.</p></div>${button("sound", s.muted ? "Sound off" : "Sound on", "secondary setting-toggle", s.muted ? "mute" : "sound")}</div>
      <div class="settings-row"><div><h3>Visual quality</h3><p>Four presets for your journey, from light to detailed.</p></div><label class="select-label"><select aria-label="Visual quality" data-action="quality">${["Low", "Medium", "High", "Ultra"].map((q, i) => `<option value="${i}" ${q.toLowerCase() === s.quality ? "selected" : ""}>${q}</option>`).join("")}</select></label></div>
      <div class="settings-row"><div><h3>Look sensitivity</h3><p>Set the pace of your camera.</p></div><label class="range-label"><input aria-label="Camera sensitivity" type="range" min="0.3" max="2" step="0.1" value="${s.sensitivity}" data-action="sensitivity"><output data-value="sensitivity">${s.sensitivity.toFixed(1)}×</output></label></div>
      <div class="settings-row"><div><h3>Field of view</h3><p>Choose a close view or a wider horizon.</p></div><label class="range-label"><input aria-label="Field of view" type="range" min="50" max="90" step="1" value="${s.fov}" data-action="fov"><output data-value="fov">${Math.round(s.fov)}°</output></label></div>
      <div class="settings-row"><div><h3>Camera effects</h3><p>Strength of camera motion and impact feedback. Zero turns them off.</p></div><label class="range-label"><input aria-label="Camera effects intensity" type="range" min="0" max="1" step="0.05" value="${s.cameraEffects}" data-action="cameraEffects"><output data-value="cameraEffects">${Math.round(s.cameraEffects * 100)}%</output></label></div>
      <div class="settings-row"><div><h3>Motion blur</h3><p>Optional camera-motion softening. Off gives the clearest view.</p></div>${button("motionBlur", s.motionBlur ? "On" : "Off", "secondary setting-toggle")}</div>
      <div class="settings-row"><div><h3>Adaptive resolution</h3><p>Automatically adjust rendering resolution to keep motion smooth.</p></div>${button("adaptiveQuality", s.adaptiveQuality ? "On" : "Off", "secondary setting-toggle")}</div>
      <p class="panel-note">Settings are remembered between journeys.<br>Eternal Realms · v0.2 Ultra Smooth · All art and sound generated locally.</p>`;
    if (s.panel === "help")
      body = `<p class="panel-description">Follow the old road north. Speak to the keeper, defeat the corrupted sentinels, and discover what waits in the ancient sanctum.</p><div class="control-columns"><div><h3>Explore</h3>${[
        ["W A S D", "Move"],
        ["Mouse", "Look around"],
        ["Shift", "Sprint"],
        ["Caps Lock", "Toggle walk"],
        ["Space", "Jump"],
        ["Ctrl", "Crouch"],
        ["E", "Interact"],
        ["V", "First / third person"],
        ["B", "Switch shoulder"],
        ["Mouse wheel", "Zoom camera"],
      ]
        .map(([k, v]) => `<p><kbd>${k}</kbd><span>${v}</span></p>`)
        .join("")}</div><div><h3>Stand your ground</h3>${[
        ["Left mouse", "Chain light attacks"],
        ["Shift + LMB", "Heavy attack"],
        ["Right mouse", "Block · initial press parries"],
        ["Q", "Evade"],
        ["F", "Cast selected spell"],
        ["1 / 2", "Ready ember / frost"],
        ["3", "Cast mending light"],
        ["H", "Drink health potion"],
        ["Esc", "Pause / release mouse"],
      ]
        .map(([k, v]) => `<p><kbd>${k}</kbd><span>${v}</span></p>`)
        .join(
          "",
        )}</div></div><div class="guide-tip">${icon("spark")} Hold right mouse to look, or double-click the game view to capture the mouse. Press Esc to release it. Inventory <kbd>I</kbd> · Journal <kbd>J</kbd> · Map <kbd>M</kbd> · Training <kbd>K</kbd></div>`;
    layer.innerHTML = `<section class="panel ${s.panel}-panel" role="dialog" aria-modal="true" aria-labelledby="panel-title"><button type="button" class="panel-close icon-button" data-action="close" aria-label="Close panel">${icon("close")}</button><p class="eyebrow">${eyebrow}</p><h2 id="panel-title">${title}</h2><div class="panel-divider"><i></i><span>◇</span><i></i></div>${body}</section>`;
  }
  notify(text: string) {
    this.get("toast").textContent = text;
    this.get("toast").classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(
      () => this.get("toast").classList.remove("show"),
      4000,
    );
  }
  destroy() {
    window.clearTimeout(this.toastTimer);
    this.container.removeEventListener("click", this.click);
    this.container.removeEventListener("input", this.input);
    this.container.removeEventListener("change", this.change);
    this.container.remove();
  }
}
function angleForMap(h: number) {
  return (-h * 180) / Math.PI;
}
