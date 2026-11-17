import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { apiRequest } from './api.js';
import { colorize, pixelFrame, printBrand } from './brand.js';
import { clearConfig, currentConfig, DEFAULT_CONSOLE_URL, normalizeApiUrl, normalizeConsoleUrl, readConfig, saveConfig } from './config.js';
import { pickVideoFile } from './file-picker.js';
import { assetSummary, formatBytes, formatDuration, printJson, printTable } from './format.js';
import { uploadProgressText, uploadVideo } from './upload.js';

const VERSION = '0.1.0';

export async function run(rawArgs) {
  const { args, json, apiUrl, consoleUrl } = parseGlobalArgs(rawArgs);
  if (!args.length) {
    if (json || (stdin.isTTY && stdout.isTTY)) return homeCommand({ json, apiUrl, consoleUrl });
    return printHelp(json);
  }
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return await printHelp(json);
  if (args.includes('--help') || args.includes('-h')) return await printHelp(json);
  if (args[0] === '--version' || args[0] === '-v') return stdout.write(`v${VERSION}\n`);

  const [group, command, ...rest] = args;
  if (group === 'auth') return authCommand(command, rest, { json, apiUrl });
  if (group === 'doctor') return doctor({ json, apiUrl });
  if (group === 'studio' || group === 'console') return openConsole({ json, consoleUrl });
  if (group === 'home') return homeCommand({ json, apiUrl, consoleUrl });
  if (group === 'init') return initProject(command || 'next', rest);
  if (group === 'assets') return assetsCommand(command, rest, { json, apiUrl });
  if (group === 'webhooks') return webhooksCommand(command, rest, { json, apiUrl });
  if (group === 'videos' && command === 'upload') return uploadCommand(rest, { json, apiUrl });
  if (group === 'videos' && command === 'watch') return watchCommand(rest, { json, apiUrl });
  if (group === 'playback') return playbackCommand(command, rest, { json, apiUrl });
  throw new Error(`Unknown command: ${args.join(' ')}. Run \`vexor --help\` to see available commands.`);
}

function parseGlobalArgs(rawArgs) {
  const args = [];
  let json = false;
  let apiUrl;
  let consoleUrl;
  for (let index = 0; index < rawArgs.length; index += 1) {
    const value = rawArgs[index];
    if (value === '--json') json = true;
    else if (value === '--api-url') {
      apiUrl = rawArgs[index + 1];
      if (!apiUrl) throw new Error('--api-url requires a URL.');
      index += 1;
    } else if (value === '--console-url') {
      consoleUrl = rawArgs[index + 1];
      if (!consoleUrl) throw new Error('--console-url requires a URL.');
      index += 1;
    } else args.push(value);
  }
  return { args, json, apiUrl, consoleUrl };
}

async function openConsole({ json, consoleUrl }) {
  const baseUrl = normalizeConsoleUrl(consoleUrl || process.env.VEXOR_CONSOLE_URL || DEFAULT_CONSOLE_URL);
  const dashboardUrl = new URL('/dashboard', baseUrl).toString();
  const [command, commandArgs] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', dashboardUrl]]
    : process.platform === 'darwin'
      ? ['open', [dashboardUrl]]
      : ['xdg-open', [dashboardUrl]];
  await new Promise((resolve, reject) => {
    const browser = spawn(command, commandArgs, { detached: true, stdio: 'ignore', windowsHide: true });
    browser.once('error', reject);
    browser.once('spawn', () => { browser.unref(); resolve(); });
  }).catch((error) => {
    throw new Error(`Could not launch a browser. Open ${dashboardUrl} manually: ${error.message}`);
  });
  if (json) printJson({ opened: true, url: dashboardUrl });
  else stdout.write(`Opening the Vexor console: ${dashboardUrl}\nIf you are not signed in, the console will send you to its sign-in page.\n`);
}

