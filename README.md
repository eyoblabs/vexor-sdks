<p align="center">
  <a href="https://vexor-video.vercel.app/"><img src="https://vexor-video.vercel.app/brands/vexor-logo-256.png" alt="VEXOR" width="120"></a>
</p>

<h1 align="center">VEXOR SDKs & Client Libraries</h1>

<p align="center">Official client SDKs, UI components, and developer tooling for VEXOR video infrastructure.</p>

<p align="center">
  <a href="https://github.com/eyoblabs/vexor-sdks/stargazers"><img src="https://img.shields.io/github/stars/eyoblabs/vexor-sdks?style=social" alt="GitHub Stars"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://vexor-video.vercel.app/"><img src="https://img.shields.io/badge/Platform-VEXOR-orange.svg" alt="Vexor Platform"></a>
  <a href="https://vexor-video.vercel.app/developers"><img src="https://img.shields.io/badge/Docs-Developer%20Portal-green.svg" alt="Developer Docs"></a>
</p>

---

## Overview

[VEXOR](https://vexor-video.vercel.app/) is video streaming and transcoding infrastructure with built-in token-gated AES-128 encryption, adaptive HLS packaging (240p to 1080p), dynamic watermarking, and regional payment support (Telebirr & Polar).

This monorepo contains all official client libraries, web embed components, and developer integrations.

---

## Packages in this Monorepo

| Package | Language / Ecosystem | Registry Link | Source Directory |
|---|---|---|---|
| **Node.js / TS SDK** | Node.js, TypeScript, Next.js | [`@vexor-video/sdk`](https://www.npmjs.com/package/@vexor-video/sdk) | [`packages/node-sdk`](./packages/node-sdk) |
| **React & Vanilla Player** | React 18/19, Next.js, HTML5 | [`@vexor-video/player`](https://www.npmjs.com/package/@vexor-video/player) | [`packages/player`](./packages/player) |
| **Python SDK** | Python 3.9+, Django, FastAPI | [`vexor-video-sdk`](https://pypi.org/project/vexor-video-sdk/) | [`packages/vexor-python`](./packages/vexor-python) |
| **CLI Tool** | Terminal / Command Line | [`@vexor/cli`](https://www.npmjs.com/package/@vexor/cli) | [`packages/cli`](./packages/cli) |
| **WordPress Plugin** | PHP 7.4+, WordPress 5.8+ | WordPress Plugin | [`packages/vexor-wordpress`](./packages/vexor-wordpress) |
| **GitHub Action** | CI/CD Pipelines | GitHub Marketplace | [`packages/github-action`](./packages/github-action) |

---

## Quickstart

### 1. Node.js / TypeScript Server SDK

Install the SDK:
```bash
npm install @vexor-video/sdk
```

Upload a video and generate a signed playback token:
```typescript
import { Vexor } from "@vexor-video/sdk";

const vexor = new Vexor({
  apiKey: process.env.VEXOR_API_KEY,
  baseUrl: process.env.VEXOR_BASE_URL, // e.g. https://vexor-api-ves7.onrender.com
});

// Resumable chunked video upload
const asset = await vexor.assets.upload("./course-lecture.mp4", {
  title: "Lesson 01 — Getting Started",
  onProgress(uploaded, total) {
    console.log(`Upload progress: ${Math.floor((uploaded / total) * 100)}%`);
  },
});

// When asset.state === "ready", issue an authorization playback token
const session = await vexor.tokens.create(asset.id, {
  expiresInSeconds: 3600,
});

console.log("Playback URL:", session.playbackUrl);
```

---

### 2. React & Next.js Player

Install the player:
```bash
npm install @vexor-video/player
```

Render the player with encrypted HLS playback and dynamic watermarking:
```tsx
"use client";

import { VexorPlayer } from "@vexor-video/player";
import "@vexor-video/player/styles.css";

export default function VideoSection({ playbackUrl, userEmail }: { playbackUrl: string; userEmail: string }) {
  return (
    <div className="max-w-4xl mx-auto rounded-xl overflow-hidden shadow-2xl">
      <VexorPlayer
        src={playbackUrl}
        watermark={{
          text: userEmail,
          position: "dynamic", // moves periodically to deter recording
        }}
        protect // disables right-click and casual drag
      />
    </div>
  );
}
```

---

### 3. Python SDK

Install via pip:
```bash
pip install vexor-video-sdk
```

Zero-dependency Python integration:
```python
from vexor_video import Vexor

vexor = Vexor(api_key="vex_live_your_key_here")

# Upload with built-in resumable tus client
asset = vexor.assets.upload("lecture.mp4", title="Chapter 1: Foundations")
print("Asset ID:", asset["id"])

# Issue playback session
playback = vexor.tokens.create(asset["id"], expires_in_seconds=3600)
print("Playback URL:", playback["playback_url"])
```

---

## Token Security Architecture

Vexor streams video using AES-128 CBC byte-range HLS encryption. The player fetches short-lived Ed25519 tokens from your server. Video segments are decrypted on-the-fly inside the browser memory sandbox and never stored unencrypted on disk.

```
┌──────────────────┐         ┌─────────────────────┐         ┌────────────────────┐
│   Viewer App     │ ──────> │  Your Backend API   │ ──────> │   VEXOR Core API   │
│ (@vexor/player)  │         │  (Auth & Access)    │         │ (Ed25519 Key Server│
└──────────────────┘         └─────────────────────┘         └────────────────────┘
         │                                                              │
         │                        AES-128 Encrypted                     │
         └─────────────────────── HLS Segments & Keys ──────────────────┘
```

---

## Documentation & Support

- **Developer Documentation:** [vexor-video.vercel.app/developers](https://vexor-video.vercel.app/developers)
- **API Reference:** [vexor-video.vercel.app/developers#api-reference](https://vexor-video.vercel.app/developers)
- **Report an Issue:** [github.com/eyoblabs/vexor-sdks/issues](https://github.com/eyoblabs/vexor-sdks/issues)
- **Official Website:** [vexor-video.vercel.app](https://vexor-video.vercel.app)

---

## License

All client libraries and SDK packages in this repository are open source and licensed under the [MIT License](LICENSE).
