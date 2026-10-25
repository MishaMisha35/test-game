import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PlayerController } from '../src/game/PlayerController';
import { resolveMeleeStrike } from '../src/game/CombatSystem';
import type { PhysicsWorld, ActorBody } from '../src/game/PhysicsWorld';
import type { InputManager } from '../src/game/InputManager';

function fixture() {
  const position = { x: 0, y: .9, z: 17 };
  const actor = { body: { translation: () => position }, halfHeight: .9, grounded: true } as ActorBody;
  const physics = {
    createActor: () => actor,
    move: (_: ActorBody, x: number, _y: number, z: number) => { position.x += x; position.z += z; },
    teleport: (_: ActorBody, x: number, y: number, z: number) => { Object.assign(position, { x, y: y + .9, z }); },
  } as unknown as PhysicsWorld;
  const keys = new Set<string>(), pressed = new Set<string>();
  const input = { keys, pressed, secondary: false, down: (...codes: string[]) => codes.some(code => keys.has(code)), take: (code: string) => pressed.delete(code) } as unknown as InputManager;
  const p = new PlayerController(physics, new THREE.Scene());
  function tick(count = 1, dt = 1 / 60) { for (let i = 0; i < count; i++) { p.beginStep(); p.update(dt, input, 0, 0, () => {}); p.sync(); } }
  function charge() { keys.add('KeyT'); pressed.add('KeyT'); }
  function release() { keys.delete('KeyT'); pressed.add('ChargeRelease'); tick(); }
  return { p, input, keys, pressed, tick, charge, release };
}

describe('explicit attack lifecycle', () => {
  it('only permits hits during the active interval and never again after impact/recovery', () => {
    const { p, tick } = fixture();
    expect(p.attack(false)).toBe(true); const id = p.swingId;
    expect(p.attackPhase).toBe('windup'); expect(p.canHit).toBe(false);
    tick(10); expect(p.attackPhase).toBe('active'); expect(p.canHit).toBe(true);
    p.hitApplied = true; expect(p.canHit).toBe(false);
    tick(8); expect(p.attackPhase).toBe('recovery'); expect(p.canHit).toBe(false);
    tick(20); expect(p.attackPhase).toBe('idle'); expect(p.canHit).toBe(false);
    p.attack(false); expect(p.swingId).toBe(id + 1);
  });
  it('honors a queued input whose deadline exactly matches the end of recovery', () => {
    const { p, tick } = fixture(); p.attack(false);
    p.attackTime = .23; p.attackCooldown = .25;
    p.attack(false); tick(15);
    expect(p.swingId).toBe(2); expect(p.comboIndex).toBe(1);
  });
  it('a queued combo pays once and cannot replay after recovery/reset', () => {
    const { p, tick } = fixture(); p.attack(false); tick(19);
    const stamina = p.stamina; p.attack(false); p.attack(false);
    expect(p.stamina).toBe(stamina); tick(12);
    expect(p.comboIndex).toBe(1); expect(p.swingId).toBe(2);
    expect(p.stamina).toBeGreaterThan(71); expect(p.stamina).toBeLessThan(74);
    p.clearActions(); tick(30); expect(p.swingId).toBe(2); expect(p.attacking).toBe(false);
  });
});

describe('charged heavy attacks', () => {
  it('releases one attack for one final stamina cost and keeps charge through active contact', () => {
    const { p, tick, charge, release } = fixture(); charge(); tick(30);
    expect(p.attackPhase).toBe('charging'); expect(p.stamina).toBeCloseTo(98);
    const power = p.chargeRatio; release();
    expect(p.charging).toBe(false); expect(p.heavy).toBe(true); expect(p.swingId).toBe(1);
    expect(p.stamina).toBeCloseTo(66); expect(p.chargePower).toBeCloseTo(power);
    tick(16); expect(p.canHit).toBe(true); expect(p.chargePower).toBeCloseTo(power);
    tick(50); expect(p.swingId).toBe(1); expect(p.chargePower).toBe(0);
  });
  it('short taps cancel without a final charge cost or normal attack delay', () => {
    const { p, tick, charge, release } = fixture(); charge(); tick(5); release();
    expect(p.attacking).toBe(false); expect(p.charging).toBe(false); expect(p.stamina).toBeGreaterThan(99);
    expect(p.attack(false)).toBe(true); expect(p.attackPhase).toBe('windup');
  });
  it.each([30, 60, 120])('auto-releases once at the same strength/cost with %i simulation steps/sec', fps => {
    const { p, tick, charge } = fixture(); charge(); tick(Math.round(fps * .9), 1 / fps);
    expect(p.swingId).toBe(1); expect(p.charging).toBe(false); expect(p.chargePower).toBeCloseTo(1);
    expect(p.stamina).toBeCloseTo(64.4); tick(20, 1 / fps); expect(p.swingId).toBe(1);
  });
  it('dodge, reset, lost hold and low stamina cancel without leaking a later release', () => {
    const { p, input, keys, pressed, tick, charge, release } = fixture();
    charge(); tick(20); pressed.add('KeyQ'); tick();
    expect(p.charging).toBe(false); expect(p.dodgeTime).toBeGreaterThan(0); release(); expect(p.swingId).toBe(0);
    p.clearActions(); charge(); tick(20); p.clearActions(); release(); expect(p.swingId).toBe(0);
    charge(); tick(20); keys.delete('KeyT'); tick(); expect(p.charging).toBe(false); expect(p.attacking).toBe(false);
    p.stamina = 32.01; charge(); tick(); expect(p.charging).toBe(false); expect(p.swingId).toBe(0);
    input.secondary = false;
  });
});

describe('guard breaks and precision counters', () => {
  it('guard break cancels all actions and prevents an immediate held-guard or attack restart', () => {
    const { p, input, tick, charge } = fixture(); charge(); tick(20); p.openCounterWindow();
    p.breakGuard(); input.secondary = true; input.pressed.add('Block'); tick(15);
    expect(p.charging).toBe(false); expect(p.blocking).toBe(false); expect(p.parryTime).toBe(0);
    expect(p.attack(false)).toBe(false); expect(p.counterWindow).toBe(0);
    p.breakGuard(.1); expect(p.guardBrokenTime).toBeGreaterThan(.4);
    tick(30); expect(p.guardBrokenTime).toBe(0); expect(p.blocking).toBe(true);
  });
  it('a successful parry counter expires or applies to exactly one swing', () => {
    const { p, tick } = fixture(); p.openCounterWindow(); tick(52); p.attack(false);
    expect(p.counterAttack).toBe(false); p.clearActions();
    p.openCounterWindow(); p.attack(false); expect(p.counterAttack).toBe(true); expect(p.counterWindow).toBe(0);
    tick(19); p.attack(false); tick(12); expect(p.comboIndex).toBe(1); expect(p.counterAttack).toBe(false);
  });
  it('uses bounded, deterministic damage and reaction values with no random critical rolls', () => {
    expect(resolveMeleeStrike(30, 0, false, 0, false)).toEqual({ damage: 30, critical: false, poise: 16, knockback: .25 });
    const finisher = resolveMeleeStrike(30, 2, false, 0, false);
    expect(finisher.damage).toBe(35); expect(finisher.critical).toBe(true);
    const counter = resolveMeleeStrike(48, 0, true, 1, true);
    expect(counter.damage).toBe(137); expect(counter.critical).toBe(true); expect(counter.poise).toBe(135);
    expect(resolveMeleeStrike(48, 999, true, 999, true)).toEqual(counter);
    expect(resolveMeleeStrike(NaN, 0, true, 1, true).damage).toBe(0);
  });
});
