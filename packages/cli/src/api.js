import { currentConfig, normalizeApiUrl } from './config.js';

export async function apiRequest(path, options = {}) {
  const config = options.config || await currentConfig();
  if (!config.apiKey) throw new Error('No API key configured. Run `vexor auth login` or set VEXOR_API_KEY.');
  config.apiUrl = normalizeApiUrl(config.apiUrl);
  const url = new URL(path, `${config.apiUrl}/`);
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${config.apiKey}`);
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let response;
  try {
    const { config: _config, ...requestOptions } = options;
    response = await fetch(url, {
      ...requestOptions,
      headers,
      redirect: 'error',
      signal: options.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(`Could not reach Vexor API at ${config.apiUrl}: ${error.message}`);
  }

  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!response.ok) {
    const looksLikeHtml = typeof data === 'string' && /<\s*!doctype\s+html|<\s*html[\s>]/i.test(data.slice(0, 1024));
    if (looksLikeHtml) {
      const apiError = new Error(`${config.apiUrl} returned an HTML page (HTTP ${response.status}), not the Vexor API. This is likely the frontend URL. Set --api-url to the Go API address, commonly http://localhost:8080.`);
      apiError.status = response.status;
      throw apiError;
    }
    const apiMessage = typeof data?.error === 'string'
      ? data.error
      : data?.error?.message || data?.message || (typeof data === 'string' ? data.slice(0, 240) : '');
    const message = apiMessage || response.statusText || 'Request failed';
    const apiError = new Error(response.status === 401
      ? 'Vexor rejected this API key. Run `vexor auth login` with a current key.'
      : response.status === 402
        ? `${message}. Top up the account wallet before uploading.`
        : `${message} (HTTP ${response.status})`);
    apiError.status = response.status;
    apiError.code = data?.error?.code;
    throw apiError;
  }
  return { data, response, config };
}
