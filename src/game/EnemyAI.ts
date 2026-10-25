import * as THREE from "three";
import { CharacterModel } from "./CharacterModel";
import { PhysicsWorld, type ActorBody } from "./PhysicsWorld";
import { terrainHeight } from "./WorldManager";
import {
  BOSS_SPAWN,
  ENEMY_SPAWNS,
  MINI_BOSS_SPAWN,
  type WorldObstacle,
} from "./types";
import { meleeHits } from "./CombatSystem";
import {
  attackProfile,
  chooseAttackers,
  dampKnockback,
  resolveStrike,
  targetInFront,
  type EnemyAttack,
  type StrikeOptions,
  type StrikeResult,
} from "./EnemyTactics";
import type { PlayerController } from "./PlayerController";

export type EnemyState =
  | "dormant"
  | "patrol"
  | "notice"
  | "chase"
  | "orbit"
  | "guard"
  | "retreat"
  | "windup"
  | "recover"
  | "return"
  | "stunned"
  | "dead";
export interface Enemy {
  id: number;
  boss: boolean;
  miniBoss: boolean;
  name: string;
  model: CharacterModel;
  actor: ActorBody | null;
  position: THREE.Vector3;
  previousPosition: THREE.Vector3;
  home: THREE.Vector3;
  motion: number;
  animation: number;
  visualYaw: number;
  yaw: number;
  health: number;
  maxHealth: number;
  poise: number;
  maxPoise: number;
  guard: number;
  maxGuard: number;
  blocking: boolean;
  guardBroken: boolean;
  knockback: THREE.Vector3;
  state: EnemyState;
  timer: number;
  phase: number;
  reactionTimer: number;
  decisionTimer: number;
  retreatCooldown: number;
  quietTime: number;
  lastAttack: number;
  attackSequence: number;
  attackPhase: number;
  comboStep: number;
  attackFlash: number;
  windupDuration: number;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  healthBar: THREE.Sprite;
  hitbox: { x: number; y: number; z: number; radius: number };
  attackType: EnemyAttack;
}
const ENGAGED = new Set<EnemyState>([
  "notice",
  "chase",
  "orbit",
  "guard",
  "retreat",
  "windup",
  "recover",
  "stunned",
]);
const ACTIVE_MOTION = new Set<EnemyState>(["chase", "orbit", "guard"]);
type PoseModel = CharacterModel & {
  setEnraged?: (enraged: boolean) => void;
  reactToHit?: (strength: number) => void;
  setCombatPose?: (pose: {
    phase: "idle" | "windup" | "active" | "recovery" | "charging";
    heavy: boolean;
    charge: number;
    counter: boolean;
    stagger: number;
    guardBroken: boolean;
  }) => void;
};

