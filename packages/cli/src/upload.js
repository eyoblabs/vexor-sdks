import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { apiRequest } from './api.js';
import { colorize } from './brand.js';
import { readUploadState, saveUploadState } from './config.js';
import { formatBytes } from './format.js';

const mimeTypes = new Map([
  ['.3gp', 'video/3gpp'], ['.avi', 'video/x-msvideo'], ['.m4v', 'video/x-m4v'],
  ['.mkv', 'video/x-matroska'], ['.mov', 'video/quicktime'], ['.mp4', 'video/mp4'],
  ['.mpeg', 'video/mpeg'], ['.mpg', 'video/mpeg'], ['.mxf', 'application/octet-stream'],
  ['.ts', 'video/mp2t'], ['.webm', 'video/webm'], ['.wmv', 'video/x-ms-wmv'],
]);

export async function uploadVideo(filePath, { config, concurrency = 4, signal, onProgress }) {
  const absolutePath = path.resolve(filePath);
  let fileInfo;
  try { fileInfo = await stat(absolutePath); } catch (error) {
    throw new Error(`Cannot open video file ${absolutePath}: ${error.message}`);
  }
  if (!fileInfo.isFile()) throw new Error('Upload path must point to a file.');
  if (fileInfo.size <= 0) throw new Error('Cannot upload an empty file.');
  const filename = path.basename(absolutePath);
  if (filename.length > 255) throw new Error('Filename is longer than Vexor’s 255-character limit.');
  const mimeType = mimeTypes.get(path.extname(filename).toLowerCase()) || 'application/octet-stream';
  const state = await readUploadState();
  const stateKey = `${config.apiUrl}\n${absolutePath}\n${fileInfo.size}\n${Math.trunc(fileInfo.mtimeMs)}`;
  let record = state[stateKey];
  let session;

  if (record?.id) {
    try {
      const result = await apiRequest(`/v1/uploads/direct/${encodeURIComponent(record.id)}`, { config, signal });
      session = { ...record, ...result.data };
      onProgress?.({ phase: 'resume', message: 'Resuming the existing upload session.' });
    } catch (error) {
      if (error.status !== 404 && error.status !== 410) throw error;
      delete state[stateKey];
      record = undefined;
    }
  }

  if (!session) {
    let result;
    try {
      result = await apiRequest('/v1/uploads/direct', {
        config,
        method: 'POST',
        body: JSON.stringify({ filename, mime_type: mimeType, file_size: fileInfo.size }),
        signal,
      });
    } catch (error) {
      if (error.status === 404) throw new Error('Direct uploads are not enabled for this Vexor environment. Ask the Vexor operator to enable direct S3 uploads, or upload from the console.');
      throw error;
    }
    session = result.data;
    if (!session?.id || !Number.isSafeInteger(Number(session.part_size)) || Number(session.part_size) <= 0) {
      throw new Error('Vexor returned an invalid upload session.');
    }
    record = {
      id: session.id,
      tus_id: session.tus_id,
      part_size: Number(session.part_size),
      file_size: fileInfo.size,
      filename,
    };
    state[stateKey] = record;
    await saveUploadState(state);
  }

  if (session.status === 'completed') {
    const asset = await findAsset(config, session.tus_id, signal);
    delete state[stateKey];
    await saveUploadState(state);
    return asset;
  }
  if (session.status && session.status !== 'uploading') {
    throw new Error(`Upload session is ${session.status}. Start a fresh upload after resolving this session.`);
  }
  if (Number(session.file_size || record.file_size) !== fileInfo.size) {
    throw new Error('The local file size changed after this upload began; use the original file to resume it.');
  }

  const partSize = Number(session.part_size || record.part_size);
  const partCount = Math.ceil(fileInfo.size / partSize);
  const remoteParts = new Map((session.parts || []).map((part) => [Number(part.part_number), Number(part.size)]));
  let uploadedBytes = 0;
  const pending = [];
  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    const start = (partNumber - 1) * partSize;
    const length = Math.min(partSize, fileInfo.size - start);
    if (remoteParts.get(partNumber) === length) uploadedBytes += length;
    else pending.push({ partNumber, start, length });
  }
  onProgress?.({ phase: 'upload', uploadedBytes, totalBytes: fileInfo.size });

  const batchSize = Math.max(concurrency, Math.min(32, concurrency * 4));
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    const signed = await signParts(config, session.id, batch.map((part) => part.partNumber), signal);
    await runPool(batch, concurrency, async (part) => {
      let item = signed.get(part.partNumber);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (signal?.aborted) throw new DOMException('Upload interrupted.', 'AbortError');
        if (attempt > 0) item = (await signParts(config, session.id, [part.partNumber], signal)).get(part.partNumber);
        const partHeaders = new Headers(item.headers || {});
        partHeaders.set('Content-Length', String(part.length));
        const response = await fetch(item.url, {
          method: item.method || 'PUT',
          headers: partHeaders,
          body: createReadStream(absolutePath, { start: part.start, end: part.start + part.length - 1 }),
          duplex: 'half',
          redirect: 'error',
          signal,
        }).catch((error) => {
          if (error?.name === 'AbortError') throw error;
          return { ok: false, status: 0, statusText: error.message };
        });
        if (response.ok) {
          uploadedBytes += part.length;
          onProgress?.({ phase: 'upload', uploadedBytes, totalBytes: fileInfo.size });
          return;
        }
        if (attempt === 2) throw new Error(`Storage rejected upload part ${part.partNumber} (HTTP ${response.status || response.statusText}).`);
        await delay(500 * (attempt + 1), signal);
      }
    }, signal);
  }

  onProgress?.({ phase: 'complete', uploadedBytes: fileInfo.size, totalBytes: fileInfo.size });
  await apiRequest(`/v1/uploads/direct/${encodeURIComponent(session.id)}/complete`, {
    config, method: 'POST', body: '{}', signal,
  });
  const asset = await findAsset(config, session.tus_id || record.tus_id, signal);
  delete state[stateKey];
  await saveUploadState(state);
  return asset;
}

