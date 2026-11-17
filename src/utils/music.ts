// Smooth casino lounge / lo-fi jazz chord loop using Web Audio API
class LoungeMusicPlayer {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isPlaying = false;
  private step = 0;

  // Dm9 -> G13 -> Cmaj9 -> A7alt
  private chords = [
    [146.83, 261.63, 329.63, 349.23, 440.0],
    [196.0, 293.66, 329.63, 392.0, 440.0],
    [130.81, 246.94, 293.66, 329.63, 392.0],
    [110.0, 220.0, 277.18, 329.63, 392.0],
  ];

  toggle(): boolean {
    if (this.isPlaying) {
      this.stop();
      return false;
    }
    this.start();
    return true;
  }

  start(): void {
    if (this.isPlaying) return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.isPlaying = true;
    this.playChord();
    this.timer = setInterval(() => this.playChord(), 2600);
  }

  stop(): void {
    this.isPlaying = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private playChord(): void {
    if (!this.ctx || !this.isPlaying) return;
    const now = this.ctx.currentTime;
    const freqs = this.chords[this.step % this.chords.length];
    this.step++;

    freqs.forEach((freq, i) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(i === 0 ? 0.045 : 0.022, now + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 2.5);
    });
  }
}

export const loungeMusic = new LoungeMusicPlayer();

let sfxCtx: AudioContext | null = null;
function getSfxContext(): AudioContext | null {
  try {
    if (!sfxCtx) sfxCtx = new AudioContext();
    if (sfxCtx.state === 'suspended') void sfxCtx.resume();
    return sfxCtx;
  } catch {
    return null;
  }
}

export function playClockTick(urgent = false): void {
  const ctx = getSfxContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(urgent ? 980 : 720, ctx.currentTime);
  gain.gain.setValueAtTime(0.06, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.07);
}

export function playDealSound(): void {
  const ctx = getSfxContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(240, now);
  osc.frequency.exponentialRampToValueAtTime(520, now + 0.07);
  gain.gain.setValueAtTime(0.045, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.09);
}

export function playChipSound(): void {
  const ctx = getSfxContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  [1200, 1650].forEach((freq, i) => {
    const t = now + i * 0.045;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  });
}

export function playCheckSound(): void {
  const ctx = getSfxContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  [0, 0.11].forEach((offset) => {
    const t = now + offset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(85, t + 0.06);
    gain.gain.setValueAtTime(0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.07);
  });
}

export function playFoldSound(): void {
  const ctx = getSfxContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(320, now);
  osc.frequency.exponentialRampToValueAtTime(140, now + 0.14);
  gain.gain.setValueAtTime(0.045, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.16);
}

export function playWinSound(): void {
  const ctx = getSfxContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    const t = now + i * 0.08;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.055, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  });
}
