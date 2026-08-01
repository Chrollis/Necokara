/**
 * fft.ts — 支持任意长度（非 2 的幂）的 STFT / ISTFT
 *
 * 背景：MDX-Net 分离模型的 n_fft=6144（非 2 的幂），而 pleco-xa 的
 * fft/stft 会把非 2 幂输入补零到 nextPow2，导致频率映射错误，故不能直接用。
 *
 * 实现：优先使用 @radzivon.bartoshyk/zaft（Rust→WASM，任意长度、精确、
 * 预规划 Plan 极快）；加载失败时回退到内置混合基 Cooley-Tukey（因子 2/3/5）。
 */

export interface ComplexBin {
  real: number;
  imag: number;
}

let zaftMod: unknown = undefined;
let zaftTried = false;

/** 惰性加载 zaft（WASM）；失败返回 undefined */
function getZaft(): any {
  if (!zaftTried) {
    zaftTried = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      zaftMod = eval('require')('@radzivon.bartoshyk/zaft');
    } catch {
      zaftMod = undefined;
    }
  }
  return zaftMod;
}

/**
 * 原地 FFT（不归一化；inverse 也由调用方负责缩放）
 * @param re 实部（原地修改）
 * @param im 虚部（原地修改）
 * @param inverse 是否逆变换
 */
export function fftInPlace(
  re: Float64Array,
  im: Float64Array,
  inverse: boolean,
): void {
  const n = re.length;
  if (n <= 1) return;
  let p = 0;
  for (const q of [2, 3, 5]) {
    if (n % q === 0) {
      p = q;
      break;
    }
  }
  if (p === 0) {
    naiveDft(re, im, inverse);
    return;
  }
  const m = n / p;
  const rs: Float64Array[] = [];
  const is: Float64Array[] = [];
  for (let a = 0; a < p; a++) {
    const rr = new Float64Array(m);
    const ii = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      rr[k] = re[a + p * k];
      ii[k] = im[a + p * k];
    }
    fftInPlace(rr, ii, inverse);
    rs.push(rr);
    is.push(ii);
  }
  const sign = inverse ? 1 : -1;
  const ang = (sign * 2 * Math.PI) / n;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const b = k % m;
    let sr = 0;
    let si = 0;
    for (let a = 0; a < p; a++) {
      const wk = (a * k) % n;
      const wRe = Math.cos(ang * wk);
      const wIm = Math.sin(ang * wk);
      const r = rs[a][b];
      const iv = is[a][b];
      sr += r * wRe - iv * wIm;
      si += r * wIm + iv * wRe;
    }
    outRe[k] = sr;
    outIm[k] = si;
  }
  for (let k = 0; k < n; k++) {
    re[k] = outRe[k];
    im[k] = outIm[k];
  }
}

function naiveDft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  if (n <= 1) return;
  const sign = inverse ? 1 : -1;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const ang = (sign * 2 * Math.PI * ((k * t) % n)) / n;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      sr += re[t] * c - im[t] * s;
      si += re[t] * s + im[t] * c;
    }
    outRe[k] = sr;
    outIm[k] = si;
  }
  for (let k = 0; k < n; k++) {
    re[k] = outRe[k];
    im[k] = outIm[k];
  }
}

/** hann 窗（periodic，与 torch.hann_window 一致） */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  }
  return w;
}

/** reflect 填充：索引越界时镜像（center=true 的 torch 风格） */
function reflectPad(y: Float32Array, idx: number): number {
  const len = y.length;
  if (idx >= 0 && idx < len) return y[idx];
  let i = idx;
  while (i < 0) i = -i;
  while (i >= len) i = 2 * len - 2 - i;
  return y[i];
}

/**
 * STFT（center=true, pad_mode=reflect, 窗周期 hann）
 * @returns [freq][time] 的复数矩阵，行数 = nFft/2 + 1
 */
export function stft(
  y: Float32Array,
  nFft: number,
  hop: number,
  win: Float64Array,
): ComplexBin[][] {
  const pad = nFft / 2;
  const nFrames = Math.floor((y.length + 2 * pad - nFft) / hop) + 1;
  const nFreq = nFft / 2 + 1;
  const S: ComplexBin[][] = [];
  for (let f = 0; f < nFreq; f++) S.push(new Array<ComplexBin>(nFrames));
  const zaft = getZaft();
  for (let t = 0; t < nFrames; t++) {
    const start = t * hop;
    if (zaft) {
      // zaft rfft32：实数帧 → interleaved 复数（长度 2*nFreq）
      const frame = new Float32Array(nFft);
      for (let n = 0; n < nFft; n++) {
        frame[n] = reflectPad(y, start + n - pad) * win[n];
      }
      const X = zaft.rfft32(frame) as Float32Array;
      for (let f = 0; f < nFreq; f++) {
        S[f][t] = { real: X[2 * f], imag: X[2 * f + 1] };
      }
    } else {
      // fallback：混合基 FFT
      const re = new Float64Array(nFft);
      const im = new Float64Array(nFft);
      for (let n = 0; n < nFft; n++) {
        re[n] = reflectPad(y, start + n - pad) * win[n];
      }
      fftInPlace(re, im, false);
      for (let f = 0; f < nFreq; f++) {
        S[f][t] = { real: re[f], imag: im[f] };
      }
    }
  }
  return S;
}

/**
 * ISTFT（overlap-add + 窗平方归一化）
 * @param S [freq][time] 的复数矩阵，行数 = nFft/2 + 1
 * @param hopLength
 * @param win 合成窗（长度 nFft）
 * @param outLen 输出长度
 */
export function istft(
  S: ComplexBin[][],
  hopLength: number,
  win: Float64Array,
  outLen: number,
): Float32Array {
  const nFft = (S.length - 1) * 2;
  const nFrames = S[0].length;
  const out = new Float64Array(outLen);
  const weight = new Float64Array(outLen);
  const zaft = getZaft();
  // stft 时窗口中心对齐 t*hop（窗口从 t*hop - nFft/2 开始），这里同步偏移
  for (let t = 0; t < nFrames; t++) {
    let frame: Float32Array;
    if (zaft) {
      // irfft32：n/2+1 个 bin interleaved → 实数帧（已归一化 1/n）
      const spec = new Float32Array(2 * S.length);
      for (let f = 0; f < S.length; f++) {
        spec[2 * f] = S[f][t].real;
        spec[2 * f + 1] = S[f][t].imag;
      }
      frame = zaft.irfft32(spec, nFft) as Float32Array;
    } else {
      // fallback：共轭对称补全负频率 + 混合基 ifft
      const re = new Float64Array(nFft);
      const im = new Float64Array(nFft);
      for (let f = 0; f < S.length; f++) {
        re[f] = S[f][t].real;
        im[f] = S[f][t].imag;
      }
      for (let f = 1; f < nFft / 2; f++) {
        re[nFft - f] = re[f];
        im[nFft - f] = -im[f];
      }
      fftInPlace(re, im, true);
      frame = new Float32Array(nFft);
      for (let n = 0; n < nFft; n++) frame[n] = re[n] / nFft;
    }
    const start = t * hopLength - nFft / 2;
    for (let n = 0; n < nFft; n++) {
      const idx = start + n;
      if (idx >= 0 && idx < outLen) {
        out[idx] += frame[n] * win[n];
        weight[idx] += win[n] * win[n];
      }
    }
  }
  const res = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    res[i] = weight[i] > 1e-8 ? out[i] / weight[i] : 0;
  }
  return res;
}
