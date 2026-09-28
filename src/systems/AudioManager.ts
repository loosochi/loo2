/**
 * Tiny procedural sound engine on the Web Audio API — no audio files needed.
 * All sounds are short and quiet; everything is silenced when sound is disabled.
 */
export type SoundId = 'click' | 'light' | 'yellow' | 'crash' | 'win' | 'lose' | 'pass' | 'spawn' | 'siren';

type Ctx = AudioContext;

class AudioManager {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private engine: { gain: GainNode; osc: OscillatorNode; filter: BiquadFilterNode } | null = null;
  private enabled = true;
  private engineLevel = -1;

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05);
    if (!on) this.setEngineLevel(0);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Must be called from a user gesture on iOS/Chrome to unlock audio. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC: typeof AudioContext | undefined =
          globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? 0.5 : 0;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, cutoff: number): void {
    if (!this.ctx || !this.master) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  play(id: SoundId): void {
    if (!this.enabled || !this.ctx) return;
    switch (id) {
      case 'click':
        this.tone(660, 0.07, 'triangle', 0.18);
        break;
      case 'light':
        this.tone(880, 0.05, 'square', 0.05);
        this.tone(1320, 0.06, 'sine', 0.08, 0.03);
        break;
      case 'yellow':
        this.tone(740, 0.08, 'triangle', 0.12);
        this.tone(740, 0.08, 'triangle', 0.1, 0.1);
        break;
      case 'pass':
        this.tone(1046, 0.08, 'sine', 0.035);
        break;
      case 'spawn':
        break;
      case 'crash':
        this.noise(0.6, 0.55, 900);
        this.tone(140, 0.4, 'sawtooth', 0.12, 0, 50);
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.16, i * 0.11));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.14, i * 0.14));
        break;
      case 'siren':
        // Soft two-tone wail, three cycles.
        for (let i = 0; i < 3; i++) {
          this.tone(740, 0.3, 'sine', 0.06, i * 0.6, 980);
          this.tone(980, 0.3, 'sine', 0.06, i * 0.6 + 0.3, 740);
        }
        break;
    }
  }

  /** Continuous soft engine hum scaled by how many cars are moving (0..1). */
  setEngineLevel(level: number): void {
    if (!this.ctx || !this.master) return;
    if (!this.engine) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 180;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(this.master);
      osc.start();
      this.engine = { gain, osc, filter };
    }
    const l = this.enabled ? Math.max(0, Math.min(1, level)) : 0;
    if (Math.abs(l - this.engineLevel) < 0.04) return; // avoid scheduling automation every frame
    this.engineLevel = l;
    const t = this.ctx.currentTime;
    this.engine.gain.gain.setTargetAtTime(l * 0.05, t, 0.3);
    this.engine.osc.frequency.setTargetAtTime(50 + l * 25, t, 0.3);
    this.engine.filter.frequency.setTargetAtTime(150 + l * 120, t, 0.3);
  }
}

export const audio = new AudioManager();
