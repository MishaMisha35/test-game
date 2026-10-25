import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { PlayerController } from "../src/game/PlayerController";
import type { PhysicsWorld, ActorBody } from "../src/game/PhysicsWorld";
import type { InputManager } from "../src/game/InputManager";

function fixture() {
  const pos = { x: 0, y: 0.9, z: 17 };
  const actor = {
    body: { translation: () => pos },
    halfHeight: 0.9,
    grounded: true,
  } as ActorBody;
  const physics = {
    createActor: () => actor,
    move: (_actor: ActorBody, x: number, _y: number, z: number) => {
      pos.x += x;
      pos.z += z;
    },
    teleport: (_actor: ActorBody, x: number, y: number, z: number) => {
      pos.x = x;
      pos.y = y + 0.9;
      pos.z = z;
    },
  } as unknown as PhysicsWorld;
  const keys = new Set<string>(),
    pressed = new Set<string>();
  const input = {
    keys,
    pressed,
    secondary: false,
    down(...codes: string[]) {
      return codes.some((key) => keys.has(key));
    },
    take(key: string) {
      return pressed.delete(key);
    },
  } as unknown as InputManager;
  const player = new PlayerController(physics, new THREE.Scene());
  const sound = vi.fn();
  const tick = (dt = 1 / 60) => {
    player.beginStep();
    player.update(dt, input, 0, 0, sound);
    player.sync();
  };
  return { player, input, tick, pos, sound };
}

describe("player fixed-step state", () => {
  it("buffers a late light combo, charges it once and announces each start once", () => {
    const { player, tick } = fixture();
    expect(player.attack(false)).toBe(true);
    expect(player.stamina).toBe(86);
    expect(player.consumeAttackStarted()).toBe(true);
    expect(player.consumeAttackStarted()).toBe(false);
    for (let i = 0; i < 19; i++) tick();
    expect(player.attack(false)).toBe(false);
    for (let i = 0; i < 12; i++) tick();
    expect(player.comboIndex).toBe(1);
    expect(player.stamina).toBeLessThan(74);
    expect(player.consumeAttackStarted()).toBe(true);
    expect(player.consumeAttackStarted()).toBe(false);
  });
  it("clears queued attacks on reset, without replaying old input", () => {
    const { player, tick } = fixture();
    player.attack(false);
    for (let i = 0; i < 19; i++) tick();
    player.attack(false);
    player.resetActions();
    for (let i = 0; i < 30; i++) tick();
    expect(player.attacking).toBe(false);
    expect(player.comboIndex).toBe(0);
    expect(player.consumeAttackStarted()).toBe(false);
  });
  it("opens parry only on a new guard press and closes it while holding the shield", () => {
    const { player, input, tick } = fixture();
    input.secondary = true;
    input.pressed.add("Block");
    tick();
    expect(player.parryTime).toBeCloseTo(0.16);
    for (let i = 0; i < 15; i++) tick();
    expect(player.blocking).toBe(true);
    expect(player.parryTime).toBe(0);
  });
  it("keeps invulnerability from a hit independent of the dodge window", () => {
    const { player, input, tick, pos } = fixture();
    player.invulnerable = 1;
    input.pressed.add("KeyQ");
    for (let i = 0; i < 24; i++) tick();
    expect(17 - pos.z).toBeCloseTo(4.2, 6);
    expect(player.invulnerable).toBeGreaterThan(0.5);
    expect(player.dodgeTime).toBe(0);
    expect(player.dodgeInvulnerable).toBe(false);
  });
  it("interpolates rendering without moving the physical actor or animating in fixed updates", () => {
    const { player, input, tick } = fixture();
    const animate = vi.spyOn(player.model, "update");
    input.keys.add("KeyW");
    tick();
    const physicalZ = player.position.z;
    expect(animate).not.toHaveBeenCalled();
    player.render(0.5, 1 / 144, 1);
    expect(player.renderPosition.z).toBeCloseTo((17 + physicalZ) / 2);
    expect(player.position.z).toBe(physicalZ);
    expect(animate).toHaveBeenCalledOnce();
    player.resetInterpolation();
    player.render(0, 1 / 144, 1);
    expect(player.renderPosition.z).toBe(physicalZ);
  });
  it("holds the impact pose at alpha zero during hitstop without resetting measured speed", () => {
    const { player, input, tick } = fixture();
    input.keys.add("KeyW");
    for (let i = 0; i < 12; i++) tick();
    const speed = player.actualSpeed,
      atContact = player.position.clone();
    expect(player.previousPosition.z).toBeGreaterThan(atContact.z);
    player.freezeInterpolation();
    player.render(0, 0, 0);
    expect(player.model.group.position.distanceTo(atContact)).toBeLessThan(
      1e-8,
    );
    expect(player.actualSpeed).toBe(speed);
  });
});