async function homeCommand({ json, apiUrl, consoleUrl }) {
  const config = await configWithApiUrl(apiUrl);
  if (json) {
    printJson(await loadHomeSnapshot(config));
    return;
  }
  if (stdout.isTTY && stdin.isTTY) await printBrand('DEVELOPER STUDIO');
  let snapshot = await loadHomeWithAnimation(config);
  renderHome(snapshot);
  if (!stdout.isTTY || !stdin.isTTY) return;

  const terminal = createInterface({ input: stdin, output: stdout });
  terminal.on('SIGINT', () => terminal.close());
  try {
    while (!terminal.closed) {
      let action;
      try {
        action = (await terminal.question(colorize('  Choose an action › '))).trim().toLowerCase();
      } catch {
        return;
      }
      if (action === 'q' || action === 'quit' || action === 'exit') return;
      try {
        if (action === '1' || action === 'upload') {
          if (!snapshot.authenticated) {
            stdout.write('Sign in first with `vexor auth login`.\n');
          } else {
            terminal.close();
            try {
              await uploadCommand(['--pick', '--wait'], { json: false, apiUrl });
            } catch (error) {
              stdout.write(`\n${colorize('!')} ${error.message}\n`);
            }
            return homeCommand({ json: false, apiUrl, consoleUrl });
          }
        } else if (action === '2' || action === 'videos') {
          if (!snapshot.authenticated) stdout.write('Sign in first with `vexor auth login`.\n');
          else await assetsCommand('list', ['--limit', '20'], { json: false, apiUrl });
        } else if (action === '3' || action === 'watch') {
          if (!snapshot.authenticated) stdout.write('Sign in first with `vexor auth login`.\n');
          else {
            const activeAssets = snapshot.recent_assets.filter((item) => ['uploading', 'uploaded', 'transcoding'].includes(item.state));
            activeAssets.forEach((item, index) => stdout.write(`  ${index + 1}  ${String(item.filename || item.id).slice(0, 36)} · ${item.state} ${item.progress}\n`));
            const answer = (await terminal.question(activeAssets.length ? '  Choose a number or enter an asset ID › ' : '  No active jobs in recent videos. Enter an asset ID › ')).trim();
            const selected = /^\d+$/.test(answer) ? activeAssets[Number(answer) - 1] : undefined;
            if (/^\d+$/.test(answer) && activeAssets.length && !selected) throw new Error(`Choose a job from 1 to ${activeAssets.length}, or enter an asset ID.`);
            const id = selected?.id || answer;
            if (id) await watchCommand([id], { json: false, apiUrl });
          }
        } else if (action === '4' || action === 'studio') {
          await openConsole({ json: false, consoleUrl });
        } else if (action === '5' || action === 'doctor') {
          await doctor({ json: false, apiUrl });
        } else if (action === 'l' || action === 'login') {
          terminal.close();
          await authCommand('login', [], { json: false, apiUrl });
          return homeCommand({ json: false, apiUrl, consoleUrl });
        } else if (action === 'h' || action === 'help') {
          await printHelp(false);
        } else {
          stdout.write('Choose 1–5, L, H, or Q.\n');
        }
      } catch (error) {
        stdout.write(`\n${colorize('!')} ${error.message}\n`);
        try { await terminal.question('  Press Enter to return to the studio › '); } catch { return; }
      }
      if (terminal.closed) return;
      stdout.write('\u001b[2J\u001b[H');
      snapshot = await loadHomeWithAnimation(config);
      renderHome(snapshot);
    }
  } finally {
    terminal.close();
  }
}

async function loadHomeWithAnimation(config) {
  const request = loadHomeSnapshot(config);
  if (!stdout.isTTY || !stdin.isTTY || !config.apiKey) return request;
  let frame = 0;
  const ticker = setInterval(() => stdout.write(`\r${pixelFrame(frame++)} Loading your Vexor workspace…`), 110);
  try {
    return await request;
  } finally {
    clearInterval(ticker);
    stdout.write('\r\u001b[K');
  }
}

async function loadHomeSnapshot(config) {
  const snapshot = {
    api_url: config.apiUrl,
    authenticated: Boolean(config.apiKey),
    credential_source: config.apiKeySource,
    api_status: config.apiKey ? 'checking' : 'not_configured',
    recent_assets: [],
    wallet: undefined,
    errors: {},
  };
  if (!config.apiKey) return snapshot;
  const [assetsResult, walletResult] = await Promise.allSettled([
    apiRequest('/v1/assets/page?limit=5', { config, signal: AbortSignal.timeout(8000) }),
    apiRequest('/v1/billing/balance', { config, signal: AbortSignal.timeout(8000) }),
  ]);
  if (assetsResult.status === 'fulfilled') {
    snapshot.api_status = 'connected';
    snapshot.recent_assets = (assetsResult.value.data?.data || []).map(assetSummary);
    snapshot.next_cursor = assetsResult.value.data?.next_cursor;
  } else {
    snapshot.api_status = 'error';
    snapshot.errors.assets = assetsResult.reason?.message || 'Could not load recent assets.';
  }
  if (walletResult.status === 'fulfilled') {
    const wallet = walletResult.value.data;
    snapshot.wallet = {
      available_balance_etb: wallet?.available_balance_etb,
      promotional_balance_etb: wallet?.promotional_balance_etb,
      promotional_expires_at: wallet?.promotional_expires_at,
      currency: wallet?.currency || 'ETB',
    };
  } else {
    snapshot.errors.wallet = walletResult.reason?.message || 'Could not load wallet balance.';
  }
  return snapshot;
}

