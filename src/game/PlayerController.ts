import * as THREE from "three";
import { CharacterModel, type LocomotionState } from "./CharacterModel";
import { PhysicsWorld, type ActorBody } from "./PhysicsWorld";
import { InputManager } from "./InputManager";
import { SPAWN } from "./types";
import {
  angleDelta,
  cameraRelativeInput,
  dodgeDistanceAt,
  JumpWindow,
} from "./MovementMath";

export type AttackPhase =
  "idle" | "windup" | "active" | "recovery" | "charging";
const LIGHT_TIMINGS = [
  { duration: 0.48, windup: 0.15, active: 0.13 },
  { duration: 0.5, windup: 0.17, active: 0.13 },
  { duration: 0.58, windup: 0.23, active: 0.15 },
] as const;

export class PlayerController {
  model = new CharacterModel("hero");
  actor: ActorBody;
  position = new THREE.Vector3();
  previousPosition = new THREE.Vector3();
  renderPosition = new THREE.Vector3();
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
  attackDuration = 0.48;
  attackCooldown = 0;
  hitApplied = false;
  heavy = false;
  comboIndex = 0;
  swingId = 0;
  charging = false;
  chargePower = 0;
  counterAttack = false;
  guardBrokenTime = 0;
  private chargeElapsed = 0;
  private counterTime = 0;
  private attackWindup = 0.15;
  private attackActive = 0.13;
  dodgeTime = 0;
  dodgeCooldown = 0;
  spellCooldown = 0;
  invulnerable = 0;
  blocking = false;
  parryTime = 0;
  guardTime = 0;
  sprinting = false;
  grounded = false;
  walking = false;
  landingImpact = 0;
  lastStep = 0;
  actualSpeed = 0;
  private readonly jump = new JumpWindow();
  private readonly direction = { x: 0, z: 0 };
  private dodgeX = 0;
  private dodgeZ = -1;
  private dodgeAge = 0;
  private stepDT = 1 / 60;
  private beforeMoveY = 0;
  private previousYaw = 0;
  private turn = 0;
  private acceleration = 0;
  private landingEvent = 0;
  private attackStarted = false;
  private queuedAttack: boolean | null = null;
  private queueTime = 0;
  private comboGrace = 0;
  private strideDistance = 0;
  private crouching = false;
  private crouchAmount = 1;
  private firstPerson = false;
  private desiredSprint = false;
  private initialized = false;
  private readonly locomotion: LocomotionState = {
    grounded: false,
    verticalVelocity: 0,
    turn: 0,
    acceleration: 0,
    landing: 0,
    dodge: 0,
    combo: 0,
    speed: 0,
  };

