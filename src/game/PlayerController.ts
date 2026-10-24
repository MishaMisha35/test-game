import * as THREE from "three";
import { CharacterModel } from "./CharacterModel";
import { PhysicsWorld, type ActorBody } from "./PhysicsWorld";
import { InputManager } from "./InputManager";
import { SPAWN } from "./types";

export class PlayerController {
  model = new CharacterModel("hero");
  actor: ActorBody;
  position = new THREE.Vector3();
  yaw = 0;
  velocity = new THREE.Vector3();
  verticalVelocity = 0;
  health = 120;
  maxHealth = 120;
  mana = 100;
  maxMana = 100;
  stamina = 100;
  maxStamina = 100;
  level = 1;
  xp = 0;
  gold = 0;
  potions = 3;
  upgrades = { warrior: 0, mage: 0, rogue: 0 };
  attackTime = 0;
  attackDuration = 0.6;
  attackCooldown = 0;
  hitApplied = false;
  heavy = false;
  dodgeTime = 0;
  dodgeCooldown = 0;
  spellCooldown = 0;
  invulnerable = 0;
  blocking = false;
  lastStep = 0;
  constructor(
    private physics: PhysicsWorld,
    scene: THREE.Scene,
  ) {
    this.actor = physics.createActor(SPAWN.x, SPAWN.z);
    scene.add(this.model.group);
    this.sync();
  }
  get nextLevel() {
    return this.level * 100;
  }
  get alive() {
    return this.health > 0;
  }
  get attacking() {
    return this.attackTime > 0;
  }
  get hitbox() {
    return {
      x: this.position.x,
      y: this.position.y + 1,
      z: this.position.z,
      radius: 0.45,
    };
  }
  sync() {
    const p = this.actor.body.translation();
    this.position.set(p.x, p.y - this.actor.halfHeight, p.z);
    this.model.group.position.copy(this.position);
    this.model.group.rotation.y = this.yaw;
  }
  update(
    dt: number,
    input: InputManager,
    cameraYaw: number,
    time: number,
    onSound: (type: "step" | "dodge") => void,
  ) {
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    this.spellCooldown = Math.max(0, this.spellCooldown - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.attackTime = Math.max(0, this.attackTime - dt);
    this.dodgeTime = Math.max(0, this.dodgeTime - dt);
    this.blocking =
      input.secondary &&
      this.stamina > 2 &&
      !this.attacking &&
      this.dodgeTime <= 0;
    let x =
      Number(input.down("KeyD", "ArrowRight")) -
      Number(input.down("KeyA", "ArrowLeft"));
    let z =
      Number(input.down("KeyS", "ArrowDown")) -
      Number(input.down("KeyW", "ArrowUp"));
    const length = Math.hypot(x, z);
    if (length) {
      x /= length;
      z /= length;
    }
    const sprint =
      input.down("ShiftLeft", "ShiftRight") &&
      length > 0 &&
      this.stamina > 4 &&
      !this.attacking;
    const crouch = input.down("ControlLeft", "ControlRight");
    let speed = this.blocking ? 2.2 : crouch ? 2 : sprint ? 8 : 4.6;
    if (this.attacking) speed *= 0.45;
    const wx = x * Math.cos(cameraYaw) + z * Math.sin(cameraYaw),
      wz = -x * Math.sin(cameraYaw) + z * Math.cos(cameraYaw);
    if (input.take("KeyQ") && this.dodgeCooldown <= 0 && this.stamina >= 22) {
      this.dodgeTime = 0.34;
      this.dodgeCooldown = 1.1;
      this.stamina -= 22;
      this.invulnerable = 0.38;
      if (length) this.yaw = Math.atan2(-wx, -wz);
      onSound("dodge");
    }
    if (input.take("Space") && this.actor.grounded && this.stamina >= 10) {
      this.verticalVelocity = 8;
      this.stamina -= 10;
    }
    if (this.dodgeTime > 0) {
      this.velocity.x = -Math.sin(this.yaw) * 13;
      this.velocity.z = -Math.cos(this.yaw) * 13;
    } else {
      const blend = 1 - Math.exp(-dt * 13);
      this.velocity.x = THREE.MathUtils.lerp(
        this.velocity.x,
        wx * speed,
        blend,
      );
      this.velocity.z = THREE.MathUtils.lerp(
        this.velocity.z,
        wz * speed,
        blend,
      );
      if (length && !this.attacking) {
        const target = Math.atan2(-wx, -wz);
        this.yaw +=
          Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw)) *
          Math.min(1, dt * 14);
      }
    }
    if (sprint) this.stamina = Math.max(0, this.stamina - dt * 12);
    else if (!this.attacking && !this.blocking && this.dodgeTime <= 0)
      this.stamina = Math.min(this.maxStamina, this.stamina + dt * 21);
    this.mana = Math.min(
      this.maxMana,
      this.mana + dt * (3 + this.upgrades.mage),
    );
    if (this.actor.grounded && this.verticalVelocity < 0)
      this.verticalVelocity = -2;
    this.verticalVelocity -= 20 * dt;
    this.physics.move(
      this.actor,
      this.velocity.x * dt,
      this.verticalVelocity * dt,
      this.velocity.z * dt,
    );
    if (length && this.actor.grounded) {
      this.lastStep += dt;
      if (this.lastStep > (sprint ? 0.28 : 0.43)) {
        this.lastStep = 0;
        onSound("step");
      }
    }
    this.model.update(
      dt,
      Math.hypot(this.velocity.x, this.velocity.z) / 5,
      this.attacking ? 1 - this.attackTime / this.attackDuration : 0,
      this.blocking,
      false,
      time,
    );
    this.model.group.position.y -= crouch ? 0.25 : 0;
  }
  attack(heavy: boolean) {
    const cost = heavy ? 27 : 14;
    if (
      !this.alive ||
      this.attackCooldown > 0 ||
      this.dodgeTime > 0 ||
      this.stamina < cost
    )
      return false;
    this.heavy = heavy;
    this.attackDuration = heavy ? 0.85 : 0.52;
    this.attackTime = this.attackDuration;
    this.attackCooldown = this.attackDuration + 0.08;
    this.hitApplied = false;
    this.stamina -= cost;
    return true;
  }
  gainXP(amount: number) {
    this.xp += amount;
    let leveled = false;
    while (this.xp >= this.nextLevel) {
      this.xp -= this.nextLevel;
      this.level++;
      this.maxHealth = 120 + (this.level - 1) * 15;
      this.health = this.maxHealth;
      this.mana = this.maxMana;
      leveled = true;
    }
    return leveled;
  }
  respawn() {
    this.health = this.maxHealth;
    this.mana = this.maxMana;
    this.stamina = this.maxStamina;
    this.verticalVelocity = 0;
    this.velocity.set(0, 0, 0);
    this.attackTime = 0;
    this.attackCooldown = 0;
    this.dodgeTime = 0;
    this.blocking = false;
    this.invulnerable = 2;
    this.physics.teleport(this.actor, SPAWN.x, 0, SPAWN.z);
    this.sync();
  }
}
