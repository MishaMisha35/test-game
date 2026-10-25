import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { EnemyAI } from "../src/game/EnemyAI";
import {
  attackProfile,
  chooseAttackers,
  dampKnockback,
  resolveStrike,
  targetInFront,
} from "../src/game/EnemyTactics";
import type { ActorBody, PhysicsWorld } from "../src/game/PhysicsWorld";
import type { PlayerController } from "../src/game/PlayerController";
import { MINI_BOSS_SPAWN } from "../src/game/types";

const strike = { poise: 20, knockback: 1, origin: { x: 0, z: -1 } };
const guarded = {
  health: 100,
  guard: 36,
  poise: 30,
  maxPoise: 30,
  blocking: true,
  facingAttacker: true,
};

describe("finite guards and poise", () => {
  it("front guards mitigate damage while spending a real finite guard resource", () => {
    const first = resolveStrike(guarded, 30, strike);
    expect(first.blocked).toBe(true);
    expect(first.damage).toBe(4);
    expect(first.guard).toBeCloseTo(4.6);
    expect(first.poise).toBeCloseTo(27.6);
    const second = resolveStrike({ ...guarded, ...first }, 30, strike);
    expect(second.blocked).toBe(false);
    expect(second.guardBroken).toBe(true);
    expect(second.damage).toBe(30);
    expect(second.guard).toBe(0);
    expect(second.staggered).toBe(true);
  });
  it("rear attacks and magic bypass facing guards, while charged breaks stagger", () => {
    expect(
      resolveStrike({ ...guarded, facingAttacker: false }, 30, strike).damage,
    ).toBe(30);
    expect(
      resolveStrike(guarded, 30, { ...strike, unblockable: true }).damage,
    ).toBe(30);
    const broken = resolveStrike(guarded, 30, { ...strike, guardBreak: true });
    expect(broken.guardBroken).toBe(true);
    expect(broken.staggered).toBe(true);
    expect(broken.poise).toBe(30);
  });
  it("accumulates poise damage into one stagger, resets the meter, and caps overkill labels", () => {
    const first = resolveStrike({ ...guarded, blocking: false }, 10, strike);
    expect(first.staggered).toBe(false);
    expect(first.poise).toBe(10);
    const second = resolveStrike(
      { ...guarded, ...first, blocking: false },
      10,
      strike,
    );
    expect(second.staggered).toBe(true);
    expect(second.poise).toBe(30);
    const dead = resolveStrike(
      { ...guarded, health: 7, blocking: false },
      1000,
      strike,
    );
    expect(dead.health).toBe(0);
    expect(dead.damage).toBe(7);
    expect(dead.killed).toBe(true);
    expect(resolveStrike({ ...guarded, health: 0 }, 20, strike).damage).toBe(0);
    expect(resolveStrike(guarded, NaN, strike).damage).toBe(0);
  });
  it("uses the same -Z facing convention as melee arcs", () => {
    expect(targetInFront(0, { x: 0, z: 0 }, { x: 0, z: -2 })).toBe(true);
    expect(targetInFront(0, { x: 0, z: 0 }, { x: 0, z: 2 })).toBe(false);
    expect(targetInFront(Math.PI / 2, { x: 0, z: 0 }, { x: -2, z: 0 })).toBe(
      true,
    );
  });
});

describe("attack scheduling and readable boss attacks", () => {
  it("retains occupied attack slots and rotates ready opponents by their last attack", () => {
    const candidates = [
      { id: 0, active: true, ready: false, lastAttack: 8 },
      { id: 1, active: false, ready: true, lastAttack: 4 },
      { id: 2, active: false, ready: true, lastAttack: 1 },
      { id: 3, active: false, ready: true, lastAttack: 3 },
    ];
    expect([...chooseAttackers(candidates, 2)]).toEqual([0, 2]);
    candidates[2].active = true;
    candidates[2].ready = false;
    expect([...chooseAttackers(candidates, 2)]).toEqual([0, 2]);
  });
  it("gives the Warden three distinct attacks, telegraphed followups, and a faster second phase", () => {
    expect([0, 1, 2].map((i) => attackProfile(true, true, 1, i).type)).toEqual([
      "slash",
      "cleave",
      "slam",
    ]);
    expect(attackProfile(true, true, 2, 0).type).toBe("cleave");
    const cleave = attackProfile(true, true, 1, 1),
      follow = attackProfile(true, true, 1, 1, true);
    expect(cleave.combo).toBe(2);
    expect(follow.windup).toBeGreaterThanOrEqual(0.3);
    expect(follow.windup).toBeLessThan(cleave.windup);
    expect(attackProfile(true, true, 2, 2).windup).toBeLessThan(
      attackProfile(true, true, 1, 0).windup,
    );
    expect(attackProfile(true, false, 1, 0).damage).toBe(22);
    expect(attackProfile(true, false, 2, 0).type).toBe("slam");
  });
  it("damps knockback at the same rate across simulation subdivisions", () => {
    const decay = (steps: number) => {
      let speed = 8;
      for (let i = 0; i < steps; i++) speed = dampKnockback(speed, 0.3 / steps);
      return speed;
    };
    expect(decay(9)).toBeCloseTo(decay(36), 10);
    expect(dampKnockback(0.001, 1 / 60)).toBe(0);
  });
});

