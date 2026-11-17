import { randomUUID, timingSafeEqual, createHmac } from "node:crypto";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  SignatureVerificationError,
  UploadError,
  VexorError,
} from "./errors.js";
import type {
  Asset,
  CreatePlaybackTokenInput,
  CreateStorageConnectionInput,
  CursorPage,
  ImportAssetInput,
  PlaybackSession,
  StorageConnection,
  VexorWebhookEvent,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.vexor.et";
const MAX_UPLOAD_CHUNK_SIZE = 64 * 1024 * 1024;

export interface VexorOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface UploadOptions {
  filename?: string;
  contentType?: string;
  title?: string;
  chunkSize?: number;
  maxRetries?: number;
  uploadUrl?: string;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  onUploadCreated?: (uploadUrl: string) => void | Promise<void>;
}

export interface CreateWebhookEndpointInput {
  url: string;
}

interface ApiErrorBody {
  error?: string | { code?: string; message?: string };
  message?: string;
}

/** Server-side Node.js client. Never expose this client or its API key in browser code. */
export class Vexor {
  readonly assets: {
    get: (assetId: string) => Promise<Asset>;
    listPage: (options?: { limit?: number; cursor?: string }) => Promise<CursorPage<Asset>>;
    delete: (assetId: string) => Promise<{ id: string; state: string; message: string }>;
    importFromStorage: (input: ImportAssetInput) => Promise<Asset>;
    upload: (filePath: string, options?: UploadOptions) => Promise<Asset>;
  };

  readonly tokens: {
    create: (input: CreatePlaybackTokenInput) => Promise<PlaybackSession>;
  };

  readonly storageConnections: {
    list: () => Promise<StorageConnection[]>;
    awsIdentity: () => Promise<{ principalArn: string }>;
    create: (input: CreateStorageConnectionInput) => Promise<StorageConnection>;
    verify: (connectionId: string) => Promise<{ verified: boolean }>;
    revoke: (connectionId: string) => Promise<void>;
  };

  readonly webhooks: {
    constructEvent: <TData = unknown>(rawBody: string | Uint8Array, signature: string, secret?: string) => VexorWebhookEvent<TData>;
  };

  private readonly apiKey: string;
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VexorOptions = {}) {
    const apiKey = options.apiKey ?? process.env.VEXOR_API_KEY;
    if (!apiKey?.trim()) throw new Error("Provide apiKey or set VEXOR_API_KEY.");
    this.apiKey = apiKey.trim();
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.VEXOR_BASE_URL ?? DEFAULT_BASE_URL);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new RangeError("timeoutMs must be a positive finite number.");
    }
    this.fetchImpl = options.fetch ?? fetch;

    this.assets = {
      get: (assetId) => this.request<Asset>("GET", `/v1/assets/${encodeURIComponent(requireId(assetId, "assetId"))}`),
      listPage: (pageOptions = {}) => this.listAssets(pageOptions),
      delete: (assetId) => this.request<{ id: string; state: string; message: string }>("DELETE", `/v1/assets/${encodeURIComponent(requireId(assetId, "assetId"))}`),
      importFromStorage: (input) => this.importAsset(input),
      upload: (filePath, uploadOptions = {}) => this.uploadFile(filePath, uploadOptions),
    };
    this.tokens = {
      create: (input) => this.createPlaybackToken(input),
    };
    this.storageConnections = {
      list: () => this.listStorageConnections(),
      awsIdentity: () => this.getAwsStorageIdentity(),
      create: (input) => this.createStorageConnection(input),
      verify: (id) => this.verifyStorageConnection(id),
      revoke: (id) => this.revokeStorageConnection(id),
    };
    this.webhooks = {
      constructEvent: (rawBody, signature, secret = process.env.VEXOR_WEBHOOK_SECRET) =>
        constructWebhookEvent(rawBody, signature, secret),
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": "@vexor-video/sdk/0.1.1",
    });
    const init: RequestInit = {
      method,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    if (body !== undefined) {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.apiUrl(path), init);
    } catch (cause) {
      throw new VexorError("Could not connect to the Vexor API.", { cause });
    }
    return this.decodeResponse<T>(response);
  }

  private async rawRequest(method: string, url: string, headers: HeadersInit = {}, body?: Uint8Array): Promise<Response> {
    const target = new URL(url, this.baseUrl);
    if (target.origin !== this.baseUrl.origin || target.username || target.password) {
      throw new UploadError("Upload session URLs must use the configured Vexor API origin.", { uploadUrl: url });
    }
    const requestHeaders = new Headers(headers);
    requestHeaders.set("Authorization", `Bearer ${this.apiKey}`);
    requestHeaders.set("User-Agent", "@vexor-video/sdk/0.1.1");
    let response: Response;
    try {
      response = await this.fetchImpl(target, {
        method,
        headers: requestHeaders,
        body: body as BodyInit | undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new VexorError("Network request to Vexor failed.", { cause });
    }
    if (response.status >= 300 && response.status < 400) {
      throw new VexorError("Vexor returned a redirect for a credentialed request.", { statusCode: response.status });
    }
    if (!response.ok) throw await this.toApiError(response);
    return response;
  }

  private async decodeResponse<T>(response: Response): Promise<T> {
    if (!response.ok) throw await this.toApiError(response);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new VexorError("Vexor returned an invalid JSON response.", { statusCode: response.status, responseBody: text, cause });
    }
  }

  private async toApiError(response: Response): Promise<VexorError> {
    const text = await response.text();
    let body: ApiErrorBody | undefined;
    try { body = JSON.parse(text) as ApiErrorBody; } catch { /* Preserve non-JSON body for diagnostics. */ }
    const nested = body?.error;
    const code = typeof nested === "object" && nested !== null ? nested.code : undefined;
    const message = (typeof nested === "object" && nested !== null ? nested.message : nested) ?? body?.message ?? `Vexor API returned HTTP ${response.status}.`;
    const options = { statusCode: response.status, code, responseBody: text };
    if (response.status === 401) return new AuthenticationError(String(message), options);
    if (response.status === 403) return new PermissionError(String(message), options);
    if (response.status === 404) return new NotFoundError(String(message), options);
    if (response.status === 409) return new ConflictError(String(message), options);
    if (response.status === 429) {
      const rawRetryAfter = response.headers.get("Retry-After");
      const retryAfterValue = rawRetryAfter === null ? Number.NaN : Number(rawRetryAfter);
      const retryAt = rawRetryAfter === null ? Number.NaN : Date.parse(rawRetryAfter);
      const retryAfterSeconds = Number.isFinite(retryAfterValue)
        ? Math.max(0, retryAfterValue)
        : Number.isFinite(retryAt)
          ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
          : undefined;
      return new RateLimitError(String(message), { ...options, retryAfterSeconds });
    }
    return new VexorError(String(message), options);
  }

  private apiUrl(path: string): URL {
    if (/^https?:\/\//i.test(path)) throw new TypeError("API methods require a relative Vexor path.");
    return new URL(path.replace(/^\/+/, ""), this.baseUrl);
  }

  private async listAssets(options: { limit?: number; cursor?: string }): Promise<CursorPage<Asset>> {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("limit must be an integer from 1 to 100.");
    const query = new URLSearchParams({ limit: String(limit) });
    if (options.cursor) query.set("cursor", options.cursor);
    const page = await this.request<CursorPage<Asset>>("GET", `/v1/assets/page?${query.toString()}`);
    if (!page || !Array.isArray(page.data)) throw new VexorError("Vexor returned an invalid asset page.");
    return page;
  }

  private async importAsset(input: ImportAssetInput): Promise<Asset> {
    const connectionId = requireId(input.connectionId, "connectionId");
    if (!input.objectKey?.trim()) throw new TypeError("objectKey is required.");
    const response = await this.request<{ data: Asset }>("POST", "/v1/assets/imports", {
      connection_id: connectionId,
      object_key: input.objectKey,
      ...(input.filename ? { filename: input.filename } : {}),
      ...(input.outputConnectionId ? { output_connection_id: input.outputConnectionId } : {}),
      ...(input.enhanceUpscale ? { enhance_upscale: true } : {}),
      ...(input.enhanceTier ? { enhance_tier: input.enhanceTier } : {}),
    });
    if (!response?.data) throw new VexorError("Vexor returned an invalid import response.");
    return response.data;
  }

  private async createPlaybackToken(input: CreatePlaybackTokenInput): Promise<PlaybackSession> {
    const assetId = requireId(input?.assetId, "assetId");
    const payload = await this.request<{ token: string; manifest_url: string; thumbnail_url?: string }>("POST", "/v1/tokens", {
      asset_id: assetId,
      viewer_id: input.viewerId ?? "anonymous",
      session_id: input.sessionId ?? `sess_${randomUUID()}`,
    });
    if (!payload?.token || !payload.manifest_url) throw new VexorError("Vexor returned an invalid playback session.");
    return { token: payload.token, manifestUrl: payload.manifest_url, ...(payload.thumbnail_url ? { thumbnailUrl: payload.thumbnail_url } : {}) };
  }

  private async listStorageConnections(): Promise<StorageConnection[]> {
    const response = await this.request<{ data: StorageConnection[] }>("GET", "/v1/storage-connections");
    if (!Array.isArray(response?.data)) throw new VexorError("Vexor returned an invalid storage connection list.");
    return response.data;
  }

  private async getAwsStorageIdentity(): Promise<{ principalArn: string }> {
    const response = await this.request<{ data: { principal_arn: string } }>("GET", "/v1/storage-connections/aws-identity");
    if (typeof response?.data?.principal_arn !== "string" || !response.data.principal_arn) {
      throw new VexorError("Vexor returned an invalid AWS identity response.");
    }
    return { principalArn: response.data.principal_arn };
  }

  private async createStorageConnection(input: CreateStorageConnectionInput): Promise<StorageConnection> {
    const authMode = input.authMode ?? "access_key";
    const payload: Record<string, string> = {
      name: requiredText(input.name, "name"),
      auth_mode: authMode,
      bucket: requiredText(input.bucket, "bucket"),
      region: input.region ?? "auto",
      prefix: input.prefix ?? "",
    };
    if (input.authMode === "aws_role") {
      payload.role_arn = requiredText(input.roleArn, "roleArn");
      payload.external_id = requiredText(input.externalId, "externalId");
      if (payload.external_id.length < 16 || payload.external_id.length > 1224) {
        throw new RangeError("externalId must be between 16 and 1224 characters.");
      }
      if (input.endpoint) payload.endpoint = input.endpoint;
    } else {
      payload.endpoint = requiredText(input.endpoint, "endpoint");
      payload.access_key_id = requiredText(input.accessKeyId, "accessKeyId");
      payload.secret_access_key = requiredText(input.secretAccessKey, "secretAccessKey");
    }
    const response = await this.request<{ data: StorageConnection }>("POST", "/v1/storage-connections", payload);
    if (!response?.data) throw new VexorError("Vexor returned an invalid storage connection response.");
    return response.data;
  }

  private async verifyStorageConnection(connectionId: string): Promise<{ verified: boolean }> {
    const response = await this.request<{ data: { verified: boolean } }>("POST", `/v1/storage-connections/${encodeURIComponent(requireId(connectionId, "connectionId"))}/verify`);
    if (typeof response?.data?.verified !== "boolean") throw new VexorError("Vexor returned an invalid storage verification response.");
    return response.data;
  }

  private async revokeStorageConnection(connectionId: string): Promise<void> {
    await this.request("DELETE", `/v1/storage-connections/${encodeURIComponent(requireId(connectionId, "connectionId"))}`);
  }

  private async uploadFile(filePath: string, options: UploadOptions): Promise<Asset> {
    if (!filePath?.trim()) throw new TypeError("filePath is required.");
    const chunkSize = options.chunkSize ?? 16 * 1024 * 1024;
    const maxRetries = options.maxRetries ?? 3;
    if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_UPLOAD_CHUNK_SIZE) throw new RangeError(`chunkSize must be between 1 and ${MAX_UPLOAD_CHUNK_SIZE} bytes.`);
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) throw new RangeError("maxRetries must be an integer from 0 to 5.");

    const file = await open(filePath, "r");
    let uploadUrl: string | undefined = options.uploadUrl;
    let offset = 0;
    try {
      const fileInfo = await file.stat();
      const totalBytes = fileInfo.size;
      if (!fileInfo.isFile() || totalBytes <= 0) throw new TypeError("filePath must point to a non-empty regular file.");
      const filename = options.filename ?? basename(filePath);
      const contentType = options.contentType ?? guessVideoContentType(filename);

      if (uploadUrl) {
        uploadUrl = this.resolveUploadUrl(uploadUrl);
        const state = await this.readUploadState(uploadUrl);
        if (state.length !== totalBytes) throw new UploadError("The saved upload belongs to a file with a different size.", { uploadUrl, offset: state.offset });
        offset = state.offset;
      } else {
        const metadata = [
          filename && metadataValue("filename", filename),
          contentType && metadataValue("filetype", contentType),
          options.title && metadataValue("title", options.title),
        ].filter(Boolean).join(",");
        const response = await this.rawRequest("POST", this.apiUrl("/uploads").toString(), {
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(totalBytes),
          "Upload-Metadata": metadata,
        });
        const location = response.headers.get("Location");
        if (!location) throw new UploadError("Vexor did not return an upload session URL.");
        uploadUrl = this.resolveUploadUrl(location);
      }

      try {
        await options.onUploadCreated?.(uploadUrl);
      } catch (cause) {
        throw new UploadError(`Could not save the upload session URL: ${errorMessage(cause)}`, { uploadUrl, offset, cause });
      }
      options.onProgress?.(offset, totalBytes);

      while (offset < totalBytes) {
        const chunkStart = offset;
        const expectedBytes = Math.min(chunkSize, totalBytes - offset);
        const chunk = Buffer.allocUnsafe(expectedBytes);
        let readBytes = 0;
        while (readBytes < expectedBytes) {
          const result = await file.read(chunk, readBytes, expectedBytes - readBytes, chunkStart + readBytes);
          if (result.bytesRead === 0) break;
          readBytes += result.bytesRead;
        }
        if (readBytes !== expectedBytes) throw new UploadError("The source file changed or ended before the upload completed.", { uploadUrl, offset });

        let chunkFinished = false;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const chunkEnd = chunkStart + expectedBytes;
            const bodyOffset = offset - chunkStart;
            const response = await this.rawRequest("PATCH", uploadUrl, {
              "Tus-Resumable": "1.0.0",
              "Upload-Offset": String(offset),
              "Content-Type": "application/offset+octet-stream",
            }, chunk.subarray(bodyOffset));
            const nextOffset = Number(response.headers.get("Upload-Offset"));
            if (!Number.isSafeInteger(nextOffset) || nextOffset !== chunkEnd) {
              throw new VexorError("Vexor returned an unexpected upload offset.", { statusCode: 409 });
            }
            offset = nextOffset;
            options.onProgress?.(offset, totalBytes);
            chunkFinished = true;
            break;
          } catch (error) {
            if (error instanceof UploadError || !isRetryable(error) || attempt === maxRetries) {
              throw new UploadError(`Upload stopped at byte ${offset}: ${errorMessage(error)}`, {
                uploadUrl,
                offset,
                statusCode: error instanceof VexorError ? error.statusCode : undefined,
                cause: error,
              });
            }
            await delay(Math.min(500 * (2 ** attempt), 4000));
            let state: { offset: number; length: number };
            try {
              state = await this.readUploadState(uploadUrl);
            } catch (stateError) {
              throw new UploadError(`Could not reconcile the upload after a network interruption: ${errorMessage(stateError)}`, {
                uploadUrl,
                offset,
                statusCode: stateError instanceof VexorError ? stateError.statusCode : undefined,
                cause: stateError,
              });
            }
            if (state.length !== totalBytes || state.offset < chunkStart || state.offset > chunkStart + expectedBytes) {
              throw new UploadError("Vexor reported an unexpected offset after a network interruption.", { uploadUrl, offset: state.offset, cause: error });
            }
            offset = state.offset;
            if (offset > chunkStart) options.onProgress?.(offset, totalBytes);
            chunkFinished = offset === chunkStart + expectedBytes;
            if (chunkFinished) break;
          }
        }
        if (!chunkFinished) throw new UploadError("Upload retries were exhausted.", { uploadUrl, offset });
      }

      const tusId = new URL(uploadUrl).pathname.split("/").filter(Boolean).at(-1);
      if (!tusId) throw new UploadError("Vexor returned an invalid upload session URL.", { uploadUrl, offset });
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await this.request<Asset>("GET", `/v1/assets/by-upload/${encodeURIComponent(tusId)}`);
        } catch (error) {
          if (!(error instanceof NotFoundError) || attempt === 4) {
            throw new UploadError(`Upload completed, but Vexor has not registered the asset: ${errorMessage(error)}`, { uploadUrl, offset: totalBytes, cause: error });
          }
          await delay(250 * (attempt + 1));
        }
      }
      throw new UploadError("Upload completed, but Vexor has not registered the asset yet.", { uploadUrl, offset: totalBytes });
    } finally {
      await file.close();
    }
  }

  private async readUploadState(uploadUrl: string): Promise<{ offset: number; length: number }> {
    const response = await this.rawRequest("HEAD", uploadUrl, { "Tus-Resumable": "1.0.0" });
    const rawOffset = response.headers.get("Upload-Offset");
    const rawLength = response.headers.get("Upload-Length");
    const offset = rawOffset === null ? Number.NaN : Number(rawOffset);
    const length = rawLength === null ? Number.NaN : Number(rawLength);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > length) {
      throw new UploadError("Vexor returned invalid Tus upload headers.", { uploadUrl, offset: Number.isFinite(offset) ? offset : undefined });
    }
    return { offset, length };
  }

  private resolveUploadUrl(uploadUrl: string): string {
    let target: URL;
    try { target = new URL(uploadUrl, this.baseUrl); }
    catch (cause) { throw new UploadError("Vexor returned an invalid upload session URL.", { uploadUrl, cause }); }
    if (target.origin !== this.baseUrl.origin || target.username || target.password || target.hash) {
      throw new UploadError("Upload session URLs must use the configured Vexor API origin.", { uploadUrl });
    }
    return target.toString();
  }
}

