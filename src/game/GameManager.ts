import * as THREE from "three";
import { WorldManager, terrainHeight } from "./WorldManager";
import { PhysicsWorld } from "./PhysicsWorld";
import { InputManager } from "./InputManager";
import { PlayerController } from "./PlayerController";
import { CameraController } from "./CameraController";
import { EnemyAI, type Enemy } from "./EnemyAI";
import { MagicSystem } from "./MagicSystem";
import { Effects } from "./Effects";
import { AudioManager } from "./AudioManager";
import { SaveSystem, type SaveData } from "./SaveSystem";
import { meleeHits, damageAfterBlock } from "./CombatSystem";
import {
  SettingsSystem,
  AdaptiveResolution,
  PRESETS,
  QUALITY_LEVELS,
  type QualityPreset,
} from "./SettingsSystem";
import { RenderPipeline } from "./RenderPipeline";
import { AtmosphereSystem } from "./AtmosphereSystem";
import { UIManager } from "../ui/UIManager";
import {
  SPAWN,
  type HudState,
  type Panel,
  type Phase,
  type UIAction,
  type Interactable,
} from "./types";

export class GameManager {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(
    56,
    window.innerWidth / window.innerHeight,
    0.1,
    380,
  );
  readonly world: WorldManager;
  readonly physics: PhysicsWorld;
  readonly player: PlayerController;
  readonly input: InputManager;
  readonly cameraController: CameraController;
  readonly enemies: EnemyAI;
  readonly magic: MagicSystem;
  readonly effects: Effects;
  readonly audio = new AudioManager();
  readonly saves = new SaveSystem();
  readonly ui: UIManager;
  phase: Phase = "menu";
  panel: Panel = "none";
  questAccepted = false;
  questComplete = false;
  quality: QualityPreset = "high";
  readonly settings = new SettingsSystem();
  private adaptive = new AdaptiveResolution();
  readonly pipeline: RenderPipeline;
  readonly atmosphere: AtmosphereSystem;
  private hitStop = 0;
  private dustTimer = 0;
  name = "The Wayfarer";
  message = "";
  interaction = "";
  time = 0;
  private accumulator = 0;
  private lastTime = 0;
  private lastSave = 0;
  private messageTime = 0;
  private frameCounter = 0;
  private fps = 60;
  private nearest: Interactable | undefined;
  private started = false;
  private lastAttackAt = 0;
  private readonly sun: THREE.DirectionalLight;
  constructor(root: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.domElement.id = "game-canvas";
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Eternal Realms 3D game world",
    );
    document.body.prepend(this.renderer.domElement);
    this.scene.background = new THREE.Color("#aebfb3");
    this.scene.fog = new THREE.Fog("#aebfb3", 38, 145);

