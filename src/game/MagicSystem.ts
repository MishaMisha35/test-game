import * as THREE from "three";
import { segmentHitsSphere } from "./CombatSystem";
import type { EnemyAI, Enemy } from "./EnemyAI";
import type { PlayerController } from "./PlayerController";
import type { PhysicsWorld } from "./PhysicsWorld";
import type { Effects } from "./Effects";
interface Projectile {
  mesh: THREE.Group;
  position: THREE.Vector3;
  previous: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  frost: boolean;
  trailTime: number;
}
export class MagicSystem {
  projectiles: Projectile[] = [];
  frost = false;
  private light = new THREE.PointLight(0xffb256, 0, 5);
  constructor(
    private scene: THREE.Scene,
    private physics: PhysicsWorld,
    private effects: Effects,
  ) {
    scene.add(this.light);
  }
  cast(player: PlayerController, enemies: EnemyAI) {
    if (player.mana < 22 || player.spellCooldown > 0 || !player.alive)
      return false;
    player.mana -= 22;
    player.spellCooldown = 1.6;
    const origin = player.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    let direction = new THREE.Vector3(
      -Math.sin(player.yaw),
      0,
      -Math.cos(player.yaw),
    );
    const target = enemies.enemies
      .filter(
        (e) =>
          e.health > 0 &&
          e.state !== "dormant" &&
          e.position.distanceTo(origin) < 22,
      )
      .filter(
        (e) =>
          direction.dot(e.position.clone().sub(origin).setY(0).normalize()) >
          0.65,
      )
      .sort(
        (a, b) =>
          a.position.distanceToSquared(origin) -
          b.position.distanceToSquared(origin),
      )[0];
    if (target)
      direction = target.position
        .clone()
        .add(new THREE.Vector3(0, target.boss ? 1.8 : 1, 0))
        .sub(origin)
        .normalize();
    const group = new THREE.Group(),
      color = this.frost ? 0x91dcf3 : 0xffb256;
    group.add(
      new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.17, 1),
        new THREE.MeshBasicMaterial({ color }),
      ),
    );
    group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 8, 6),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
        }),
      ),
    );
    // A persistent light avoids recompiling every world material when a bolt spawns.
    group.position.copy(origin).addScaledVector(direction, 0.7);
    this.scene.add(group);
    this.projectiles.push({
      mesh: group,
      position: group.position.clone(),
      previous: group.position.clone(),
      velocity: direction.multiplyScalar(22),
      life: 2.3,
      frost: this.frost,
      trailTime: 0,
    });
    return true;
  }
  update(
    dt: number,
    enemies: EnemyAI,
    player: PlayerController,
    onHit: (enemy: Enemy, damage: number) => void,
  ) {
    this.light.intensity = this.projectiles.length ? 2 : 0;
    if (this.projectiles.length) {
      this.light.position.copy(this.projectiles[0].mesh.position);
      this.light.color.setHex(this.projectiles[0].frost ? 0x91dcf3 : 0xffb256);
    }
    this.projectiles = this.projectiles.filter((p) => {
      p.life -= dt;
      p.previous.copy(p.position);
      const from = p.position.clone(),
        to = from.clone().addScaledVector(p.velocity, dt);
      let hit: Enemy | undefined;
      if (p.life > 0)
        hit = enemies.enemies.find(
          (e) =>
            e.health > 0 &&
            e.state !== "dormant" &&
            segmentHitsSphere(from, to, {
              ...e.hitbox,
              radius: e.hitbox.radius + 0.2,
            }),
        );
      const blocked = !this.physics.lineClear(from, to);
      if (hit && !blocked) {
        onHit(hit, (p.frost ? 35 : 46) + player.upgrades.mage * 8);
        if (p.frost && hit.health > 0) {
          hit.state = "stunned";
          hit.timer = 1.6;
          hit.ring.visible = false;
        }
      }
      if (p.life <= 0 || hit || blocked) {
        this.effects.burst(to, p.frost ? 0x91dcf3 : 0xffb256, 18);
        this.scene.remove(p.mesh);
        p.mesh.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            (obj.material as THREE.Material).dispose();
          }
        });
        return false;
      }
      p.trailTime += dt;
      if (p.trailTime >= 0.045) {
        p.trailTime = 0;
        this.effects.trail(to, p.frost ? 0x91dcf3 : 0xffb256);
      }
      p.position.copy(to);
      p.mesh.rotation.z += dt * 4;
      return true;
    });
  }
  freezeInterpolation() {
    for (const p of this.projectiles) p.previous.copy(p.position);
  }
  render(alpha: number) {
    for (const p of this.projectiles)
      p.mesh.position.lerpVectors(
        p.previous,
        p.position,
        Math.max(0, Math.min(1, alpha)),
      );
  }
  clear() {
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      p.mesh.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.projectiles = [];
    this.light.intensity = 0;
  }
}
