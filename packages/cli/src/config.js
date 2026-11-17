import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const DEFAULT_API_URL = 'https://api.vexor.et';
export const DEFAULT_CONSOLE_URL = 'http://localhost:3000';

function configDirectory() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || process.env.LOCALAPPDATA || homedir(), 'Vexor', 'cli');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'vexor');
}

const directory = configDirectory();
const configPath = path.join(directory, 'config.json');
export const uploadStatePath = path.join(directory, 'uploads.json');

export async function readConfig() {
  try {
    const contents = await readFile(configPath, 'utf8');
    const value = JSON.parse(contents);
    return {
      apiUrl: typeof value.apiUrl === 'string' ? value.apiUrl : DEFAULT_API_URL,
      apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { apiUrl: DEFAULT_API_URL, apiKey: '' };
    throw new Error(`Could not read CLI config at ${configPath}: ${error.message}`);
  }
}

export function currentConfig() {
  return readConfig().then((stored) => ({
    apiUrl: normalizeApiUrl(process.env.VEXOR_API_URL || stored.apiUrl),
    apiKey: process.env.VEXOR_API_KEY || stored.apiKey,
    apiKeySource: process.env.VEXOR_API_KEY ? 'environment' : stored.apiKey ? 'local config' : 'missing',
  }));
}

export async function saveConfig(config) {
  await secureWrite(configPath, JSON.stringify({
    apiUrl: normalizeApiUrl(config.apiUrl || DEFAULT_API_URL),
    apiKey: config.apiKey,
  }, null, 2) + '\n');
}

export async function clearConfig() {
  try {
    await rm(configPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export async function readUploadState() {
  try {
    const value = JSON.parse(await readFile(uploadStatePath, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error(`Could not read resumable upload state: ${error.message}`);
  }
}

export async function saveUploadState(state) {
  await secureWrite(uploadStatePath, JSON.stringify(state, null, 2) + '\n');
}

async function secureWrite(filePath, contents) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(directory, 0o700);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, filePath);
  if (process.platform !== 'win32') await chmod(filePath, 0o600);
}

export function normalizeApiUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('API URL must be an absolute http(s) URL. Set VEXOR_API_URL or run vexor auth login --api-url <url>.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API URL must use HTTP or HTTPS.');
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHost) throw new Error('Vexor API keys require HTTPS except for localhost development.');
  if (url.username || url.password || url.search || url.hash) throw new Error('API URL cannot include credentials, query parameters, or a fragment.');
  return url.toString().replace(/\/$/, '');
}

export function normalizeConsoleUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Console URL must be an absolute http(s) URL. Set VEXOR_CONSOLE_URL or use --console-url <url>.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Console URL must use HTTP or HTTPS.');
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHost) throw new Error('Use HTTPS for the Vexor console outside localhost development.');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Console URL must contain only the origin, without credentials, a path, query, or fragment.');
  }
  return url.origin;
}
