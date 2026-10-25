import RAPIER from "@dimforge/rapier3d-compat";
import type { WorldObstacle } from "./types";
import { terrainHeight } from "./WorldManager";

export interface ActorBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  halfHeight: number;
  grounded: boolean;
}
export class PhysicsWorld {
  world: RAPIER.World;
  constructor(obstacles: WorldObstacle[]) {
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    const vertices: number[] = [],
      indices: number[] = [];
    const nx = 81,
      nz = 91;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = -80 + i * 2,
          z = -100 + j * 2;
        vertices.push(x, terrainHeight(x, z), z);
      }
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        indices.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
      }
    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(
        new Float32Array(vertices),
        new Uint32Array(indices),
      ),
    );
    for (const o of obstacles) {
      const desc = RAPIER.ColliderDesc.cuboid(
        o.hx,
        o.height / 2,
        o.hz,
      ).setTranslation(o.x, terrainHeight(o.x, o.z) + o.height / 2, o.z);
      if (o.rotation)
        desc.setRotation({
          x: 0,
          y: Math.sin(o.rotation / 2),
          z: 0,
          w: Math.cos(o.rotation / 2),
        });
      this.world.createCollider(desc);
    }
    // Solid invisible perimeter at the edge of the explorable valley.
    for (const [x, z, hx, hz] of [
      [-66, -10, 1, 76],
      [66, -10, 1, 76],
      [0, -86, 66, 1],
      [0, 66, 66, 1],
    ]) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, 15, hz).setTranslation(x, 5, z),
      );
    }
    this.world.timestep = 1 / 60;
  }
  static async init() {
    await RAPIER.init();
  }
  createActor(
    x: number,
    z: number,
    radius = 0.35,
    halfHeight = 0.9,
  ): ActorBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        x,
        terrainHeight(x, z) + halfHeight + 0.04,
        z,
      ),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight - radius, radius),
      body,
    );
    const controller = this.world.createCharacterController(0.025);
    controller.enableAutostep(0.35, 0.2, false);
    controller.enableSnapToGround(0.3);
    controller.setMaxSlopeClimbAngle(Math.PI / 3);
    controller.setMinSlopeSlideAngle(Math.PI / 3);
    return { body, collider, controller, halfHeight, grounded: false };
  }
  move(actor: ActorBody, dx: number, dy: number, dz: number) {
    actor.controller.computeColliderMovement(actor.collider, {
      x: dx,
      y: dy,
      z: dz,
    });
    const m = actor.controller.computedMovement(),
      p = actor.body.translation();
    actor.body.setNextKinematicTranslation({
      x: p.x + m.x,
      y: p.y + m.y,
      z: p.z + m.z,
    });
    actor.grounded = actor.controller.computedGrounded();
  }
  step() {
    this.world.step();
  }
  teleport(actor: ActorBody, x: number, y: number, z: number) {
    actor.body.setTranslation({ x, y: y + actor.halfHeight + 0.04, z }, true);
    actor.body.setNextKinematicTranslation({
      x,
      y: y + actor.halfHeight + 0.04,
      z,
    });
  }
  remove(actor: ActorBody) {
    this.world.removeCharacterController(actor.controller);
    this.world.removeRigidBody(actor.body);
  }
  /** Sweeps the near-plane's enclosing sphere through static geometry. */
  cameraDistance(
    start: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    distance: number,
    radius = 0.28,
  ) {
    if (!Number.isFinite(distance) || distance <= 0) return 0;
    const magnitude = Math.hypot(dir.x, dir.y, dir.z);
    if (magnitude < 0.000001) return 0;
    const hit = this.world.castShape(
      start,
      { x: 0, y: 0, z: 0, w: 1 },
      { x: dir.x / magnitude, y: dir.y / magnitude, z: dir.z / magnitude },
      new RAPIER.Ball(Math.max(0.01, radius)),
      0.025,
      distance,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      this.staticCollisionFilter,
    );
    return hit ? Math.max(0, hit.time_of_impact - 0.02) : distance;
  }
  private readonly staticCollisionFilter = (collider: RAPIER.Collider) => {
    const body = collider.parent();
    return !collider.isSensor() && (!body || body.isFixed());
  };
  lineClear(
    start: { x: number; y: number; z: number },
    end: { x: number; y: number; z: number },
  ) {
    const dx = end.x - start.x,
      dy = end.y - start.y,
      dz = end.z - start.z,
      d = Math.hypot(dx, dy, dz);
    if (d < 0.001) return true;
    const hit = this.world.castRay(
      new RAPIER.Ray(start, { x: dx / d, y: dy / d, z: dz / d }),
      d,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => !c.parent(),
    );
    return !hit || hit.timeOfImpact >= d - 0.015;
  }
}
