/** A world-space spherical hurtbox. Attack origins use radius as vertical reach. */
export interface Hitbox {
  x: number;
  y: number;
  z: number;
  radius: number;
}
type Point3 = { x: number; y: number; z: number };

/** Tests a swept horizontal melee arc against a real hurtbox, facing -Z at yaw 0. */
export function meleeHits(
  origin: Hitbox,
  yaw: number,
  target: Hitbox,
  reach: number,
  halfAngle = Math.PI / 3,
): boolean {
  if (reach < 0 || target.radius < 0 || origin.radius < 0) return false;
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const distance = Math.hypot(dx, dz);
  const verticalGap = Math.max(
    0,
    Math.abs(target.y - origin.y) - origin.radius,
  );
  if (verticalGap > target.radius || distance > reach + target.radius)
    return false;
  const projectedRadiusSquared = target.radius ** 2 - verticalGap ** 2;
  if (distance === 0) return true;
  const dot = (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / distance;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const outsideAngle = Math.max(
    0,
    angle - Math.max(0, Math.min(Math.PI, halfAngle)),
  );
  // Exact distance to the sector: outside its angle, project onto its radial edge.
  // This avoids phantom hits at the corner where angular and range limits meet.
  const projection = Math.max(
    0,
    Math.min(reach, distance * Math.cos(outsideAngle)),
  );
  const separationSquared =
    distance ** 2 +
    projection ** 2 -
    2 * distance * projection * Math.cos(outsideAngle);
  return separationSquared <= projectedRadiusSquared + Number.EPSILON * 16;
}

/** Swept projectile check: fast projectiles cannot tunnel through a target. */
export function segmentHitsSphere(
  start: Point3,
  end: Point3,
  target: Hitbox,
): boolean {
  if (target.radius < 0) return false;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((target.x - start.x) * dx +
              (target.y - start.y) * dy +
              (target.z - start.z) * dz) /
              lengthSquared,
          ),
        );
  return (
    (start.x + dx * t - target.x) ** 2 +
      (start.y + dy * t - target.y) ** 2 +
      (start.z + dz * t - target.z) ** 2 <=
    target.radius ** 2
  );
}

/** Blocking spends stamina before mitigation; a broken guard takes the full hit. */
export function damageAfterBlock(
  damage: number,
  blocking: boolean,
  stamina: number,
): { damage: number; staminaCost: number; broken: boolean } {
  const amount = Math.max(0, damage);
  if (!blocking) return { damage: amount, staminaCost: 0, broken: false };
  const available = Math.max(0, stamina);
  const cost = amount * 0.7;
  if (available >= cost)
    return { damage: amount * 0.2, staminaCost: cost, broken: false };
  return { damage: amount, staminaCost: available, broken: true };
}

export interface MeleeStrike { damage: number; critical: boolean; poise: number; knockback: number }
/** Deterministic precision rewards, never random critical hits.
 * Light damage: base*(1 + .08*combo). Heavy: base*(1 + .9*charge).
 * A parry counter multiplies damage by 1.5. Third light and counters are critical.
 * Poise and knockback are independent reactions, not additional health damage.
 */
export function resolveMeleeStrike(base: number, comboIndex: number, heavy: boolean, chargePower: number, counterAttack: boolean): MeleeStrike {
  const amount = Number.isFinite(base) ? Math.max(0, Math.min(10_000, base)) : 0;
  const combo = Number.isFinite(comboIndex) ? Math.max(0, Math.min(2, Math.floor(comboIndex))) : 0;
  const charge = Number.isFinite(chargePower) ? Math.max(0, Math.min(1, chargePower)) : 0;
  if (amount === 0) return { damage: 0, critical: false, poise: 0, knockback: 0 };
  return {
    damage: Math.round(amount * (heavy ? 1 + .9 * charge : 1 + .08 * combo) * (counterAttack ? 1.5 : 1)),
    critical: counterAttack || (!heavy && combo === 2),
    poise: Math.round((heavy ? 42 + 58 * charge : [16, 22, 34][combo]) * (counterAttack ? 1.35 : 1)),
    knockback: (heavy ? 1.3 + 1.7 * charge : [.25, .4, .8][combo]) + (counterAttack ? .7 : 0),
  };
}
