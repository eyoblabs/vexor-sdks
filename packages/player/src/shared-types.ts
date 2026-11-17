export interface QualityLevel {
  /** Internal Hls.js quality level index (-1 for Auto) */
  id: number;
  /** Video frame height (e.g. 1080, 720, 480, 360, 240, or 0 for audio) */
  height: number;
  /** Video frame width */
  width: number;
  /** Stream bitrate in bits/sec */
  bitrate: number;
  /** Human-readable label (e.g. "1080p", "720p", "Audio only") */
  label: string;
}

export interface WatermarkConfig {
  /** Watermark text, such as a viewer identifier */
  text: string;
  /** Position strategy. Dynamic movement can make cropping less convenient. */
  position?: "dynamic" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  /** Reposition interval in seconds when position is dynamic (default: 15) */
  intervalSeconds?: number;
  /** Text opacity from 0.0 to 1.0 (default: 0.35) */
  opacity?: number;
  /** Font size (e.g. "12px", 12) */
  fontSize?: number | string;
  /** Text color (default: "#ffffff") */
  color?: string;
}
