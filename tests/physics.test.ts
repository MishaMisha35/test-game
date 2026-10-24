import { beforeAll, describe, expect, it } from "vitest";
import { PhysicsWorld } from "../src/game/PhysicsWorld";
import { terrainHeight } from "../src/game/WorldManager";

beforeAll(async () => {
  await PhysicsWorld.init();
});
describe("Rapier world", () => {
  it("grounds a capsule on the visible terrain and blocks it at a solid wall", () => {
    const physics = new PhysicsWorld([
      { x: 0, z: 10, hx: 4, hz: 1, height: 4 },
    ]);
    const actor = physics.createActor(0, 17);
    for (let i = 0; i < 90; i++) {
      physics.move(actor, 0, -0.08, 0);
      physics.step();
    }
    expect(actor.grounded).toBe(true);
    const feet = actor.body.translation().y - actor.halfHeight;
    expect(Math.abs(feet - terrainHeight(0, 17))).toBeLessThan(0.08);
    for (let i = 0; i < 150; i++) {
      physics.move(actor, 0, -0.08, -0.1);
      physics.step();
    }
    expect(actor.body.translation().z).toBeGreaterThan(11.3);
    expect(actor.body.translation().z).toBeLessThan(11.5);
    physics.world.free();
  });
  it("allows ascending jumps then lands and clips camera rays at solid geometry", () => {
    const physics = new PhysicsWorld([
      { x: 0, z: 10, hx: 4, hz: 1, height: 4 },
    ]);
    const actor = physics.createActor(0, 17);
    for (let i = 0; i < 30; i++) {
      physics.move(actor, 0, -0.08, 0);
      physics.step();
    }
    const ground = actor.body.translation().y;
    let vy = 8,
      highest = ground;
    for (let i = 0; i < 100; i++) {
      vy -= 20 / 60;
      physics.move(actor, 0, vy / 60, 0);
      physics.step();
      if (actor.grounded && vy < 0) vy = -2;
      highest = Math.max(highest, actor.body.translation().y);
    }
    expect(highest - ground).toBeGreaterThan(1.3);
    expect(actor.grounded).toBe(true);
    // The controller skin and snap-to-ground margin may settle within 10 cm.
    expect(Math.abs(actor.body.translation().y - ground)).toBeLessThan(0.1);
    expect(
      physics.cameraDistance({ x: 0, y: 2, z: 14 }, { x: 0, y: 0, z: -1 }, 8),
    ).toBeLessThan(3);
    expect(physics.lineClear({ x: 0, y: 2, z: 14 }, { x: 0, y: 2, z: 8 })).toBe(
      false,
    );
    expect(physics.lineClear({ x: 8, y: 2, z: 14 }, { x: 8, y: 2, z: 8 })).toBe(
      true,
    );
    physics.world.free();
  });
});
