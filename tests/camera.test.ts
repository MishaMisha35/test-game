import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CameraController, cameraDamp } from "../src/game/CameraController";
import { PhysicsWorld } from "../src/game/PhysicsWorld";
import { terrainHeight } from "../src/game/WorldManager";
import type { InputManager } from "../src/game/InputManager";
import type { WorldObstacle } from "../src/game/types";

const worlds: PhysicsWorld[] = [];
beforeAll(async () => {
  await PhysicsWorld.init();
});
afterEach(() => {
  for (const physics of worlds.splice(0)) physics.world.free();
});
function world(obstacles: WorldObstacle[] = []) {
  const physics = new PhysicsWorld(obstacles);
  worlds.push(physics);
  physics.step();
  return physics;
}
function input(mouseX = 0, mouseY = 0, wheelDelta = 0, pressed: string[] = []) {
  const keys = new Set(pressed);
  return {
    mouseX,
    mouseY,
    wheelDelta,
    down: () => false,
    take: (code: string) => {
      const value = keys.has(code);
      keys.delete(code);
      return value;
    },
  } as unknown as InputManager;
}
function camera(physics: PhysicsWorld) {
  return new CameraController(
    new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200),
    physics,
  );
}
function expectClear(physics: PhysicsWorld, position: THREE.Vector3) {
  expect(
    physics.world.intersectionWithShape(
      position,
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Ball(0.26),
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => !c.parent(),
    ),
  ).toBeNull();
}

