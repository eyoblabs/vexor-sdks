import React, { useEffect, useState, useMemo } from "react";
import type { WatermarkConfig } from "../types";

interface WatermarkProps {
  config?: string | WatermarkConfig;
}

export const Watermark: React.FC<WatermarkProps> = ({ config }) => {
  const parsedConfig: WatermarkConfig | null = useMemo(() => {
    if (!config) return null;
    if (typeof config === "string") {
      return { text: config, position: "dynamic", intervalSeconds: 15, opacity: 0.35 };
    }
    return {
      position: "dynamic",
      intervalSeconds: 15,
      opacity: 0.35,
      ...config,
    };
  }, [config]);

  const [coords, setCoords] = useState<{ top: string; left: string }>({ top: "15%", left: "15%" });

  useEffect(() => {
    if (!parsedConfig || parsedConfig.position !== "dynamic") return;

    const intervalMs = Math.max(2, parsedConfig.intervalSeconds || 15) * 1000;
    const updatePosition = () => {
      // Keep watermark inside 10% - 80% range so it doesn't clip
      const top = Math.floor(10 + Math.random() * 70);
      const left = Math.floor(10 + Math.random() * 70);
      setCoords({ top: `${top}%`, left: `${left}%` });
    };

    updatePosition();
    const timer = setInterval(updatePosition, intervalMs);
    return () => clearInterval(timer);
  }, [parsedConfig?.position, parsedConfig?.intervalSeconds]);

  const getPositionStyles = (): React.CSSProperties => {
    switch (parsedConfig?.position) {
      case "top-left":
        return { top: "16px", left: "16px" };
      case "top-right":
        return { top: "16px", right: "16px" };
      case "bottom-left":
        return { bottom: "48px", left: "16px" };
      case "bottom-right":
        return { bottom: "48px", right: "16px" };
      case "center":
        return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
      case "dynamic":
      default:
        return { top: coords.top, left: coords.left };
    }
  };

  if (!parsedConfig) return null;

  return (
    <div
      className="vexor-watermark"
      style={{
        ...getPositionStyles(),
        opacity: Math.max(0, Math.min(1, parsedConfig.opacity ?? 0.35)),
        fontSize: parsedConfig.fontSize ?? "12px",
        color: parsedConfig.color ?? "#ffffff",
      }}
      aria-hidden="true"
    >
      {parsedConfig.text}
    </div>
  );
};
