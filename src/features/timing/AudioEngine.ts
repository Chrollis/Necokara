export default class AudioEngine {
  private audio: HTMLAudioElement | null = null;

  private ctx: AudioContext | null = null;

  private _duration = 0;

  private _rawData: Float32Array | null = null;

  private _url: string | null = null;

  get duration() {
    return this._duration;
  }

  get playing() {
    return this.audio ? !this.audio.paused : false;
  }

  getPeaks(width: number): Float32Array {
    const data = this._rawData;
    if (!data || data.length === 0) return new Float32Array(width || 1);
    const step = Math.max(1, Math.floor(data.length / width));
    const result = new Float32Array(width);
    for (let i = 0; i < width; i += 1) {
      const start = i * step;
      let max = 0;
      for (let j = 0; j < step; j += 1) {
        const abs = Math.abs(data[start + j]);
        if (abs > max) max = abs;
      }
      result[i] = max;
    }
    const m = Math.max(...result);
    if (m > 0) {
      for (let i = 0; i < width; i += 1) result[i] /= m;
    }
    return result;
  }

  async loadFromDataUrl(dataUrl: string, fileName: string): Promise<void> {
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    const file = new File([blob], fileName, { type: blob.type });
    return this.loadFile(file);
  }

  async loadFile(file: File): Promise<void> {
    const url = URL.createObjectURL(file);
    this._url = url;

    const audio = new Audio();
    audio.crossOrigin = 'anonymous';

    const ready = new Promise<void>((resolve, reject) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      audio.onloadedmetadata = done;
      audio.oncanplay = done;
      audio.onerror = () => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Cannot load audio'));
        }
      };
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 5000);
    });

    audio.src = url;
    audio.load();
    await ready;

    this._duration = audio.duration || 0;

    this.ctx = new AudioContext();
    const source = this.ctx.createMediaElementSource(audio);
    const gain = this.ctx.createGain();
    source.connect(gain);
    gain.connect(this.ctx.destination);

    this.audio = audio;
    try {
      const buf = await file.arrayBuffer();
      const c = new AudioContext();
      const decoded = await c.decodeAudioData(buf);
      c.close();
      this._rawData = decoded.getChannelData(0);
    } catch {
      this._rawData = null;
    }
  }

  play(): void {
    if (!this.audio) return;
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    this.audio.play();
  }

  pause(): void {
    this.audio?.pause();
  }

  getCurrentTime(): number {
    return this.audio ? this.audio.currentTime * 1000 : 0;
  }

  seek(timeMs: number): void {
    if (!this.audio) return;
    this.audio.currentTime = timeMs / 1000;
  }

  setPlaybackRate(rate: number): void {
    if (!this.audio) return;
    this.audio.playbackRate = rate;
    this.audio.defaultPlaybackRate = rate;
  }

  destroy(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
    }
    if (this._url) URL.revokeObjectURL(this._url);
    this.ctx?.close();
  }
}