describe("smooth collision-safe camera", () => {
  it("sweeps the near-plane sphere at a wall edge that a center ray misses", () => {
    const physics = world([{ x: 0, z: 10, hx: 1, hz: 1, height: 4 }]);
    const start = { x: 1.15, y: 2, z: 14 },
      end = { x: 1.15, y: 2, z: 7 };
    expect(physics.lineClear(start, end)).toBe(true);
    expect(
      physics.cameraDistance(start, { x: 0, y: 0, z: -1 }, 7),
    ).toBeLessThan(3.2);
    expect(
      physics.cameraDistance(
        { x: 0, y: 2, z: 11.32 },
        { x: 0, y: 0, z: -1 },
        2,
      ),
    ).toBeLessThan(0.1);
  });

  it("ignores the player's own collider and other actors during camera sweeps", () => {
    const physics = world();
    physics.createActor(0, 14);
    physics.createActor(0, 17);
    physics.step();
    const start = { x: 0, y: terrainHeight(0, 14) + 1.4, z: 14 };
    expect(physics.cameraDistance(start, { x: 0, y: 0.1, z: 1 }, 6)).toBe(6);
    const orbit = camera(physics);
    orbit.snap(new THREE.Vector3(0, terrainHeight(0, 14), 14));
    expect(orbit.camera.position.z).toBeGreaterThan(20);
  });

  it("retracts on the first blocked frame instead of smoothing through a wall", () => {
    const physics = world(),
      orbit = camera(physics);
    const player = new THREE.Vector3(0, terrainHeight(0, 14), 14);
    orbit.snap(player);
    expect(orbit.camera.position.z).toBeGreaterThan(20);
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(4, 3, 1).setTranslation(0, 3, 18),
    );
    physics.step();
    orbit.update(1 / 144, player);
    expect(orbit.camera.position.z).toBeLessThan(16.72);
    expectClear(physics, orbit.camera.position);
  });

  it("keeps the final interpolated camera sphere clear while following around a corner", () => {
    const physics = world([{ x: 0, z: 18, hx: 3, hz: 1, height: 5 }]),
      orbit = camera(physics);
    const player = new THREE.Vector3(0, terrainHeight(0, 14), 14);
    orbit.snap(player);
    for (let frame = 0; frame < 120; frame++) {
      player.x = Math.min(5, frame / 18);
      player.y = terrainHeight(player.x, player.z);
      orbit.update(1 / 60, player);
      expectClear(physics, orbit.camera.position);
    }
    expect(orbit.camera.position.x).toBeGreaterThan(4.5);
    expect(orbit.camera.position.z).toBeGreaterThan(18);
  });

  it("keeps a lowered long orbit above the actual terrain", () => {
    const physics = world(),
      orbit = camera(physics);
    const player = new THREE.Vector3(0, terrainHeight(0, 14), 14);
    orbit.pitch = -0.22;
    orbit.distance = 10;
    orbit.snap(player);
    expectClear(physics, orbit.camera.position);
    expect(
      orbit.camera.position.y -
        terrainHeight(orbit.camera.position.x, orbit.camera.position.z),
    ).toBeGreaterThan(0.25);
    expect(orbit.camera.position.distanceTo(player)).toBeLessThan(10);
  });

  it("settles to the same orbit and sprint FOV at 30 and 144 render fps", () => {
    const physics = world(),
      a = camera(physics),
      b = camera(physics);
    const player = new THREE.Vector3(0, terrainHeight(0, 14), 14);
    for (const orbit of [a, b]) {
      orbit.effectsIntensity = 1;
      orbit.snap(player);
    }
    for (const [orbit, fps] of [
      [a, 30],
      [b, 144],
    ] as const) {
      for (let frame = 0; frame < fps; frame++) {
        orbit.readInput(1 / fps, input(frame === 0 ? 120 : 0));
        orbit.update(1 / fps, player, true);
      }
    }
    expect(a.yaw).toBeCloseTo(b.yaw, 7);
    expect(a.camera.fov).toBeCloseTo(b.camera.fov, 7);
    expect(a.camera.fov).toBeGreaterThan(66.9);
    expect(a.camera.position.distanceTo(b.camera.position)).toBeLessThan(0.001);
    expect(cameraDamp(0, 1, 10, 0.1)).toBeCloseTo(
      cameraDamp(cameraDamp(0, 1, 10, 0.04), 1, 10, 0.06),
      12,
    );
  });

  it("zooms within bounds, switches shoulders, and snaps without residual input", () => {
    const physics = world(),
      orbit = camera(physics);
    const player = new THREE.Vector3(0, terrainHeight(0, 14), 14);
    for (let i = 0; i < 20; i++) orbit.readInput(1 / 60, input(0, 0, -10000));
    expect(orbit.desiredDistance).toBe(2.8);
    for (let i = 0; i < 20; i++) orbit.readInput(1 / 60, input(0, 0, 10000));
    expect(orbit.desiredDistance).toBe(10);
    orbit.readInput(1 / 60, input(90, 20, 0, ["KeyB"]));
    expect(orbit.shoulder).toBe(-1);
    orbit.yaw = 0.4;
    orbit.pitch = 0.3;
    orbit.snap(player);
    orbit.readInput(1 / 60, input());
    orbit.update(1 / 60, player);
    expect(orbit.yaw).toBe(0.4);
    expect(orbit.pitch).toBe(0.3);
    expect(orbit.motionStrength).toBe(0);
    expectClear(physics, orbit.camera.position);
  });

  it("keeps first-person aim on the interpolated player and disables impulses at effects zero", () => {
    const physics = world(),
      orbit = camera(physics);
    const player = new THREE.Vector3(0, terrainHeight(0, 14), 14);
    orbit.firstPerson = true;
    orbit.effectsIntensity = 0;
    orbit.snap(player);
    const resting = orbit.camera.position.clone();
    orbit.shake(50);
    orbit.update(1 / 60, player, true);
    expect(orbit.camera.position.distanceTo(resting)).toBe(0);
    expect(orbit.camera.position.y).toBeCloseTo(player.y + 1.65, 8);
    expect(orbit.motionStrength).toBe(0);
    expect(orbit.camera.fov).toBe(60);
    player.x += 0.25;
    orbit.update(1 / 60, player);
    expect(orbit.camera.position.x).toBe(player.x);
  });
});
