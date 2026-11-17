#!/usr/bin/env node

/**
 * Vexor Video Pipeline - Official GitHub Action
 * Uploads, transcodes, imports, and previews HLS videos in CI/CD workflows.
 * Zero external dependencies (uses native Node.js 20+ runtime).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const MIME_TYPES = new Map([
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.mkv', 'video/x-matroska'],
  ['.webm', 'video/webm'],
  ['.avi', 'video/x-msvideo'],
  ['.m4v', 'video/x-m4v'],
  ['.ts', 'video/mp2t'],
]);

export function validateApiUrl(value, { allowLoopback = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error('api_url must be a valid URL.'); }

  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('api_url must be an origin URL without credentials, path, query, or fragment.');
  }

  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const officialApi = url.hostname === 'api.vexor.et' && (url.port === '' || url.port === '443');
  const allowedLoopback = allowLoopback && loopback && (url.protocol === 'http:' || url.protocol === 'https:');

  if (!officialApi && !allowedLoopback) {
    throw new Error('api_url must use the official https://api.vexor.et endpoint.');
  }
  if (officialApi && url.protocol !== 'https:') {
    throw new Error('The official Vexor API must use HTTPS.');
  }
  return url.origin;
}

export function validateSignedUploadUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Vexor returned an invalid signed upload URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Vexor signed upload URLs must use HTTPS and contain no credentials.');
  return url.toString();
}

async function safeFetch(url, options = {}) {
  return fetch(url, { ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(30_000) });
}

function assertSafeFilename(filename) {
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 255 ||
      /[\/\\\x00-\x1f\x7f]/.test(filename) || filename === '.' || filename === '..') {
    throw new Error('filename must be a plain filename (max 255 characters) without path separators or control characters.');
  }
  return filename;
}

function assertAsset(asset) {
  if (!asset || typeof asset !== 'object' || typeof asset.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(asset.id) ||
      typeof asset.state !== 'string' || !/^[a-z_ -]{1,40}$/i.test(asset.state)) {
    throw new Error('Vexor returned an invalid asset response.');
  }
  return asset;
}

function safePublicUrl(value, base) {
  let url;
  try { url = new URL(value, base); } catch { throw new Error('Vexor returned an invalid public URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Vexor returned an unsafe public URL.');
  }
  return url.toString();
}


export function getInput(name, required = false, defaultValue = '') {
  const envName = `INPUT_${name.toUpperCase().replace(/-/g, '_')}`;
  const val = process.env[envName];
  if (!val || val.trim() === '') {
    if (required) {
      throw new Error(`Input required and not supplied: ${name}`);
    }
    return defaultValue;
  }
  return val.trim();
}

function escapeWorkflowCommandData(value) {
  return String(value ?? '').replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function setOutput(name, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) throw new Error('Invalid GitHub Actions output name.');
  const outputFile = process.env.GITHUB_OUTPUT;
  const strVal = String(value ?? '');
  if (outputFile) {
    let delimiter;
    do { delimiter = `vexor_${randomUUID()}`; } while (strVal.includes(delimiter));
    fs.appendFileSync(outputFile, `${name}<<${delimiter}\n${strVal}\n${delimiter}\n`, 'utf8');
  } else {
    const safeValue = escapeWorkflowCommandData(strVal);
    console.log(`::set-output name=${name}::${safeValue}`);
  }
}

export function addMask(value) {
  if (value && typeof value === 'string') {
    console.log(`::add-mask::${escapeWorkflowCommandData(value)}`);
  }
}

export function setFailed(message) {
  console.error(`::error::${escapeWorkflowCommandData(message)}`);
  process.exitCode = 1;
}

/**
 * Poll an asset until it is ready, failed, or the timeout expires.
 * pollIntervalMs and the injected functions keep this helper deterministic in tests.
 */