async function signParts(config, sessionId, partNumbers, signal) {
  const result = await apiRequest(`/v1/uploads/direct/${encodeURIComponent(sessionId)}/parts`, {
    config,
    method: 'POST',
    body: JSON.stringify({ parts: partNumbers }),
    signal,
  });
  const entries = result.data?.parts;
  if (!Array.isArray(entries)) throw new Error('Vexor did not return signed upload URLs.');
  return new Map(entries.map((part) => [Number(part.part_number), part]));
}

async function findAsset(config, tusId, signal) {
  if (!tusId) throw new Error('Upload completed, but Vexor did not return its upload reference. Find the asset with `vexor assets list`.');
  const result = await apiRequest(`/v1/assets/by-upload/${encodeURIComponent(tusId)}`, { config, signal });
  return result.data;
}

async function runPool(items, concurrency, operation, signal) {
  let cursor = 0;
  let failure;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure && cursor < items.length) {
      if (signal?.aborted) throw new DOMException('Upload interrupted.', 'AbortError');
      const item = items[cursor++];
      try { await operation(item); } catch (error) { failure = error; }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException('Upload interrupted.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function uploadProgressText(progress, frame = 0) {
  const packets = ['▰···', '·▰··', '··▰·', '···▰'];
  const packet = colorize(packets[frame % packets.length]);
  if (progress.phase === 'starting') return `${packet} Preparing a resumable upload…`;
  if (progress.phase === 'resume') return `${packet} ${progress.message}`;
  if (progress.phase === 'complete') return `${packet} Uploaded ${formatBytes(progress.totalBytes)}. Finalizing with Vexor…`;
  const percent = Math.min(100, Math.floor((progress.uploadedBytes / progress.totalBytes) * 100));
  const width = 22;
  const filled = Math.round((percent / 100) * width);
  return `${packet} [${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${String(percent).padStart(3)}%  ${formatBytes(progress.uploadedBytes)} / ${formatBytes(progress.totalBytes)}  SENDING CHUNKS`;
}