export function verifyWebhookSignature(rawBody: string | Uint8Array, signature: string, secret: string): boolean {
  if (!secret || !signature) return false;
  const supplied = signature.trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(supplied, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function constructWebhookEvent<TData = unknown>(
  rawBody: string | Uint8Array,
  signature: string,
  secret?: string,
): VexorWebhookEvent<TData> {
  if (!secret || !verifyWebhookSignature(rawBody, signature, secret)) {
    throw new SignatureVerificationError("The Vexor webhook signature is invalid.");
  }
  let event: unknown;
  try { event = JSON.parse(typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8")); }
  catch (cause) { throw new VexorError("The Vexor webhook body is not valid JSON.", { cause }); }
  if (!isWebhookEvent<TData>(event)) throw new VexorError("Vexor returned an invalid webhook event payload.");
  return event;
}

function isWebhookEvent<TData>(value: unknown): value is VexorWebhookEvent<TData> {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<VexorWebhookEvent<TData>>;
  return typeof event.event_id === "string" && typeof event.type === "string" &&
    typeof event.asset_id === "string" && typeof event.account_id === "string" &&
    typeof event.timestamp === "string";
}

function normalizeBaseUrl(rawUrl: string): URL {
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw new TypeError("baseUrl must be a valid absolute HTTP(S) URL."); }
  const hostname = url.hostname.toLowerCase();
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (!url.hostname || !["https:", "http:"].includes(url.protocol) || (url.protocol !== "https:" && !isLocal)) {
    throw new TypeError("baseUrl must use HTTPS except for localhost development.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new TypeError("baseUrl cannot include credentials, a path, query parameters, or a fragment.");
  }
  return new URL(url.origin);
}

function requireId(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  return normalized;
}

function requiredText(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  return normalized;
}

function metadataValue(key: string, value: string): string {
  return `${key} ${Buffer.from(value, "utf8").toString("base64")}`;
}

function guessVideoContentType(filename: string): string {
  const ext = filename.toLowerCase().split(".").at(-1);
  if (ext === "mov") return "video/quicktime";
  if (ext === "mkv") return "video/x-matroska";
  if (ext === "webm") return "video/webm";
  if (ext === "m4v") return "video/x-m4v";
  return "video/mp4";
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof VexorError)) return true;
  return error.statusCode === undefined || [408, 409, 425, 429].includes(error.statusCode) || error.statusCode >= 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
