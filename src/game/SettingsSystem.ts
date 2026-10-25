export type QualityPreset = "low" | "medium" | "high" | "ultra";
export const QUALITY_LEVELS: QualityPreset[] = [
  "low",
  "medium",
  "high",
  "ultra",
];
export const PRESETS = {
  low: { pixelRatio: 0.85, shadowSize: 0, bloom: false, particles: 80 },
  medium: { pixelRatio: 1.15, shadowSize: 1024, bloom: false, particles: 150 },
  high: { pixelRatio: 1.5, shadowSize: 1536, bloom: true, particles: 230 },
  ultra: { pixelRatio: 1.75, shadowSize: 2048, bloom: true, particles: 320 },
} as const;
export interface GameSettings {
  quality: QualityPreset;
  sensitivity: number;
  fov: number;
  cameraEffects: number;
  motionBlur: boolean;
  adaptiveQuality: boolean;
}
export const DEFAULT_SETTINGS: GameSettings = {
  quality: "high",
  sensitivity: 1,
  fov: 60,
  cameraEffects: 0.6,
  motionBlur: false,
  adaptiveQuality: true,
};
const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.max(min, Math.min(max, v))
    : fallback;
export function validateSettings(raw: unknown): GameSettings {
  const s = (
    raw && typeof raw === "object" ? raw : {}
  ) as Partial<GameSettings>;
  return {
    quality: QUALITY_LEVELS.includes(s.quality!)
      ? s.quality!
      : DEFAULT_SETTINGS.quality,
    sensitivity: clamp(s.sensitivity, 0.3, 2, 1),
    fov: clamp(s.fov, 50, 90, 60),
    cameraEffects: clamp(s.cameraEffects, 0, 1, 0.6),
    motionBlur: typeof s.motionBlur === "boolean" ? s.motionBlur : false,
    adaptiveQuality:
      typeof s.adaptiveQuality === "boolean" ? s.adaptiveQuality : true,
  };
}
export class SettingsSystem {
  value: GameSettings;
  constructor() {
    let raw: unknown;
    try {
      raw = JSON.parse(
        localStorage.getItem("eternal-realms-settings-v2") || "null",
      );
    } catch {}
    this.value = validateSettings(raw);
  }
  save() {
    try {
      localStorage.setItem(
        "eternal-realms-settings-v2",
        JSON.stringify(this.value),
      );
    } catch {}
  }
}
/** Hysteresis avoids oscillating render-target allocations around the FPS target. */
export class AdaptiveResolution {
  ratio = 1;
  private elapsed = 0;
  private average = 1 / 60;
  private warmup = 3;
  private stable = 0;
  reset(ratio: number) {
    this.ratio = ratio;
    this.elapsed = 0;
    this.warmup = 3;
    this.stable = 0;
    this.average = 1 / 60;
  }
  sample(dt: number, maximum: number, enabled: boolean): number {
    if (!enabled) return this.ratio;
    this.average += (dt - this.average) * (1 - Math.exp(-dt / 2));
    this.elapsed += dt;
    if (this.warmup > 0) {
      this.warmup -= dt;
      return this.ratio;
    }
    if (this.elapsed < 2) return this.ratio;
    const sampledTime = this.elapsed;
    this.elapsed = 0;
    if (this.average > 1 / 48) {
      this.ratio = Math.max(Math.min(0.65, maximum), this.ratio - 0.1);
      this.stable = 0;
    } else if (this.average < 1 / 58) {
      this.stable += sampledTime;
      if (this.stable >= 4) {
        this.ratio = Math.min(maximum, this.ratio + 0.05);
        this.stable = 0;
      }
    } else this.stable = 0;
    return this.ratio;
  }
}
