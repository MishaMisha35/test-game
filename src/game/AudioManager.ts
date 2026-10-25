/** Procedural, asset-free soundscape. Audio is activated only by a user gesture. */
export type SoundEffect =
  | "swing"
  | "hit"
  | "hurt"
  | "magic"
  | "step"
  | "death"
  | "level"
  | "ui"
  | "victory"
  | "dodge"
  | "chest"
  | "parry"
  | "land";

export class AudioManager {
  enabled = true;
  private context?: AudioContext;
  private master?: GainNode;
  private atmosphere?: GainNode;
  private combatBed?: GainNode;
  private noiseBuffer?: AudioBuffer;
  private ambienceNodes: AudioScheduledSourceNode[] = [];
  private elapsed = 0;
  private nextChime = 3;
  private phrase = 0;
  private lastStep = -Infinity;

  constructor() {}

  /** Call from a click or keyboard handler, never from an automatic page load. */
  start(): void {
    try {
      if (!this.context) {
        const AudioContextClass =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioContextClass) return;
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.master.gain.value = this.enabled ? 0.48 : 0;
        this.master.connect(this.context.destination);
        this.noiseBuffer = this.makeNoise(this.context);
        this.createAtmosphere();
      }
      if (this.context.state === "suspended")
        void this.context.resume().catch(() => {});
    } catch {
      // A silent browser is still a playable browser (for example, embedded WebViews).
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(
        this.enabled ? 0.48 : 0,
        this.context.currentTime,
        0.08,
      );
    }
    return this.enabled;
  }

  update(dt: number, inCombat: boolean): void {
    if (!this.context || this.context.state !== "running") return;
    this.elapsed += Math.max(0, Math.min(dt, 0.1));
    const now = this.context.currentTime;
    this.atmosphere?.gain.setTargetAtTime(inCombat ? 0.52 : 1, now, 1.4);
    this.combatBed?.gain.setTargetAtTime(inCombat ? 0.065 : 0.001, now, 1.1);
    if (!this.enabled || this.elapsed < this.nextChime) return;
    // A sparse D-minor pentatonic motif, leaving plenty of room for the world.
    const melody = [
      293.665, 440, 349.228, 523.251, 440, 293.665, 261.626, 349.228,
    ];
    const note = melody[this.phrase++ % melody.length];
    if (inCombat) {
      this.tone(note * 0.25, note * 0.25, 0.34, 0.09, "triangle");
      this.noise(0.16, 0.07, 180, "lowpass");
      this.nextChime = this.elapsed + 0.85;
    } else {
      this.tone(note, note, 3.5, 0.025, "sine");
      this.tone(note * 2, note * 2, 2.3, 0.008, "sine", 0.15);
      this.nextChime = this.elapsed + 4.8;
    }
  }

  play(type: SoundEffect): void {
    if (!this.enabled || !this.context || this.context.state !== "running")
      return;
    switch (type) {
      case "parry":
        this.tone(880, 510, 0.16, 0.085, "sine");
        this.tone(1330, 990, 0.22, 0.035, "sine");
        this.noise(0.09, 0.1, 2500, "highpass");
        break;
      case "land":
        this.noise(0.17, 0.1, 420, "lowpass");
        this.tone(65, 34, 0.14, 0.065, "sine");
        break;
      case "swing":
        this.noise(0.19, 0.24, 1450, "bandpass");
        this.tone(190, 75, 0.15, 0.08, "triangle");
        break;
      case "hit":
        this.noise(0.14, 0.38, 2100, "highpass");
        this.tone(122, 48, 0.22, 0.28, "triangle");
        this.tone(710, 240, 0.12, 0.08, "sine");
        break;
      case "hurt":
        this.noise(0.2, 0.19, 440, "lowpass");
        this.tone(105, 45, 0.34, 0.23, "sawtooth");
        break;
      case "magic":
        this.noise(0.6, 0.09, 2800, "bandpass");
        [1, 1.5, 2].forEach((ratio, i) =>
          this.tone(220 * ratio, 880 * ratio, 0.55, 0.065, "sine", i * 0.035),
        );
        break;
      case "step":
        if (this.context.currentTime - this.lastStep < 0.18) return;
        this.lastStep = this.context.currentTime;
        this.noise(0.075, 0.095, 600, "lowpass");
        this.tone(72, 40, 0.065, 0.055, "sine");
        break;
      case "death":
        this.tone(146.83, 36.7, 1.9, 0.17, "triangle");
        this.noise(1.6, 0.07, 310, "lowpass");
        break;
      case "level":
        [293.665, 349.228, 440, 587.33].forEach((frequency, i) =>
          this.tone(frequency, frequency, 1.35, 0.1, "sine", i * 0.16),
        );
        break;
      case "ui":
        this.tone(660, 880, 0.085, 0.055, "sine");
        break;
      case "victory":
        [146.83, 220, 293.665, 349.228, 440, 587.33].forEach((frequency, i) =>
          this.tone(frequency, frequency, 3.1, 0.07, "sine", i * 0.19),
        );
        break;
      case "dodge":
        this.noise(0.3, 0.16, 760, "bandpass");
        break;
      case "chest":
        this.noise(0.16, 0.11, 360, "lowpass");
        [523.25, 659.25, 783.99].forEach((frequency, i) =>
          this.tone(frequency, frequency, 0.8, 0.07, "sine", i * 0.11),
        );
        break;
    }
  }

  /** Optional lifecycle cleanup for hosts that replace the game without reloading. */
  destroy(): void {
    for (const source of this.ambienceNodes) {
      try {
        source.stop();
      } catch {
        /* Already stopped. */
      }
      source.disconnect();
    }
    this.ambienceNodes = [];
    void this.context?.close().catch(() => {});
    this.context = undefined;
    this.master = undefined;
  }

  private makeNoise(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(
      1,
      context.sampleRate * 3,
      context.sampleRate,
    );
    const channel = buffer.getChannelData(0);
    let low = 0;
    for (let i = 0; i < channel.length; i++) {
      low = (low + Math.random() * 0.1 - 0.05) / 1.02;
      channel[i] = low * 3.3;
    }
    return buffer;
  }

  private createAtmosphere(): void {
    const context = this.context!;
    this.atmosphere = context.createGain();
    this.atmosphere.gain.value = 1;
    this.atmosphere.connect(this.master!);
    const wind = context.createBufferSource();
    wind.buffer = this.noiseBuffer!;
    wind.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 460;
    const windGain = context.createGain();
    windGain.gain.value = 0.105;
    wind.connect(filter).connect(windGain).connect(this.atmosphere);
    wind.start();
    this.ambienceNodes.push(wind);
    for (const [frequency, volume] of [
      [73.416, 0.022],
      [110, 0.012],
      [146.832, 0.008],
    ]) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.value = volume;
      oscillator.connect(gain).connect(this.atmosphere);
      oscillator.start();
      this.ambienceNodes.push(oscillator);
    }
    this.combatBed = context.createGain();
    this.combatBed.gain.value = 0.001;
    this.combatBed.connect(this.master!);
    const rumble = context.createOscillator();
    rumble.type = "triangle";
    rumble.frequency.value = 55;
    rumble.connect(this.combatBed);
    rumble.start();
    this.ambienceNodes.push(rumble);
  }

  private tone(
    from: number,
    to: number,
    duration: number,
    volume: number,
    wave: OscillatorType,
    delay = 0,
  ): void {
    const context = this.context!;
    const at = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(from, at);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(to, 1),
      at + duration,
    );
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(
      Math.max(volume, 0.0002),
      at + Math.min(0.04, duration * 0.2),
    );
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope).connect(this.master!);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
    };
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  private noise(
    duration: number,
    volume: number,
    frequency: number,
    type: BiquadFilterType,
  ): void {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer!;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 0.7;
    const envelope = context.createGain();
    const at = context.currentTime;
    envelope.gain.setValueAtTime(Math.max(volume, 0.0002), at);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(envelope).connect(this.master!);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      envelope.disconnect();
    };
    source.start(at, Math.random() * 2);
    source.stop(at + duration);
  }
}
