import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getInput, setOutput, run, handlePRComment, waitForAssetReady, validateApiUrl, validateSignedUploadUrl, addMask, setFailed } from '../src/index.js';


const tempDir = await mkdtemp(path.join(os.tmpdir(), 'vexor-gha-test-'));
const outputFile = path.join(tempDir, 'github_output');
process.env.GITHUB_OUTPUT = outputFile;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

try {
  // Test 1: getInput validation
  process.env.INPUT_SAMPLE_KEY = '  hello_world  ';
  assert.equal(getInput('sample_key'), 'hello_world', 'trims input whitespace');
  assert.equal(getInput('missing_key', false, 'default_val'), 'default_val', 'returns default value');
  assert.throws(() => getInput('missing_required', true), /Input required and not supplied/, 'throws on missing required input');


  // Test 1a: reject insecure API and signed-upload URLs.
  assert.throws(() => validateApiUrl('http://example.com'), /official https/);
  assert.throws(() => validateApiUrl('https://user:pass@example.com'), /credentials/);
  assert.equal(validateApiUrl('https://api.vexor.et'), 'https://api.vexor.et');
  assert.throws(() => validateApiUrl('https://attacker.example'), /official https:\/\/api.vexor.et/);
  assert.throws(() => validateApiUrl('https://api.vexor.et:8443'), /official https:\/\/api.vexor.et/);
  assert.throws(() => validateApiUrl('https://api.vexor.et.attacker.example'), /official https:\/\/api.vexor.et/);
  assert.throws(() => validateApiUrl('https://api.vexor.et/path'), /origin URL/);
  assert.throws(() => validateApiUrl('https://api.vexor.et?token=x'), /origin URL/);
  assert.throws(() => validateApiUrl('http://127.0.0.1:9000'), /official https:\/\/api.vexor.et/);
  assert.equal(validateApiUrl('http://127.0.0.1:9000', { allowLoopback: true }), 'http://127.0.0.1:9000');
  assert.throws(() => validateApiUrl('http://127.0.0.1:9000', { allowLoopback: false }), /official https:\/\/api.vexor.et/);
  assert.throws(() => validateSignedUploadUrl('http://storage.example/upload'), /HTTPS/);
  assert.throws(() => validateSignedUploadUrl('https://user:pass@storage.example/upload'), /HTTPS/);

  // Test 1b: wait_for_ready must fail immediately when its timeout is exhausted.
  await assert.rejects(
    waitForAssetReady({
      asset: { id: 'timeout-asset', state: 'processing' },
      apiUrl: 'https://api.vexor.et',
      headers: {},
      timeoutMs: 0,
    }),
    /Timed out waiting for Vexor asset timeout-asset/,
    'fails the action when the processing timeout expires',
  );

  // Test 1c: an initially failed asset is reported as a processing failure, not a timeout.
  await assert.rejects(
    waitForAssetReady({
      asset: { id: 'failed-asset', state: 'failed' },
      apiUrl: 'https://api.vexor.et',
      headers: {},
      timeoutMs: 1000,
    }),
    /Video processing failed on Vexor/,
  );

  // Test 1d: invalid boolean and conflicting mode inputs fail before network requests.
  process.env.INPUT_API_KEY = 'vx_live_test_key_123';
  process.env.INPUT_API_URL = 'https://api.vexor.et';
  process.env.INPUT_VIDEO_PATH = 'unused.mp4';
  process.env.INPUT_CONNECTION_ID = 'connection';
  process.env.INPUT_OBJECT_KEY = 'object.mp4';
  process.env.INPUT_WAIT_FOR_READY = 'sometimes';
  await run();
  assert.equal(process.exitCode, 1, 'rejects invalid boolean input');
  process.exitCode = 0;
  process.env.INPUT_WAIT_FOR_READY = 'true';
  await run();
  assert.equal(process.exitCode, 1, 'rejects mixed upload modes');
  process.exitCode = 0;
  delete process.env.INPUT_VIDEO_PATH;
  delete process.env.INPUT_CONNECTION_ID;
  delete process.env.INPUT_OBJECT_KEY;

  // Test 1e: GitHub workflow command data must not allow newline command injection.
  let maskedCommand = '';
  let failedCommand = '';
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  console.log = (value) => { maskedCommand += String(value); };
  console.error = (value) => { failedCommand += String(value); };
  addMask('secret-token\n::warning::injected%');
  setFailed('bad input\n::warning::injected%');
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  assert.equal(maskedCommand, '::add-mask::secret-token%0A::warning::injected%25');
  assert.equal(failedCommand, '::error::bad input%0A::warning::injected%25');
  process.exitCode = 0;

  // Test 2: setOutput writes to GITHUB_OUTPUT file
  setOutput('my_var', '12345');
  const written = fs.readFileSync(outputFile, 'utf8');
  assert.equal(written.includes('my_var<<vexor_'), true, 'writes output with a unique delimiter');
  assert.equal(written.includes('\n12345\n'), true, 'includes the output value');

  // Test 3: Mock Vexor API for Cloud Import mode using the official origin.
  const apiCalls = [];
  const originalImportFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    apiCalls.push({ method: options.method || 'GET', url: target });
    if (target === 'https://api.vexor.et/v1/assets/imports' && options.method === 'POST') {
      return new Response(JSON.stringify({ data: {
        id: 'test-asset-uuid-1234',
        state: 'ready',
        duration_seconds: 42,
        thumbnail_path: 'https://api.vexor.et/v1/assets/test-asset-uuid-1234/thumbnail.jpg',
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected import test request: ${options.method || 'GET'} ${target}`);
  };

  // Configure environment for run()
  process.env.INPUT_API_KEY = 'vx_live_test_key_123';
  process.env.INPUT_API_URL = 'https://api.vexor.et';
  process.env.INPUT_CONNECTION_ID = 'conn-uuid-5678';
  process.env.INPUT_OBJECT_KEY = 'videos/intro.mp4';
  process.env.INPUT_WAIT_FOR_READY = 'true';
  process.env.INPUT_TIMEOUT_MINUTES = '1';
  process.env.INPUT_COMMENT_ON_PR = 'false';

  const assetResult = await run();
  global.fetch = originalImportFetch;
  assert.equal(assetResult.id, 'test-asset-uuid-1234', 'returns imported asset id');
  assert.equal(assetResult.state, 'ready', 'returns ready state');
  assert.equal(apiCalls.length, 1, 'calls only the official Vexor API origin');

  const finalOutput = fs.readFileSync(outputFile, 'utf8');
  assert.equal(finalOutput.includes('asset_id<<vexor_'), true, 'uses a unique delimiter for multiline outputs');
  assert.equal(finalOutput.includes('test-asset-uuid-1234'), true, 'outputs asset_id value');
  assert.equal(finalOutput.includes('state<<vexor_'), true, 'writes state using a safe delimiter');
  assert.equal(finalOutput.includes('playback_url<<vexor_'), true, 'outputs playback_url using safe delimiter');
  assert.equal(finalOutput.includes('embed_iframe<<vexor_'), true, 'outputs embed iframe using safe delimiter');
  assert.equal(finalOutput.includes('<iframe src='), true, 'includes the embed iframe value');

  // Test 3a: exercise the complete direct-upload lifecycle without a real storage account.
  const videoFile = path.join(tempDir, 'sample.mp4');
  const videoBytes = Buffer.from('vexor-direct-upload-integration-test');
  await writeFile(videoFile, videoBytes);

  process.env.INPUT_VIDEO_PATH = videoFile;
  delete process.env.INPUT_CONNECTION_ID;
  delete process.env.INPUT_OBJECT_KEY;
  process.env.INPUT_API_URL = 'https://api.vexor.et';
  process.env.INPUT_WAIT_FOR_READY = 'true';

  const originalDirectFetch = global.fetch;
  let uploadedBytes = Buffer.alloc(0);
  const directCalls = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    directCalls.push({ url: target, method: options.method || 'GET' });

    if (target.endsWith('/v1/uploads/direct') && options.method === 'POST') {
      return new Response(JSON.stringify({ data: { id: 'session-1', tus_id: 'upload-1', part_size: 1024 } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (target.endsWith('/v1/uploads/direct/session-1/parts') && options.method === 'POST') {
      return new Response(JSON.stringify({ data: { parts: [
        { part_number: 1, url: 'https://storage.example/upload/part-1', method: 'PUT', headers: { 'x-test-signed': 'yes' } },
      ] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (target === 'https://storage.example/upload/part-1' && options.method === 'PUT') {
      const chunks = [];
      for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
      uploadedBytes = Buffer.concat(chunks);
      assert.equal(options.headers.get('content-length'), String(videoBytes.length));
      assert.equal(options.headers.get('x-test-signed'), 'yes');
      return new Response(null, { status: 200 });
    }
    if (target.endsWith('/v1/uploads/direct/session-1/complete') && options.method === 'POST') {
      return new Response(JSON.stringify({ data: { completed: true } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (target.endsWith('/v1/assets/by-upload/upload-1') && (options.method || 'GET') === 'GET') {
      return new Response(JSON.stringify({ data: {
        id: 'direct-upload-asset', state: 'ready', duration_seconds: 5,
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected direct-upload test request: ${options.method || 'GET'} ${target}`);
  };

  const directAsset = await run();
  global.fetch = originalDirectFetch;
  assert.equal(directAsset.id, 'direct-upload-asset');
  assert.deepEqual(uploadedBytes, videoBytes, 'uploads the exact bytes read from the source file');
  assert.equal(directCalls.some((call) => call.url.endsWith('/complete')), true, 'finalizes the upload session');
  assert.equal(directCalls.some((call) => call.url.endsWith('/by-upload/upload-1')), true, 'fetches the created asset');

  delete process.env.INPUT_VIDEO_PATH;

  // Test 4: PR Comment payload construction
  const eventPayload = {
    pull_request: { number: 42 },
    repository: { full_name: 'test-org/test-repo' },
  };
  const eventFilePath = path.join(tempDir, 'event.json');
  await writeFile(eventFilePath, JSON.stringify(eventPayload));
  process.env.GITHUB_EVENT_PATH = eventFilePath;

  let githubCommentCall = null;
  const mockGithubServer = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      githubCommentCall = { method: req.method, url: req.url, body: JSON.parse(body) };
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 999 }));
    });
  });

  const ghPort = await listen(mockGithubServer);

  // Override fetch URL for GitHub testing
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (typeof url === 'string' && url.startsWith('https://api.github.com/')) {
      const redirectedUrl = url.replace('https://api.github.com', `http://127.0.0.1:${ghPort}`);
      return originalFetch(redirectedUrl, options);
    }
    return originalFetch(url, options);
  };

  await handlePRComment({
    asset: { id: 'test-asset-42', state: 'ready', duration_seconds: 60 },
    embedUrl: 'https://vexor.et/embed/test-asset-42',
    playbackUrl: 'https://api.vexor.et/v1/assets/test-asset-42/hls/master.m3u8',
    embedIframe: '<iframe src="..."></iframe>',
    thumbnailUrl: 'https://api.vexor.et/thumb.jpg',
    githubToken: 'ghp_mock_token',
  });

  global.fetch = originalFetch;
  mockGithubServer.close();

  assert.equal(githubCommentCall !== null, true, 'sent comment to GitHub API');
  assert.equal(githubCommentCall.method, 'POST', 'creates a preview comment when one does not exist');
  assert.equal(githubCommentCall.url, '/repos/test-org/test-repo/issues/42/comments');
  assert.equal(githubCommentCall.body.body.includes('Vexor video preview'), true);
  assert.equal(githubCommentCall.body.body.includes('https://vexor.et/embed/test-asset-42'), true);
  assert.equal(githubCommentCall.body.body.includes('https://api.vexor.et/thumb.jpg'), true, 'includes a linked preview thumbnail');


  // Test 5: an existing Vexor comment is updated instead of duplicated.
  const originalEventPath = process.env.GITHUB_EVENT_PATH;
  let updateCall = null;
  const updateServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ id: 321, body: '<!-- vexor-video-preview -->\\nold preview' }]));
        return;
      }
      updateCall = { method: req.method, url: req.url, body: JSON.parse(body) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 321 }));
    });
  });
  const updatePort = await listen(updateServer);
  global.fetch = async (url, options) => {
    if (typeof url === 'string' && url.startsWith('https://api.github.com/')) {
      return originalFetch(url.replace('https://api.github.com', `http://127.0.0.1:${updatePort}`), options);
    }
    return originalFetch(url, options);
  };

  await handlePRComment({
    asset: { id: 'test-asset-42', state: 'ready', duration_seconds: 60 },
    embedUrl: 'https://vexor.et/embed/test-asset-42',
    playbackUrl: 'https://api.vexor.et/v1/assets/test-asset-42/hls/master.m3u8',
    embedIframe: '<iframe src="..."></iframe>',
    thumbnailUrl: 'https://api.vexor.et/thumb.jpg',
    githubToken: 'ghp_mock_token',
  });

  global.fetch = originalFetch;
  updateServer.close();
  if (originalEventPath === undefined) delete process.env.GITHUB_EVENT_PATH;
  else process.env.GITHUB_EVENT_PATH = originalEventPath;
  assert.equal(updateCall?.method, 'PATCH', 'updates the existing Vexor preview comment');
  assert.equal(updateCall?.url, '/repos/test-org/test-repo/issues/comments/321');
  assert.equal(updateCall?.body.body.includes('Vexor video preview'), true);

  console.log('✔ All GitHub Action tests passed cleanly!');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
