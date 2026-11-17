const TOKEN_REFRESH_INTERVAL_MS = 4 * 60 * 1000;
const TOKEN_REFRESH_RETRY_MS = 30 * 1000;

/**
 * Refresh native-HLS playback before Vexor's five-minute token expires.
 * Browsers do not expose the native HLS request status to JavaScript, so this
 * timer complements the reactive 401/403 handling used by hls.js.
 */
export function startNativeTokenRefresh(
  video: HTMLVideoElement,
  initialUrl: string,
  refreshToken?: () => Promise<string>,
): { refreshNow: () => Promise<boolean>; stop: () => void } {
  let currentUrl = initialUrl;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let refreshInFlight: Promise<boolean> | null = null;
  let restoreListener: (() => void) | undefined;

  const schedule = (delay = TOKEN_REFRESH_INTERVAL_MS) => {
    if (!refreshToken || disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refreshNow(), delay);
  };

  const refreshNow = (): Promise<boolean> => {
    if (!refreshToken || disposed) return Promise.resolve(false);
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      try {
        const token = await refreshToken();
        if (disposed || !token) return false;

        const nextUrl = new URL(currentUrl, document.baseURI);
        nextUrl.searchParams.set("token", token);
        currentUrl = nextUrl.toString();

        const resumeTime = video.currentTime;
        const shouldResume = !video.paused;
        restoreListener = () => {
          restoreListener = undefined;
          if (disposed) return;
          if (Number.isFinite(resumeTime) && resumeTime > 0) {
            try {
              video.currentTime = resumeTime;
            } catch {
              // The new manifest may not have loaded enough media to seek yet.
            }
          }
          if (shouldResume) video.play().catch(() => {});
        };
        video.addEventListener("loadedmetadata", restoreListener, { once: true });
        video.src = currentUrl;
        video.load();
        schedule();
        return true;
      } catch {
        // Retry soon; do not keep using a token that is about to expire.
        schedule(TOKEN_REFRESH_RETRY_MS);
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  };

  schedule();

  return {
    refreshNow,
    stop: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (restoreListener) video.removeEventListener("loadedmetadata", restoreListener);
    },
  };
}
