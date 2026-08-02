#!/usr/bin/env node
/**
 * ffmpeg/download-ffmpeg.mjs — Download FFmpeg (gyan.dev static builds) for Windows.
 *
 * Fetches the essentials zip from www.gyan.dev, extracts it, and copies
 * ffmpeg.exe / ffprobe.exe / ffplay.exe + LICENSE into this ffmpeg/ folder.
 * Requires no third-party npm packages (uses bsdtar / PowerShell to unzip).
 *
 * Usage:
 *   node ffmpeg/download-ffmpeg.mjs
 *   FFMPEG_URL=https://www.gyan.dev/ffmpeg/builds/ffmpeg-git-essentials.zip node ...
 *
 * Source: https://www.gyan.dev/ffmpeg/builds/  (GPL v3 static builds)
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FFMPEG_URL =
  process.env.FFMPEG_URL ||
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

/** HEAD with redirect following — resolve the real content-length. */
function getLength(url) {
  return new Promise((resolve) => {
    const fetchHead = (u) => {
      const req = https.get(
        u,
        {
          headers: { 'User-Agent': 'Necokara-ffmpeg-download' },
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
    fetchHead(url);
  });
}

/** Download to a file (redirect following + progress). */
async function download(url, destPath) {
  const total = await getLength(url);
  await new Promise((resolve, reject) => {
    const doRequest = (u) => {
      const req = https.get(
        u,
        { headers: { 'User-Agent': 'Necokara-ffmpeg-download' } },
        (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            doRequest(new URL(res.headers.location, u).toString());
            return;
          }
          if (res.statusCode !== 200 && res.statusCode !== 206) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode} for ${u}`));
            return;
          }
          const fileSize = Number(res.headers['content-length']) || total || 0;
          let received = 0;
          const out = fs.createWriteStream(destPath);
          res.on('data', (chunk) => {
            received += chunk.length;
            const pct =
              fileSize > 0 ? ((received / fileSize) * 100).toFixed(1) : '?';
            const mb = (received / 1048576).toFixed(1);
            process.stdout.write(`\r  downloading ${mb}MB  (${pct}%)   `);
          });
          res.pipe(out);
          out.on('finish', () => {
            process.stdout.write('\n');
            out.close(resolve);
          });
          out.on('error', reject);
        },
      );
      req.on('error', reject);
    };
    doRequest(url);
  });
}

/** Extract a zip using bsdtar (Windows 10+) or PowerShell Expand-Archive. */
function unzip(zipPath, destDir) {
  const tar = spawnSync('tar', ['-xf', zipPath, '-C', destDir], {
    stdio: 'pipe',
  });
  if (tar.status === 0) return;
  const pw = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
    ],
    { stdio: 'pipe' },
  );
  if (pw.status !== 0) {
    throw new Error(
      'Failed to extract zip: ' +
        (pw.stderr?.toString() || pw.stdout?.toString() || 'unknown'),
    );
  }
}

/** Recursively copy a directory tree. */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function main() {
  const zipPath = path.join(__dirname, '.ffmpeg-download.zip');
  const tmpExtract = path.join(os.tmpdir(), `necokara-ffmpeg-${Date.now()}`);
  try {
    console.log('Downloading FFmpeg (gyan.dev essentials build)...');
    console.log('  source:', FFMPEG_URL);
    await download(FFMPEG_URL, zipPath);

    console.log('Extracting...');
    fs.mkdirSync(tmpExtract, { recursive: true });
    unzip(zipPath, tmpExtract);

    // Find files of interest inside the extracted tree.
    const exes = [];
    let licenseFile = null;
    let readmeFile = null;
    let presetsDir = null;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name.toLowerCase() === 'presets') presetsDir = p;
          walk(p);
        } else {
          if (/\.exe$/i.test(e.name)) exes.push(p);
          else if (/^license$/i.test(e.name)) licenseFile = p;
          else if (/^readme/i.test(e.name)) readmeFile = p;
        }
      }
    };
    walk(tmpExtract);

    // Copy executables into ffmpeg/bin/.
    const binDir = path.join(__dirname, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    for (const exe of exes) {
      const dest = path.join(binDir, path.basename(exe));
      fs.copyFileSync(exe, dest);
      console.log('  ->', path.relative(__dirname, dest));
    }

    // Copy LICENSE / README.txt / presets.
    if (licenseFile)
      fs.copyFileSync(licenseFile, path.join(__dirname, 'LICENSE'));
    if (readmeFile)
      fs.copyFileSync(readmeFile, path.join(__dirname, 'README.txt'));
    if (presetsDir) copyDir(presetsDir, path.join(__dirname, 'presets'));

    console.log('Done. FFmpeg installed into', __dirname);
  } finally {
    for (const p of [zipPath, tmpExtract]) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((err) => {
  console.error('[download-ffmpeg]', err);
  process.exit(1);
});
