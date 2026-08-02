/**
 * onnx.ts — shared onnxruntime session factory with GPU (DirectML) auto-detection.
 *
 * onnxruntime-node bundles the DirectML execution provider (Windows, any GPU).
 * We try `dml` first and fall back to `cpu` when it is unavailable (no GPU /
 * outdated driver / unsupported OS / model op unsupported on dml). The chosen
 * provider is cached so every inference site shares one probe. Used from both
 * the main process and the worker threads.
 */

export type OnnxProvider = 'dml' | 'cpu';

let probed: OnnxProvider | null = null;

/** Load onnxruntime-node (webpack-safe, native addon via eval require). */
export function loadOnnx(): any {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const ort = eval('require')('onnxruntime-node');
  if (!ort) throw new Error('onnxruntime-node is not available');
  // eslint-disable-next-line no-console
  console.log(
    `[onnx] onnxruntime-node loaded (pid ${process.pid}, thread ${typeof process.threadId === 'number' ? process.threadId : 'main'})`,
  );
  return ort;
}

/**
 * Create an inference session, preferring DirectML when available.
 *
 * The first call probes DML with the real model path: if creation succeeds we
 * cache `dml`; on any failure we fall back to CPU (and cache `cpu`). Later
 * calls reuse the cached provider. A model that works on DML but fails for
 * another reason (bad file) will surface the CPU retry error as-is.
 */
export async function createSession(modelPath: string): Promise<any> {
  const ort = loadOnnx();
  if (probed) {
    // eslint-disable-next-line no-console
    console.log(`[onnx] using ${probed} for ${modelPath}`);
    return ort.InferenceSession.create(modelPath, {
      executionProviders: [probed],
    });
  }
  // Probe with the real model — empty paths can't distinguish "no DML" from
  // "file missing".
  try {
    const session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['dml'],
    });
    probed = 'dml';
    // eslint-disable-next-line no-console
    console.log(`[onnx] dml OK for ${modelPath}`);
    return session;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[onnx] dml unavailable, using cpu: ${e instanceof Error ? e.message : String(e)}`,
    );
    probed = 'cpu';
    return ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
    });
  }
}

/** Reset the cached provider (used in tests / after GPU changes). */
export function resetProviderCache(): void {
  probed = null;
}
