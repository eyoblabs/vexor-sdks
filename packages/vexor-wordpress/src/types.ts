import type { WatermarkConfig } from "../shared-types";

export interface VexorVanillaPlayerOptions {
  src?: string;
  assetId?: string;
  token?: string;
  baseUrl?: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  preload?: "auto" | "metadata" | "none";
  fallbackSrc?: string;
  watermark?: string | WatermarkConfig;
  /** Casual-copy deterrent only; does not prevent capture or guarantee access control. */
  protect?: boolean;
  /** Automatically resume playback position across page reloads (default: true). */
  resume?: boolean;
  refreshToken?: () => Promise<string>;
  onReady?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onError?: (error: { code: string; message: string; fatal: boolean }) => void;
}
