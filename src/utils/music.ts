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

export function playClockTick(urgent = false): void {
  try {
    const AudioCtx = window.AudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
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
    setTimeout(() => void ctx.close(), 120);
  } catch {
    // Ignore audio context errors
  }
}
