import * as THREE from "three";
import { PhysicsWorld } from "./PhysicsWorld";
import { InputManager } from "./InputManager";

/** Exact exponential response, independent of the number of render frames. */
export function cameraDamp(
  value: number,
  target: number,
  response: number,
  dt: number,
) {
  return THREE.MathUtils.lerp(
    value,
    target,
    1 - Math.exp(-response * Math.max(0, dt)),
  );
}

/** A collision-safe orbit camera. Physics never follows the cosmetic camera. */
export class CameraController {
  private currentYaw = 0;
  private currentPitch = 0.27;
  private targetYaw = 0;
  private targetPitch = 0.27;
  desiredDistance = 6.6;
  firstPerson = false;
  sensitivity = 1;
  fov = 60;
  effectsIntensity = 0.6;
  shoulder = 1;
  motionStrength = 0;

  private armDistance = 6.6;
  private shoulderOffset = 0.45;
  private initialized = false;
  private trauma = 0;
  private elapsed = 0;
  private lastYaw = 0;
  private previousPlayer = new THREE.Vector3();
  private pivot = new THREE.Vector3();
  private shoulderPivot = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private right = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private candidate = new THREE.Vector3();
  private path = new THREE.Vector3();
  private look = new THREE.Vector3();

  constructor(
    public camera: THREE.PerspectiveCamera,
    private physics: PhysicsWorld,
  ) {}

  get yaw() {
    return this.currentYaw;
  }
  set yaw(value: number) {
    this.currentYaw = this.targetYaw = Number.isFinite(value) ? value : 0;
  }
  get pitch() {
    return this.currentPitch;
  }
  set pitch(value: number) {
    this.currentPitch = this.targetPitch = THREE.MathUtils.clamp(
      Number.isFinite(value) ? value : 0.27,
      -0.22,
      0.93,
    );
  }
  /** Kept as the public orbit-distance setting for existing callers. */
  get distance() {
    return this.desiredDistance;
  }
  set distance(value: number) {
    this.desiredDistance = THREE.MathUtils.clamp(value, 2.8, 10);
  }

  readInput(dt: number, input: InputManager) {
    this.targetYaw -= input.mouseX * 0.003 * this.sensitivity;
    this.targetPitch = THREE.MathUtils.clamp(
      this.targetPitch + input.mouseY * 0.0025 * this.sensitivity,
      -0.22,
      0.93,
    );
    if (input.down("KeyZ")) this.targetYaw += dt * 1.5;
    if (input.down("KeyC")) this.targetYaw -= dt * 1.5;
    // Apply on this frame, with only a short angular response to remove mouse jitter.
    this.currentYaw = cameraDamp(this.currentYaw, this.targetYaw, 50, dt);
    this.currentPitch = cameraDamp(this.currentPitch, this.targetPitch, 50, dt);
    if (Math.abs(this.targetYaw - this.currentYaw) < 0.00001)
      this.currentYaw = this.targetYaw;
    if (Math.abs(this.targetPitch - this.currentPitch) < 0.00001)
      this.currentPitch = this.targetPitch;
    if (input.take("KeyV")) {
      this.firstPerson = !this.firstPerson;
      if (!this.firstPerson)
        this.armDistance = Math.min(2.8, this.desiredDistance);
    }
    if (input.take("KeyB")) this.shoulder = this.shoulder < 0 ? 1 : -1;
    const wheel =
      (input as InputManager & { wheelDelta?: number }).wheelDelta ?? 0;
    this.desiredDistance = THREE.MathUtils.clamp(
      this.desiredDistance + THREE.MathUtils.clamp(wheel * 0.007, -1.8, 1.8),
      2.8,
      10,
    );
  }

  shake(amount: number) {
    if (Number.isFinite(amount))
      this.trauma = THREE.MathUtils.clamp(
        this.trauma + Math.max(0, amount),
        0,
        1,
      );
  }