function renderHome(snapshot) {
  const line = '─'.repeat(58);
  stdout.write(`${colorize('╭─ VEXOR / DEVELOPER STUDIO')}\n`);
  stdout.write(`│ API       ${snapshot.api_url}\n`);
  const connection = snapshot.api_status === 'connected'
    ? colorize('● Connected')
    : snapshot.api_status === 'error'
      ? colorize('× Connection error')
      : '○ Not connected';
  stdout.write(`│ Status    ${connection}${snapshot.credential_source ? ` · ${snapshot.credential_source}` : ''}\n`);
  stdout.write(`├${line}\n`);
  if (!snapshot.authenticated) {
    stdout.write('│ Start here: connect your Vexor API key to manage videos.\n');
    stdout.write('│ Run `vexor auth login` or choose L below.\n');
  } else {
    const counts = snapshot.recent_assets.reduce((result, item) => {
      result[item.state] = (result[item.state] || 0) + 1;
      return result;
    }, {});
    const recentLabel = `${snapshot.recent_assets.length}${snapshot.next_cursor ? '+' : ''} recent`;
    const active = (counts.uploading || 0) + (counts.uploaded || 0) + (counts.transcoding || 0);
    const credit = snapshot.wallet?.available_balance_etb;
    stdout.write(`│ VIDEO PIPELINE    ${recentLabel} assets · ${active} processing`);
    if (counts.failed) stdout.write(` · ${counts.failed} failed`);
    stdout.write('\n');
    stdout.write(`│ AVAILABLE CREDIT  ${credit === undefined ? '—' : `${Number(credit).toFixed(2)} ETB`}\n`);
    if (snapshot.errors.assets) stdout.write(`│ Asset status      ${snapshot.errors.assets}\n`);
    if (snapshot.errors.wallet) stdout.write(`│ Wallet            ${snapshot.errors.wallet}\n`);
    if (snapshot.recent_assets.length) {
      stdout.write('├─ RECENT VIDEOS\n');
      for (const item of snapshot.recent_assets.slice(0, 3)) {
        const filename = String(item.filename || item.id).slice(0, 34);
        stdout.write(`│ ${filename.padEnd(35)} ${String(item.state || 'unknown').padEnd(12)} ${item.progress}\n`);
      }
    } else if (!snapshot.errors.assets) {
      stdout.write('│ No videos yet. Upload your first video to start the pipeline.\n');
    }
  }
  stdout.write(`├${line}\n`);
  stdout.write('│ 1  Upload video           2  Browse videos\n');
  stdout.write('│ 3  Watch a transcode      4  Open browser console\n');
  stdout.write('│ 5  Run diagnostics        L  Sign in\n');
  stdout.write('│ H  Help                   Q  Quit\n');
  stdout.write(`╰${line}\n`);
}

async function authCommand(command, args, options) {
  if (command === 'login') {
    const previous = await readConfig();
    const apiUrl = normalizeApiUrl(options.apiUrl || optionValue(args, '--api-url') || process.env.VEXOR_API_URL || previous.apiUrl);
    if (!options.json) await printBrand('CLI / SIGN IN');
    const apiKey = process.env.VEXOR_API_KEY || await promptSecret('Vexor API key: ');
    if (!apiKey.trim()) throw new Error('API key cannot be empty.');
    const config = { apiUrl, apiKey: apiKey.trim() };
    await apiRequest('/v1/assets/page?limit=1', { config });
    if (!process.env.VEXOR_API_KEY) await saveConfig(config);
    const result = { authenticated: true, api_url: config.apiUrl, credential_source: process.env.VEXOR_API_KEY ? 'VEXOR_API_KEY' : 'user config' };
    if (options.json) printJson(result);
    else stdout.write(`Connected to ${config.apiUrl}. Vexor accepted this key.\n${process.env.VEXOR_API_KEY ? 'The key remains in VEXOR_API_KEY.' : 'The key was saved in your user config directory.'}\n`);
    return;
  }
  if (command === 'status') {
    const config = await currentConfig();
    const result = {
      authenticated: Boolean(config.apiKey),
      api_url: config.apiUrl,
      credential_source: config.apiKeySource,
      key_hint: config.apiKey ? `••••${config.apiKey.slice(-4)}` : undefined,
    };
    if (options.json) printJson(result);
    else stdout.write(result.authenticated
      ? `Configured for ${result.api_url}\nCredential source: ${result.credential_source}\nKey: ${result.key_hint}\n`
      : `No API key configured. Run \`vexor auth login\` or set VEXOR_API_KEY.\n`);
    return;
  }
  if (command === 'logout') {
    await clearConfig();
    if (options.json) printJson({ logged_out: true, environment_key_remains: Boolean(process.env.VEXOR_API_KEY) });
    else stdout.write(`Removed the saved Vexor API key.${process.env.VEXOR_API_KEY ? ' VEXOR_API_KEY is still set in this shell.' : ''}\n`);
    return;
  }
  throw new Error('Use `vexor auth login`, `vexor auth status`, or `vexor auth logout`.');
}

