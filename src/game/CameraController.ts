import * as THREE from "three";
import { PhysicsWorld } from "./PhysicsWorld";
import { InputManager } from "./InputManager";
export class CameraController {
  yaw = 0;
  pitch = 0.27;
  distance = 6.6;
  firstPerson = false;
  sensitivity = 1;
  private target = new THREE.Vector3();
  constructor(
    public camera: THREE.PerspectiveCamera,
    private physics: PhysicsWorld,
  ) {}
  readInput(dt: number, input: InputManager) {
    this.yaw -= input.mouseX * 0.003 * this.sensitivity;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + input.mouseY * 0.0025 * this.sensitivity,
      -0.22,
      0.93,
    );
    if (input.take("KeyV")) this.firstPerson = !this.firstPerson;
    if (input.down("KeyZ")) this.yaw += dt * 1.5;
    if (input.down("KeyC")) this.yaw -= dt * 1.5;
  }
  update(dt: number, position: THREE.Vector3) {
    this.target
      .copy(position)
      .add(new THREE.Vector3(0, this.firstPerson ? 1.65 : 1.35, 0));
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    const d = this.firstPerson
      ? 0
      : this.physics.cameraDistance(this.target, dir, this.distance);
    const desired = this.target.clone().addScaledVector(dir, d);
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 12));
    const look = this.firstPerson
      ? this.target.clone().addScaledVector(dir, -12)
      : this.target.clone().add(new THREE.Vector3(0, 0.1, 0));
    this.camera.lookAt(look);
  }
  snap(position: THREE.Vector3) {
    this.camera.position.copy(position).add(new THREE.Vector3(0, 3, 7));
  }
}
