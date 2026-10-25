import { describe, it, expect } from "vitest";
import {
  validateSettings,
  AdaptiveResolution,
  DEFAULT_SETTINGS,
} from "../src/game/SettingsSystem";
describe("comfort and quality settings", () => {
  it("defaults invalid storage safely and clamps FOV, effects and sensitivity", () => {
    expect(validateSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(
      validateSettings({
        quality: "maximum",
        fov: 160,
        cameraEffects: -1,
        sensitivity: NaN,
        motionBlur: "yes",
      }),
    ).toMatchObject({
      quality: "high",
      fov: 90,
      cameraEffects: 0,
      sensitivity: 1,
      motionBlur: false,
    });
  });
  it("keeps Low pixel budget bounded under slow rendering, with hysteresis", () => {
    const scale = new AdaptiveResolution();
    scale.reset(0.85);
    for (let i = 0; i < 120; i++) scale.sample(0.1, 0.85, true);
    expect(scale.ratio).toBe(0.65);
    const before = scale.ratio;
    for (let i = 0; i < 20; i++) scale.sample(1 / 120, 0.85, true);
    expect(scale.ratio).toBe(before);
  });
  it("does not change resolution when adaptive mode is disabled", () => {
    const scale = new AdaptiveResolution();
    scale.reset(1.5);
    for (let i = 0; i < 200; i++) scale.sample(0.1, 1.5, false);
    expect(scale.ratio).toBe(1.5);
  });
  it("recovers resolution on a stable 60Hz screen after temporary load", () => {
    const scale = new AdaptiveResolution();
    scale.reset(0.75);
    for (let i = 0; i < 900; i++) scale.sample(1 / 60, 1.5, true);
    expect(scale.ratio).toBeGreaterThan(0.75);
    expect(scale.ratio).toBeLessThanOrEqual(1.5);
  });
});
