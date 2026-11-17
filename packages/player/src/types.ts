import type { CSSProperties, ReactNode } from "react";
import type { WatermarkConfig } from "./shared-types";

export type { QualityLevel, WatermarkConfig } from "./shared-types";

export interface VexorPlayerProps {
  /** Full authenticated HLS manifest URL. */
  src?: string;
  /** Vexor asset UUID used when src is not provided. */
  assetId?: string;
  /** Short-lived playback token used with assetId. */
  token?: string;
  /** Vexor API base URL (default: https://api.vexor.et). */
  baseUrl?: string;
  /** Poster thumbnail URL. */
  poster?: string;
  /** Automatically start playback (browser policy may require muted=true). */
  autoPlay?: boolean;
  /** Start audio muted. */
  muted?: boolean;
  /** Loop playback. */
  loop?: boolean;
  /** HTML video preload behavior. */
  preload?: "auto" | "metadata" | "none";
  /** Fallback URL if HLS is unsupported or cannot be played. */
  fallbackSrc?: string;
  /** Display custom controls (default: true). */
  controls?: boolean;
  /** Use browser native controls instead of Vexor controls. */
  nativeControls?: boolean;
  /** Visible watermark overlay; this is a deterrent, not DRM or capture prevention. */
  watermark?: string | WatermarkConfig;
  /** Suppress context menu and drag interactions as a casual-copy deterrent only. */
  protect?: boolean;
  /** Automatically resume playback position across page reloads (default: true). */
  resume?: boolean;
  /** Retrieve a fresh playback token when an active token expires. */
  refreshToken?: () => Promise<string>;
  /** Playback lifecycle callbacks. */
  onReady?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onError?: (error: { code: string; message: string; fatal: boolean }) => void;
  onQualityChange?: (levelIndex: number) => void;
  /** Custom child elements rendered over the player. */
  children?: ReactNode;
  /** CSS class name applied to player container. */
  className?: string;
  /** Inline styles applied to player container. */
  style?: CSSProperties;
}