function fixture() {
  let visible = true;
  const removed = vi.fn();
  const moved = vi.fn(
    (_actor: ActorBody, _x: number, _y: number, _z: number) => {},
  );
  const createActor = (
    x: number,
    z: number,
    _radius: number,
    halfHeight: number,
  ) => {
    const position = { x, y: halfHeight, z };
    return {
      body: { translation: () => position },
      halfHeight,
      grounded: true,
      position,
    } as unknown as ActorBody & {
      position: { x: number; y: number; z: number };
    };
  };
  const physics = {
    createActor,
    lineClear: () => visible,
    remove: removed,
    move: moved,
    teleport: (
      actor: ActorBody & { position: { x: number; y: number; z: number } },
      x: number,
      y: number,
      z: number,
    ) => Object.assign(actor.position, { x, y: y + actor.halfHeight, z }),
  } as unknown as PhysicsWorld;
  const ai = new EnemyAI(physics, new THREE.Scene(), []);
  const player = {
    alive: true,
    attacking: false,
    position: new THREE.Vector3(),
    hitbox: { x: 0, y: 1, z: 0, radius: 0.35 },
  } as unknown as PlayerController;
  function near(id: number, distance = 1) {
    const e = ai.enemies[id];
    player.position.copy(e.position);
    player.position.z -= distance;
    Object.assign(player.hitbox, {
      x: player.position.x,
      y: player.position.y + 1,
      z: player.position.z,
    });
  }
  return {
    ai,
    player,
    near,
    removed,
    moved,
    visibility: (v: boolean) => {
      visible = v;
    },
  };
}

