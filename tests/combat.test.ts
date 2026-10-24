import { describe, expect, it } from "vitest";
import {
  damageAfterBlock,
  meleeHits,
  segmentHitsSphere,
  type Hitbox,
} from "../src/game/CombatSystem";

const origin: Hitbox = { x: 0, y: 1, z: 0, radius: 0.5 };
describe("melee hitboxes", () => {
  it("hits a target in the blade arc and rejects targets behind, distant or above it", () => {
    expect(meleeHits(origin, 0, { x: 0, y: 1, z: -2, radius: 0.4 }, 2)).toBe(
      true,
    );
    expect(meleeHits(origin, 0, { x: 0, y: 1, z: 2, radius: 0.4 }, 2)).toBe(
      false,
    );
    expect(meleeHits(origin, 0, { x: 0, y: 1, z: -3, radius: 0.4 }, 2)).toBe(
      false,
    );
    expect(meleeHits(origin, 0, { x: 0, y: 3, z: -1, radius: 0.4 }, 2)).toBe(
      false,
    );
  });
  it("rotates with the attacker and includes hurtbox edges rather than center only", () => {
    expect(
      meleeHits(origin, Math.PI / 2, { x: -2, y: 1, z: 0, radius: 0.4 }, 2),
    ).toBe(true);
    expect(
      meleeHits(origin, Math.PI / 2, { x: 2, y: 1, z: 0, radius: 0.4 }, 2),
    ).toBe(false);
    expect(meleeHits(origin, 0, { x: 0, y: 1, z: -2.35, radius: 0.4 }, 2)).toBe(
      true,
    );
  });
  it("rejects a target just outside the arc unless its hurtbox overlaps", () => {
    const angle = Math.PI / 3 + 0.12;
    const target = {
      x: Math.sin(angle) * 2,
      y: 1,
      z: -Math.cos(angle) * 2,
      radius: 0.1,
    };
    expect(meleeHits(origin, 0, target, 2)).toBe(false);
    expect(meleeHits(origin, 0, { ...target, radius: 0.4 }, 2)).toBe(true);
  });
  it("does not award a phantom hit beyond the corner of the attack sector", () => {
    const angle = Math.PI / 3 + 0.15;
    expect(
      meleeHits(
        origin,
        0,
        {
          x: Math.sin(angle) * 2.38,
          y: 1,
          z: -Math.cos(angle) * 2.38,
          radius: 0.4,
        },
        2,
      ),
    ).toBe(false);
  });
});

describe("swept magic projectile", () => {
  const target = { x: 0, y: 1, z: -5, radius: 0.5 };
  it("detects hits between frames rather than only at endpoints", () => {
    expect(
      segmentHitsSphere({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -10 }, target),
    ).toBe(true);
    expect(
      segmentHitsSphere({ x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: -10 }, target),
    ).toBe(false);
  });
  it("does not extend rays beyond the actual projectile segment", () => {
    expect(
      segmentHitsSphere({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -3 }, target),
    ).toBe(false);
  });
  it("supports stationary projectiles and tangent contact", () => {
    expect(segmentHitsSphere(target, target, target)).toBe(true);
    expect(
      segmentHitsSphere(
        { x: 0.5, y: 1, z: 0 },
        { x: 0.5, y: 1, z: -10 },
        target,
      ),
    ).toBe(true);
    expect(
      segmentHitsSphere({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, target),
    ).toBe(false);
  });
});

describe("guard stamina", () => {
  it("mitigates damage only when the guard can pay its stamina cost", () => {
    expect(damageAfterBlock(20, true, 30)).toEqual({
      damage: 4,
      staminaCost: 14,
      broken: false,
    });
    expect(damageAfterBlock(20, true, 14)).toEqual({
      damage: 4,
      staminaCost: 14,
      broken: false,
    });
    expect(damageAfterBlock(20, true, 5)).toEqual({
      damage: 20,
      staminaCost: 5,
      broken: true,
    });
    expect(damageAfterBlock(20, false, 5)).toEqual({
      damage: 20,
      staminaCost: 0,
      broken: false,
    });
  });
});
