<p align="center">
  <a href="https://vexor-video.vercel.app/"><img src="https://vexor-video.vercel.app/brands/vexor-logo-256.png" alt="VEXOR" width="104"></a>
</p>

<h1 align="center">VEXOR Player (React & Vanilla JS)</h1>

<p align="center">Official accessible React and Vanilla JavaScript video player for encrypted HLS streaming with dynamic watermarks.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@vexor-video/player"><img src="https://img.shields.io/npm/v/@vexor-video/player.svg?color=ea580c" alt="npm version"></a>
  <a href="https://github.com/eyoblabs/-vexor-sdks/tree/main/packages/player"><img src="https://img.shields.io/badge/GitHub-eyoblabs%2F--vexor--sdks-black?logo=github" alt="GitHub Repository"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@vexor-video/player">npm Package</a> · 
  <a href="https://github.com/eyoblabs/-vexor-sdks">GitHub Monorepo</a> · 
  <a href="https://vexor-video.vercel.app/">VEXOR Console</a> · 
  <a href="https://vexor-video.vercel.app/developers">Developer Documentation</a>
</p>

The official React and Vanilla JS video player for [VEXOR](https://vexor-video.vercel.app/) token-gated HLS playback.

- **Encrypted HLS Streaming**: Seamless playback of AES-128 CBC encrypted adaptive video (240p up to 1080p).
- **Zero Boilerplate**: Automatically manages Hls.js initialization, quality levels, segment loading, and token parameters.
- **Dynamic Watermarking**: Optional visible viewer label that periodically moves, adding friction to casual sharing.
- **Interaction Deterrents**: Optional context-menu and drag suppression. These do not prevent screen capture or replace server-side access controls.
- **Token Refresh**: Hls.js playback refreshes after an authorization failure; native Safari/iOS HLS refreshes proactively before token expiry when a callback is supplied. Playback resumes from the current playhead; a brief rebuffer may occur.
- **Modern Controls**: Sleek, accessible UI controls including timeline scrubbing, volume slider, playback rate, quality selector, PiP, and fullscreen.
- **SSR & Next.js Friendly**: Safe to render on the server and works with React 18 & 19, Next.js, Vite, Remix, or plain HTML.

---

## Installation

```bash
npm install @vexor-video/player
```

---

## Quickstart (React & Next.js)

```tsx
import { VexorPlayer } from "@vexor-video/player";
import "@vexor-video/player/styles.css";

export default function VideoSection() {
  return (
    <div className="max-w-4xl mx-auto rounded-xl overflow-hidden shadow-2xl">
      <VexorPlayer
        src="https://YOUR_API_HOST/v1/playback/ea56fdde-ad35-44f6-ad9a-8cd01c4f10d1/master.m3u8?token=eyJhbGci..."
        poster="https://YOUR_API_HOST/v1/playback/ea56fdde-ad35-44f6-ad9a-8cd01c4f10d1/thumbnail.jpg"
        watermark="student@example.com"
        protect
      />
    </div>
  );
}
```

### Alternatively, pass `assetId` and `token` directly:

```tsx
<VexorPlayer
  assetId="ea56fdde-ad35-44f6-ad9a-8cd01c4f10d1"
  token={playbackToken}
  baseUrl="https://YOUR_API_HOST"
  watermark={{
    text: "Yonas Abebe · ID: 9021",
    position: "dynamic",
    intervalSeconds: 20,
    opacity: 0.35,
  }}
  protect
/>
```

---

## Props Reference

| Prop | Type | Default | Description |
|---|---|---|---|
| `src` | `string` | `undefined` | Full authenticated manifest URL (`master.m3u8?token=...`). |
| `assetId` | `string` | `undefined` | Vexor video asset UUID (used when `src` is omitted). |
| `token` | `string` | `undefined` | Short-lived Ed25519 token issued by `/v1/tokens`. |
| `baseUrl` | `string` | `"https://YOUR_API_HOST"` | Your deployed VEXOR API origin. |
| `poster` | `string` | `undefined` | Poster thumbnail image URL. |
| `autoPlay` | `boolean` | `false` | Automatically begin playback (browsers may require muted=true). |
| `muted` | `boolean` | `false` | Start audio in muted state. |
| `loop` | `boolean` | `false` | Loop video playback. |
| `controls` | `boolean` | `true` | Display playback controls. |
| `nativeControls` | `boolean` | `false` | Use browser native HTML5 controls instead of custom UI. |
| `watermark` | `string \| WatermarkConfig` | `undefined` | Moving watermark text or config object. |
| `protect` | `boolean` | `false` | Suppress right-click and drag interactions as a casual-copy deterrent. It does not prevent capture. |
| `refreshToken` | `() => Promise<string>` | `undefined` | Callback used to obtain a replacement token after an authorization failure. |
| `fallbackSrc` | `string` | `undefined` | Fallback MP4 URL if HLS is completely unsupported. |
| `onReady` | `() => void` | `undefined` | Fires when manifest is parsed and player is ready. |
| `onPlay` | `() => void` | `undefined` | Fires on playback resume. |
| `onPause` | `() => void` | `undefined` | Fires on playback pause. |
| `onEnded` | `() => void` | `undefined` | Fires when video reaches end. |
| `onTimeUpdate` | `(time, duration) => void` | `undefined` | Fires on progress update. |
| `onError` | `(error) => void` | `undefined` | Fires on fatal playback error. |
| `onQualityChange` | `(levelIndex) => void` | `undefined` | Fires when active quality rendition switches. |

---

## Visible Watermark

The player can move a visible watermark across the video. It can discourage casual sharing, but it is not DRM and cannot prevent recording, cropping, or redistribution. Keep authorization and playback-token enforcement on your server. Avoid putting sensitive personal data such as IP addresses in the watermark.

```tsx
<VexorPlayer
  src={manifestUrl}
  watermark={{
    text: "Confidential · viewer-9021",
    position: "dynamic",    // 'dynamic' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
    intervalSeconds: 15,     // Moves every 15 seconds
    opacity: 0.35,          // Subtle readable overlay
    fontSize: "12px",
    color: "#ffffff",
  }}
  protect
/>
```

---

## Token Refresh and Playback Resume

Vexor playback tokens expire after a limited period. Provide `refreshToken` to obtain replacement access. Hls.js requests a new token after an authorization failure. Safari/iOS native HLS cannot expose individual playlist or segment authorization failures to JavaScript, so it refreshes proactively about once every four minutes. The player reloads the manifest and attempts to resume at the current playhead; depending on the browser and stream, viewers may see a brief buffer:

```tsx
async function handleRefreshToken(): Promise<string> {
  const res = await fetch(`/api/courses/${courseId}/lessons/${lessonId}/refresh-token`);
  const data = await res.json();
  return data.token;
}

<VexorPlayer
  src={manifestUrl}
  refreshToken={handleRefreshToken}
/>
```

---

## Headless Hook (`useVexorPlayer`)

If you want to build completely custom UI controls while letting Vexor manage Hls.js, quality switching, and decryption:

```tsx
import { useVexorPlayer } from "@vexor-video/player";

function CustomPlayer({ src }) {
  const {
    videoRef,
    containerRef,
    isPlaying,
    currentTime,
    duration,
    togglePlay,
    seek,
    qualityLevels,
    setQuality,
  } = useVexorPlayer({ src });

  return (
    <div ref={containerRef}>
      <video ref={videoRef} />
      <button onClick={togglePlay}>{isPlaying ? "Pause" : "Play"}</button>
      <span>{currentTime} / {duration}</span>
    </div>
  );
}
```

---

## Vanilla JavaScript (Non-React)

Use the dedicated `@vexor-video/player/vanilla` entry in a JavaScript bundler or framework. It does not import React. Install the package as usual:

```html
  <link rel="stylesheet" href="node_modules/@vexor-video/player/dist/index.css">
<div id="player-container"></div>

<script type="module">
  import { createVexorPlayer } from "@vexor-video/player/vanilla";

  const player = createVexorPlayer("#player-container", {
    src: "https://YOUR_API_HOST/v1/playback/:id/master.m3u8?token=...",
    watermark: "user@example.com",
    protect: true,
  });

  // Programmatic controls:
  // player.play();
  // player.pause();
  // player.destroy(); // removes only elements created by this player instance
</script>
```

For a plain HTML page without a bundler, load the standalone browser bundle and use its global API:

```html
<link rel="stylesheet" href="/node_modules/@vexor-video/player/dist/index.css">
<div id="player-container"></div>
<script src="/node_modules/@vexor-video/player/dist/vexor-player.global.js"></script>
<script>
  const player = VexorPlayer.createVexorPlayer("#player-container", {
    src: "https://YOUR_API_HOST/v1/playback/ASSET_ID/master.m3u8?token=...",
  });
</script>
```

---

## Keyboard Shortcuts

When the player is focused or hovered:
- `Space` or `K`: Play / Pause
- `Left Arrow` / `J`: Seek backward 5 seconds
- `Right Arrow` / `L`: Seek forward 5 seconds
- `Up Arrow`: Volume up 10%
- `Down Arrow`: Volume down 10%
- `M`: Mute / Unmute
- `F`: Fullscreen toggle

---

## Support Vexor

If Vexor helps your product, you can support its continued development on [Buy Me a Coffee](https://buymeacoffee.com/eyob_dev).

---

## License

MIT © [VEXOR](https://vexor-video.vercel.app/)
