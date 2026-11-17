import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import type { QualityLevel, VexorPlayerProps } from "../types";
import { startNativeTokenRefresh } from "../native-token-refresh";

export interface UseVexorPlayerReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
  qualityLevels: QualityLevel[];
  currentQuality: number;
  playbackRate: number;
  error: { code: string; message: string; fatal: boolean } | null;
  play: () => Promise<void>;
  pause: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  setQuality: (levelIndex: number) => void;
  setPlaybackRate: (rate: number) => void;
  toggleFullscreen: () => void;
  togglePiP: () => void;
  retry: () => void;
}

export function useVexorPlayer({
  src,
  assetId,
  token,
  baseUrl = "https://api.vexor.et",
  fallbackSrc,
  autoPlay = false,
  muted = false,
  refreshToken,
  onReady,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
  onError,
  onQualityChange,
  resume = true,
}: VexorPlayerProps): UseVexorPlayerReturn {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const callbacksRef = useRef({ onReady, onPlay, onPause, onEnded, onTimeUpdate, onError, onQualityChange, refreshToken });
  callbacksRef.current = { onReady, onPlay, onPause, onEnded, onTimeUpdate, onError, onQualityChange, refreshToken };
  const activeParamsRef = useRef("");
  const refreshPromiseRef = useRef<Promise<string> | null>(null);
  const resumeAfterRefreshRef = useRef<{ time: number; shouldPlay: boolean } | null>(null);

  const storageKey = resume !== false && (assetId || src) ? `vexor:pos:${assetId || (src ? src.split("?")[0] : "")}` : null;
  const hasRestoredSavedPositionRef = useRef(false);
  const lastSavedTimeRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(muted);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [error, setError] = useState<{ code: string; message: string; fatal: boolean } | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  const restoreSavedPosition = useCallback((videoElement: HTMLVideoElement) => {
    if (hasRestoredSavedPositionRef.current || !storageKey || typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const target = parseFloat(saved);
        const dur = videoElement.duration;
        if (target > 5 && (!dur || target < dur - 10)) {
          videoElement.currentTime = target;
          setCurrentTime(target);
        }
      }
    } catch {}
    hasRestoredSavedPositionRef.current = true;
  }, [storageKey]);

  // Determine effective playback manifest URL
  const activeUrl = src
    ? src
    : assetId
    ? `${baseUrl.replace(/\/+$/, "")}/v1/playback/${encodeURIComponent(assetId)}/master.m3u8${token ? `?token=${encodeURIComponent(token)}` : ""}`
    : "";

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setIsBuffering(true);
    setReloadTrigger((v) => v + 1);
  }, []);

  // Initialize HLS & Media Source
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cleanupFallback = () => {};
    const loadFallback = () => {
      if (!fallbackSrc) return false;
      destroyHls();
      setIsBuffering(true);
      video.src = fallbackSrc;
      const onLoaded = () => {
        setIsBuffering(false);
        callbacksRef.current.onReady?.();
      };
      const onError = () => {
        const errObj = {
          code: "FALLBACK_PLAYBACK_ERROR",
          message: "Unable to load fallback media source",
          fatal: true,
        };
        setError(errObj);
        callbacksRef.current.onError?.(errObj);
        setIsBuffering(false);
      };
      video.addEventListener("loadeddata", onLoaded);
      video.addEventListener("error", onError);
      cleanupFallback = () => {
        video.removeEventListener("loadeddata", onLoaded);
        video.removeEventListener("error", onError);
      };
      video.load();
      return true;
    };
    const setFatalError = (code: string, message: string) => {
      destroyHls();
      const errObj = { code, message, fatal: true };
      setError(errObj);
      callbacksRef.current.onError?.(errObj);
      setIsBuffering(false);
    };

    destroyHls();
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);
    setQualityLevels([]);
    setCurrentQuality(-1);
    setIsBuffering(Boolean(activeUrl));
    if (!activeUrl) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      return;
    }

    const isHlsUrl = activeUrl.includes(".m3u8") || activeUrl.includes("/playback/");
    let fatalRecoveryAttempts = 0;

    if (isHlsUrl && Hls.isSupported()) {
      activeParamsRef.current = activeUrl.includes("?") ? activeUrl.substring(activeUrl.indexOf("?")) : "";

      class VexorLoader extends Hls.DefaultConfig.loader {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        load(context: any, config: any, callbacks: any) {
          // Propagate token query params to child playlists and segments if not present
          const activeParams = activeParamsRef.current;
          if (activeParams && context?.url) {
            try {
              const sourceUrl = new URL(activeUrl, window.location.href);
              const childUrl = new URL(context.url, sourceUrl);
              if (childUrl.origin === sourceUrl.origin && !childUrl.searchParams.has("token")) {
                new URLSearchParams(activeParams).forEach((value, key) => {
                  if (!childUrl.searchParams.has(key)) childUrl.searchParams.set(key, value);
                });
                context.url = childUrl.toString();
              }
            } catch {
              // Leave an unparseable child URL untouched; the loader will report failures normally.
            }
          }
          super.load(context, config, callbacks);
        }
      }

      const hls = new Hls({
        startFragPrefetch: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        enableWorker: true,
        lowLatencyMode: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        loader: VexorLoader as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fLoader: VexorLoader as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pLoader: VexorLoader as any,
      });
      hlsRef.current = hls;

      hls.loadSource(activeUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        if (hlsRef.current !== hls) return;
        setIsBuffering(false);
        const levels: QualityLevel[] = data.levels.map((lvl, index) => {
          let label = `${lvl.height}p`;
          if (lvl.height === 0 || lvl.videoCodec === undefined) {
            label = "Audio only";
          }
          return {
            id: index,
            height: lvl.height,
            width: lvl.width,
            bitrate: lvl.bitrate,
            label,
          };
        });
        setQualityLevels(levels);
        callbacksRef.current.onReady?.();
        const resume = resumeAfterRefreshRef.current;
        if (resume) {
          resumeAfterRefreshRef.current = null;
          if (Number.isFinite(resume.time) && resume.time > 0) video.currentTime = resume.time;
          if (resume.shouldPlay) video.play().catch(() => {});
        } else {
          restoreSavedPosition(video);
        }
        if (autoPlay) {
          video.play().catch(() => {
            // Autoplay might be blocked by browser policy; user can interact to start
          });
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        if (hlsRef.current !== hls) return;
        setCurrentQuality(hls.autoLevelEnabled ? -1 : data.level);
        callbacksRef.current.onQualityChange?.(hls.autoLevelEnabled ? -1 : data.level);
      });

      hls.on(Hls.Events.ERROR, async (_event, data) => {
        if (hlsRef.current !== hls) return;
        // Handle token expiry (HTTP 401 or 403 on key/segment)
        if (
          (data.response?.code === 401 || data.response?.code === 403) &&
          callbacksRef.current.refreshToken
        ) {
          try {
            if (!refreshPromiseRef.current) {
              refreshPromiseRef.current = callbacksRef.current.refreshToken();
            }
            const newToken = await refreshPromiseRef.current;
            refreshPromiseRef.current = null;
            if (newToken && hlsRef.current === hls) {
              resumeAfterRefreshRef.current = {
                time: video.currentTime,
                shouldPlay: !video.paused,
              };
              const url = new URL(activeUrl, window.location.href);
              url.searchParams.set("token", newToken);
              activeParamsRef.current = url.search;
              hls.loadSource(url.toString());
              hls.startLoad();
              return;
            }
          } catch {
            refreshPromiseRef.current = null;
            // Fall through to standard error handling if token refresh fails
          }
        }

        if (hlsRef.current !== hls) return;

        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (fatalRecoveryAttempts++ < 1) {
                hls.startLoad();
              } else if (!loadFallback()) {
                setFatalError(data.details || "NETWORK_ERROR", `Failed to stream video: ${data.details || "network error"}`);
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              if (fatalRecoveryAttempts++ < 1) {
                hls.recoverMediaError();
              } else if (!loadFallback()) {
                setFatalError(data.details || "MEDIA_ERROR", `Failed to stream video: ${data.details || "media error"}`);
              }
              break;
            default:
              if (!loadFallback()) {
                setFatalError(data.details || "MEDIA_PLAYBACK_ERROR", `Failed to stream video: ${data.details || "network error"}`);
              }
              break;
          }
        }
      });
    } else if (isHlsUrl && video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari / iOS Native HLS
      video.src = activeUrl;
      const nativeTokenRefresh = startNativeTokenRefresh(
        video,
        activeUrl,
        callbacksRef.current.refreshToken,
      );
      const onLoaded = () => {
        setIsBuffering(false);
        callbacksRef.current.onReady?.();
        restoreSavedPosition(video);
        if (autoPlay) {
          video.play().catch(() => {});
        }
      };
      const onNativeError = () => {
        void nativeTokenRefresh.refreshNow().then((refreshed) => {
          if (refreshed || hlsRef.current) return;
          if (loadFallback()) {
            video.removeEventListener("error", onNativeError);
            return;
          }
          setFatalError("NATIVE_HLS_ERROR", "Failed to play native HLS stream");
        });
      };
      video.addEventListener("loadedmetadata", onLoaded);
      video.addEventListener("error", onNativeError);
      return () => {
        nativeTokenRefresh.stop();
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onNativeError);
      };
    } else if (!isHlsUrl) {
      // Standard MP4 progressive playback
      video.src = activeUrl;
      const onLoaded = () => {
        setIsBuffering(false);
        callbacksRef.current.onReady?.();
      };
      const onErr = () => {
        const errObj = {
          code: "DIRECT_PLAYBACK_ERROR",
          message: "Unable to load media source",
          fatal: true,
        };
        setError(errObj);
        callbacksRef.current.onError?.(errObj);
        setIsBuffering(false);
      };
      video.addEventListener("loadeddata", onLoaded);
      video.addEventListener("error", onErr);
      return () => {
        video.removeEventListener("loadeddata", onLoaded);
        video.removeEventListener("error", onErr);
      };
    } else if (fallbackSrc) {
      // HLS unsupported: use the configured progressive fallback.
      loadFallback();
    } else {
      const errObj = {
        code: "HLS_UNSUPPORTED",
        message: "This browser does not support HLS playback and no fallback source was provided",
        fatal: true,
      };
      setError(errObj);
      callbacksRef.current.onError?.(errObj);
      setIsBuffering(false);
    }

    return () => {
      cleanupFallback();
      destroyHls();
    };
  }, [activeUrl, fallbackSrc, autoPlay, reloadTrigger, destroyHls]);

  // Video Element Event Listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlayEvent = () => {
      setIsPlaying(true);
      callbacksRef.current.onPlay?.();
    };

    const onPauseEvent = () => {
      setIsPlaying(false);
      callbacksRef.current.onPause?.();
    };

    const onEndedEvent = () => {
      setIsPlaying(false);
      if (storageKey && typeof window !== "undefined") {
        try { localStorage.removeItem(storageKey); } catch {}
      }
      callbacksRef.current.onEnded?.();
    };

    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);

    const updateBufferProgress = () => {
      if (video.buffered.length > 0 && video.duration > 0) {
        const cur = video.currentTime;
        let endSec = 0;
        for (let i = 0; i < video.buffered.length; i++) {
          const start = video.buffered.start(i);
          const end = video.buffered.end(i);
          if ((start <= cur || (i === 0 && start <= 0.5)) && end >= cur) {
            endSec = end;
            break;
          }
        }
        if (endSec === 0 && video.buffered.length > 0 && cur <= 0.5) {
          endSec = video.buffered.end(0);
        }
        const pct = (endSec / video.duration) * 100;
        setBuffered(Math.max(0, Math.min(100, isNaN(pct) ? 0 : pct)));
      }
    };

    const onTimeUpdateEvent = () => {
      setCurrentTime(video.currentTime);
      callbacksRef.current.onTimeUpdate?.(video.currentTime, video.duration);

      if (storageKey && video.duration > 0 && typeof window !== "undefined") {
        if (video.currentTime >= video.duration * 0.95) {
          try { localStorage.removeItem(storageKey); } catch {}
        } else if (video.currentTime > 3 && Math.abs(video.currentTime - lastSavedTimeRef.current) >= 3) {
          lastSavedTimeRef.current = video.currentTime;
          try { localStorage.setItem(storageKey, video.currentTime.toFixed(1)); } catch {}
        }
      }

      updateBufferProgress();
    };

    const onDurationChange = () => {
      setDuration(video.duration || 0);
      updateBufferProgress();
    };
    const onVolumeChangeEvent = () => {
      setVolumeState(video.volume);
      setIsMuted(video.muted);
    };

    video.addEventListener("play", onPlayEvent);
    video.addEventListener("pause", onPauseEvent);
    video.addEventListener("ended", onEndedEvent);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("timeupdate", onTimeUpdateEvent);
    video.addEventListener("progress", updateBufferProgress);
    video.addEventListener("seeked", updateBufferProgress);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("volumechange", onVolumeChangeEvent);

    return () => {
      video.removeEventListener("play", onPlayEvent);
      video.removeEventListener("pause", onPauseEvent);
      video.removeEventListener("ended", onEndedEvent);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("timeupdate", onTimeUpdateEvent);
      video.removeEventListener("progress", updateBufferProgress);
      video.removeEventListener("seeked", updateBufferProgress);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("volumechange", onVolumeChangeEvent);
    };
  }, []);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Player Actions
  const play = useCallback(async () => {
    if (videoRef.current) {
      await videoRef.current.play();
    }
  }, []);

  const pause = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    if (videoRef.current) {
      const clamped = Math.max(0, Math.min(time, videoRef.current.duration || time));
      videoRef.current.currentTime = clamped;
      if (storageKey && typeof window !== "undefined") {
        lastSavedTimeRef.current = clamped;
        try { localStorage.setItem(storageKey, clamped.toFixed(1)); } catch {}
      }
    }
  }, [storageKey]);

  const setVolume = useCallback((vol: number) => {
    if (videoRef.current) {
      const clamped = Math.max(0, Math.min(1, vol));
      videoRef.current.volume = clamped;
      videoRef.current.muted = clamped === 0;
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
    }
  }, []);

  const setQuality = useCallback((levelIndex: number) => {
    if (hlsRef.current) {
      if (levelIndex === -1) {
        hlsRef.current.currentLevel = -1; // Auto
      } else {
        hlsRef.current.currentLevel = levelIndex;
      }
      setCurrentQuality(levelIndex);
    }
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      setPlaybackRateState(rate);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current || videoRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const togglePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch {
      // Ignored
    }
  }, []);

  return {
    videoRef,
    containerRef,
    isPlaying,
    isBuffering,
    currentTime,
    duration,
    buffered,
    volume,
    isMuted,
    isFullscreen,
    qualityLevels,
    currentQuality,
    playbackRate,
    error,
    play,
    pause,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    setQuality,
    setPlaybackRate,
    toggleFullscreen,
    togglePiP,
    retry,
  };
}
