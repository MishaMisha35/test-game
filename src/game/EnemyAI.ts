import * as THREE from "three";
import { CharacterModel } from "./CharacterModel";
import { PhysicsWorld, type ActorBody } from "./PhysicsWorld";
import { terrainHeight } from "./WorldManager";
import { BOSS_SPAWN, ENEMY_SPAWNS, type WorldObstacle } from "./types";
import { meleeHits } from "./CombatSystem";
import type { PlayerController } from "./PlayerController";
export type EnemyState =
  | "dormant"
  | "patrol"
  | "chase"
  | "windup"
  | "recover"
  | "return"
  | "stunned"
  | "dead";
export interface Enemy {
  id: number;
  boss: boolean;
  model: CharacterModel;
  actor: ActorBody | null;
  position: THREE.Vector3;
  home: THREE.Vector3;
  health: number;
  maxHealth: number;
  state: EnemyState;
  timer: number;
  yaw: number;
  phase: number;
  ring: THREE.Mesh;
  healthBar: THREE.Sprite;
  hitbox: { x: number; y: number; z: number; radius: number };
  attackType: "slash" | "slam";
}
export class EnemyAI {
  enemies: Enemy[] = [];
  constructor(
    private physics: PhysicsWorld,
    private scene: THREE.Scene,
    private obstacles: WorldObstacle[],
  ) {
    [...ENEMY_SPAWNS, BOSS_SPAWN].forEach((point, id) => {
      const boss = id === 4,
        model = new CharacterModel(boss ? "guardian" : "wraith");
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
          color: 0xedb464,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(position);
      ring.position.y += 0.055;
      scene.add(ring);
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 16;
      const texture = new THREE.CanvasTexture(canvas);
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
      this.enemies.push({
        id,
        boss,
        model,
        actor: physics.createActor(
          point.x,
          point.z,
          boss ? 0.72 : 0.34,
          boss ? 1.7 : 0.9,
        ),
        position,
        home: position.clone(),
        health: boss ? 300 : 72,
        maxHealth: boss ? 300 : 72,
        state: boss ? "dormant" : "patrol",
        timer: id * 0.8,
        yaw: 0,
        phase: 1,
        ring,
        healthBar,
        hitbox: {
          x: point.x,
          y: position.y + (boss ? 1.5 : 1),
          z: point.z,
          radius: boss ? 1 : 0.5,
        },
        attackType: "slash",
      });
    });
  }
  get kills() {
    return this.enemies.filter((e) => !e.boss && e.health <= 0).length;
  }
  get boss() {
    return this.enemies[4];
  }
  get inCombat() {
    return this.enemies.some(
      (e) =>
        e.state === "chase" || e.state === "windup" || e.state === "recover",
    );
  }
  update(
    dt: number,
    time: number,
    player: PlayerController,
    onHit: (damage: number, enemy: Enemy) => void,
  ) {
    for (const e of this.enemies) {
      e.timer -= dt;
      if (e.health <= 0) {
        e.model.update(dt, 0, 0, false, true, time);
        continue;
      }
      const distance = e.position.distanceTo(player.position),
        homeDistance = e.home.distanceTo(player.position);
      if (e.boss && e.state === "dormant" && this.kills === 4 && distance < 23)
        e.state = "chase";
      let vx = 0,
        vz = 0,
        animation = 0;
      if (e.state !== "dormant" && player.alive) {
        if (e.health < e.maxHealth * 0.48 && e.boss) e.phase = 2;
        if (e.state === "patrol") {
          if (distance < 14) {
            e.state = "chase";
            e.timer = 0;
          } else {
            const target = e.home
              .clone()
              .add(
                new THREE.Vector3(
                  Math.sin(time * 0.22 + e.id) * 2,
                  0,
                  Math.cos(time * 0.22 + e.id) * 2,
                ),
              );
            const direction = target.sub(e.position);
            if (direction.length() > 0.45) {
              direction.normalize();
              vx = direction.x * 0.8;
              vz = direction.z * 0.8;
            }
          }
        }
        if (e.state === "chase") {
          if (homeDistance > 30 || distance > 25) {
            e.state = "return";
          } else if (
            distance < (e.boss ? 3 : 1.95) &&
            this.physics.lineClear(e.hitbox, player.hitbox)
          ) {
            e.state = "windup";
            e.attackType = e.boss && e.phase === 2 ? "slam" : "slash";
            e.timer = e.boss ? 1.1 : 0.75;
            e.yaw = Math.atan2(
              -(player.position.x - e.position.x),
              -(player.position.z - e.position.z),
            );
          } else {
            let direction = player.position
              .clone()
              .sub(e.position)
              .setY(0)
              .normalize();
            // Steering probes avoid static geometry; Rapier handles the final collisions.
            for (const o of this.obstacles) {
              const dx = e.position.x + direction.x * 1.4 - o.x,
                dz = e.position.z + direction.z * 1.4 - o.z;
              if (Math.abs(dx) < o.hx + 1 && Math.abs(dz) < o.hz + 1) {
                const tangent = new THREE.Vector3(
                  -direction.z,
                  0,
                  direction.x,
                ).multiplyScalar(e.id % 2 ? 1 : -1);
                direction.addScaledVector(tangent, 2).normalize();
                break;
              }
            }
            const speed = e.boss ? (e.phase === 2 ? 3.4 : 2.4) : 2.8;
            vx = direction.x * speed;
            vz = direction.z * speed;
          }
        }
        if (e.state === "return") {
          const d = e.home.clone().sub(e.position).setY(0);
          if (d.length() < 1) e.state = "patrol";
          else {
            d.normalize();
            vx = d.x * 2.4;
            vz = d.z * 2.4;
          }
          if (distance < 10 && homeDistance < 26) e.state = "chase";
        }
        if (e.state === "windup") {
          animation = 1 - Math.max(0, e.timer) / (e.boss ? 1.1 : 0.75);
          const mat = e.ring.material as THREE.MeshBasicMaterial;
          mat.opacity = 0.08 + animation * 0.3;
          e.ring.visible = true;
          e.ring.position.set(e.position.x, e.position.y + 0.07, e.position.z);
          if (e.timer <= 0) {
            const hit =
              e.attackType === "slam"
                ? Math.hypot(
                    player.position.x - e.position.x,
                    player.position.z - e.position.z,
                  ) < 4.9 && Math.abs(player.position.y - e.position.y) < 1
                : meleeHits(
                    { ...e.hitbox, radius: e.boss ? 1.4 : 0.7 },
                    e.yaw,
                    player.hitbox,
                    e.boss ? 3 : 1.7,
                    Math.PI * 0.38,
                  );
            if (hit && this.physics.lineClear(e.hitbox, player.hitbox))
              onHit(e.boss ? (e.phase === 2 ? 28 : 22) : 14, e);
            e.state = "recover";
            e.timer = e.boss ? 1.4 : 1.05;
            mat.opacity = 0;
            e.ring.visible = false;
          }
        }
        if ((e.state === "recover" || e.state === "stunned") && e.timer <= 0)
          e.state = "chase";
      }
      if (vx || vz) e.yaw = Math.atan2(-vx, -vz);
      e.model.group.rotation.y = e.yaw;
      if (e.actor) this.physics.move(e.actor, vx * dt, -5 * dt, vz * dt);
      e.model.update(dt, Math.hypot(vx, vz) / 4, animation, false, false, time);
      e.healthBar.visible = e.health < e.maxHealth && distance < 25 && !e.boss;
      e.healthBar.position
        .copy(e.position)
        .add(new THREE.Vector3(0, e.boss ? 4 : 2.3, 0));
    }
  }
  sync() {
    for (const e of this.enemies)
      if (e.actor) {
        const p = e.actor.body.translation();
        e.position.set(p.x, p.y - e.actor.halfHeight, p.z);
        e.model.group.position.copy(e.position);
        e.hitbox = {
          x: e.position.x,
          y: e.position.y + (e.boss ? 1.5 : 1),
          z: e.position.z,
          radius: e.boss ? 1 : 0.5,
        };
      }
  }
  damage(e: Enemy, damage: number): boolean {
    if (e.health <= 0 || e.state === "dormant") return false;
    e.health = Math.max(0, e.health - damage);
    e.model.flash();
    const canvas = e.healthBar.material.map!.image as HTMLCanvasElement,
      ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 128, 16);
    ctx.fillStyle = "#162725";
    ctx.fillRect(0, 2, 128, 12);
    ctx.fillStyle = "#c2a16a";
    ctx.fillRect(1, 3, (126 * e.health) / e.maxHealth, 10);
    e.healthBar.material.map!.needsUpdate = true;
    if (e.health <= 0) {
      this.kill(e);
      return true;
    }
    if (!e.boss && e.state !== "windup") {
      e.state = "stunned";
      e.timer = 0.28;
    }
    return false;
  }
  kill(e: Enemy) {
    e.health = 0;
    e.state = "dead";
    e.ring.visible = false;
    e.healthBar.visible = false;
    if (e.actor) {
      this.physics.remove(e.actor);
      e.actor = null;
    }
  }
  reset() {
    for (const e of this.enemies) {
      e.health = e.maxHealth;
      e.phase = 1;
      e.state = e.boss ? "dormant" : "patrol";
      e.timer = 0;
      e.ring.visible = false;
      e.healthBar.visible = false;
      e.position.copy(e.home);
      if (e.actor) this.physics.teleport(e.actor, e.home.x, e.home.y, e.home.z);
      else
        e.actor = this.physics.createActor(
          e.home.x,
          e.home.z,
          e.boss ? 0.72 : 0.34,
          e.boss ? 1.7 : 0.9,
        );
      e.model.group.position.copy(e.home);
    }
  }
}
