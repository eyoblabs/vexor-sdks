import Hls from "hls.js";
import type { VexorVanillaPlayerOptions } from "./types";
import { startNativeTokenRefresh } from "../native-token-refresh";

export interface VanillaPlayerInstance {
  play: () => Promise<void>;
  pause: () => void;
  seek: (seconds: number) => void;
  destroy: () => void;
  getElement: () => HTMLVideoElement;
}

/** Mount the Vexor player into an element without requiring React. */
export function createVexorPlayer(
  target: HTMLElement | string,
  options: VexorVanillaPlayerOptions
): VanillaPlayerInstance {
  const container = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (!container) throw new Error(`Target container not found: ${String(target)}`);
  const initialUrl = options.src ?? (options.assetId
    ? `${(options.baseUrl || "https://vexor-video.vercel.app").replace(/\/+$/, "")}/v1/playback/${encodeURIComponent(options.assetId)}/master.m3u8${options.token ? `?token=${encodeURIComponent(options.token)}` : ""}`
    : "");
  if (!initialUrl) throw new Error("Provide either src or assetId to create the Vexor player.");

  const hadPlayerClass = container.classList.contains("vexor-player");
  const hadProtectedClass = container.classList.contains("is-protected");
  container.classList.add("vexor-player");

  const video = document.createElement("video");
  video.className = "vexor-video";
  video.controls = options.controls ?? true;
  video.playsInline = true;
  video.preload = options.preload ?? "metadata";
  if (options.poster) video.poster = options.poster;
  if (options.autoPlay) video.autoplay = true;
  if (options.muted) video.muted = true;
  if (options.loop) video.loop = true;
  container.appendChild(video);

  let watermarkElement: HTMLDivElement | null = null;
  let watermarkTimer: ReturnType<typeof setInterval> | undefined;
  if (options.watermark) {
    const watermark = typeof options.watermark === "string"
      ? { text: options.watermark, position: "dynamic" as const, intervalSeconds: 15, opacity: 0.35 }
      : { position: "dynamic" as const, intervalSeconds: 15, opacity: 0.35, ...options.watermark };
    watermarkElement = document.createElement("div");
    watermarkElement.className = "vexor-watermark";
    watermarkElement.textContent = watermark.text;
    watermarkElement.style.opacity = String(Math.max(0, Math.min(1, watermark.opacity ?? 0.35)));
    watermarkElement.style.fontSize = typeof watermark.fontSize === "number" ? `${watermark.fontSize}px` : watermark.fontSize ?? "12px";
    watermarkElement.style.color = watermark.color ?? "#ffffff";

    const placeWatermark = () => {
      watermarkElement!.style.removeProperty("top");
      watermarkElement!.style.removeProperty("right");
      watermarkElement!.style.removeProperty("bottom");
      watermarkElement!.style.removeProperty("left");
      watermarkElement!.style.removeProperty("transform");
      switch (watermark.position) {
        case "top-left": watermarkElement!.style.cssText += ";top:16px;left:16px"; break;
        case "top-right": watermarkElement!.style.cssText += ";top:16px;right:16px"; break;
        case "bottom-left": watermarkElement!.style.cssText += ";bottom:48px;left:16px"; break;
        case "bottom-right": watermarkElement!.style.cssText += ";bottom:48px;right:16px"; break;
        case "center": watermarkElement!.style.cssText += ";top:50%;left:50%;transform:translate(-50%,-50%)"; break;
        default:
          watermarkElement!.style.top = `${10 + Math.floor(Math.random() * 70)}%`;
          watermarkElement!.style.left = `${10 + Math.floor(Math.random() * 70)}%`;
      }
    };
    placeWatermark();
    if (watermark.position === "dynamic") {
      watermarkTimer = setInterval(placeWatermark, Math.max(2, watermark.intervalSeconds || 15) * 1000);
    }
    container.appendChild(watermarkElement);
  }

  const onContextMenu = (event: Event) => event.preventDefault();
  const onDragStart = (event: Event) => event.preventDefault();
  if (options.protect) {
    container.classList.add("is-protected");
    container.addEventListener("contextmenu", onContextMenu);
    video.addEventListener("contextmenu", onContextMenu);
    video.addEventListener("dragstart", onDragStart);
  }

  let activeUrl = initialUrl;

  let hls: Hls | null = null;
  let nativeTokenRefresh: ReturnType<typeof startNativeTokenRefresh> | null = null;
  let nativeErrorListener: (() => void) | undefined;
  let destroyed = false;
  let refreshPromise: Promise<string> | null = null;
  let resumeAfterRefresh: { time: number; shouldPlay: boolean } | null = null;
  let hasSignaledReady = false;
  let activeParams = new URL(activeUrl, document.baseURI).search;
  const storageKey = options.resume !== false && (options.assetId || options.src)
    ? `vexor:pos:${options.assetId || (options.src ? options.src.split("?")[0] : "")}`
    : null;
  let hasRestoredSavedPos = false;
  let lastSavedTime = 0;

  const restoreSavedPosition = () => {
    if (hasRestoredSavedPos || !storageKey || typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const target = parseFloat(saved);
        const dur = video.duration;
        if (target > 5 && (!dur || target < dur - 10)) {
          video.currentTime = target;
        }
      }
    } catch {}
    hasRestoredSavedPos = true;
  };

  const useFallback = (error?: { code: string; message: string; fatal: boolean }) => {
    if (options.fallbackSrc) {
      if (hls) hls.destroy();
      hls = null;
      video.src = options.fallbackSrc;
      video.load();
    } else if (error) options.onError?.(error);
  };
  const signalReady = () => {
    if (hasSignaledReady) return;
    hasSignaledReady = true;
    options.onReady?.();
  };
  const onLoaded = () => {
    signalReady();
    const resume = resumeAfterRefresh;
    resumeAfterRefresh = null;
    if (resume && Number.isFinite(resume.time)) {
      video.currentTime = resume.time;
    } else {
      restoreSavedPosition();
    }
    if ((resume?.shouldPlay || options.autoPlay) && !destroyed) video.play().catch(() => {});
  };

  video.addEventListener("loadedmetadata", onLoaded);
  video.addEventListener("loadeddata", onLoaded);
  const onPlay = () => options.onPlay?.();
  const onPause = () => options.onPause?.();
  const onEnded = () => {
    if (storageKey && typeof window !== "undefined") {
      try { localStorage.removeItem(storageKey); } catch {}
    }
    options.onEnded?.();
  };
  video.addEventListener("play", onPlay);
  video.addEventListener("pause", onPause);
  video.addEventListener("ended", onEnded);
  const onTimeUpdate = () => {
    options.onTimeUpdate?.(video.currentTime, video.duration);
    if (storageKey && video.duration > 0 && typeof window !== "undefined") {
      if (video.currentTime >= video.duration * 0.95) {
        try { localStorage.removeItem(storageKey); } catch {}
      } else if (video.currentTime > 3 && Math.abs(video.currentTime - lastSavedTime) >= 3) {
        lastSavedTime = video.currentTime;
        try { localStorage.setItem(storageKey, video.currentTime.toFixed(1)); } catch {}
      }
    }
  };
  video.addEventListener("timeupdate", onTimeUpdate);

  const isHlsUrl = activeUrl.includes(".m3u8") || activeUrl.includes("/playback/");
  if (isHlsUrl && Hls.isSupported()) {
    class TokenAwareLoader extends Hls.DefaultConfig.loader {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      load(context: any, config: any, callbacks: any) {
        if (activeParams && context?.url) {
          try {
            const sourceUrl = new URL(activeUrl, document.baseURI);
            const childUrl = new URL(context.url, sourceUrl);
            if (childUrl.origin === sourceUrl.origin && !childUrl.searchParams.has("token")) {
              new URLSearchParams(activeParams).forEach((value, key) => {
                if (!childUrl.searchParams.has(key)) childUrl.searchParams.set(key, value);
              });
              context.url = childUrl.toString();
            }
          } catch {
            // Leave an unparseable child URL unchanged.
          }
        }
        super.load(context, config, callbacks);
      }
    }
    hls = new Hls({ enableWorker: true, loader: TokenAwareLoader as any, fLoader: TokenAwareLoader as any, pLoader: TokenAwareLoader as any });
    const activeHls = hls;
    activeHls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (hls !== activeHls || destroyed) return;
      const resume = resumeAfterRefresh;
      resumeAfterRefresh = null;
      signalReady();
      if (resume && Number.isFinite(resume.time)) {
        video.currentTime = resume.time;
      } else {
        restoreSavedPosition();
      }
      if ((resume?.shouldPlay || options.autoPlay) && !destroyed) video.play().catch(() => {});
    });
    activeHls.on(Hls.Events.ERROR, async (_event, data) => {
      if (hls !== activeHls || destroyed) return;
      if ((data.response?.code === 401 || data.response?.code === 403) && options.refreshToken) {
        try {
          refreshPromise ??= options.refreshToken();
          const newToken = await refreshPromise;
          refreshPromise = null;
          if (newToken && hls === activeHls && !destroyed) {
            resumeAfterRefresh = { time: video.currentTime, shouldPlay: !video.paused };
            const url = new URL(activeUrl, document.baseURI);
            url.searchParams.set("token", newToken);
            activeUrl = url.toString();
            activeParams = url.search;
            activeHls.loadSource(activeUrl);
            activeHls.startLoad();
            return;
          }
        } catch {
          refreshPromise = null;
        }
      }
      if (hls !== activeHls || destroyed) return;
      if (data.fatal) useFallback({ code: data.details || "MEDIA_PLAYBACK_ERROR", message: `Failed to stream video: ${data.details || "network error"}`, fatal: true });
    });
    activeHls.loadSource(activeUrl);
    activeHls.attachMedia(video);
  } else if (isHlsUrl && video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = activeUrl;
    nativeTokenRefresh = startNativeTokenRefresh(video, activeUrl, options.refreshToken);
    nativeErrorListener = () => {
      void nativeTokenRefresh?.refreshNow().then((refreshed) => {
        if (refreshed || destroyed) return;
        video.removeEventListener("error", nativeErrorListener!);
        useFallback({ code: "NATIVE_HLS_ERROR", message: "Failed to play native HLS stream", fatal: true });
      });
    };
    video.addEventListener("error", nativeErrorListener);
  } else if (!isHlsUrl || options.fallbackSrc) {
    video.src = isHlsUrl ? options.fallbackSrc! : activeUrl;
  } else {
    useFallback({ code: "HLS_UNSUPPORTED", message: "This browser does not support HLS playback.", fatal: true });
  }

  return {
    play: () => video.play(),
    pause: () => video.pause(),
    seek: (seconds) => {
      const clamped = Math.max(0, Math.min(seconds, video.duration || seconds));
      video.currentTime = clamped;
      if (storageKey && typeof window !== "undefined") {
        lastSavedTime = clamped;
        try { localStorage.setItem(storageKey, clamped.toFixed(1)); } catch {}
      }
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      nativeTokenRefresh?.stop();
      if (hls) hls.destroy();
      hls = null;
      if (watermarkTimer) clearInterval(watermarkTimer);
      container.removeEventListener("contextmenu", onContextMenu);
      video.removeEventListener("contextmenu", onContextMenu);
      video.removeEventListener("dragstart", onDragStart);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTimeUpdate);
      if (nativeErrorListener) video.removeEventListener("error", nativeErrorListener);
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      watermarkElement?.remove();
      if (!hadPlayerClass) container.classList.remove("vexor-player");
      if (options.protect && !hadProtectedClass) container.classList.remove("is-protected");
    },
    getElement: () => video,
  };
}