export async function waitForAssetReady({
  asset,
  apiUrl,
  headers,
  timeoutMs,
  pollIntervalMs = 4000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  if (asset?.state === 'failed') {
    throw new Error('Video processing failed on Vexor. Check the asset details in your Vexor dashboard.');
  }
  if (asset?.state === 'ready') return asset;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error('timeoutMs must be a positive finite number.');
  }
  const deadline = Date.now() + timeoutMs;
  console.log(`\x1b[36mℹ Waiting for adaptive HLS transcoding ladder to complete (timeout: ${Math.ceil(timeoutMs / 60000)}m)...\x1b[0m`);

  while (asset.state !== 'ready' && asset.state !== 'failed') {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Timed out waiting for Vexor asset ${asset.id} after ${Math.ceil(timeoutMs / 1000)} seconds (last state: ${asset.state || 'unknown'}). Increase timeout_minutes or set wait_for_ready: false to continue asynchronously.`);
    }

    await sleep(Math.min(pollIntervalMs, remaining));
    if (Date.now() >= deadline) break;

    const pollRes = await fetchImpl(`${apiUrl}/v1/assets/${encodeURIComponent(asset.id)}`, { headers, redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - Date.now()))) });
    if (!pollRes.ok) {
      throw new Error(`Could not check Vexor asset status (HTTP ${pollRes.status}).`);
    }

    const pollData = await pollRes.json();
    const polledAsset = assertAsset(pollData?.data);
    if (polledAsset.id !== asset.id) {
      throw new Error('Vexor returned a different asset while checking processing status.');
    }
    asset = polledAsset;
    const stage = typeof asset.processing_stage === 'string' && /^[a-z0-9 _-]{1,40}$/i.test(asset.processing_stage)
      ? asset.processing_stage : 'transcoding';
    const rawPercent = Number(asset.progress_percent);
    const pct = Number.isFinite(rawPercent) ? Math.max(0, Math.min(100, Math.round(rawPercent))) : 0;
    process.stdout.write(`\r  Processing: ${pct}% [Stage: ${stage}, State: ${asset.state}] `);

    if (asset.state === 'failed') {
      throw new Error('Video processing failed on Vexor. Check the asset details in your Vexor dashboard.');
    }
  }

  if (asset.state === 'ready') {
    console.log('\n\x1b[32m✔ Transcoding complete! HLS master manifest and AES-128 keys published.\x1b[0m');
    return asset;
  }

  throw new Error(`Timed out waiting for Vexor asset ${asset.id} (last state: ${asset.state || 'unknown'}).`);
}

export async function run() {
  try {
    const apiKey = getInput('api_key', true);
    addMask(apiKey);

    const apiUrl = validateApiUrl(getInput('api_url', false, 'https://api.vexor.et'));
    const videoPath = getInput('video_path', false) || getInput('file_path', false);
    const connectionId = getInput('connection_id', false);
    const objectKey = getInput('object_key', false);
    const customFilename = getInput('filename', false);
    const waitForReadyInput = getInput('wait_for_ready', false, 'true').toLowerCase();
    if (!['true', 'false'].includes(waitForReadyInput)) throw new Error('wait_for_ready must be true or false.');
    const waitForReady = waitForReadyInput === 'true';
    const enhanceUpscaleInput = getInput('enhance_upscale', false, 'false').toLowerCase();
    if (!['true', 'false'].includes(enhanceUpscaleInput)) throw new Error('enhance_upscale must be true or false.');
    const enhanceUpscale = enhanceUpscaleInput === 'true';
    const enhanceTier = getInput('enhance_tier', false, 'none').toLowerCase();
    if (!['none', '1080p', '4k'].includes(enhanceTier)) throw new Error('enhance_tier must be none, 1080p, or 4k.');
    const commentOnPRInput = getInput('comment_on_pr', false, 'false').toLowerCase();
    if (!['true', 'false'].includes(commentOnPRInput)) throw new Error('comment_on_pr must be true or false.');
    const commentOnPR = commentOnPRInput === 'true';
    const timeoutInput = getInput('timeout_minutes', false, '15');
    if (!/^\d+$/.test(timeoutInput) || Number(timeoutInput) < 1 || Number(timeoutInput) > 120) {
      throw new Error('timeout_minutes must be a whole number between 1 and 120.');
    }
    const timeoutMinutes = Number(timeoutInput);
    const githubToken = getInput('github_token', false, process.env.GITHUB_TOKEN || '');
    addMask(githubToken);

    const hasCloudImportInput = Boolean(connectionId || objectKey);
    if (videoPath && hasCloudImportInput) {
      throw new Error('Choose either video_path or connection_id and object_key; do not combine upload modes.');
    }
    if (!videoPath && (!connectionId || !objectKey)) {
      throw new Error('Either video_path (for direct upload) or both connection_id and object_key (for cloud import) must be provided.');
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Vexor-GitHub-Action/1.0',
    };

    let asset;

    // Mode 1: Cloud Storage Import
    if (connectionId && objectKey) {
      console.log(`\x1b[36mℹ Importing video from connected storage (connected storage source)...\x1b[0m`);
      const importPayload = {
        connection_id: connectionId,
        object_key: objectKey,
        ...(customFilename ? { filename: customFilename } : {}),
        enhance_upscale: enhanceUpscale,
        enhance_tier: enhanceTier !== 'none' ? enhanceTier : undefined,
      };

      const res = await safeFetch(`${apiUrl}/v1/assets/imports`, {
        method: 'POST',
        headers,
        body: JSON.stringify(importPayload),
      });

      if (!res.ok) {
        throw new Error(`Vexor import failed (HTTP ${res.status}).`);
      }

      const body = await res.json();
      asset = assertAsset(body.data);
      console.log(`\x1b[32m✔ Import accepted! Asset ID: ${asset.id}\x1b[0m`);
    } else {
      // Mode 2: Local Video Upload
      const absolutePath = path.resolve(videoPath);
      let fileStat;
      try {
        fileStat = await stat(absolutePath);
      } catch (err) {
        throw new Error(`Cannot open video file at ${absolutePath}: ${err.message}`);
      }

      if (!fileStat.isFile()) {
        throw new Error(`Video path is not a file: ${absolutePath}`);
      }
      if (fileStat.size <= 0) {
        throw new Error('Video file is empty.');
      }

      const filename = assertSafeFilename(customFilename || path.basename(absolutePath));
      const ext = path.extname(filename).toLowerCase();
      const mimeType = MIME_TYPES.get(ext) || 'application/octet-stream';

      console.log(`\x1b[36mℹ Initiating direct upload for "${filename}" (${(fileStat.size / (1024 * 1024)).toFixed(2)} MB)...\x1b[0m`);

      const sessionRes = await safeFetch(`${apiUrl}/v1/uploads/direct`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filename,
          mime_type: mimeType,
          file_size: fileStat.size,
        }),
      });

      if (!sessionRes.ok) {
        throw new Error(`Upload session creation failed (HTTP ${sessionRes.status}).`);
      }

      const sessionData = await sessionRes.json();
      const session = sessionData.data;
      if (!session || typeof session.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(session.id) ||
          typeof session.tus_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(session.tus_id)) {
        throw new Error('Vexor returned an invalid upload session.');
      }
      const partSize = Number(session.part_size || 8 * 1024 * 1024);
      if (!Number.isSafeInteger(partSize) || partSize <= 0) throw new Error('Vexor returned an invalid upload part size.');
      const partCount = Math.ceil(fileStat.size / partSize);
      if (!Number.isSafeInteger(partCount) || partCount < 1 || partCount > 10_000) {
        throw new Error('Video requires an unsupported number of upload parts (maximum 10,000).');
      }

      console.log(`\x1b[36mℹ Uploading ${partCount} part(s) to secure storage origin...\x1b[0m`);

      // Sign parts
      const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1);
      const signRes = await safeFetch(`${apiUrl}/v1/uploads/direct/${encodeURIComponent(session.id)}/parts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ parts: partNumbers }),
      });

      if (!signRes.ok) {
        throw new Error(`Failed to sign upload parts (HTTP ${signRes.status})`);
      }

      const signData = await signRes.json();
      if (!Array.isArray(signData.data?.parts)) throw new Error('Vexor returned an invalid signed-parts response.');
      if (signData.data.parts.length !== partCount) {
        throw new Error('Vexor returned an incomplete or unexpected signed-parts response.');
      }
      const signedParts = new Map();
      for (const part of signData.data.parts) {
        const number = Number(part?.part_number);
        if (!Number.isSafeInteger(number) || number < 1 || number > partCount || signedParts.has(number)) {
          throw new Error('Vexor returned duplicate or invalid upload part numbers.');
        }
        signedParts.set(number, part);
      }

      let uploadedBytes = 0;
      for (const partNum of partNumbers) {
        const partInfo = signedParts.get(partNum);
        if (!partInfo) throw new Error(`Missing signed URL for part ${partNum}`);

        const start = (partNum - 1) * partSize;
        const length = Math.min(partSize, fileStat.size - start);

        const signedUrl = validateSignedUploadUrl(partInfo.url);
        const method = String(partInfo.method || 'PUT').toUpperCase();
        if (method !== 'PUT') throw new Error('Vexor returned an unsupported signed upload method.');
        const partHeaders = new Headers(partInfo.headers || {});
        for (const forbidden of ['authorization', 'cookie', 'host', 'content-length']) {
          if (partHeaders.has(forbidden)) throw new Error(`Vexor returned a forbidden upload header: ${forbidden}.`);
        }
        partHeaders.set('Content-Length', String(length));

        const partStream = createReadStream(absolutePath, { start, end: start + length - 1 });
        const uploadRes = await safeFetch(signedUrl, {
          method,
          headers: partHeaders,
          body: partStream,
          duplex: 'half',
        });

        if (!uploadRes.ok) {
          throw new Error(`Failed to upload part ${partNum} (HTTP ${uploadRes.status})`);
        }

        uploadedBytes += length;
        const pct = Math.floor((uploadedBytes / fileStat.size) * 100);
        process.stdout.write(`\r  Uploading: ${pct}% [${(uploadedBytes / (1024 * 1024)).toFixed(1)} / ${(fileStat.size / (1024 * 1024)).toFixed(1)} MB]`);
      }
      console.log('\n\x1b[32m✔ Parts uploaded. Finalizing session...\x1b[0m');

      // Complete session
      const completeRes = await safeFetch(`${apiUrl}/v1/uploads/direct/${encodeURIComponent(session.id)}/complete`, {
        method: 'POST',
        headers,
        body: '{}',
      });

      if (!completeRes.ok) {
        throw new Error(`Failed to complete upload session (HTTP ${completeRes.status})`);
      }

      // Fetch asset
      const assetRes = await safeFetch(`${apiUrl}/v1/assets/by-upload/${encodeURIComponent(session.tus_id)}`, {
        headers,
      });

      if (!assetRes.ok) {
        throw new Error(`Failed to load asset after upload (HTTP ${assetRes.status})`);
      }

      const assetData = await assetRes.json();
      asset = assertAsset(assetData.data);
      console.log(`\x1b[32m✔ Upload completed! Asset ID: ${asset.id}\x1b[0m`);
    }

    // A failed state is always a failed action, even when asynchronous waiting is disabled.
    asset = assertAsset(asset);
    if (asset.state === 'failed') {
      throw new Error('Video processing failed on Vexor. Check the asset details in your Vexor dashboard.');
    }

    // Wait for transcoding if enabled. A timeout is a failure so downstream
    // deployment steps cannot accidentally publish an unready video.
    if (waitForReady && asset?.id) {
      asset = await waitForAssetReady({
        asset,
        apiUrl,
        headers,
        timeoutMs: timeoutMinutes * 60 * 1000,
      });
    }

    // Derive public URLs
    asset = assertAsset(asset);
    const webOrigin = new URL(apiUrl).hostname === 'api.vexor.et' ? 'https://vexor.et' : apiUrl;
    const playbackUrl = safePublicUrl(`${apiUrl}/v1/assets/${encodeURIComponent(asset.id)}/hls/master.m3u8`);
    const embedUrl = safePublicUrl(`${webOrigin}/embed/${encodeURIComponent(asset.id)}`);
    const embedIframe = `<iframe src="${embedUrl}" width="100%" height="450" frameborder="0" allowfullscreen></iframe>`;
    const thumbnailUrl = safePublicUrl(asset.thumbnail_path || `${apiUrl}/v1/assets/${encodeURIComponent(asset.id)}/thumbnail.jpg`, apiUrl);

    // Set GitHub step outputs
    setOutput('asset_id', asset.id);
    setOutput('state', asset.state);
    setOutput('playback_url', playbackUrl);
    setOutput('embed_url', embedUrl);
    setOutput('embed_iframe', embedIframe);
    setOutput('thumbnail_url', thumbnailUrl);
    setOutput('duration_seconds', asset.duration_seconds || 0);

    console.log('\n\x1b[32m═══════════════════════════════════════════════════════════════════\x1b[0m');
    console.log(`\x1b[1m🎬 VEXOR VIDEO PIPELINE SUMMARY\x1b[0m`);
    console.log(`  Asset ID:          ${asset.id}`);
    console.log(`  State:             ${asset.state}`);
    console.log(`  Duration:          ${asset.duration_seconds ? `${asset.duration_seconds}s` : 'Calculating'}`);
    console.log(`  Embed URL:         ${embedUrl}`);
    console.log(`  HLS Playback URL:  ${playbackUrl}`);
    console.log('\x1b[32m═══════════════════════════════════════════════════════════════════\x1b[0m\n');

    // Post PR comment if requested and in PR context
    if (commentOnPR && githubToken) {
      await handlePRComment({
        asset,
        embedUrl,
        playbackUrl,
        embedIframe,
        thumbnailUrl,
        githubToken,
      });
    }

    return asset;
  } catch (err) {
    setFailed(err instanceof Error ? err.message : String(err));
  }
}

export async function handlePRComment({
  asset,
  embedUrl,
  playbackUrl,
  embedIframe,
  thumbnailUrl,
  githubToken,
}) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    console.log('Skipping PR comment: GITHUB_EVENT_PATH not available.');
    return;
  }

  try {
    const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    const prNumber = eventData.pull_request?.number;
    const repoFullName = eventData.repository?.full_name || process.env.GITHUB_REPOSITORY;

    if (!Number.isSafeInteger(prNumber) || prNumber < 1 ||
        typeof repoFullName !== 'string' ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoFullName) ||
        repoFullName.split('/').some((part) => part === '.' || part === '..')) {
      console.log('Skipping PR comment: Not running in a Pull Request context.');
      return;
    }

    console.log(`\x1b[36mℹ Posting video preview comment to PR #${prNumber} on ${repoFullName}...\x1b[0m`);

    const marker = '<!-- vexor-video-preview -->';
    const safeEmbedUrl = safePublicUrl(embedUrl);
    const safePlaybackUrl = safePublicUrl(playbackUrl);
    const safeThumbnailUrl = thumbnailUrl ? safePublicUrl(thumbnailUrl) : '';
    const safeAsset = assertAsset(asset);
    const safeDuration = Number.isFinite(Number(safeAsset.duration_seconds)) && Number(safeAsset.duration_seconds) >= 0
      ? Number(safeAsset.duration_seconds) : null;
    const safeState = /^[a-z_ -]{1,40}$/i.test(safeAsset.state) ? safeAsset.state : 'unknown';
    const safeIframe = `<iframe src="${safeEmbedUrl}" width="100%" height="450" frameborder="0" allowfullscreen></iframe>`;
    const previewImage = safeThumbnailUrl ? `[![Vexor video preview](${safeThumbnailUrl})](${safeEmbedUrl})\n\n` : '';
    const commentBody = `${marker}
### 🎬 Vexor video preview

${previewImage}| Property | Details |
|---|---|
| **Asset ID** | \`${safeAsset.id}\` |
| **Status** | **${safeState === 'ready' ? '✅ Ready for playback' : safeState}** |
| **Duration** | ${safeDuration !== null && safeDuration > 0 ? `${safeDuration} seconds` : 'Pending'} |
| **HLS stream** | [\`master.m3u8\`](${safePlaybackUrl}) |
| **Player** | [Open video preview](${safeEmbedUrl}) |

<details>
<summary>📋 Copy embed code</summary>

\`\`\`html
${safeIframe}
\`\`\`

</details>

*Updated automatically by [Vexor Video Pipeline](https://github.com/eyob13-coder/Vexor-)*`;

    const ghHeaders = {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Vexor-GitHub-Action/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const encodedRepo = repoFullName.split('/').map(encodeURIComponent).join('/');
    const commentsUrl = `https://api.github.com/repos/${encodedRepo}/issues/${prNumber}/comments?per_page=100`;
    const listRes = await safeFetch(commentsUrl, { headers: ghHeaders });
    if (!listRes.ok) {
      throw new Error(`Could not list PR comments (HTTP ${listRes.status}).`);
    }

    const comments = await listRes.json();
    const existing = Array.isArray(comments)
      ? comments.find((comment) => typeof comment.body === 'string' && comment.body.includes(marker))
      : null;

    const isUpdate = Boolean(existing?.id);
    const targetUrl = isUpdate
      ? `https://api.github.com/repos/${encodedRepo}/issues/comments/${existing.id}`
      : `https://api.github.com/repos/${encodedRepo}/issues/${prNumber}/comments`;
    const ghRes = await safeFetch(targetUrl, {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: ghHeaders,
      body: JSON.stringify({ body: commentBody }),
    });

    if (ghRes.ok) {
      console.log(`\x1b[32m✔ ${isUpdate ? 'Updated' : 'Posted'} Vexor preview comment on PR #${prNumber}.\x1b[0m`);
    } else {
      console.warn(`\x1b[33m⚠ Could not ${isUpdate ? 'update' : 'post'} PR comment (HTTP ${ghRes.status}).\x1b[0m`);
    }
  } catch (err) {
    console.warn(`\x1b[33m⚠ PR comment error: ${err.message}\x1b[0m`);
  }
}

// Auto-run if executed directly as main CLI
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  run();
}
