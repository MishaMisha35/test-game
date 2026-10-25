/** Deterministic combat decisions shared by the AI and its isolated tests. */
export type EnemyAttack = "slash" | "cleave" | "slam";
export interface AttackProfile {
  type: EnemyAttack;
  windup: number;
  recovery: number;
  reach: number;
  halfAngle: number;
  damage: number;
  combo: number;
}
export function attackProfile(
  boss: boolean,
  miniBoss: boolean,
  phase: number,
  sequence: number,
  followup = false,
): AttackProfile {
  if (!boss)
    return {
      type: "slash",
      windup: 0.75,
      recovery: 1.05,
      reach: 1.7,
      halfAngle: Math.PI * 0.38,
      damage: 14,
      combo: 1,
    };
  if (!miniBoss)
    return {
      type: phase === 2 ? "slam" : "slash",
      windup: 1.1,
      recovery: 1.4,
      reach: phase === 2 ? 4.9 : 3,
      halfAngle: Math.PI * 0.38,
      damage: phase === 2 ? 28 : 22,
      combo: 1,
    };
  const type: EnemyAttack =
    phase === 2
      ? (["cleave", "slam", "slash"] as const)[sequence % 3]
      : (["slash", "cleave", "slam"] as const)[sequence % 3];
  if (type === "slam")
    return {
      type,
      windup: phase === 2 ? 1.05 : 1.25,
      recovery: 1.4,
      reach: 4.35,
      halfAngle: Math.PI,
      damage: phase === 2 ? 36 : 32,
      combo: 1,
    };
  if (type === "cleave")
    return {
      type,
      windup: followup ? (phase === 2 ? 0.32 : 0.4) : phase === 2 ? 0.72 : 0.95,
      recovery: 1.1,
      reach: 3.25,
      halfAngle: Math.PI * 0.58,
      damage: followup ? 19 : 16,
      combo: 2,
    };
  return {
    type,
    windup: phase === 2 ? 0.62 : 0.8,
    recovery: 0.9,
    reach: 2.9,
    halfAngle: Math.PI * 0.38,
    damage: phase === 2 ? 25 : 21,
    combo: 1,
  };
}

/** Eligible opponents rotate by their last real attack; occupied slots are never stolen. */
export function chooseAttackers(
  candidates: ReadonlyArray<{
    id: number;
    active: boolean;
    ready: boolean;
    lastAttack: number;
  }>,
  limit = 2,
): Set<number> {
  const selected = new Set(candidates.filter((e) => e.active).map((e) => e.id));
  const available = Math.max(0, Math.floor(limit) - selected.size);
  candidates
    .filter((e) => !e.active && e.ready)
    .sort((a, b) => a.lastAttack - b.lastAttack || a.id - b.id)
    .slice(0, available)
    .forEach((e) => selected.add(e.id));
  return selected;
}

export function targetInFront(
  yaw: number,
  origin: { x: number; z: number },
  target: { x: number; z: number },
  halfAngle = Math.PI * 0.42,
): boolean {
  const dx = target.x - origin.x,
    dz = target.z - origin.z,
    d = Math.hypot(dx, dz);
  return (
    d < 0.0001 ||
    (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / d >= Math.cos(halfAngle)
  );
}
export interface StrikeOptions {
  poise: number;
  knockback: number;
  origin: { x: number; z: number };
  guardBreak?: boolean;
  unblockable?: boolean;
}
export interface StrikeState {
  health: number;
  guard: number;
  poise: number;
  maxPoise: number;
  blocking: boolean;
  facingAttacker: boolean;
}
export interface StrikeResult {
  killed: boolean;
  blocked: boolean;
  guardBroken: boolean;
  damage: number;
  staggered: boolean;
}
export interface ResolvedStrike extends StrikeResult {
  health: number;
  guard: number;
  poise: number;
}
const positive = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);
/** Guards consume a finite resource. Rear attacks, magic and forced breaks bypass mitigation. */
export function resolveStrike(
  state: StrikeState,
  amount: number,
  options: Pick<StrikeOptions, "poise" | "guardBreak" | "unblockable">,
): ResolvedStrike {
  const incoming = positive(amount),
    impact = positive(options.poise);
  if (state.health <= 0 || incoming <= 0)
    return {
      health: state.health,
      guard: state.guard,
      poise: state.poise,
      killed: false,
      blocked: false,
      guardBroken: false,
      damage: 0,
      staggered: false,
    };
  const guarding =
    state.blocking && state.facingAttacker && !options.unblockable;
  const guardCost = Math.max(8, incoming * 0.9 + impact * 0.22);
  const guardBroken =
    guarding && (!!options.guardBreak || state.guard < guardCost);
  const blocked = guarding && !guardBroken;
  const damage = blocked ? Math.max(1, Math.round(incoming * 0.12)) : incoming;
  const poiseAfter = Math.max(0, state.poise - impact * (blocked ? 0.12 : 1));
  const staggered =
    !blocked && (guardBroken || (poiseAfter <= 0 && impact > 0));
  const health = Math.max(0, state.health - damage);
  return {
    health,
    guard: guarding ? Math.max(0, state.guard - guardCost) : state.guard,
    poise: staggered ? state.maxPoise : poiseAfter,
    killed: health === 0,
    blocked,
    guardBroken,
    damage: Math.min(state.health, damage),
    staggered,
  };
}

/** Exponential velocity decay is stable at different fixed simulation step sizes. */
export function dampKnockback(value: number, dt: number): number {
  const next = value * Math.exp(-9 * Math.max(0, dt));
  return Math.abs(next) < 0.015 ? 0 : next;
}