export class EnemyAI {
  readonly enemies: Enemy[] = [];
  constructor(
    private physics: PhysicsWorld,
    private scene: THREE.Scene,
    private obstacles: WorldObstacle[],
  ) {
    [...ENEMY_SPAWNS, BOSS_SPAWN, MINI_BOSS_SPAWN].forEach((point, id) => {
      const miniBoss = id === 5,
        boss = id >= 4;
      const model = new CharacterModel(
        miniBoss ? "warden" : boss ? "guardian" : "wraith",
      );
      const position = new THREE.Vector3(
        point.x,
        terrainHeight(point.x, point.z) + 0.04,
        point.z,
      );
      model.group.position.copy(position);
      scene.add(model.group);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.85, boss ? 4.9 : 2.1, 64),
        new THREE.MeshBasicMaterial({
          color: miniBoss ? 0xaed18a : 0xedb464,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(position);
      ring.position.y += 0.055;
      ring.visible = false;
      scene.add(ring);
      // Reused pixel buffer: no canvas, texture allocation or disposal per hit/frame.
      const texture = new THREE.DataTexture(
        new Uint8Array(128 * 8 * 4),
        128,
        8,
        THREE.RGBAFormat,
      );
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      const healthBar = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: false,
        }),
      );
      healthBar.scale.set(boss ? 3 : 1.6, 0.12, 1);
      healthBar.visible = false;
      scene.add(healthBar);
      const maxHealth = miniBoss ? 240 : boss ? 300 : 72,
        maxPoise = miniBoss ? 90 : boss ? 120 : 30,
        maxGuard = miniBoss ? 85 : boss ? 100 : 36;
      const enemy: Enemy = {
        id,
        boss,
        miniBoss,
        name: miniBoss
          ? "Thornbound Warden"
          : boss
            ? "The Fallen Guardian"
            : "Veil Wraith",
        model,
        actor: physics.createActor(
          point.x,
          point.z,
          miniBoss ? 0.58 : boss ? 0.72 : 0.34,
          miniBoss ? 1.35 : boss ? 1.7 : 0.9,
        ),
        position,
        previousPosition: position.clone(),
        home: position.clone(),
        motion: 0,
        animation: 0,
        visualYaw: 0,
        yaw: 0,
        health: maxHealth,
        maxHealth,
        poise: maxPoise,
        maxPoise,
        guard: maxGuard,
        maxGuard,
        blocking: false,
        guardBroken: false,
        knockback: new THREE.Vector3(),
        state: id === 4 ? "dormant" : "patrol",
        timer: 0,
        phase: 1,
        reactionTimer: 0,
        decisionTimer: 0,
        retreatCooldown: 0,
        quietTime: 0,
        lastAttack: -10 - id * 0.1,
        attackSequence: 0,
        attackPhase: 1,
        comboStep: 0,
        attackFlash: 0,
        windupDuration: 0,
        ring,
        healthBar,
        hitbox: {
          x: point.x,
          y: position.y + (miniBoss ? 1.2 : boss ? 1.5 : 1),
          z: point.z,
          radius: miniBoss ? 0.82 : boss ? 1 : 0.5,
        },
        attackType: "slash",
      };
      this.paintHealth(enemy);
      this.enemies.push(enemy);
    });
  }
  get kills() {
    return this.enemies.filter((e) => e.id < 4 && e.health <= 0).length;
  }
  get boss() {
    return this.enemies[4];
  }
  get miniBoss() {
    return this.enemies[5];
  }
  activeBoss(playerPos: { x: number; z: number }): Enemy | undefined {
    return this.enemies
      .filter(
        (e) =>
          e.boss &&
          e.health > 0 &&
          ENGAGED.has(e.state) &&
          Math.hypot(e.position.x - playerPos.x, e.position.z - playerPos.z) <
            28,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.position.x - playerPos.x, a.position.z - playerPos.z) -
          Math.hypot(b.position.x - playerPos.x, b.position.z - playerPos.z),
      )[0];
  }
  get inCombat() {
    return this.enemies.some((e) => e.health > 0 && ENGAGED.has(e.state));
  }

  update(
    dt: number,
    time: number,
    player: PlayerController,
    onHit: (damage: number, enemy: Enemy) => void,
  ) {
    // Reserve approach slots before entering weapon reach. Otherwise every solo
    // newcomer would orbit at its standoff distance and never close for a strike.
    const slots = chooseAttackers(
      this.enemies.map((e) => ({
        id: e.id,
        active: e.health > 0 && e.state === "windup",
        ready:
          e.health > 0 &&
          (e.state === "chase" || e.state === "orbit") &&
          e.timer <= 0 &&
          Math.hypot(
            e.position.x - player.position.x,
            e.position.z - player.position.z,
          ) < 5.7 &&
          this.seesPlayer(e, player),
        lastAttack: e.lastAttack,
      })),
      2,
    );
    for (const e of this.enemies) {
      e.timer = Math.max(0, e.timer - dt);
      e.decisionTimer = Math.max(0, e.decisionTimer - dt);
      e.retreatCooldown = Math.max(0, e.retreatCooldown - dt);
      e.attackFlash = Math.max(0, e.attackFlash - dt);
      e.quietTime += dt;
      if (e.health <= 0) {
        e.motion = 0;
        e.animation = 0;
        continue;
      }
      const dx = player.position.x - e.position.x,
        dz = player.position.z - e.position.z,
        distance = Math.hypot(dx, dz),
        homeDistance = Math.hypot(
          e.home.x - player.position.x,
          e.home.z - player.position.z,
        );
      const face = Math.atan2(-dx, -dz),
        canSee = distance < 26 && this.seesPlayer(e, player);
      if (e.quietTime > 2.2 && e.state !== "windup")
        e.poise = Math.min(e.maxPoise, e.poise + dt * (e.boss ? 14 : 9));
      if (!e.blocking && e.state !== "windup")
        e.guard = Math.min(e.maxGuard, e.guard + dt * (e.boss ? 12 : 10));
      if (
        e.id === 4 &&
        e.state === "dormant" &&
        this.kills === 4 &&
        distance < 23
      ) {
        e.state = "chase";
        e.timer = 0;
      }
      if (e.boss && e.health <= e.maxHealth * 0.5) e.phase = 2;
      let vx = 0,
        vz = 0,
        animation = 0;
      e.blocking = e.state === "guard" && e.timer > 0 && e.guard > 0;
      if (e.state !== "dormant") {
        if (!player.alive && ENGAGED.has(e.state)) {
          e.state = "return";
          e.blocking = false;
          this.hideRing(e);
        }
        if (
          player.alive &&
          (e.state === "patrol" || e.state === "return") &&
          homeDistance < 28 &&
          distance < (e.miniBoss ? 15 : 14) &&
          canSee
        ) {
          e.state = "notice";
          e.reactionTimer = 0.18;
          e.blocking = false;
        }
        if (e.state === "notice") {
          e.yaw = face;
          e.reactionTimer = Math.max(0, e.reactionTimer - dt);
          if (!canSee || distance > 20) e.state = "return";
          else if (e.reactionTimer <= 0) {
            e.state = "chase";
            e.timer = 0;
          }
        }
        if (e.state === "patrol") {
          const tx = e.home.x + Math.sin(time * 0.22 + e.id) * 2 - e.position.x,
            tz = e.home.z + Math.cos(time * 0.22 + e.id) * 2 - e.position.z,
            d = Math.hypot(tx, tz);
          if (d > 0.45) {
            vx = (tx / d) * 0.8;
            vz = (tz / d) * 0.8;
          }
        }
        if (player.alive && ACTIVE_MOTION.has(e.state)) {
          e.yaw = face;
          if (homeDistance > 30 || distance > 26) {
            e.state = "return";
            e.blocking = false;
          } else if (e.state === "guard") {
            if (e.timer <= 0) {
              e.state = "chase";
              e.blocking = false;
            }
          } else if (e.health < e.maxHealth * 0.25 && e.retreatCooldown <= 0) {
            e.state = "retreat";
            e.timer = 0.9;
            e.retreatCooldown = 7;
          } else if (
            player.attacking &&
            distance < 4 &&
            e.guard > 12 &&
            e.decisionTimer <= 0 &&
            canSee
          ) {
            e.state = "guard";
            e.timer = e.boss ? 0.58 : 0.42;
            e.blocking = true;
            e.decisionTimer = 1.65 + e.id * 0.08;
          } else if (
            distance < (e.boss ? 3.1 : 1.95) &&
            slots.has(e.id) &&
            canSee
          ) {
            this.beginAttack(e, time, face);
          } else {
            const speed = e.boss ? (e.phase === 2 ? 3.4 : 2.4) : 2.8;
            if (distance < 5.7 && !slots.has(e.id)) {
              e.state = "orbit";
              const desired = e.boss ? 4 : 3.05,
                radial = THREE.MathUtils.clamp(
                  (distance - desired) * 1.25,
                  -1,
                  1,
                ),
                side = e.id % 2 ? 1 : -1;
              if (distance > 0.001) {
                vx =
                  ((dx / distance) * radial - (dz / distance) * side * 0.65) *
                  1.7;
                vz =
                  ((dz / distance) * radial + (dx / distance) * side * 0.65) *
                  1.7;
              }
            } else {
              e.state = "chase";
              if (distance > 0.001) {
                vx = (dx / distance) * speed;
                vz = (dz / distance) * speed;
              }
            }
          }
        }
        if (e.state === "retreat") {
          if (e.timer <= 0) {
            e.state = "chase";
            e.timer = 0.18;
          } else if (distance > 0.001) {
            vx = (-dx / distance) * 2.2;
            vz = (-dz / distance) * 2.2;
            e.yaw = face;
          }
        }
        if (e.state === "return") {
          const x = e.home.x - e.position.x,
            z = e.home.z - e.position.z,
            d = Math.hypot(x, z);
          if (d < 0.75) {
            e.state = "patrol";
            e.timer = 0;
          } else {
            vx = (x / d) * 2.4;
            vz = (z / d) * 2.4;
            e.yaw = Math.atan2(-vx, -vz);
          }
        }
        if (e.state === "windup") {
          animation =
            1 - Math.max(0, e.timer) / Math.max(0.01, e.windupDuration);
          this.showTelegraph(e, animation);
          if (e.timer <= 0) {
            const profile = attackProfile(
              e.boss,
              e.miniBoss,
              e.attackPhase,
              e.attackSequence,
              e.comboStep > 0,
            );
            const hit =
              e.attackType === "slam"
                ? distance < profile.reach &&
                  Math.abs(player.position.y - e.position.y) < 1.05
                : meleeHits(
                    { ...e.hitbox, radius: e.boss ? 1.4 : 0.7 },
                    e.yaw,
                    player.hitbox,
                    profile.reach,
                    profile.halfAngle,
                  );
            e.attackFlash = 0.18;
            if (
              hit &&
              player.alive &&
              this.physics.lineClear(e.hitbox, player.hitbox)
            )
              onHit(profile.damage, e);
            // A parry callback owns its stun. Never replace it with recovery or the second cleave.
            if (e.state === "windup") {
              if (
                e.miniBoss &&
                e.attackType === "cleave" &&
                e.comboStep === 0
              ) {
                e.comboStep = 1;
                const follow = attackProfile(
                  true,
                  true,
                  e.attackPhase,
                  e.attackSequence,
                  true,
                );
                e.timer = follow.windup;
                e.windupDuration = follow.windup;
                e.yaw = face;
              } else {
                e.state = "recover";
                e.timer = profile.recovery;
                e.attackSequence++;
                this.hideRing(e);
              }
            } else this.hideRing(e);
          }
        }
        if ((e.state === "recover" || e.state === "stunned") && e.timer <= 0) {
          e.state = "chase";
          e.guardBroken = false;
          e.blocking = false;
        }
      }
      if (
        (vx || vz) &&
        e.state !== "orbit" &&
        e.state !== "retreat" &&
        e.state !== "guard"
      )
        e.yaw = Math.atan2(-vx, -vz);
      [vx, vz] = this.steer(e, vx, vz);
      if (e.state !== "windup") this.hideRing(e);
      e.motion = Math.hypot(vx, vz) / 4;
      e.animation = animation;
      if (e.actor)
        this.physics.move(
          e.actor,
          (vx + e.knockback.x) * dt,
          -5 * dt,
          (vz + e.knockback.z) * dt,
        );
      e.knockback.x = dampKnockback(e.knockback.x, dt);
      e.knockback.z = dampKnockback(e.knockback.z, dt);
      e.healthBar.visible = e.health < e.maxHealth && distance < 25 && !e.boss;
    }
  }

  private seesPlayer(e: Enemy, player: PlayerController) {
    return this.physics.lineClear(
      {
        x: e.position.x,
        y: e.position.y + (e.boss ? 2 : 1.45),
        z: e.position.z,
      },
      {
        x: player.position.x,
        y: player.position.y + 1.45,
        z: player.position.z,
      },
    );
  }
  private beginAttack(e: Enemy, time: number, yaw: number) {
    const p = attackProfile(e.boss, e.miniBoss, e.phase, e.attackSequence);
    e.state = "windup";
    e.attackPhase = e.phase;
    e.attackType = p.type;
    e.timer = p.windup;
    e.windupDuration = p.windup;
    e.comboStep = 0;
    e.yaw = yaw;
    e.lastAttack = time;
    e.blocking = false;
  }
  private showTelegraph(e: Enemy, progress: number) {
    const p = attackProfile(
        e.boss,
        e.miniBoss,
        e.attackPhase,
        e.attackSequence,
        e.comboStep > 0,
      ),
      outer = e.boss ? 4.9 : 2.1;
    const scale =
      e.attackType === "slam"
        ? p.reach / outer
        : e.attackType === "cleave"
          ? 3.25 / outer
          : (e.boss ? 3 : 1.8) / outer;
    e.ring.scale.set(scale, scale, 1);
    e.ring.position.set(e.position.x, e.position.y + 0.07, e.position.z);
    e.ring.material.color.set(
      e.attackType === "slam"
        ? 0xe77d52
        : e.attackType === "cleave"
          ? 0xdac16b
          : e.miniBoss
            ? 0xaed18a
            : 0xedb464,
    );
    e.ring.material.opacity = 0.09 + progress * 0.32;
    e.ring.visible = true;
  }
  private hideRing(e: Enemy) {
    e.ring.visible = false;
    e.ring.material.opacity = 0;
  }
  /** Short head-height Rapier probes pick a free tangent; the capsule resolves final contacts. */
  private steer(e: Enemy, vx: number, vz: number): [number, number] {
    const speed = Math.hypot(vx, vz);
    if (speed < 0.001) return [0, 0];
    const nx = vx / speed,
      nz = vz / speed,
      head = { x: e.position.x, y: e.position.y + 0.8, z: e.position.z };
    const radius = e.boss ? 0.85 : 0.55;
    const clear = (x: number, z: number) => {
      const end = { x: head.x + x * 1.6, y: head.y, z: head.z + z * 1.6 };
      if (!this.physics.lineClear(head, end)) return false;
      for (const o of this.obstacles) {
        const dx = end.x - o.x,
          dz = end.z - o.z,
          a = -(o.rotation || 0),
          lx = dx * Math.cos(a) - dz * Math.sin(a),
          lz = dx * Math.sin(a) + dz * Math.cos(a);
        if (Math.abs(lx) < o.hx + radius && Math.abs(lz) < o.hz + radius)
          return false;
      }
      return true;
    };
    if (clear(nx, nz)) return [vx, vz];
    const side = e.id % 2 ? 1 : -1;
    for (const angle of [
      (Math.PI / 3) * side,
      (-Math.PI / 3) * side,
      (Math.PI / 2) * side,
      (-Math.PI / 2) * side,
    ]) {
      const x = nx * Math.cos(angle) - nz * Math.sin(angle),
        z = nx * Math.sin(angle) + nz * Math.cos(angle);
      if (clear(x, z)) return [x * speed, z * speed];
    }
    return [0, 0];
  }

  beginStep() {
    for (const e of this.enemies) e.previousPosition.copy(e.position);
  }
  freezeInterpolation() {
    for (const e of this.enemies) e.previousPosition.copy(e.position);
  }
  render(alpha: number, dt: number, time: number) {
    for (const e of this.enemies) {
      e.model.group.position.lerpVectors(e.previousPosition, e.position, alpha);
      e.visualYaw +=
        Math.atan2(
          Math.sin(e.yaw - e.visualYaw),
          Math.cos(e.yaw - e.visualYaw),
        ) *
        (1 - Math.exp(-dt * 18));
      e.model.group.rotation.y = e.visualYaw;
      const model = e.model as PoseModel;
      model.setEnraged?.(e.boss && e.phase === 2);
      model.setCombatPose?.({
        phase:
          e.attackFlash > 0
            ? "active"
            : e.state === "windup"
              ? "windup"
              : e.state === "recover"
                ? "recovery"
                : "idle",
        heavy: e.attackType !== "slash",
        charge: e.animation,
        counter: false,
        stagger: e.state === "stunned" ? 1 : 0,
        guardBroken: e.guardBroken,
      });
      e.model.update(
        dt,
        e.motion,
        e.animation,
        e.blocking,
        e.health <= 0,
        time,
      );
      e.healthBar.position.copy(e.model.group.position);
      e.healthBar.position.y += e.miniBoss ? 3.4 : e.boss ? 4 : 2.3;
    }
  }
  sync() {
    for (const e of this.enemies)
      if (e.actor) {
        const p = e.actor.body.translation();
        e.position.set(p.x, p.y - e.actor.halfHeight, p.z);
        e.hitbox.x = e.position.x;
        e.hitbox.y = e.position.y + (e.miniBoss ? 1.2 : e.boss ? 1.5 : 1);
        e.hitbox.z = e.position.z;
      }
  }
  receiveStrike(
    e: Enemy,
    amount: number,
    options: StrikeOptions,
  ): StrikeResult {
    const empty = {
      killed: false,
      blocked: false,
      guardBroken: false,
      damage: 0,
      staggered: false,
    };
    if (e.health <= 0 || e.state === "dormant") return empty;
    const result = resolveStrike(
      {
        health: e.health,
        guard: e.guard,
        poise: e.poise,
        maxPoise: e.maxPoise,
        blocking: e.blocking,
        facingAttacker: targetInFront(e.yaw, e.position, options.origin),
      },
      amount,
      options,
    );
    if (result.damage <= 0) return empty;
    e.health = result.health;
    e.guard = result.guard;
    e.poise = result.poise;
    e.quietTime = 0;
    e.model.flash();
    (e.model as PoseModel).reactToHit?.(
      result.blocked ? 0.3 : options.poise >= 40 ? 1 : 0.6,
    );
    if (result.staggered) {
      e.state = "stunned";
      e.timer = result.guardBroken
        ? e.boss
          ? 0.85
          : 1.15
        : e.boss
          ? 0.65
          : 0.45;
      e.guardBroken = result.guardBroken;
      e.blocking = false;
      this.hideRing(e);
    } else if (
      e.state === "patrol" ||
      e.state === "return" ||
      e.state === "notice"
    ) {
      e.state = "chase";
      e.timer = 0;
    }
    const dx = e.position.x - options.origin.x,
      dz = e.position.z - options.origin.z,
      d = Math.hypot(dx, dz),
      force =
        Math.max(
          0,
          Math.min(
            e.boss ? 8 : 13,
            Number.isFinite(options.knockback) ? options.knockback : 0,
          ),
        ) * (result.blocked ? 0.2 : 1);
    if (d > 0.001) {
      e.knockback.x = THREE.MathUtils.clamp(
        e.knockback.x + (dx / d) * force,
        -13,
        13,
      );
      e.knockback.z = THREE.MathUtils.clamp(
        e.knockback.z + (dz / d) * force,
        -13,
        13,
      );
    }
    this.paintHealth(e);
    if (result.killed) this.kill(e);
    return {
      killed: result.killed,
      blocked: result.blocked,
      guardBroken: result.guardBroken,
      damage: result.damage,
      staggered: result.staggered,
    };
  }
  damage(e: Enemy, damage: number): boolean {
    return this.receiveStrike(e, damage, {
      poise: damage * 0.5,
      knockback: 0,
      origin: { x: e.position.x, z: e.position.z },
      unblockable: true,
    }).killed;
  }
  private paintHealth(e: Enemy) {
    const texture = e.healthBar.material.map as THREE.DataTexture,
      data = texture.image.data as Uint8Array,
      filled = Math.round((126 * e.health) / e.maxHealth);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 128; x++) {
        const i = (y * 128 + x) * 4,
          bar = x > 0 && x <= filled && y > 0 && y < 7;
        data[i] = bar ? 194 : 22;
        data[i + 1] = bar ? 161 : 39;
        data[i + 2] = bar ? 106 : 37;
        data[i + 3] = 255;
      }
    texture.needsUpdate = true;
  }
  kill(e: Enemy) {
    e.health = 0;
    e.state = "dead";
    e.blocking = false;
    e.guardBroken = false;
    e.knockback.set(0, 0, 0);
    e.animation = 0;
    e.attackFlash = 0;
    this.hideRing(e);
    e.healthBar.visible = false;
    if (e.actor) {
      this.physics.remove(e.actor);
      e.actor = null;
    }
  }
  /** Respawning never resurrects defeated foes or loses their saved rewards. */
  resetSurvivors() {
    for (const e of this.enemies) if (e.health > 0) this.resetEnemy(e);
  }
  reset() {
    for (const e of this.enemies) this.resetEnemy(e);
  }
  private resetEnemy(e: Enemy) {
    e.health = e.maxHealth;
    e.poise = e.maxPoise;
    e.guard = e.maxGuard;
    e.phase = 1;
    e.state = e.id === 4 ? "dormant" : "patrol";
    e.timer = 0;
    e.reactionTimer = 0;
    e.decisionTimer = 0;
    e.retreatCooldown = 0;
    e.quietTime = 0;
    e.lastAttack = -10 - e.id * 0.1;
    e.attackSequence = 0;
    e.attackPhase = 1;
    e.comboStep = 0;
    e.attackFlash = 0;
    e.windupDuration = 0;
    e.animation = 0;
    e.motion = 0;
    e.yaw = 0;
    e.visualYaw = 0;
    e.blocking = false;
    e.guardBroken = false;
    e.knockback.set(0, 0, 0);
    this.hideRing(e);
    e.healthBar.visible = false;
    e.position.copy(e.home);
    e.previousPosition.copy(e.home);
    if (e.actor) this.physics.teleport(e.actor, e.home.x, e.home.y, e.home.z);
    else
      e.actor = this.physics.createActor(
        e.home.x,
        e.home.z,
        e.miniBoss ? 0.58 : e.boss ? 0.72 : 0.34,
        e.miniBoss ? 1.35 : e.boss ? 1.7 : 0.9,
      );
    e.hitbox.x = e.home.x;
    e.hitbox.y = e.home.y + (e.miniBoss ? 1.2 : e.boss ? 1.5 : 1);
    e.hitbox.z = e.home.z;
    e.model.group.position.copy(e.home);
    e.model.group.rotation.y = 0;
    this.paintHealth(e);
    const model = e.model as PoseModel;
    model.setEnraged?.(false);
    model.setCombatPose?.({
      phase: "idle",
      heavy: false,
      charge: 0,
      counter: false,
      stagger: 0,
      guardBroken: false,
    });
  }
}
