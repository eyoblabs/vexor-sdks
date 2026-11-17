"use client";

import "./styles/player.css";

export { VexorPlayer } from "./components/VexorPlayer";
export { Controls } from "./components/Controls";
export { Watermark } from "./components/Watermark";
export { useVexorPlayer } from "./hooks/useVexorPlayer";
export { createVexorPlayer } from "./vanilla/player";

export type {
  VexorPlayerProps,
  QualityLevel,
  WatermarkConfig,
} from "./types";

export type {
  UseVexorPlayerReturn,
} from "./hooks/useVexorPlayer";

export type {
  VanillaPlayerInstance,
} from "./vanilla/player";