    this.sun = new THREE.DirectionalLight("#ffdda3", 3.5);
    this.sun.position.set(-32, 48, 25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -38,
      right: 38,
      top: 38,
      bottom: -38,
      near: 1,
      far: 125,
    });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.atmosphere = new AtmosphereSystem(this.scene, this.sun);
    this.world = new WorldManager(this.scene);
    this.physics = new PhysicsWorld(this.world.obstacles);
    this.effects = new Effects(this.scene);
    this.player = new PlayerController(this.physics, this.scene);
    this.input = new InputManager(this.renderer.domElement);
    this.cameraController = new CameraController(this.camera, this.physics);
    this.enemies = new EnemyAI(this.physics, this.scene, this.world.obstacles);
    this.magic = new MagicSystem(this.scene, this.physics, this.effects);
    this.ui = new UIManager(root, (a, v) => this.action(a, v));
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera);
    this.applySettings();
    // Prime Rapier's query pipeline before the first camera or combat query.
    this.physics.step();
    this.player.sync();
    this.enemies.sync();
    this.camera.position.set(12, 7.5, 31);
    this.camera.lookAt(-3, 3, -23);
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.pipeline.resize();
    });
    window.addEventListener("blur", () => {
      if (this.phase === "playing") {
        this.phase = "paused";
        this.input.active = false;
        this.input.reset();
        document.exitPointerLock?.();
      }
    });
    window.addEventListener("beforeunload", () => {
      if (this.started && this.player.alive) this.save(false);
    });
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }
  private frame(timestamp: number) {
    const rawDt = this.lastTime
      ? Math.max(0.001, (timestamp - this.lastTime) / 1000)
      : 1 / 60;
    const dt = Math.min(0.1, rawDt);
    this.lastTime = timestamp;
    this.time += dt;
    this.frameCounter++;
    if (this.frameCounter % 20 === 0) this.fps = Math.round(1 / rawDt);
    this.hotkeys();
    const running = this.phase === "playing" && this.panel === "none";
    this.input.active = running;
    if (running) {
      this.cameraController.readInput(dt, this.input);
      if (this.cameraController.firstPerson)
        this.player.yaw = this.cameraController.yaw;
      this.actions();
      const pausedTime = Math.min(dt, this.hitStop);
      this.hitStop = Math.max(0, this.hitStop - dt);
      this.accumulator += dt - pausedTime;
      let steps = 0;
      while (
        this.accumulator >= 1 / 60 &&
        steps < 6 &&
        this.phase === "playing"
      ) {
        this.tick(1 / 60);
        this.accumulator -= 1 / 60;
        steps++;
        if (this.hitStop > 0) {
          this.accumulator = 0;
          this.player.freezeInterpolation();
          this.enemies.freezeInterpolation();
          this.magic.freezeInterpolation();
          break;
        }
      }
      const animationDt = this.hitStop > 0 ? 0 : dt - pausedTime;
      this.player.render(
        this.accumulator * 60,
        animationDt,
        this.time,
        this.cameraController.firstPerson,
      );
      this.enemies.render(this.accumulator * 60, animationDt, this.time);
      this.magic.render(this.accumulator * 60);
      if (this.player.consumeAttackStarted()) {
        this.audio.play("swing");
        this.lastAttackAt = this.time;
      }
      const landing = this.player.consumeLanding();
      if (landing > 0) {
        this.effects.dust(this.player.position, Math.min(2, landing / 5));
        this.audio.play("land");
      }
      this.dustTimer += dt;
      if (
        this.player.grounded &&
        this.player.sprinting &&
        this.dustTimer > 0.17
      ) {
        this.dustTimer = 0;
        this.effects.dust(this.player.position, 0.35);
      }
      this.cameraController.update(
        dt,
        this.player.renderPosition,
        this.player.sprinting,
      );
      this.player.model.group.visible = !this.cameraController.firstPerson;
      this.updateInteraction();
      if (this.time - this.lastSave > 30) {
        this.save(false);
        this.lastSave = this.time;
      }
      if (steps > 0) this.input.pressed.clear();
    } else {
      this.accumulator = 0;
      this.input.pressed.clear();
      if (this.phase === "menu") {
        this.camera.position.set(
          12 + Math.sin(this.time * 0.07) * 2,
          7.5 + Math.sin(this.time * 0.09) * 0.2,
          31,
        );
        this.camera.lookAt(-3, 3, -23);
        this.player.model.group.visible = true;
        this.player.model.setLocomotion({
          grounded: true,
          verticalVelocity: 0,
          turn: 0,
          acceleration: 0,
          landing: 0,
          dodge: 0,
          combo: 0,
          speed: 0,
        });
        this.player.model.update(dt, 0, 0, false, false, this.time);
      }
      if (this.phase === "dead")
        this.player.model.update(dt, 0, 0, false, true, this.time);
      if (this.phase === "victory")
        for (const e of this.enemies.enemies)
          if (e.health <= 0) e.model.update(dt, 0, 0, false, true, this.time);
    }
    this.input.mouseX = 0;
    this.input.mouseY = 0;
    this.input.wheelDelta = 0;
    this.atmosphere.update(dt, this.time, this.camera.position);
    this.world.update(dt, this.time, this.camera);
    this.effects.update(dt);
    this.audio.update(dt, running && this.enemies.inCombat);
    if (this.messageTime > 0) {
      this.messageTime -= dt;
      if (this.messageTime <= 0) this.message = "";
    }
    // Snap the shadow volume to shadow-map texels, avoiding ten-frame jumps.
    const extent = 76,
      resolution = PRESETS[this.quality].shadowSize || 1024;
    const texel = extent / resolution,
      p = this.player.renderPosition;
    const sx = Math.round(p.x / texel) * texel,
      sz = Math.round(p.z / texel) * texel;
    this.sun.position
      .copy(this.atmosphere.sunOffset)
      .add(new THREE.Vector3(sx, 0, sz));
    this.sun.target.position.set(sx, 0, sz);
    this.sun.target.updateMatrixWorld();
    const maximum = Math.min(
      window.devicePixelRatio,
      PRESETS[this.quality].pixelRatio,
    );
    const ratio = this.adaptive.sample(
      Math.min(rawDt, 0.5),
      maximum,
      this.settings.value.adaptiveQuality,
    );
    if (
      this.settings.value.adaptiveQuality &&
      Math.abs(ratio - this.renderer.getPixelRatio()) >= 0.045
    ) {
      this.renderer.setPixelRatio(ratio);
      this.pipeline.resize();
    }
    this.ui.update(this.hud());
    this.pipeline.render(
      dt,
      running ? this.cameraController.motionStrength : 0,
      running && this.player.sprinting,
    );
  }
  private hotkeys() {
    if (this.input.take("Escape")) {
      if (this.panel !== "none") {
        this.panel = "none";
      } else if (this.phase === "playing") {
        this.phase = "paused";
        document.exitPointerLock?.();
      } else if (this.phase === "paused") this.phase = "playing";
      this.input.reset();
    }
    const panels: Record<string, Panel> = {
      KeyI: "inventory",
      KeyJ: "journal",
      KeyM: "map",
      KeyK: "skills",
    };
    for (const [code, panel] of Object.entries(panels))
      if (this.input.take(code) && this.phase === "playing") {
        this.panel = this.panel === panel ? "none" : panel;
        this.input.reset();
        document.exitPointerLock?.();
      }
  }
  private actions() {
    if (this.input.take("Attack") || this.input.take("KeyR")) {
      if (
        !this.player.attack(this.input.down("ShiftLeft", "ShiftRight")) &&
        this.player.stamina < 14
      )
        this.tell("You need a moment to catch your breath.");
    }
    if (this.input.take("Digit1")) {
      this.magic.frost = false;
      this.tell("Ember bolt readied · F to cast");
    }
    if (this.input.take("Digit2")) {
      this.magic.frost = true;
      this.tell("Frost lance readied · F to cast");
    }
    if (this.input.take("Digit3")) {
      if (
        this.player.mana >= 30 &&
        this.player.health < this.player.maxHealth
      ) {
        this.player.mana -= 30;
        this.player.health = Math.min(
          this.player.maxHealth,
          this.player.health + 40,
        );
        this.effects.burst(
          this.player.position.clone().add(new THREE.Vector3(0, 1, 0)),
          0x9ee9bd,
          25,
        );
        this.audio.play("magic");
        this.tell("Mending light · +40 health");
      } else this.tell("Mending light requires 30 mana and missing health.");
    }
    if (this.input.take("KeyF")) {
      if (this.magic.cast(this.player, this.enemies)) this.audio.play("magic");
      else if (this.player.mana < 22) this.tell("Not enough mana.");
    }
    if (this.input.take("KeyH")) this.heal();
    if (this.input.take("KeyE")) this.interact();
    if (this.input.take("F5")) this.save();
  }
  private tick(dt: number) {
    this.player.beginStep();
    this.enemies.beginStep();
    this.player.update(
      dt,
      this.input,
      this.cameraController.yaw,
      this.time,
      (t) => this.audio.play(t),
    );
    if (this.cameraController.firstPerson)
      this.player.yaw = this.cameraController.yaw;
    this.enemies.update(dt, this.time, this.player, (damage, e) =>
      this.hurt(damage, e),
    );
    this.physics.step();
    this.player.sync();
    this.enemies.sync();
    if (!this.player.alive) return;
    this.magic.update(dt, this.enemies, this.player, (e, d) => this.hit(e, d));
    const p = this.player;
    if (
      p.attacking &&
      !p.hitApplied &&
      p.attackTime < p.attackDuration * 0.52
    ) {
      p.hitApplied = true;
      for (const e of this.enemies.enemies)
        if (
          e.health > 0 &&
          meleeHits(
            { ...p.hitbox, radius: 0.9 },
            p.yaw,
            e.hitbox,
            p.heavy ? 2.7 : 2.3,
            Math.PI * 0.38,
          ) &&
          this.physics.lineClear(p.hitbox, e.hitbox)
        ) {
          if (e.state === "dormant") {
            this.tell(
              "Four shadow wards bind the Guardian. Defeat the wraiths first.",
            );
            continue;
          }
          this.hit(
            e,
            Math.round(
              ((p.heavy ? 48 : 29) +
                p.upgrades.warrior * 5 +
                (p.level - 1) * 2) *
                (p.heavy ? 1 : 1 + p.comboIndex * 0.08),
            ),
            true,
          );
        }
    }
    if (!this.enemies.inCombat && this.time - this.lastAttackAt > 6)
      p.health = Math.min(p.maxHealth, p.health + dt * 2.2);
    if (p.position.y < -10) {
      this.physics.teleport(
        p.actor,
        SPAWN.x,
        terrainHeight(SPAWN.x, SPAWN.z),
        SPAWN.z,
      );
      p.verticalVelocity = 0;
      p.sync();
      p.resetInterpolation();
    }
  }
  private hit(enemy: Enemy, amount: number, melee = false) {
    if (!this.player.alive || enemy.health <= 0 || enemy.state === "dormant")
      return;
    const killed = this.enemies.damage(enemy, amount);
    this.hitStop = Math.max(
      this.hitStop,
      melee ? (this.player.heavy ? 0.045 : 0.028) : 0.012,
    );
    this.cameraController.shake(
      melee ? (this.player.heavy ? 0.55 : 0.32) : 0.22,
    );
    if (melee && this.player.heavy && !enemy.boss && !killed) {
      enemy.state = "stunned";
      enemy.timer = 0.35;
      enemy.ring.visible = false;
    }
    this.audio.play("hit");
    this.effects.burst(
      enemy.position.clone().add(new THREE.Vector3(0, 1.2, 0)),
      0x9bd8c2,
      12,
    );
    this.effects.damage(
      enemy.position.clone().add(new THREE.Vector3(0, 2.2, 0)),
      String(amount),
    );
    if (killed) {
      this.player.gold += enemy.boss ? 120 : 15;
      const level = this.player.gainXP(enemy.boss ? 150 : 35);
      if (level) {
        this.audio.play("level");
        this.tell(`Level ${this.player.level} · Your strength awakens.`);
      } else
        this.tell(
          enemy.boss
            ? "The ancient ward has fallen."
            : `Shadow banished · +35 XP · +15 gold (${this.enemies.kills}/4)`,
        );
      if (this.enemies.kills === 4 && !enemy.boss)
        this.tell(
          "The last ward fades. The Fallen Guardian awaits in the northern ruins.",
        );
      if (enemy.boss) {
        this.questAccepted = true;
        this.questComplete = true;
        this.phase = "victory";
        this.panel = "none";
        this.input.reset();
        document.exitPointerLock?.();
        this.audio.play("victory");
        this.save(false);
      } else this.save(false);
    }
  }
  private hurt(amount: number, enemy: Enemy) {
    const p = this.player;
    if (p.invulnerable > 0 || p.dodgeInvulnerable || !p.alive) return;
    const canBlock =
      p.blocking &&
      meleeHits(
        { ...p.hitbox, radius: 2 },
        p.yaw,
        enemy.hitbox,
        6,
        Math.PI * 0.4,
      );
    if (canBlock && p.parryTime > 0 && enemy.attackType !== "slam") {
      p.parryTime = 0;
      enemy.state = "stunned";
      enemy.timer = enemy.boss ? 0.55 : 1;
      enemy.ring.visible = false;
      this.audio.play("parry");
      this.cameraController.shake(0.45);
      this.hitStop = 0.045;
      this.effects.burst(
        p.position.clone().add(new THREE.Vector3(0, 1.3, 0)),
        0xffdea1,
        16,
      );
      this.effects.damage(
        p.position.clone().add(new THREE.Vector3(0, 2.2, 0)),
        "PARRY",
      );
      return;
    }
    this.cameraController.shake(canBlock ? 0.22 : 0.48);
    const block = damageAfterBlock(amount, canBlock, p.stamina);
    p.stamina -= block.staminaCost;
    p.health = Math.max(0, p.health - block.damage);
    p.invulnerable = 0.6;
    p.model.flash();
    this.audio.play("hurt");
    this.lastAttackAt = this.time;
    this.effects.damage(
      p.position.clone().add(new THREE.Vector3(0, 2.2, 0)),
      canBlock && !block.broken ? "BLOCK" : `−${Math.round(block.damage)}`,
      canBlock ? "#d8c59d" : "#ed9e8f",
    );
    if (block.broken) this.tell("Guard broken!");
    if (!p.alive) {
      this.phase = "dead";
      this.panel = "none";
      this.input.reset();
      document.exitPointerLock?.();
      this.audio.play("death");
    }
  }
  private heal() {
    if (this.phase !== "playing" && this.phase !== "paused") return;
    const p = this.player;
    if (p.potions < 1) {
      this.tell("No healing draughts remaining. Look for treasure chests.");
      return;
    }
    if (p.health >= p.maxHealth) {
      this.tell("Your health is already full.");
      return;
    }
    p.potions--;
    p.health = Math.min(p.maxHealth, p.health + 65);
    this.audio.play("magic");
    this.effects.heal(p.position.clone().add(new THREE.Vector3(0, 1, 0)));
    this.tell("Healing draught · +65 health");
  }
  private updateInteraction() {
    const p = this.player.position;
    this.nearest = this.world.interactables
      .filter((i) => !i.used || i.type !== "chest")
      .filter((i) => Math.hypot(i.x - p.x, i.z - p.z) < 3)
      .sort(
        (a, b) =>
          Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z),
      )[0];
    this.interaction = this.nearest
      ? this.nearest.type === "npc"
        ? "Speak to the Waykeeper"
        : this.nearest.type === "chest"
          ? "Open ancient chest"
          : "Attune to the shrine"
      : "";
  }
  private interact() {
    this.updateInteraction();
    const i = this.nearest;
    if (!i) return;
    if (i.type === "npc") {
      if (!this.questAccepted) {
        this.questAccepted = true;
        this.tell(
          "Waykeeper: “Four shadows seal the old sanctuary. Silence them, then face its fallen guardian.”",
        );
        this.audio.play("ui");
        this.save(false);
      } else
        this.tell(
          this.questComplete
            ? "Waykeeper: “You carry the first light of a new age.”"
            : this.enemies.kills === 4
              ? "Waykeeper: “The wards are broken. Seek the Guardian in the northern ruins.”"
              : "Waykeeper: “Follow the old road north. The shadows linger among the stones.”",
        );
    } else if (i.type === "chest" && !i.used) {
      i.used = true;
      this.world.openChest(i.id);
      this.player.gold += 25;
      this.player.potions++;
      this.player.gainXP(15);
      this.audio.play("chest");
      this.effects.burst(
        new THREE.Vector3(i.x, terrainHeight(i.x, i.z) + 1, i.z),
      );
      this.tell("Ancient chest · +25 gold · +1 healing draught · +15 XP");
      this.save(false);
    } else if (i.type === "shrine") {
      if (this.enemies.boss.health > 0) {
        this.tell("The shrine lies dormant. Defeat the Fallen Guardian.");
        return;
      }
      this.player.health = this.player.maxHealth;
      this.player.mana = this.player.maxMana;
      this.save();
      this.tell(
        "Sanctuary restored · Health and mana replenished · Journey saved",
      );
    }
  }
  private tell(text: string) {
    this.message = text;
    this.messageTime = 6;
    this.ui.notify(text);
  }
  action(action: UIAction, value?: number) {
    this.audio.play("ui");
    switch (action) {
      case "start":
        this.newGame();
        break;
      case "continue":
      case "load":
        this.load();
        break;
      case "resume":
        this.phase = "playing";
        this.panel = "none";
        this.input.reset();
        break;
      case "close":
        this.panel = "none";
        this.input.reset();
        break;
      case "restart":
        this.respawn();
        break;
      case "menu":
        if (this.started && this.player.alive) this.save(false);
        this.phase = "menu";
        this.panel = "none";
        this.input.reset();
        break;
      case "save":
        this.save();
        break;
      case "heal":
        this.heal();
        break;
      case "sound":
        this.audio.toggle();
        break;
      case "quality":
        this.settings.value.quality =
          value === undefined
            ? this.quality === "low"
              ? "high"
              : "low"
            : QUALITY_LEVELS[Math.max(0, Math.min(3, Math.round(value)))];
        this.applySettings();
        break;
      case "sensitivity":
        this.settings.value.sensitivity = THREE.MathUtils.clamp(
          value ?? 1,
          0.3,
          2,
        );
        this.applySettings(false);
        break;
      case "fov":
        this.settings.value.fov = THREE.MathUtils.clamp(value ?? 60, 50, 90);
        this.applySettings(false);
        break;
      case "cameraEffects":
        this.settings.value.cameraEffects = THREE.MathUtils.clamp(
          value ?? 0.6,
          0,
          1,
        );
        this.applySettings(false);
        break;
      case "motionBlur":
        this.settings.value.motionBlur = !this.settings.value.motionBlur;
        this.applySettings();
        break;
      case "adaptiveQuality":
        this.settings.value.adaptiveQuality =
          !this.settings.value.adaptiveQuality;
        this.applySettings();
        break;
      case "acceptQuest":
        this.questAccepted = true;
        this.panel = "none";
        break;
      case "upgradeWarrior":
      case "upgradeMage":
      case "upgradeRogue": {
        if (this.player.gold < 40) {
          this.tell("You need 40 gold to learn this skill.");
          break;
        }
        const branch =
          action === "upgradeWarrior"
            ? "warrior"
            : action === "upgradeMage"
              ? "mage"
              : "rogue";
        this.player.gold -= 40;
        this.player.upgrades[branch]++;
        this.player.maxStamina = 100 + this.player.upgrades.rogue * 15;
        this.player.stamina = this.player.maxStamina;
        this.tell(
          `${branch[0].toUpperCase() + branch.slice(1)} mastery improved.`,
        );
        this.save(false);
        break;
      }
      default:
        this.panel = this.panel === action ? "none" : (action as Panel);
        document.exitPointerLock?.();
        this.input.reset();
    }
  }
  private newGame() {
    this.audio.start();
    this.started = true;
    this.phase = "playing";
    this.panel = "none";
    this.questAccepted = false;
    this.questComplete = false;
    const p = this.player;
    p.level = 1;
    p.xp = 0;
    p.gold = 0;
    p.potions = 3;
    p.upgrades = { warrior: 0, mage: 0, rogue: 0 };
    p.maxHealth = 120;
    p.maxStamina = 100;
    this.resetWorld();
    p.respawn();
    this.physics.teleport(
      p.actor,
      SPAWN.x,
      terrainHeight(SPAWN.x, SPAWN.z),
      SPAWN.z,
    );
    p.sync();
    p.resetInterpolation();
    p.yaw = 0;
    this.cameraController.yaw = 0;
    this.cameraController.pitch = 0.27;
    this.cameraController.snap(p.position);
    this.input.reset();
    this.lastSave = this.time;
    this.tell(
      "Welcome to the Elderwood. Speak to the Waykeeper nearby, or follow the road north.",
    );
    this.save(false);
  }
  private resetWorld() {
    this.hitStop = 0;
    this.enemies.reset();
    this.magic.clear();
    this.world.resetInteractables();
  }
  private respawn() {
    // Respawning preserves earned progress; only surviving enemies return to their patrols.
    this.player.respawn();
    this.physics.teleport(
      this.player.actor,
      SPAWN.x,
      terrainHeight(SPAWN.x, SPAWN.z),
      SPAWN.z,
    );
    this.player.sync();
    this.player.resetInterpolation();
    this.hitStop = 0;
    for (const e of this.enemies.enemies)
      if (e.health > 0) {
        e.health = e.maxHealth;
        e.phase = 1;
        e.state = e.boss ? "dormant" : "patrol";
        e.position.copy(e.home);
        e.previousPosition.copy(e.home);
        e.motion = 0;
        e.animation = 0;
        e.timer = 0;
        e.ring.visible = false;
        e.healthBar.visible = false;
        if (e.actor)
          this.physics.teleport(e.actor, e.home.x, e.home.y, e.home.z);
      }
    this.enemies.sync();
    this.enemies.freezeInterpolation();
    this.magic.clear();
    this.phase = "playing";
    this.panel = "none";
    this.cameraController.snap(this.player.position);
    this.input.reset();
    this.tell("The sanctuary calls you back. Your journey continues.");
  }
  save(feedback = true) {
    if (!this.started || !this.player.alive) {
      if (feedback) this.tell("Begin a journey before saving.");
      return false;
    }
    const p = this.player;
    const data: SaveData = {
      version: 1,
      name: this.name,
      position: { x: p.position.x, y: p.position.y, z: p.position.z },
      health: p.health,
      mana: p.mana,
      stamina: p.stamina,
      level: p.level,
      xp: p.xp,
      gold: p.gold,
      potions: p.potions,
      kills: this.enemies.kills,
      questAccepted: this.questAccepted,
      questComplete: this.questComplete,
      deadEnemies: this.enemies.enemies
        .filter((e) => e.health <= 0)
        .map((e) => e.id),
      openedChests: this.world.interactables
        .filter((i) => i.type === "chest" && i.used)
        .map((i) => i.id),
      upgrades: { ...p.upgrades },
      bossDefeated: this.enemies.boss.health <= 0,
    };
    const ok = this.saves.save(data);
    if (feedback)
      this.tell(
        ok
          ? "Journey saved."
          : "Unable to save. Local storage may be unavailable.",
      );
    return ok;
  }
  private load() {
    const s = this.saves.load();
    if (!s) {
      this.tell("No saved journey was found.");
      return;
    }
    this.audio.start();
    this.started = true;
    this.resetWorld();
    const p = this.player;
    this.name = s.name;
    p.level = s.level;
    p.xp = s.xp;
    p.gold = s.gold;
    p.potions = s.potions;
    p.upgrades = { ...s.upgrades };
    p.maxHealth = 120 + (p.level - 1) * 15;
    p.maxStamina = 100 + p.upgrades.rogue * 15;
    p.health = Math.max(1, Math.min(s.health, p.maxHealth));
    p.mana = Math.min(s.mana, p.maxMana);
    p.stamina = Math.min(s.stamina, p.maxStamina);
    p.verticalVelocity = 0;
    p.velocity.set(0, 0, 0);
    p.invulnerable = 2;
    p.clearActions();
    this.hitStop = 0;
    p.attackTime = 0;
    p.attackCooldown = 0;
    p.dodgeTime = 0;
    p.dodgeCooldown = 0;
    p.spellCooldown = 0;
    p.blocking = false;
    this.questAccepted = s.questAccepted;
    this.questComplete = s.questComplete;
    this.physics.teleport(
      p.actor,
      s.position.x,
      Math.max(terrainHeight(s.position.x, s.position.z), s.position.y),
      s.position.z,
    );
    p.sync();
    p.resetInterpolation();
    for (const id of s.deadEnemies) this.enemies.kill(this.enemies.enemies[id]);
    for (const id of s.openedChests) {
      const i = this.world.interactables.find((i) => i.id === id);
      if (i) {
        i.used = true;
        this.world.openChest(i.id);
      }
    }
    this.phase = "playing";
    this.panel = "none";
    this.input.reset();
    this.cameraController.snap(p.position);
    this.tell("Your journey continues.");
    this.lastSave = this.time;
  }
  private applySettings(graphics = true) {
    const prefs = this.settings.value;
    this.quality = prefs.quality;
    this.cameraController.sensitivity = prefs.sensitivity;
    this.cameraController.fov = prefs.fov;
    this.cameraController.effectsIntensity = prefs.cameraEffects;
    if (graphics) {
      const preset = PRESETS[prefs.quality];
      this.world.setQuality(prefs.quality);
      this.atmosphere.setQuality(prefs.quality);
      this.effects.setBudget(preset.particles);
      this.renderer.shadowMap.enabled = preset.shadowSize > 0;
      this.sun.castShadow = preset.shadowSize > 0;
      if (
        preset.shadowSize > 0 &&
        this.sun.shadow.mapSize.x !== preset.shadowSize
      ) {
        this.sun.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
      const ratio = Math.min(window.devicePixelRatio, preset.pixelRatio);
      this.renderer.setPixelRatio(ratio);
      this.adaptive.reset(ratio);
      this.pipeline.configure(prefs);
    }
    this.settings.save();
  }
  hud(): HudState {
    const p = this.player,
      boss = this.enemies.boss;
    return {
      phase: this.phase,
      panel: this.panel,
      name: this.name,
      health: p.health,
      maxHealth: p.maxHealth,
      mana: p.mana,
      maxMana: p.maxMana,
      stamina: p.stamina,
      maxStamina: p.maxStamina,
      xp: p.xp,
      nextLevel: p.nextLevel,
      level: p.level,
      gold: p.gold,
      potions: p.potions,
      kills: this.enemies.kills,
      totalEnemies: 4,
      questAccepted: this.questAccepted,
      questComplete: this.questComplete,
      bossAwake: boss.state !== "dormant" && boss.health > 0,
      bossHealth: boss.health,
      bossMaxHealth: boss.maxHealth,
      position: { x: p.position.x, z: p.position.z },
      heading: this.cameraController.yaw,
      location:
        p.position.z > 3
          ? "Elderwood Village"
          : p.position.z > -28
            ? "The Whispering Wood"
            : p.position.z > -46
              ? "Ruins of the First Age"
              : "The Fallen Sanctuary",
      time: `${String(Math.floor(this.atmosphere.hour)).padStart(2, "0")}:${String(Math.floor((this.atmosphere.hour % 1) * 60)).padStart(2, "0")}`,
      interaction: this.interaction,
      message: this.message,
      spellCooldown: p.spellCooldown,
      dodgeCooldown: p.dodgeCooldown,
      muted: !this.audio.enabled,
      quality: this.quality,
      fov: this.settings.value.fov,
      cameraEffects: this.settings.value.cameraEffects,
      motionBlur: this.settings.value.motionBlur,
      adaptiveQuality: this.settings.value.adaptiveQuality,
      timeOfDay: this.atmosphere.hour,
      combo: p.attacking && !p.heavy ? p.comboIndex + 1 : 0,
      parryReady: p.parryTime > 0,
      hasSave: this.saves.hasSave(),
      enemies: this.enemies.enemies.map((e) => ({
        x: e.position.x,
        z: e.position.z,
        boss: e.boss,
        alive: e.health > 0,
      })),
      objective: !this.questAccepted
        ? { x: 5, z: 15 }
        : this.enemies.kills < 4
          ? this.enemies.enemies.find((e) => !e.boss && e.health > 0)!.position
          : { x: 0, z: -58 },
      fps: this.fps,
      sensitivity: this.cameraController.sensitivity,
    };
  }
}