  update(dt: number, position: THREE.Vector3, sprinting = false) {
    const delta = Math.max(0, Math.min(0.1, dt));
    this.elapsed += delta;
    this.desiredDistance = THREE.MathUtils.clamp(this.desiredDistance, 2.8, 10);
    const intensity = THREE.MathUtils.clamp(this.effectsIntensity, 0, 1);
    const targetFov =
      THREE.MathUtils.clamp(this.fov, 45, 95) + (sprinting ? 7 * intensity : 0);
    const nextFov = cameraDamp(this.camera.fov, targetFov, 9, delta);
    const previousFov = this.camera.fov;
    this.camera.fov = nextFov;
    if (Math.abs(nextFov - previousFov) > 0.0000001)
      this.camera.updateProjectionMatrix();

    // Input comes from an interpolated physical player pose. Keeping the pivot on
    // that pose avoids a second lagging anchor cutting through a building corner.
    this.pivot.copy(position).y += this.firstPerson ? 1.65 : 1.4;
    this.direction.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const radius = Math.max(
      0.28,
      this.camera.near *
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) *
        Math.hypot(1, this.camera.aspect) +
        0.05,
    );

    if (this.firstPerson) {
      this.candidate.copy(this.pivot);
      this.look.copy(this.pivot).addScaledVector(this.direction, -12);
    } else {
      this.shoulderOffset = cameraDamp(
        this.shoulderOffset,
        this.shoulder < 0 ? -0.45 : 0.45,
        12,
        delta,
      );
      const side = Math.sign(this.shoulderOffset) || 1;
      this.path.copy(this.right).multiplyScalar(side);
      const shoulderDistance = this.physics.cameraDistance(
        this.pivot,
        this.path,
        Math.abs(this.shoulderOffset),
        radius,
      );
      this.shoulderPivot
        .copy(this.pivot)
        .addScaledVector(this.path, shoulderDistance);
      const clearDistance = this.physics.cameraDistance(
        this.shoulderPivot,
        this.direction,
        this.desiredDistance,
        radius,
      );
      // Retraction is immediate. Extension is damped so a departing obstruction
      // cannot produce a sudden camera pop into the distance.
      this.armDistance =
        clearDistance < this.armDistance
          ? clearDistance
          : cameraDamp(this.armDistance, clearDistance, 8, delta);
      this.desired
        .copy(this.shoulderPivot)
        .addScaledVector(this.direction, this.armDistance);
      if (this.initialized)
        this.candidate
          .copy(this.camera.position)
          .lerp(this.desired, 1 - Math.exp(-18 * delta));
      else this.candidate.copy(this.desired);
      this.look.copy(this.pivot).y += 0.1;
    }

    // Small, positional impulses only: no head bob or repeated rotational kick.
    const shake = this.trauma * this.trauma * intensity * 0.035;
    if (shake > 0.00001) {
      this.candidate.addScaledVector(
        this.right,
        Math.sin(this.elapsed * 37) * shake,
      );
      this.candidate.y += Math.sin(this.elapsed * 29 + 1.4) * shake * 0.65;
    }
    this.trauma *= Math.exp(-8 * delta);
    // Re-sweep the final smoothed/shaken position, rather than trusting the
    // desired arm alone. This protects against lerping through walls at corners.
    if (!this.firstPerson) {
      this.path.copy(this.candidate).sub(this.pivot);
      const length = this.path.length();
      if (length > 0.00001) {
        this.path.multiplyScalar(1 / length);
        const safe = this.physics.cameraDistance(
          this.pivot,
          this.path,
          length,
          radius,
        );
        if (safe < length)
          this.candidate.copy(this.pivot).addScaledVector(this.path, safe);
      }
    }
    this.camera.position.copy(this.candidate);
    this.camera.lookAt(this.look);

    if (this.initialized && delta > 0) {
      const speed = this.previousPlayer.distanceTo(position) / delta;
      const turning = Math.abs(this.yaw - this.lastYaw) / delta;
      const motion =
        THREE.MathUtils.clamp(speed / 14 + turning * 0.07, 0, 1) * intensity;
      this.motionStrength = cameraDamp(this.motionStrength, motion, 12, delta);
    } else this.motionStrength = 0;
    this.previousPlayer.copy(position);
    this.lastYaw = this.yaw;
    this.initialized = true;
  }

  snap(position: THREE.Vector3) {
    this.targetYaw = this.currentYaw;
    this.targetPitch = this.currentPitch;
    this.armDistance = this.desiredDistance;
    this.shoulderOffset = this.shoulder < 0 ? -0.45 : 0.45;
    this.trauma = 0;
    this.motionStrength = 0;
    this.lastYaw = this.yaw;
    this.previousPlayer.copy(position);
    this.initialized = false;
    this.camera.fov = THREE.MathUtils.clamp(this.fov, 45, 95);
    this.camera.updateProjectionMatrix();
    this.update(0, position);
  }
}