  constructor(
    private physics: PhysicsWorld,
    scene: THREE.Scene,
  ) {
    this.actor = physics.createActor(SPAWN.x, SPAWN.z);
    scene.add(this.model.group);
    this.sync();
    this.resetInterpolation();
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
  get attackPhase(): AttackPhase {
    if (this.charging) return "charging";
    if (!this.attacking) return "idle";
    const elapsed = this.attackDuration - this.attackTime;
    if (elapsed < this.attackWindup) return "windup";
    if (elapsed < this.attackWindup + this.attackActive) return "active";
    return "recovery";
  }
  get canHit(): boolean {
    return this.alive && !this.hitApplied && this.attackPhase === "active";
  }
  get chargeRatio(): number {
    return this.charging ? Math.min(1, this.chargeElapsed / 0.9) : 0;
  }
  get counterWindow(): number {
    return this.counterTime;
  }
  openCounterWindow(): void {
    if (this.alive && this.guardBrokenTime <= 0) this.counterTime = 0.85;
  }
  cancelCharge(): void {
    this.charging = false;
    this.chargeElapsed = 0;
  }
  breakGuard(duration = 0.7): void {
    const remaining = this.guardBrokenTime;
    this.resetActions();
    this.guardBrokenTime = Math.max(
      remaining,
      Math.max(0.1, Math.min(2, Number.isFinite(duration) ? duration : 0.7)),
    );
  }
  get dodgeInvulnerable() {
    return this.dodgeTime > 0 && this.dodgeAge >= 0.06 && this.dodgeAge <= 0.26;
  }
  get hitbox() {
    return {
      x: this.position.x,
      y: this.position.y + 1,
      z: this.position.z,
      radius: 0.45,
    };
  }

  /** Called before every fixed physics step, never before an animation-only frame. */
  beginStep(): void {
    this.previousPosition.copy(this.position);
    this.previousYaw = this.yaw;
  }
  sync(): void {
    const p = this.actor.body.translation();
    const x = p.x,
      y = p.y - this.actor.halfHeight,
      z = p.z;
    if (this.initialized) {
      const distance = Math.hypot(x - this.position.x, z - this.position.z);
      const previousSpeed = this.actualSpeed;
      this.actualSpeed = distance / this.stepDT;
      this.acceleration = (this.actualSpeed - previousSpeed) / this.stepDT;
      this.strideDistance += this.grounded ? distance : 0;
      const nowGrounded = this.actor.grounded && this.verticalVelocity <= 0;
      if (nowGrounded && !this.grounded && this.beforeMoveY < -2) {
        this.landingEvent = Math.max(this.landingEvent, -this.beforeMoveY);
        this.landingImpact = Math.min(1, -this.beforeMoveY / 13);
      }
      this.grounded = nowGrounded;
    } else {
      this.initialized = true;
      this.grounded = this.actor.grounded;
    }
    this.position.set(x, y, z);
    this.sprinting = this.desiredSprint && this.actualSpeed > 3;
  }
  resetInterpolation(): void {
    this.previousPosition.copy(this.position);
    this.renderPosition.copy(this.position);
    this.previousYaw = this.yaw;
    this.actualSpeed = 0;
    this.acceleration = 0;
    this.strideDistance = 0;
    this.model.group.position.copy(this.position);
    this.model.group.rotation.y = this.yaw;
  }
  /** Freeze the rendered pose at contact without resetting speed or gait. */
  freezeInterpolation(): void {
    this.previousPosition.copy(this.position);
    this.renderPosition.copy(this.position);
    this.previousYaw = this.yaw;
  }
  consumeLanding(): number {
    const value = this.landingEvent;
    this.landingEvent = 0;
    return value;
  }
  /** Consume once after simulation to play a swing for immediate or queued attacks. */
  consumeAttackStarted(): boolean {
    const value = this.attackStarted;
    this.attackStarted = false;
    return value;
  }

  update(
    dt: number,
    input: InputManager,
    cameraYaw: number,
    _time: number,
    onSound: (type: "step" | "dodge") => void,
  ): void {
    this.stepDT = dt;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    this.spellCooldown = Math.max(0, this.spellCooldown - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.parryTime = Math.max(0, this.parryTime - dt);
    this.counterTime = Math.max(0, this.counterTime - dt);
    this.guardBrokenTime = Math.max(0, this.guardBrokenTime - dt);
    const wasAttacking = this.attacking;
    this.attackTime = Math.max(0, this.attackTime - dt);
    if (wasAttacking && !this.attacking) {
      this.comboGrace = 0.3;
      this.counterAttack = false;
      this.chargePower = 0;
    } else this.comboGrace = Math.max(0, this.comboGrace - dt);
    this.queueTime = Math.max(0, this.queueTime - dt);
    if (!this.alive) {
      this.resetActions();
      return;
    }
    const chargePressed = input.take("KeyT");
    const chargeReleased = input.take("ChargeRelease");
    if (
      chargePressed &&
      !this.attacking &&
      this.attackCooldown <= 0 &&
      this.dodgeTime <= 0 &&
      this.guardBrokenTime <= 0 &&
      this.stamina >= 32
    ) {
      this.charging = true;
      this.chargeElapsed = 0;
      this.chargePower = 0;
      this.blocking = false;
      this.parryTime = 0;
      this.clearQueuedAttack();
    }
    if (this.charging && input.pressed.has("KeyQ")) this.cancelCharge();
    if (this.charging) {
      if (chargeReleased) this.releaseCharge();
      else if (!input.down("KeyT") || this.guardBrokenTime > 0)
        this.cancelCharge();
      else {
        this.chargeElapsed = Math.min(0.9, this.chargeElapsed + dt);
        this.stamina = Math.max(0, this.stamina - 4 * dt);
        if (this.stamina < 32) this.cancelCharge();
        else if (this.chargeElapsed >= 0.9 - 1e-8) this.releaseCharge();
      }
    }
    // A buffer that reaches zero on the exact recovery boundary is still valid.
    if (this.queueTime <= 0 && this.attackCooldown > 1e-8)
      this.queuedAttack = null;
    if (
      this.queuedAttack !== null &&
      this.attackCooldown <= 1e-8 &&
      this.dodgeTime <= 0 &&
      !this.charging &&
      this.guardBrokenTime <= 0
    ) {
      const heavy = this.queuedAttack;
      this.clearQueuedAttack();
      if (this.startAttack(heavy)) this.attackStarted = true;
    }
    if (input.take("CapsLock")) this.walking = !this.walking;
    this.crouching = input.down("ControlLeft", "ControlRight");
    this.blocking =
      input.secondary &&
      this.stamina > 2 &&
      !this.attacking &&
      !this.charging &&
      this.guardBrokenTime <= 0 &&
      this.dodgeTime <= 0;
    this.guardTime = this.blocking ? this.guardTime + dt : 0;
    if (input.take("Block") && this.blocking) {
      this.parryTime = 0.16;
      this.guardTime = 0;
    }
    if (!this.blocking) this.parryTime = 0;
    const x =
      Number(input.down("KeyD", "ArrowRight")) -
      Number(input.down("KeyA", "ArrowLeft"));
    const z =
      Number(input.down("KeyS", "ArrowDown")) -
      Number(input.down("KeyW", "ArrowUp"));
    cameraRelativeInput(x, z, cameraYaw, this.direction);
    const moving = x !== 0 || z !== 0;
    const wx = this.direction.x,
      wz = this.direction.z;
    this.desiredSprint =
      input.down("ShiftLeft", "ShiftRight") &&
      moving &&
      this.stamina > 4 &&
      !this.attacking &&
      !this.charging &&
      this.guardBrokenTime <= 0 &&
      !this.blocking &&
      !this.crouching;
    let speed = this.blocking
      ? 2.2
      : this.crouching
        ? 2
        : this.desiredSprint
          ? 8
          : this.walking
            ? 2.2
            : 4.6;
    if (this.attacking) speed *= 0.45;
    if (this.charging) speed *= 0.38;
    if (this.guardBrokenTime > 0) speed *= 0.55;
    if (
      input.take("KeyQ") &&
      this.dodgeCooldown <= 0 &&
      this.stamina >= 22 &&
      !this.attacking
    ) {
      this.dodgeTime = 0.38;
      this.dodgeAge = 0;
      this.dodgeCooldown = 1.1;
      this.stamina -= 22;
      this.dodgeX = moving ? wx : -Math.sin(this.yaw);
      this.dodgeZ = moving ? wz : -Math.cos(this.yaw);
      if (moving && !this.firstPerson) this.yaw = Math.atan2(-wx, -wz);
      this.blocking = false;
      this.parryTime = 0;
      this.cancelCharge();
      this.clearQueuedAttack();
      onSound("dodge");
    }
    this.jump.update(dt, this.grounded, input.take("Space"));
    if (this.jump.consume(this.stamina >= 10 && this.dodgeTime <= 0)) {
      this.verticalVelocity = 8.2;
      this.stamina -= 10;
      this.grounded = false;
    }
    let moveX: number, moveZ: number;
    if (this.dodgeTime > 0) {
      const nextAge = Math.min(0.38, this.dodgeAge + dt);
      const distance =
        dodgeDistanceAt(nextAge) - dodgeDistanceAt(this.dodgeAge);
      moveX = this.dodgeX * distance;
      moveZ = this.dodgeZ * distance;
      this.dodgeAge = nextAge;
      this.dodgeTime = Math.max(0, 0.38 - nextAge);
      // A dodge stops cleanly instead of leaking its initial burst into normal movement.
      this.velocity.x = this.dodgeX * Math.min(speed, distance / dt);
      this.velocity.z = this.dodgeZ * Math.min(speed, distance / dt);
    } else {
      const targetX = wx * speed,
        targetZ = wz * speed;
      const dx = targetX - this.velocity.x,
        dz = targetZ - this.velocity.z;
      const delta = Math.hypot(dx, dz);
      const turning =
        moving && this.velocity.x * targetX + this.velocity.z * targetZ < 0;
      const rate = this.grounded
        ? !moving
          ? 38
          : turning
            ? 54
            : 32
        : !moving
          ? 9
          : 14;
      const ratio = delta > 0 ? Math.min(1, (rate * dt) / delta) : 0;
      this.velocity.x += dx * ratio;
      this.velocity.z += dz * ratio;
      moveX = this.velocity.x * dt;
      moveZ = this.velocity.z * dt;
      if (moving && !this.attacking && !this.charging && !this.firstPerson) {
        const difference = angleDelta(this.yaw, Math.atan2(-wx, -wz));
        const change = Math.max(-18 * dt, Math.min(18 * dt, difference));
        this.yaw += change;
        this.turn = change / dt;
      } else this.turn = 0;
    }
    if (this.desiredSprint && this.actualSpeed > 3 && this.dodgeTime <= 0)
      this.stamina = Math.max(0, this.stamina - dt * 12);
    else if (
      !this.attacking &&
      !this.charging &&
      !this.blocking &&
      this.dodgeTime <= 0
    )
      this.stamina = Math.min(this.maxStamina, this.stamina + dt * 21);
    this.mana = Math.min(
      this.maxMana,
      this.mana + dt * (3 + this.upgrades.mage),
    );
    if (this.grounded && this.verticalVelocity < 0) this.verticalVelocity = -2;
    this.verticalVelocity = Math.max(
      -35,
      this.verticalVelocity - (this.verticalVelocity > 0 ? 22 : 32) * dt,
    );
    this.beforeMoveY = this.verticalVelocity;
    this.physics.move(this.actor, moveX, this.verticalVelocity * dt, moveZ);
    if (
      this.strideDistance >=
        (this.sprinting ? 2.05 : this.walking ? 1.35 : 1.65) &&
      this.grounded &&
      this.actualSpeed > 0.4 &&
      this.dodgeTime <= 0
    ) {
      this.strideDistance = 0;
      onSound("step");
    }
  }
  render(alpha: number, dt: number, time: number, firstPerson = false): void {
    this.firstPerson = firstPerson;
    const a = Math.max(0, Math.min(1, alpha));
    this.renderPosition.lerpVectors(this.previousPosition, this.position, a);
    this.model.group.position.copy(this.renderPosition);
    this.model.group.rotation.y =
      this.previousYaw + angleDelta(this.previousYaw, this.yaw) * a;
    this.model.group.visible = !firstPerson;
    this.crouchAmount +=
      ((this.crouching ? 0.83 : 1) - this.crouchAmount) *
      (1 - Math.exp(-dt * 16));
    this.model.group.scale.y = this.crouchAmount;
    this.landingImpact *= Math.exp(-dt * 11);
    const pose = this.locomotion;
    pose.grounded = this.grounded;
    pose.verticalVelocity = this.verticalVelocity;
    pose.turn = this.turn;
    pose.acceleration = this.acceleration;
    pose.landing = this.landingImpact;
    pose.dodge = this.dodgeTime > 0 ? Math.max(0.001, this.dodgeAge / 0.38) : 0;
    pose.combo = this.comboIndex;
    pose.speed = this.actualSpeed;
    this.model.setLocomotion(pose);
    this.model.setCombatPose({
      phase: this.attackPhase,
      heavy: this.heavy,
      charge: this.charging ? this.chargeRatio : this.chargePower,
      counter: this.counterAttack,
      stagger: this.guardBrokenTime > 0 ? 1 : 0,
      guardBroken: this.guardBrokenTime > 0,
    });
    this.model.update(
      dt,
      this.actualSpeed / 5,
      this.attacking ? 1 - this.attackTime / this.attackDuration : 0,
      this.blocking,
      !this.alive,
      time,
    );
  }
  attack(heavy: boolean): boolean {
    if (
      !this.alive ||
      this.dodgeTime > 0 ||
      this.charging ||
      this.guardBrokenTime > 0
    )
      return false;
    if (this.attackCooldown <= 0) return this.startAttack(heavy);
    // The whole remaining recovery must fit within the input buffer lifetime.
    if (
      this.attacking &&
      this.attackTime <= 0.23 &&
      this.attackCooldown <= 0.25 &&
      this.stamina >= (heavy ? 27 : 14)
    ) {
      this.queuedAttack = heavy;
      this.queueTime = 0.25;
    }
    return false;
  }
  private releaseCharge(): void {
    const elapsed = this.chargeElapsed;
    this.cancelCharge();
    if (
      elapsed + 1e-8 >= 0.25 &&
      this.alive &&
      this.guardBrokenTime <= 0 &&
      this.dodgeTime <= 0
    )
      this.startAttack(true, Math.min(1, elapsed / 0.9), true);
  }
  private startAttack(
    heavy: boolean,
    chargePower = 0,
    charged = false,
  ): boolean {
    const cost = charged ? 32 : heavy ? 27 : 14;
    if (this.stamina < cost || !this.alive || this.guardBrokenTime > 0)
      return false;
    this.comboIndex =
      !heavy && !this.heavy && this.comboGrace > 0
        ? (this.comboIndex + 1) % 3
        : 0;
    this.heavy = heavy;
    this.chargePower = heavy ? Math.max(0, Math.min(1, chargePower)) : 0;
    const timing = LIGHT_TIMINGS[this.comboIndex];
    this.attackDuration = heavy ? 0.85 : timing.duration;
    this.attackWindup = heavy ? (charged ? 0.26 : 0.36) : timing.windup;
    this.attackActive = heavy ? 0.18 : timing.active;
    this.attackTime = this.attackDuration;
    this.attackCooldown = this.attackDuration + 0.02;
    this.hitApplied = false;
    this.stamina -= cost;
    this.blocking = false;
    this.parryTime = 0;
    this.counterAttack = this.counterTime > 0;
    this.counterTime = 0;
    this.comboGrace = 0;
    this.swingId++;
    this.attackStarted = true;
    return true;
  }
  private clearQueuedAttack(): void {
    this.queuedAttack = null;
    this.queueTime = 0;
  }
  /** Also call before restoring a save: no input/action from the old life is replayed. */
  clearActions(): void {
    this.resetActions();
  }
  resetActions(): void {
    this.attackTime = 0;
    this.attackCooldown = 0;
    this.hitApplied = false;
    this.heavy = false;
    this.comboIndex = 0;
    this.dodgeTime = 0;
    this.dodgeAge = 0;
    this.dodgeCooldown = 0;
    this.spellCooldown = 0;
    this.blocking = false;
    this.parryTime = 0;
    this.guardTime = 0;
    this.attackStarted = false;
    this.comboGrace = 0;
    this.cancelCharge();
    this.chargePower = 0;
    this.counterAttack = false;
    this.counterTime = 0;
    this.guardBrokenTime = 0;
    this.clearQueuedAttack();
    this.jump.reset();
    this.landingEvent = 0;
    this.landingImpact = 0;
    this.sprinting = false;
    this.desiredSprint = false;
  }
  gainXP(amount: number): boolean {
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
  respawn(): void {
    this.health = this.maxHealth;
    this.mana = this.maxMana;
    this.stamina = this.maxStamina;
    this.verticalVelocity = 0;
    this.velocity.set(0, 0, 0);
    this.resetActions();
    this.invulnerable = 2;
    this.physics.teleport(this.actor, SPAWN.x, 0, SPAWN.z);
    this.sync();
    this.resetInterpolation();
  }
}
