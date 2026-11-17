<p align="center">
  <a href="https://vexor-video.vercel.app/"><img src="https://vexor-video.vercel.app/brands/vexor-logo-256.png" alt="VEXOR" width="104"></a>
</p>

<h1 align="center">VEXOR Node.js & TypeScript SDK</h1>

<p align="center">Official server-side video infrastructure SDK for Node.js, TypeScript, Next.js, Express, and Remix.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@vexor-video/sdk"><img src="https://img.shields.io/npm/v/@vexor-video/sdk.svg?color=ea580c" alt="npm version"></a>
  <a href="https://github.com/eyoblabs/vexor-sdks/tree/main/packages/node-sdk"><img src="https://img.shields.io/badge/GitHub-eyoblabs%2Fvexor--sdks-black?logo=github" alt="GitHub Repository"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@vexor-video/sdk">npm Package</a> · 
  <a href="https://github.com/eyoblabs/vexor-sdks">GitHub Monorepo</a> · 
  <a href="https://vexor-video.vercel.app/">VEXOR Console</a> · 
  <a href="https://vexor-video.vercel.app/developers">Developer Documentation</a>
</p>

The official server-side Node.js and TypeScript client for VEXOR. It supports resumable uploads, asset lifecycle operations, playback-token issuance, customer source-storage imports, and webhook signature verification.

The SDK requires Node.js 20 or newer. Keep `VEXOR_API_KEY` in server-only configuration; do not put this package or its key in browser bundles, public mobile apps, or client components.

## Install

After the package is published to npm:

```sh
npm install @vexor-video/sdk
```

For development inside this repository, build the package in `packages/node-sdk`, then install its local folder from your server project with `npm install ../Vexor/packages/node-sdk` (adjust the relative path).

## Initialize

```ts
import { Vexor } from "@vexor-video/sdk";

const vexor = new Vexor({
  apiKey: process.env.VEXOR_API_KEY,
  baseUrl: process.env.VEXOR_BASE_URL, // your deployed VEXOR API origin
});
```

The public VEXOR site is [vexor-video.vercel.app](https://vexor-video.vercel.app/). Set `VEXOR_BASE_URL` to the API origin for your VEXOR deployment; the site URL and API URL are separate. The SDK also reads `VEXOR_API_KEY` and `VEXOR_BASE_URL` from the environment when options are omitted. Non-HTTPS base URLs are accepted only for localhost development. API redirects are rejected so bearer credentials are not forwarded to a different destination.

## Upload and track a video

The upload helper streams bounded chunks from disk using the tus resumable protocol. Save the session URL from `onUploadCreated` to resume after a process restart; store it as a secret and resume with the same file.

```ts
const asset = await vexor.assets.upload("./lesson.mp4", {
  title: "Lesson 01",
  onProgress(uploaded, total) {
    console.log(`${Math.floor((uploaded / total) * 100)}%`);
  },
  onUploadCreated(uploadUrl) {
    // Persist securely if the upload must survive a process restart.
    saveUploadSession(uploadUrl);
  },
});

console.log(asset.id, asset.state);
const current = await vexor.assets.get(asset.id);
```

On an interrupted upload, `UploadError` includes `uploadUrl` and `offset`. Pass `uploadUrl` back in the next `upload()` call with the same source file. Default chunk size is 16 MiB; configure 1 byte through 64 MiB. The client retries transient failures and reconciles the tus offset before retrying a chunk.

## List and delete assets

```ts
const page = await vexor.assets.listPage({ limit: 25 });
for (const asset of page.data) console.log(asset.id, asset.state);

if (page.next_cursor) {
  const nextPage = await vexor.assets.listPage({ limit: 25, cursor: page.next_cursor });
}

const deletion = await vexor.assets.delete("ASSET_ID");
console.log(deletion.state); // Deletion is queued asynchronously.
```

## Import from connected storage

Create a connection once, then import by object key. The source object remains customer-owned; Vexor manages processed playback output by default.

```ts
const connection = await vexor.storageConnections.create({
  name: "Course videos",
  endpoint: "https://s3.example.net",
  region: "us-east-1",
  bucket: "course-media",
  prefix: "published",
  accessKeyId: process.env.COURSE_STORAGE_ACCESS_KEY!,
  secretAccessKey: process.env.COURSE_STORAGE_SECRET_KEY!,
});

await vexor.storageConnections.verify(connection.id);
const asset = await vexor.assets.importFromStorage({
  connectionId: connection.id,
  objectKey: "lesson-01.mp4", // relative to the configured prefix
});
```

AWS role-based connections can use `authMode: "aws_role"`, `roleArn`, and `externalId`. Call `await vexor.storageConnections.awsIdentity()` to retrieve the VEXOR deployment principal ARN for the role trust policy; create a unique external ID of at least 16 characters and keep it for the connection. Static access keys are sent only during connection creation; VEXOR returns a masked key hint. Optional customer-managed output storage is deployment-gated and should be configured only when enabled for your account.

## Issue playback access

Call the token endpoint from your server only after your own app authorizes the viewer. Return the short-lived manifest URL or token to that viewer, never the API key.

```ts
const playback = await vexor.tokens.create({
  assetId: asset.id,
  viewerId: "student_123",
  // Optional; generated automatically when omitted.
  sessionId: "course-session-456",
});

return { manifestUrl: playback.manifestUrl, token: playback.token };
```

An asset that is not ready for playback returns `ConflictError` (HTTP 409).

## Verify webhooks

Pass the exact raw HTTP body bytes, `X-Vexor-Signature`, and your endpoint secret. The event discriminator is `type` and the asset identifier is `asset_id`.

```ts
import { SignatureVerificationError, Vexor } from "@vexor-video/sdk";

try {
  const event = vexor.webhooks.constructEvent(
    rawBody,
    request.headers["x-vexor-signature"],
    process.env.VEXOR_WEBHOOK_SECRET,
  );
  if (event.type === "video.asset.ready") {
    await markLessonReady(event.asset_id, event.event_id);
  }
  // Persist event_id idempotently before returning 2xx.
} catch (error) {
  if (error instanceof SignatureVerificationError) return response.status(400).end();
  throw error;
}
```

Use the raw request body before JSON parsing or reserialization. The SDK verifies HMAC-SHA256 using a timing-safe comparison.

## Errors

All SDK errors extend `VexorError`. Common HTTP statuses map to `AuthenticationError` (401), `PermissionError` (403), `NotFoundError` (404), `ConflictError` (409), and `RateLimitError` (429). `RateLimitError.retryAfterSeconds` is set when the API provides a `Retry-After` header. Network and malformed-response errors also extend `VexorError`.

## Build

```sh
npm ci
npm run typecheck
npm run build
```

## Support Vexor

If Vexor helps your product, you can support its continued development on [Support Vexor](https://buymeacoffee.com/eyob_dev).

## License

MIT. See [LICENSE](LICENSE).
