#!/usr/bin/env node
/**
 * models/download-model.mjs — Download AI models from a mirror (bring-your-own policy)
 *
 * Necokara does NOT ship models with the app; users download them into models/ via
 * this script, then point the app's Resource Config at the model directory.
 *
 * Usage:
 *   node models/download-model.mjs             download all models
 *   node models/download-model.mjs vocal       download a specific model by key
 *   node models/download-model.mjs --list      list available models
 *   HF_MIRROR=https://hf-mirror.com node ...    override the mirror (default hf-mirror.com)
 *
 * Features: resumable downloads (.part files), progress display, redirect following.
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIRROR = process.env.HF_MIRROR || 'https://hf-mirror.com';

/**
 * Model manifest: key → { repo, file|files, dir, note, license }
 * - dir is a sub-directory under models/ (for organization)
 * - single file uses `file`; multiple files use `files` (paths relative to repo root, may include subdirs)
 * - add a new model by adding one entry here
 */
const MODELS = {
  vocal: {
    repo: 'Eddycrack864/UVR5-MDX-NET-VIP-MODELS',
    file: 'UVR-MDX-NET_Main_438.onnx',
    dir: 'separate',
    note: 'Vocal separation (MDX-Net vocals)',
    license: 'OpenRAIL (commercial use permitted; verify yourself)',
  },
  whisper: {
    repo: 'onnx-community/whisper-base_timestamped',
    files: [
      'onnx/encoder_model.onnx',
      'onnx/decoder_model.onnx',
      'onnx/decoder_with_past_model.onnx',
      'config.json',
      'generation_config.json',
      'preprocessor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'vocab.json',
      'special_tokens_map.json',
      'normalizer.json',
      'merges.txt',
      'added_tokens.json',
    ],
    dir: 'whisper',
    note: 'Whisper base timestamped (multilingual incl. Japanese) ONNX: ASR + word-level timestamps',
    license:
      'MIT (derived from openai/whisper-base; the onnx-community conversion has no explicit license tag)',
  },
};

function listModels() {
  console.log('Available models:');
  for (const [key, m] of Object.entries(MODELS)) {
    console.log(`  ${key.padEnd(8)} ${m.note}`);
    console.log(
      `           ${m.repo} / ${m.files ? m.files[0] : m.file} (${m.license})`,
    );
  }
}

/** Resolve Content-Length, preferring the value given by the mirror. Follows
 * redirects (the mirror resolve endpoint redirects to a CDN), otherwise HEAD
 * returns the small 302 body length and the progress % explodes. */
function getLength(remoteUrl, headers = {}) {
  return new Promise((resolve) => {
    const fetchHead = (u) => {
      const req = https.get(
        u,
        {
          headers: { 'User-Agent': 'Necokara-model-download', ...headers },
          method: 'HEAD',
        },
        (res) => {
          res.resume();
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            fetchHead(new URL(res.headers.location, u).toString());
            return;
          }
          resolve(Number(res.headers['content-length']) || 0);
        },
      );
      req.on('error', () => resolve(0));
    };
    fetchHead(remoteUrl);
  });
}

/** Download a single file (redirect following + resume support) */
async function downloadFile(url, destPath) {
  const tmpPath = `${destPath}.part`;
  let startByte = 0;
  if (fs.existsSync(tmpPath)) {
    startByte = fs.statSync(tmpPath).size;
  }
  const total = await getLength(
    url,
    startByte > 0 ? { Range: `bytes=${startByte}-` } : {},
  );

  await new Promise((resolve, reject) => {
    const doRequest = (u) => {
      const headers = { 'User-Agent': 'Necokara-model-download' };
      if (startByte > 0) headers.Range = `bytes=${startByte}-`;

      const req = https.get(u, { headers }, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          // follow redirects (the mirror resolve endpoint may redirect to a CDN)
          const next = new URL(res.headers.location, u).toString();
          doRequest(next);
          return;
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          return;
        }
        // prefer the real content-length from the final (200/206) response —
        // the HEAD-derived `total` may be stale after a redirect
        const fileSize = Number(res.headers['content-length']) || total || 0;
        let received = startByte;
        const out = fs.createWriteStream(tmpPath, {
          flags: startByte > 0 ? 'a' : 'w',
        });
        res.on('data', (chunk) => {
          received += chunk.length;
          const pct =
            fileSize > 0 ? ((received / fileSize) * 100).toFixed(1) : '?';
          const mb = (received / 1048576).toFixed(1);
          process.stdout.write(
            `\r  downloading ${mb}MB  (${pct}%)${fileSize > 0 ? '' : ' '}   `,
          );
        });
        res.pipe(out);
        out.on('finish', () => {
          process.stdout.write('\n');
          out.close(() => {
            fs.renameSync(tmpPath, destPath);
            resolve();
          });
        });
        out.on('error', reject);
      });
      req.on('error', reject);
    };
    doRequest(url);
  });
}

async function download(key) {
  const m = MODELS[key];
  if (!m) {
    console.error(`Unknown model key: ${key}`);
    listModels();
    process.exit(1);
  }
  const destDir = path.join(__dirname, m.dir);
  fs.mkdirSync(destDir, { recursive: true });

  // multi-file models (files array; keep relative sub-paths)
  const relFiles = m.files ? m.files : [m.file];

  for (const rel of relFiles) {
    const destPath = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    if (fs.existsSync(destPath)) {
      console.log(
        `Already exists, skipping: ${path.relative(__dirname, destPath)}`,
      );
      continue;
    }

    const url = `${MIRROR}/${m.repo}/resolve/main/${rel}`;
    console.log(`[${key}] ${m.note}`);
    console.log(`  source: ${url}`);
    console.log(`  target: ${path.relative(__dirname, destPath)}`);
    try {
      await downloadFile(url, destPath);
      console.log(`Done: ${path.relative(__dirname, destPath)}`);
    } catch (err) {
      console.error(`\nDownload failed: ${err.message}`);
      process.exit(1);
    }
  }
}

async function main() {
  const arg = process.argv[2];
  if (arg === '--list' || arg === '-l') {
    listModels();
    return;
  }
  if (arg) {
    await download(arg);
    return;
  }
  for (const key of Object.keys(MODELS)) {
    await download(key);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
