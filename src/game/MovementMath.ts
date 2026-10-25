/** Bounded, monotonic acceleration with no overshoot. */
export function moveToward(
  current: number,
  target: number,
  maximumDelta: number,
): number {
  return (
    current + Math.max(-maximumDelta, Math.min(maximumDelta, target - current))
  );
}

/** Shortest signed angle; stable when crossing -PI/PI. */
export function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** Integrating this curve over any subdivision gives exactly 4.2 metres. */
export function dodgeDistanceAt(
  elapsed: number,
  duration = 0.38,
  distance = 4.2,
): number {
  const t = Math.max(0, Math.min(1, elapsed / duration));
  return distance * (2 * t - t * t);
}

export interface PlanarVector {
  x: number;
  z: number;
}
/** Normalize before camera rotation so diagonals never move faster. Mutates output. */
export function cameraRelativeInput(
  x: number,
  z: number,
  yaw: number,
  out: PlanarVector,
): void {
  const length = Math.hypot(x, z);
  if (length > 1) {
    x /= length;
    z /= length;
  }
  const sin = Math.sin(yaw),
    cos = Math.cos(yaw);
  out.x = x * cos + z * sin;
  out.z = -x * sin + z * cos;
}

/** Coyote time and a press-before-landing buffer use simulation time, not frames. */
export class JumpWindow {
  coyote = 0;
  buffered = 0;
  update(dt: number, grounded: boolean, pressed: boolean): void {
    this.coyote = grounded ? 0.1 : Math.max(0, this.coyote - dt);
    this.buffered = pressed ? 0.12 : Math.max(0, this.buffered - dt);
  }
  consume(allowed = true): boolean {
    if (!allowed || this.coyote <= 0 || this.buffered <= 0) return false;
    this.coyote = 0;
    this.buffered = 0;
    return true;
  }
  reset(): void {
    this.coyote = 0;
    this.buffered = 0;
  }
}