describe("integrated enemy state machine", () => {
  it("keeps the original Guardian and kill gate independent of the optional Warden", () => {
    const { ai, player, near } = fixture();
    expect(ai.enemies).toHaveLength(6);
    expect(ai.boss.id).toBe(4);
    expect(ai.boss.state).toBe("dormant");
    expect(ai.miniBoss.home.x).toBe(MINI_BOSS_SPAWN.x);
    expect(ai.miniBoss.home.z).toBe(MINI_BOSS_SPAWN.z);
    ai.kill(ai.miniBoss);
    expect(ai.kills).toBe(0);
    for (let i = 0; i < 4; i++) ai.kill(ai.enemies[i]);
    expect(ai.kills).toBe(4);
    near(4, 5);
    ai.update(1 / 60, 0, player, () => {});
    expect(ai.boss.state).not.toBe("dormant");
    expect(ai.boss.health).toBe(300);
  });
  it("requires line of sight and a short notice period before chasing", () => {
    const { ai, player, near, visibility } = fixture();
    near(5, 6);
    visibility(false);
    ai.update(0.1, 0, player, () => {});
    expect(ai.miniBoss.state).toBe("patrol");
    visibility(true);
    ai.update(0.05, 0.1, player, () => {});
    expect(ai.miniBoss.state).toBe("notice");
    ai.update(0.05, 0.15, player, () => {});
    expect(ai.miniBoss.state).toBe("notice");
    ai.update(0.1, 0.25, player, () => {});
    expect(ai.miniBoss.state).toBe("chase");
    expect(ai.activeBoss(player.position)).toBe(ai.miniBoss);
  });
  it.each([
    [5, 4],
    [0, 3],
  ])(
    "lets solo enemy %i close from %im instead of orbiting outside weapon reach",
    (id, distance) => {
      const { ai, player, near, moved } = fixture();
      near(id, distance);
      const enemy = ai.enemies[id];
      enemy.state = "chase";
      ai.update(1 / 60, 0, player, () => {});
      expect(enemy.state).toBe("chase");
      expect(enemy.motion).toBeGreaterThan(0);
      const movement = moved.mock.calls.find(
        ([actor]) => actor === enemy.actor,
      );
      expect(movement).toBeDefined();
      const [, dx, , dz] = movement!;
      const towardPlayer =
        dx * (player.position.x - enemy.position.x) +
        dz * (player.position.z - enemy.position.z);
      expect(towardPlayer).toBeGreaterThan(0);
    },
  );
  it("does not let a hidden opponent reserve the only free approach slot", () => {
    const { ai, player, near } = fixture();
    near(0, 3);
    const hidden = ai.enemies[0],
      visible = ai.enemies[1],
      occupied = ai.enemies[2];
    hidden.state = "chase";
    hidden.lastAttack = -100;
    visible.position.copy(hidden.position);
    visible.position.x += 0.1;
    visible.home.copy(visible.position);
    visible.state = "chase";
    occupied.state = "windup";
    occupied.timer = 1;
    const physics = (
      ai as unknown as {
        physics: { lineClear: (start: { x: number }) => boolean };
      }
    ).physics;
    physics.lineClear = (start) => start.x !== hidden.position.x;
    ai.update(1 / 60, 0, player, () => {});
    expect(hidden.state).toBe("orbit");
    expect(visible.state).toBe("chase");
  });
  it("never starts more than two simultaneous enemy windups", () => {
    const { ai, player } = fixture();
    player.position.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const e = ai.enemies[i];
      e.position.set(i % 2 ? 1 : -1, 0, i < 2 ? 1 : -1);
      e.home.copy(e.position);
      e.state = "chase";
      e.timer = 0;
    }
    ai.update(1 / 60, 0, player, () => {});
    expect(ai.enemies.filter((e) => e.state === "windup")).toHaveLength(2);
    ai.update(1 / 60, 0.017, player, () => {});
    expect(ai.enemies.filter((e) => e.state === "windup")).toHaveLength(2);
    expect(ai.enemies.filter((e) => e.state === "orbit")).toHaveLength(2);
  });
  it("latches an attack across the 50% phase transition instead of changing its telegraph damage", () => {
    const { ai, player, near } = fixture();
    near(5);
    const e = ai.miniBoss;
    e.state = "chase";
    ai.update(1 / 60, 0, player, () => {});
    expect(e.attackType).toBe("slash");
    expect(e.attackPhase).toBe(1);
    e.health = 110;
    const onHit = vi.fn();
    ai.update(0.81, 1, player, onHit);
    expect(e.phase).toBe(2);
    expect(e.attackPhase).toBe(1);
    expect(onHit).toHaveBeenCalledOnce();
    expect(onHit.mock.calls[0][0]).toBe(21);
    expect(e.state).toBe("recover");
  });
  it("preserves a parry callback stun instead of replacing it with recovery or a cleave followup", () => {
    const { ai, player, near } = fixture();
    near(5);
    const e = ai.miniBoss;
    e.state = "windup";
    e.attackSequence = 1;
    e.attackPhase = 1;
    e.attackType = "cleave";
    e.timer = 0.01;
    e.windupDuration = 0.95;
    ai.update(0.02, 0, player, (_damage, enemy) => {
      enemy.state = "stunned";
      enemy.timer = 0.7;
    });
    expect(e.state).toBe("stunned");
    expect(e.timer).toBe(0.7);
    expect(e.comboStep).toBe(0);
    expect(e.ring.visible).toBe(false);
  });
  it("applies guard breaks and knockback to real enemies, and removes defeated colliders once", () => {
    const { ai, removed } = fixture();
    const e = ai.enemies[0];
    e.state = "guard";
    e.blocking = true;
    e.yaw = 0;
    const result = ai.receiveStrike(e, 30, {
      ...strike,
      origin: { x: e.position.x, z: e.position.z - 1 },
      guardBreak: true,
    });
    expect(result.guardBroken).toBe(true);
    expect(e.state).toBe("stunned");
    expect(e.blocking).toBe(false);
    expect(e.knockback.z).toBeGreaterThan(0);
    expect(ai.damage(e, 1000)).toBe(true);
    expect(e.actor).toBeNull();
    expect(e.health).toBe(0);
    expect(ai.damage(e, 1000)).toBe(false);
    expect(removed).toHaveBeenCalledTimes(1);
  });
  it("resets surviving enemies on respawn while preserving defeated enemies and kill progress", () => {
    const { ai } = fixture();
    ai.kill(ai.enemies[0]);
    const e = ai.miniBoss;
    e.health = 50;
    e.guard = 0;
    e.poise = 1;
    e.state = "windup";
    e.phase = 2;
    e.timer = 3;
    e.attackPhase = 2;
    e.comboStep = 1;
    e.knockback.set(3, 0, 4);
    e.position.x += 6;
    e.ring.visible = true;
    ai.resetSurvivors();
    expect(ai.kills).toBe(1);
    expect(ai.enemies[0].actor).toBeNull();
    expect(ai.enemies[0].state).toBe("dead");
    expect(e.health).toBe(e.maxHealth);
    expect(e.guard).toBe(e.maxGuard);
    expect(e.poise).toBe(e.maxPoise);
    expect(e.phase).toBe(1);
    expect(e.state).toBe("patrol");
    expect(e.timer).toBe(0);
    expect(e.comboStep).toBe(0);
    expect(e.attackPhase).toBe(1);
    expect(e.position.equals(e.home)).toBe(true);
    expect(e.previousPosition.equals(e.home)).toBe(true);
    expect(e.knockback.length()).toBe(0);
    expect(e.ring.visible).toBe(false);
    ai.reset();
    expect(ai.kills).toBe(0);
    expect(ai.enemies[0].actor).not.toBeNull();
    expect(ai.boss.state).toBe("dormant");
  });
});