async function doctor({ json, apiUrl }) {
  const config = await currentConfig();
  if (!json) await printBrand('SYSTEM CHECK');
  if (apiUrl) config.apiUrl = normalizeApiUrl(apiUrl);
  const checks = [];
  const healthUrl = new URL('/health', `${config.apiUrl}/`);
  try {
    const response = await fetch(healthUrl, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    checks.push({ name: 'API reachable', status: response.ok ? 'ok' : 'failed', detail: `HTTP ${response.status}` });
  } catch (error) {
    checks.push({ name: 'API reachable', status: 'failed', detail: error.message });
  }
  try {
    const response = await fetch(new URL('/ready', `${config.apiUrl}/`), { redirect: 'error', signal: AbortSignal.timeout(8000) });
    checks.push({ name: 'API dependencies', status: response.ok ? 'ok' : 'failed', detail: response.ok ? 'Database, Redis, and RabbitMQ are ready' : `HTTP ${response.status}` });
  } catch (error) {
    checks.push({ name: 'API dependencies', status: 'failed', detail: error.message });
  }
  checks.push({ name: 'API key configured', status: config.apiKey ? 'ok' : 'missing', detail: config.apiKey ? config.apiKeySource : 'Run vexor auth login' });

  if (config.apiKey) {
    try {
      await apiRequest('/v1/assets/page?limit=1', { config, signal: AbortSignal.timeout(10000) });
      checks.push({ name: 'API key accepted', status: 'ok', detail: 'Asset access is authorized' });
    } catch (error) {
      checks.push({ name: 'API key accepted', status: 'failed', detail: error.message });
    }
    try {
      const balance = await apiRequest('/v1/billing/balance', { config, signal: AbortSignal.timeout(10000) });
      checks.push({ name: 'Wallet endpoint', status: 'ok', detail: 'Billing status is available' });
      checks.push({ name: 'Wallet balance', status: 'info', detail: balance.data?.available_balance_etb !== undefined ? `${Number(balance.data.available_balance_etb).toFixed(2)} ETB available` : 'Check the dashboard before uploading' });
    } catch (error) {
      checks.push({ name: 'Wallet endpoint', status: 'failed', detail: error.message });
    }
  }
  checks.push({ name: 'Direct upload', status: 'info', detail: 'Availability is confirmed when an upload session is created; it depends on the Vexor environment.' });

  if (json) printJson({ api_url: config.apiUrl, checks });
  else {
    stdout.write(`Vexor Doctor · ${config.apiUrl}\n\n`);
    for (const check of checks) stdout.write(`${statusIcon(check.status)} ${check.name.padEnd(20)} ${check.detail}\n`);
  }
  if (checks.some((check) => check.status === 'failed' || check.status === 'missing')) process.exitCode = 1;
}

async function assetsCommand(command, args, { json, apiUrl }) {
  const config = await configWithApiUrl(apiUrl);
  if (command === 'list') {
    const limit = parseInteger(optionValue(args, '--limit') || '20', '--limit', 1, 100);
    const cursor = optionValue(args, '--cursor');
    const response = await apiRequest(`/v1/assets/page?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { config });
    const assets = (response.data?.data || []).map(assetSummary);
    if (json) printJson({ assets, next_cursor: response.data?.next_cursor });
    else printTable(assets, [
      { key: 'id', label: 'ID' }, { key: 'filename', label: 'VIDEO' },
      { key: 'state', label: 'STATE' }, { key: 'progress', label: 'PROGRESS' },
      { key: 'size', label: 'SIZE' },
    ], 'No videos yet. Upload one with `vexor videos upload <file>`.');
    return;
  }
  if (command === 'get') {
    const id = requiredArgument(args[0], 'asset ID');
    const result = await apiRequest(`/v1/assets/${encodeURIComponent(id)}`, { config });
    if (json) printJson(result.data);
    else printAsset(result.data);
    return;
  }
  if (command === 'delete') {
    const id = requiredArgument(args[0], 'asset ID');
    if (!args.includes('--force')) throw new Error('Asset deletion removes stored video data. Repeat with `--force` to confirm.');
    const result = await apiRequest(`/v1/assets/${encodeURIComponent(id)}`, { config, method: 'DELETE' });
    if (json) printJson(result.data);
    else stdout.write(`Deletion queued for ${id}.\n`);
    return;
  }
  throw new Error('Use `vexor assets list`, `vexor assets get <id>`, or `vexor assets delete <id> --force`.');
}

async function webhooksCommand(command, args, { json, apiUrl }) {
  const config = await configWithApiUrl(apiUrl);
  const limit = parseInteger(optionValue(args, '--limit') || '20', '--limit', 1, 100);
  if (command === 'list') {
    const cursor = optionValue(args, '--cursor');
    const response = await apiRequest(`/v1/webhooks?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { config });
    const endpoints = response.data?.data || [];
    if (json) printJson({ webhooks: endpoints, next_cursor: response.data?.next_cursor });
    else printTable(endpoints.map((endpoint) => ({ id: endpoint.id, url: endpoint.url, status: endpoint.active ? 'active' : 'paused' })), [
      { key: 'id', label: 'ID' }, { key: 'url', label: 'ENDPOINT' }, { key: 'status', label: 'STATUS' },
    ], 'No webhook endpoints configured. Create one in the Vexor console.');
    return;
  }
  if (command === 'deliveries') {
    const cursor = optionValue(args, '--cursor');
    const response = await apiRequest(`/v1/webhooks/deliveries?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { config });
    const deliveries = (response.data?.deliveries || []).map((delivery) => ({
      id: delivery.id,
      event: delivery.event_type,
      status: delivery.status,
      attempts: delivery.attempts,
      endpoint: delivery.endpoint_url,
      error: delivery.last_error || '',
    }));
    if (json) printJson({ deliveries, next_cursor: response.data?.next_cursor });
    else printTable(deliveries, [
      { key: 'id', label: 'DELIVERY' }, { key: 'event', label: 'EVENT' },
      { key: 'status', label: 'STATUS' }, { key: 'attempts', label: 'ATTEMPTS' },
    ], 'No webhook deliveries found for this account.');
    return;
  }
  if (command === 'replay') {
    const id = requiredArgument(args[0], 'webhook delivery ID');
    if (!args.includes('--force')) throw new Error('Replaying sends the event to your endpoint again. Repeat with `--force` to confirm.');
    await apiRequest(`/v1/webhooks/deliveries/${encodeURIComponent(id)}/replay`, { config, method: 'POST' });
    if (json) printJson({ id, status: 'retrying' });
    else stdout.write(`Replay queued for webhook delivery ${id}.\n`);
    return;
  }
  throw new Error('Use `vexor webhooks list`, `vexor webhooks deliveries`, or `vexor webhooks replay <delivery-id> --force`.');
}

async function uploadCommand(args, { json, apiUrl }) {
  const config = await configWithApiUrl(apiUrl);
  if (!config.apiKey) throw new Error('No API key configured. Run `vexor auth login` before choosing a video to upload.');
  let filename = args.find((argument) => !argument.startsWith('--'));
  if (args.includes('--pick') || !filename) {
    if (!stdin.isTTY || !stdout.isTTY) throw new Error('Choose a video from an interactive terminal, or pass its path: `vexor videos upload <file>`.');
    stdout.write('Opening the video picker…\n');
    try {
      filename = await pickVideoFile();
    } catch (error) {
      stdout.write(`Picker unavailable (${error.message}).\n`);
      const terminal = createInterface({ input: stdin, output: stdout });
      try {
        filename = (await terminal.question('Enter or drag the video file path here › ')).trim().replace(/^(["'])(.*)\1$/, '$2');
      } finally {
        terminal.close();
      }
    }
    if (!filename) {
      stdout.write('No video selected. Upload cancelled.\n');
      return;
    }
  }
  requiredArgument(filename, 'video file path');
  const concurrency = parseInteger(optionValue(args, '--concurrency') || '4', '--concurrency', 1, 16);
  const controller = new AbortController();
  const startedAt = Date.now();
  const animate = !json && stdout.isTTY && stdin.isTTY;
  let latestProgress = { phase: 'starting' };
  let frame = 0;
  let lastPlainProgress = '';
  const onInterrupt = () => controller.abort();
  process.once('SIGINT', onInterrupt);
  if (!json) {
    await printBrand('DIRECT UPLOAD');
    stdout.write(`Uploading ${path.basename(filename)} to Vexor…\n`);
  }
  const drawProgress = () => {
    let line = uploadProgressText(latestProgress, frame++);
    if (latestProgress.phase === 'upload' && latestProgress.uploadedBytes > 0) {
      const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000);
      const bytesPerSecond = latestProgress.uploadedBytes / elapsedSeconds;
      const remainingSeconds = (latestProgress.totalBytes - latestProgress.uploadedBytes) / bytesPerSecond;
      line += `  ·  ${formatBytes(bytesPerSecond)}/s  ·  ETA ${formatDuration(remainingSeconds)}`;
    }
    if (animate) stdout.write(`\r\u001b[2K${line}`);
    else if (!json) {
      const marker = `${latestProgress.phase}:${latestProgress.uploadedBytes || 0}:${latestProgress.totalBytes || 0}`;
      if (marker !== lastPlainProgress) {
        stdout.write(`${line}\n`);
        lastPlainProgress = marker;
      }
    }
  };
  drawProgress();
  const ticker = animate ? setInterval(drawProgress, 100) : undefined;
  let asset;
  try {
    asset = await uploadVideo(filename, {
      config, concurrency, signal: controller.signal,
      onProgress: (progress) => {
        latestProgress = progress;
        if (!animate) drawProgress();
      },
    });
  } catch (error) {
    if (!json && error?.name === 'AbortError') stdout.write('\nUpload paused. Run the same command again to resume from saved parts.\n');
    throw error;
  } finally {
    if (ticker) clearInterval(ticker);
    if (animate) stdout.write('\r\u001b[2K\n');
    process.removeListener('SIGINT', onInterrupt);
  }
  if (args.includes('--wait')) {
    await watchAsset(asset.id, { json, config });
    return;
  }
  const summary = assetSummary(asset);
  if (json) printJson({ asset: summary });
  else {
    stdout.write(`Vexor accepted the upload.\n`);
    printAsset(asset);
    stdout.write(`\nFollow processing with: vexor videos watch ${asset.id}\n`);
  }
}

async function watchCommand(args, { json, apiUrl }) {
  const id = requiredArgument(args[0], 'asset ID');
  const timeoutSeconds = parseInteger(optionValue(args, '--timeout') || '7200', '--timeout', 1, 86400);
  const config = await configWithApiUrl(apiUrl);
  if (!json) await printBrand('TRANSCODE WATCH');
  await watchAsset(id, { json, config, timeoutSeconds });
}

async function watchAsset(id, { json, config, timeoutSeconds = 7200 }) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let last = '';
  const animate = !json && stdout.isTTY && stdin.isTTY;
  let assetView = { state: 'uploaded', progress_percent: 0 };
  let screenDrawn = false;
  let readyAsset;
  let frame = 0;
  const drawTranscode = () => {
    const [heading, stages] = transcodeProgressLines(assetView, frame++);
    if (screenDrawn) stdout.write('\u001b[1A');
    stdout.write(`\r\u001b[2K${heading}\n\r\u001b[2K${stages}`);
    screenDrawn = true;
  };
  const ticker = animate ? setInterval(drawTranscode, 110) : undefined;
  try {
    while (Date.now() < deadline) {
      const result = await apiRequest(`/v1/assets/${encodeURIComponent(id)}`, { config, signal: AbortSignal.timeout(15000) });
      const asset = result.data;
      assetView = asset;
      const stage = asset.processing_stage ? ` · ${asset.processing_stage}` : '';
      const progress = `${Number(asset.progress_percent || 0)}%`;
      const signature = `${asset.state}:${progress}:${stage}`;
      const label = `${asset.state}${stage} ${progress}`;
      if (signature !== last && !animate && !json) {
        stdout.write(`\r${label.padEnd(72)}`);
        last = signature;
      }
      if (asset.state === 'ready') {
        readyAsset = asset;
        break;
      }
      if (asset.state === 'failed' || asset.state === 'deleted' || asset.state === 'deleting') {
        throw new Error(`Asset processing ended in state "${asset.state}"${asset.error_msg ? `: ${asset.error_msg}` : '.'}`);
      }
      if (animate) drawTranscode();
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  } finally {
    if (ticker) clearInterval(ticker);
    if (!json && stdout.isTTY) stdout.write('\n');
  }
  if (!readyAsset) throw new Error(`Timed out waiting for asset ${id}. Check its state with \`vexor assets get ${id}\`.`);
  if (json) printJson({ asset: assetSummary(readyAsset) });
  else stdout.write(`${colorize('■')} Video is ready for playback.\n`);
}

function transcodeProgressLines(asset, frame) {
  const phases = [
    ['downloading', 'SOURCE'],
    ['probing', 'PROBE'],
    ['transcoding', 'FFMPEG'],
    ['publishing', 'HLS'],
  ];
  const activeIndex = phases.findIndex(([stage]) => stage === asset.processing_stage);
  const sourceSize = Number(asset.file_size || 0);
  const sourceBytesDownloaded = Number(asset.processing_bytes_downloaded || 0);
  const rawProgress = asset.processing_stage === 'downloading' && sourceSize > 0
    ? (sourceBytesDownloaded / sourceSize) * 100
    : Number(asset.progress_percent || 0);
  const progress = Math.round(Math.max(0, Math.min(100, Number.isFinite(rawProgress) ? rawProgress : 0)));
  const barWidth = 20;
  const filled = Math.round(progress / 100 * barWidth);
  const stageLabel = phases[activeIndex]?.[1] || (asset.state === 'transcoding' ? 'PROCESSING' : 'QUEUED');
  const profile = asset.processing_profile ? ` · ${asset.processing_profile}` : '';
  const sourceSpeed = Number(asset.processing_download_speed_bps) > 0
    ? `  ·  ${formatBytes(Number(asset.processing_download_speed_bps))}/s`
    : '';
  const encodeSpeed = Number(asset.processing_speed) > 0 ? `  ·  ${Number(asset.processing_speed).toFixed(1)}× REALTIME` : '';
  const speed = asset.processing_stage === 'downloading' ? sourceSpeed : encodeSpeed;
  const heading = `${pixelFrame(frame)} VEXOR / TRANSCODE  ${stageLabel}${profile}  [${'█'.repeat(filled)}${'░'.repeat(barWidth - filled)}] ${String(progress).padStart(3)}%${speed}`;
  const stages = phases.map(([, label], index) => {
    const marker = index < activeIndex ? colorize('✓') : index === activeIndex ? pixelFrame(frame + 1) : colorize('·');
    return `${marker} ${label}`;
  }).join('     ›     ');
  return [heading, stages];
}

async function playbackCommand(id, args, { json, apiUrl }) {
  requiredArgument(id, 'asset ID');
  const config = await configWithApiUrl(apiUrl);
  const sessionId = optionValue(args, '--session-id') || randomUUID();
  const viewerId = optionValue(args, '--viewer-id');
  const response = await apiRequest('/v1/tokens', {
    config,
    method: 'POST',
    body: JSON.stringify({ asset_id: id, session_id: sessionId, ...(viewerId ? { viewer_id: viewerId } : {}) }),
  });
  const playback = {
    asset_id: id,
    manifest_url: response.data?.manifest_url,
    thumbnail_url: response.data?.thumbnail_url,
    token: response.data?.token,
    expires_in_seconds: 300,
  };
  if (!playback.manifest_url || !playback.token) throw new Error('Vexor returned incomplete playback details.');
  if (json) printJson(playback);
  else {
    stdout.write(`Playback details for ${id} (token expires in 5 minutes):\n\n`);
    stdout.write(`Manifest:  ${playback.manifest_url}\n`);
    if (playback.thumbnail_url) stdout.write(`Thumbnail: ${playback.thumbnail_url}\n`);
    stdout.write('\nPass the manifest URL and playback token to your player from your authenticated application server. Keep your Vexor API key on the server.\n');
  }
}

async function initProject(framework, args) {
  if (!['next', 'node'].includes(framework)) throw new Error('Supported starters are `next` and `node`. More framework starters are coming.');
  const force = args.includes('--force');
  const destination = framework === 'next' ? path.join(process.cwd(), 'lib', 'vexor.ts') : path.join(process.cwd(), 'vexor.js');
  if (existsSync(destination) && !force) throw new Error(`${path.relative(process.cwd(), destination)} already exists. Choose another project path or use --force to replace it.`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, framework === 'next' ? nextHelper : nodeHelper, { encoding: 'utf8', flag: force ? 'w' : 'wx' });
  stdout.write(`Created ${path.relative(process.cwd(), destination)}.\n\n`);
  stdout.write('Set VEXOR_API_URL and VEXOR_API_KEY in your server environment. Call createVexorPlayback only after your own application has verified that the viewer may access the asset.\n');
  stdout.write('See the generated function for the server-side token flow; playback tokens are short-lived.\n');
}

const nextHelper = `import 'server-only';\nimport { randomUUID } from 'node:crypto';\n\nexport async function createVexorPlayback(input: { assetId: string; viewerId?: string; sessionId?: string }) {\n  const apiUrl = process.env.VEXOR_API_URL || 'https://api.vexor.et';\n  const apiKey = process.env.VEXOR_API_KEY;\n  if (!apiKey) throw new Error('VEXOR_API_KEY is required on the server.');\n  const endpoint = new URL('/v1/tokens', apiUrl);\n  if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('Use HTTPS for the Vexor API outside local development.');\n\n  const response = await fetch(endpoint, {\n    method: 'POST',\n    headers: { Authorization: \`Bearer \${apiKey}\`, 'Content-Type': 'application/json' },\n    body: JSON.stringify({\n      asset_id: input.assetId,\n      viewer_id: input.viewerId,\n      session_id: input.sessionId || randomUUID(),\n    }),\n    redirect: 'error',\n  });\n  if (!response.ok) throw new Error(\`Vexor token request failed (HTTP \${response.status}).\`);\n  const playback = await response.json() as { token: string; manifest_url: string; thumbnail_url?: string };\n  return { assetId: input.assetId, token: playback.token, manifestUrl: playback.manifest_url, thumbnailUrl: playback.thumbnail_url };\n}\n`;

const nodeHelper = `import { randomUUID } from 'node:crypto';\n\nexport async function createVexorPlayback({ assetId, viewerId, sessionId = randomUUID() }) {\n  const apiUrl = process.env.VEXOR_API_URL || 'https://api.vexor.et';\n  const apiKey = process.env.VEXOR_API_KEY;\n  if (!apiKey) throw new Error('VEXOR_API_KEY is required on the server.');\n  const endpoint = new URL('/v1/tokens', apiUrl);\n  if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('Use HTTPS for the Vexor API outside local development.');\n\n  const response = await fetch(endpoint, {\n    method: 'POST',\n    headers: { Authorization: \`Bearer \${apiKey}\`, 'Content-Type': 'application/json' },\n    body: JSON.stringify({ asset_id: assetId, viewer_id: viewerId, session_id: sessionId }),\n    redirect: 'error',\n  });\n  if (!response.ok) throw new Error(\`Vexor token request failed (HTTP \${response.status}).\`);\n  const playback = await response.json();\n  return { assetId, token: playback.token, manifestUrl: playback.manifest_url, thumbnailUrl: playback.thumbnail_url };\n}\n`;

async function configWithApiUrl(apiUrl) {
  const config = await currentConfig();
  if (apiUrl) config.apiUrl = normalizeApiUrl(apiUrl);
  return config;
}

function printAsset(asset) {
  const row = assetSummary(asset);
  for (const [label, key] of [['ID', 'id'], ['File', 'filename'], ['State', 'state'], ['Progress', 'progress'], ['Size', 'size'], ['Duration', 'duration'], ['Resolution', 'dimensions']]) {
    if (row[key] !== undefined && row[key] !== '') stdout.write(`${label.padEnd(13)} ${row[key]}\n`);
  }
  if (asset.processing_stage) stdout.write(`Stage        ${asset.processing_stage}\n`);
  if (asset.error_msg) stdout.write(`Error        ${asset.error_msg}\n`);
}

function parseInteger(raw, name, minimum, maximum) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}

function optionValue(args, option) {
  const index = args.indexOf(option);
  if (index === -1) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${option} requires a value.`);
  return args[index + 1];
}

function requiredArgument(value, label) {
  if (!value || value.startsWith('--')) throw new Error(`Provide ${label}.`);
  return value;
}

function statusIcon(status) {
  return ({ ok: '✓', failed: '✗', missing: '!', info: '·' })[status] || '·';
}

async function promptSecret(prompt) {
  if (!stdin.isTTY || !stdin.setRawMode) throw new Error('Interactive key entry needs a terminal. Set VEXOR_API_KEY and run `vexor auth login` again.');
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };
    const onData = (character) => {
      if (character === '\u0003') {
        cleanup();
        stdout.write('\n');
        reject(new Error('Login cancelled.'));
      } else if (character === '\r' || character === '\n') {
        cleanup();
        stdout.write('\n');
        resolve(value);
      } else if (character === '\u007f' || character === '\b') {
        value = value.slice(0, -1);
      } else if (character >= ' ') value += character;
    };
    stdin.on('data', onData);
  });
}

async function printHelp(json = false) {
  if (!json) await printBrand('VIDEO INFRASTRUCTURE');
  stdout.write(`Vexor CLI ${VERSION}\n\n`);
  stdout.write('Build, upload, process, and play video from your terminal.\n\n');
  stdout.write('Usage:\n  vexor [home]\n  vexor <command> [options]\n\n');
  stdout.write('Commands:\n');
  stdout.write('  auth login [--api-url URL]     Save and validate an API key\n');
  stdout.write('  auth status                    Show the active account configuration\n');
  stdout.write('  auth logout                    Remove the saved API key\n');
  stdout.write('  doctor                         Check API, credentials, and wallet access\n');
  stdout.write('  home                           Show account activity and quick actions\n');
  stdout.write('  studio                         Open the Vexor console in your browser\n');
  stdout.write('  init <next|node>               Generate a server-side playback helper\n');
  stdout.write('  assets list [--limit N]        List recent videos\n');
  stdout.write('  assets get <id>                Show asset and processing status\n');
  stdout.write('  assets delete <id> --force     Queue asset and storage deletion\n');
  stdout.write('  webhooks list [--limit N]      List webhook endpoints\n');
  stdout.write('  webhooks deliveries            Inspect webhook delivery attempts\n');
  stdout.write('  webhooks replay <id> --force   Retry a failed delivery\n');
  stdout.write('  videos upload [file] [--pick]    Pick a video or pass its path, then upload it\n');
  stdout.write('  videos watch <id>              Follow processing progress\n');
  stdout.write('  playback <id>                  Issue short-lived playback details\n\n');
  stdout.write('Options:\n  --api-url URL                  Override VEXOR_API_URL\n  --console-url URL              Override VEXOR_CONSOLE_URL (studio command)\n  --json                         Print structured JSON output\n  --help                         Show command help\n\n');
  stdout.write('CI authentication: set VEXOR_API_URL and VEXOR_API_KEY.\n');
}
