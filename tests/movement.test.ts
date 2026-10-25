import { describe, expect, it } from "vitest";
import {
  angleDelta,
  cameraRelativeInput,
  dodgeDistanceAt,
  JumpWindow,
  moveToward,
} from "../src/game/MovementMath";

describe("camera-relative movement", () => {
  it("normalizes diagonals and rotates forward with the camera", () => {
    const direction = { x: 0, z: 0 };
    cameraRelativeInput(1, -1, 0, direction);
    expect(Math.hypot(direction.x, direction.z)).toBeCloseTo(1);
    cameraRelativeInput(0, -1, Math.PI / 2, direction);
    expect(direction.x).toBeCloseTo(-1);
    expect(direction.z).toBeCloseTo(0);
    cameraRelativeInput(0, 0, 2, direction);
    expect(Math.hypot(direction.x, direction.z)).toBe(0);
  });
  it("turns through the short arc across the angle boundary", () => {
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(moveToward(4, 0, 8)).toBe(0);
    expect(moveToward(0, 4, 0.5)).toBe(0.5);
  });
});

describe("analytical dodge", () => {
  it.each([30, 60, 144])(
    "travels exactly 4.2m at %i fixed subdivisions/sec",
    (fps) => {
      let distance = 0,
        age = 0;
      while (age < 0.38) {
        const end = Math.min(0.38, age + 1 / fps);
        distance += dodgeDistanceAt(end) - dodgeDistanceAt(age);
        age = end;
      }
      expect(distance).toBeCloseTo(4.2, 12);
    },
  );
  it("decelerates and clamps both endpoints", () => {
    expect(dodgeDistanceAt(-1)).toBe(0);
    expect(dodgeDistanceAt(2)).toBe(4.2);
    expect(dodgeDistanceAt(0.1) - dodgeDistanceAt(0)).toBeGreaterThan(
      dodgeDistanceAt(0.3) - dodgeDistanceAt(0.2),
    );
  });
});

describe("jump grace windows", () => {
  it("permits one jump within 100ms after leaving the ground", () => {
    const jump = new JumpWindow();
    jump.update(0.016, true, false);
    jump.update(0.08, false, true);
    expect(jump.consume()).toBe(true);
    expect(jump.consume()).toBe(false);
    jump.update(0.12, false, true);
    expect(jump.consume()).toBe(false);
  });
  it("buffers a jump pressed just before landing and expires stale input", () => {
    const jump = new JumpWindow();
    jump.update(0.016, false, true);
    jump.update(0.08, true, false);
    expect(jump.consume()).toBe(true);
    jump.update(0.016, false, true);
    jump.update(0.13, true, false);
    expect(jump.consume()).toBe(false);
  });
  it("does not consume a buffered jump without the required resources", () => {
    const jump = new JumpWindow();
    jump.update(0.016, true, true);
    expect(jump.consume(false)).toBe(false);
    expect(jump.consume(true)).toBe(true);
    jump.update(0.016, true, true);
    jump.reset();
    expect(jump.consume()).toBe(false);
  });
});
