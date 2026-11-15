import type { SynthMode } from '../data/tracks';
import type { PixelTelemetry } from '../utils/sonificationMath';

export class EarthAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private panner: StereoPannerNode | null = null;
  private analyser: AnalyserNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;

  // Ambient Pad oscillators
  private padOsc1: OscillatorNode | null = null;
  private padOsc2: OscillatorNode | null = null;
  private padSub: OscillatorNode | null = null;
  private padGain: GainNode | null = null;

  private mode: SynthMode = 'pad';
  private volume = 0.55;
  private muted = false;
  private running = false;
  private lastNoteTriggerAt = 0;

  private timeDomainData = new Uint8Array(256);
  private freqDomainData = new Uint8Array(256);

  public isRunning(): boolean {
    return this.running;
  }

  public async start(): Promise<void> {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.82;
      this.timeDomainData = new Uint8Array(this.analyser.frequencyBinCount);
      this.freqDomainData = new Uint8Array(this.analyser.frequencyBinCount);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;

      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.ratio.value = 4;

      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 1400;
      this.filter.Q.value = 2.2;

      this.panner = this.ctx.createStereoPanner();
      this.panner.pan.value = 0;

      // Ambient feedback delay bus
      this.delayNode = this.ctx.createDelay(1.0);
      this.delayNode.delayTime.value = 0.34;
      this.delayFeedback = this.ctx.createGain();
      this.delayFeedback.gain.value = 0.32;
      const delayFilter = this.ctx.createBiquadFilter();
      delayFilter.type = 'lowpass';
      delayFilter.frequency.value = 1800;

      this.delayNode.connect(delayFilter);
      delayFilter.connect(this.delayFeedback);
      this.delayFeedback.connect(this.delayNode);
      delayFilter.connect(compressor);

      this.panner.connect(this.filter);
      this.filter.connect(compressor);
      this.filter.connect(this.delayNode);
      compressor.connect(this.masterGain);
      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      // Continuous Ambient Pad voice
      this.padGain = this.ctx.createGain();
      this.padGain.gain.value = 0;

      this.padOsc1 = this.ctx.createOscillator();
      this.padOsc1.type = 'triangle';
      this.padOsc1.frequency.value = 220;

      this.padOsc2 = this.ctx.createOscillator();
      this.padOsc2.type = 'sine';
      this.padOsc2.frequency.value = 329.63;
      this.padOsc2.detune.value = 7;

      this.padSub = this.ctx.createOscillator();
      this.padSub.type = 'sine';
      this.padSub.frequency.value = 110;

      const subGain = this.ctx.createGain();
      subGain.gain.value = 0.38;

      this.padOsc1.connect(this.padGain);
      this.padOsc2.connect(this.padGain);
      this.padSub.connect(subGain);
      subGain.connect(this.padGain);
      this.padGain.connect(this.panner);

      this.padOsc1.start();
      this.padOsc2.start();
      this.padSub.start();
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    this.running = true;
    this.syncMasterGain();
  }

  public stop(): void {
    this.running = false;
    if (this.ctx && this.padGain) {
      const now = this.ctx.currentTime;
      this.padGain.gain.setTargetAtTime(0, now, 0.08);
    }
  }

  public setMode(mode: SynthMode): void {
    this.mode = mode;
    if (this.ctx && this.padGain && this.running) {
      const now = this.ctx.currentTime;
      if (mode !== 'pad') {
        this.padGain.gain.setTargetAtTime(0.05, now, 0.1);
      }
    }
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    this.syncMasterGain();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.syncMasterGain();
  }

  private syncMasterGain(): void {
    if (!this.ctx || !this.masterGain) return;
    const target = this.muted || !this.running ? 0 : this.volume;
    this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.06);
  }

  public updateFromTelemetry(telemetry: PixelTelemetry, nowMs: number): void {
    if (!this.ctx || !this.running || !this.panner || !this.filter || !this.padGain) {
      return;
    }

    const now = this.ctx.currentTime;
    this.panner.pan.setTargetAtTime(telemetry.stereoPan, now, 0.12);
    this.filter.frequency.setTargetAtTime(telemetry.filterCutoffHz, now, 0.14);

    if (this.padOsc1 && this.padOsc2 && this.padSub) {
      this.padOsc1.frequency.setTargetAtTime(telemetry.pitchHz, now, 0.18);
      this.padOsc2.frequency.setTargetAtTime(telemetry.pitchHz * 1.498, now, 0.22); // fifth shimmer
      this.padSub.frequency.setTargetAtTime(telemetry.pitchHz * 0.5, now, 0.2);

      const padTargetGain =
        this.mode === 'pad' ? telemetry.mappedGain * 0.26 : telemetry.mappedGain * 0.05;
      this.padGain.gain.setTargetAtTime(padTargetGain, now, 0.14);
    }

    if (this.mode === 'chimes') {
      const intervalMs = Math.max(190, 480 - telemetry.dataDensity * 260);
      if (nowMs - this.lastNoteTriggerAt >= intervalMs) {
        this.lastNoteTriggerAt = nowMs;
        this.triggerChime(telemetry.pitchHz, telemetry.stereoPan, telemetry.mappedGain);
      }
    } else if (this.mode === 'pulse') {
      const intervalMs = Math.max(135, 310 - telemetry.dataDensity * 165);
      if (nowMs - this.lastNoteTriggerAt >= intervalMs) {
        this.lastNoteTriggerAt = nowMs;
        this.triggerPulse(telemetry.pitchHz, telemetry.stereoPan, telemetry.mappedGain);
      }
    }
  }

  private triggerChime(freq: number, pan: number, gainAmount: number): void {
    if (!this.ctx || !this.filter) return;
    const now = this.ctx.currentTime;

    const notePanner = this.ctx.createStereoPanner();
    notePanner.pan.value = Math.max(-1, Math.min(1, pan));

    const env = this.ctx.createGain();
    const peak = Math.min(0.28, 0.1 + gainAmount * 0.18);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);

    const carrier = this.ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(freq, now);

    const harmonic = this.ctx.createOscillator();
    harmonic.type = 'triangle';
    harmonic.frequency.setValueAtTime(freq * 2, now);
    const harmGain = this.ctx.createGain();
    harmGain.gain.value = 0.22;

    carrier.connect(env);
    harmonic.connect(harmGain);
    harmGain.connect(env);
    env.connect(notePanner);
    notePanner.connect(this.filter);

    carrier.start(now);
    harmonic.start(now);
    carrier.stop(now + 0.9);
    harmonic.stop(now + 0.9);
  }

  private triggerPulse(freq: number, pan: number, gainAmount: number): void {
    if (!this.ctx || !this.filter) return;
    const now = this.ctx.currentTime;

    const notePanner = this.ctx.createStereoPanner();
    notePanner.pan.value = Math.max(-1, Math.min(1, pan));

    const env = this.ctx.createGain();
    const peak = Math.min(0.22, 0.08 + gainAmount * 0.14);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq * 0.5, now);

    const pulseFilter = this.ctx.createBiquadFilter();
    pulseFilter.type = 'lowpass';
    pulseFilter.frequency.setValueAtTime(freq * 4, now);
    pulseFilter.frequency.exponentialRampToValueAtTime(Math.max(180, freq * 1.1), now + 0.2);

    osc.connect(pulseFilter);
    pulseFilter.connect(env);
    env.connect(notePanner);
    notePanner.connect(this.filter);

    osc.start(now);
    osc.stop(now + 0.26);
  }

  public getAnalyserData(): { timeDomain: Uint8Array; frequency: Uint8Array } | null {
    if (!this.analyser || !this.running) return null;
    this.analyser.getByteTimeDomainData(this.timeDomainData);
    this.analyser.getByteFrequencyData(this.freqDomainData);
    return {
      timeDomain: this.timeDomainData,
      frequency: this.freqDomainData,
    };
  }

  public dispose(): void {
    this.stop();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
