import React, { useState, useEffect, useRef, useCallback } from "react";
import { useVexorPlayer } from "../hooks/useVexorPlayer";
import { Controls } from "./Controls";
import { Watermark } from "./Watermark";
import type { VexorPlayerProps } from "../types";

export const VexorPlayer: React.FC<VexorPlayerProps> = (props) => {
  const {
    poster,
    preload = "metadata",
    muted = false,
    loop = false,
    controls = true,
    nativeControls = false,
    watermark,
    protect = false,
    className = "",
    style,
    children,
  } = props;

  const player = useVexorPlayer(props);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetHideTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    if (player.isPlaying && !player.containerRef.current?.contains(document.activeElement)) {
      hideTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 2500);
    }
  }, [player.isPlaying]);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [player.isPlaying, resetHideTimer]);

  // Anti-tamper protection handlers
  const handleContextMenu = (e: React.MouseEvent) => {
    if (protect) {
      e.preventDefault();
    }
  };

  // Keyboard navigation & shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Leave keystrokes to focused form controls, buttons, and custom controls.
      const target = e.target as HTMLElement;
      if (target?.closest("input, textarea, select, button, [contenteditable='true'], [role='slider']")) return;

      const container = player.containerRef.current;
      if (!container || (!document.fullscreenElement && !container.contains(document.activeElement) && !container.matches(":hover"))) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case " ":
        case "k":
          e.preventDefault();
          player.togglePlay();
          resetHideTimer();
          break;
        case "arrowleft":
        case "j":
          e.preventDefault();
          player.seek(player.currentTime - 5);
          resetHideTimer();
          break;
        case "arrowright":
        case "l":
          e.preventDefault();
          player.seek(player.currentTime + 5);
          resetHideTimer();
          break;
        case "arrowup":
          e.preventDefault();
          player.setVolume(player.volume + 0.1);
          resetHideTimer();
          break;
        case "arrowdown":
          e.preventDefault();
          player.setVolume(player.volume - 0.1);
          resetHideTimer();
          break;
        case "m":
          e.preventDefault();
          player.toggleMute();
          resetHideTimer();
          break;
        case "f":
          e.preventDefault();
          player.toggleFullscreen();
          resetHideTimer();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [player, resetHideTimer]);

  return (
    <div
      ref={player.containerRef}
      className={`vexor-player ${player.isFullscreen ? "is-fullscreen" : ""} ${protect ? "is-protected" : ""} ${className}`}
      style={style}
      onMouseMove={resetHideTimer}
      onMouseLeave={(event) => {
        if (player.isPlaying && !event.currentTarget.contains(document.activeElement)) {
          setControlsVisible(false);
        }
      }}
      onFocusCapture={() => {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        setControlsVisible(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resetHideTimer();
      }}
      onContextMenu={handleContextMenu}
      tabIndex={0}
      role="region"
      aria-label="Video Player"
    >
      <video
        ref={player.videoRef}
        className="vexor-video"
        poster={poster}
        preload={preload}
        muted={muted}
        loop={loop}
        playsInline
        controls={nativeControls}
        onClick={nativeControls ? undefined : player.togglePlay}
      />

      {/* Watermark Overlay */}
      {watermark && <Watermark config={watermark} />}

      {/* Buffering Spinner */}
      {player.isBuffering && !player.error && (
        <div className="vexor-spinner-overlay" aria-label="Buffering video">
          <div className="vexor-spinner" />
        </div>
      )}

      {/* Center Big Play Button (when paused, not buffering, and custom controls active) */}
      {!nativeControls && controls && !player.isPlaying && !player.isBuffering && !player.error && (
        <button type="button" className="vexor-center-play-overlay" onClick={player.togglePlay} aria-label="Play video">
          <span className="vexor-center-play-button" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6,4 20,12 6,20" />
            </svg>
          </span>
        </button>
      )}

      {/* Custom Controls Bar */}
      {!nativeControls && controls && !player.error && (
        <Controls
          isPlaying={player.isPlaying}
          isBuffering={player.isBuffering}
          currentTime={player.currentTime}
          duration={player.duration}
          buffered={player.buffered}
          volume={player.volume}
          isMuted={player.isMuted}
          isFullscreen={player.isFullscreen}
          qualityLevels={player.qualityLevels}
          currentQuality={player.currentQuality}
          playbackRate={player.playbackRate}
          visible={controlsVisible}
          onPlayPause={player.togglePlay}
          onSeek={player.seek}
          onVolumeChange={player.setVolume}
          onToggleMute={player.toggleMute}
          onQualityChange={player.setQuality}
          onPlaybackRateChange={player.setPlaybackRate}
          onToggleFullscreen={player.toggleFullscreen}
          onTogglePiP={player.togglePiP}
        />
      )}

      {/* Error Overlay */}
      {player.error && (
        <div className="vexor-error-overlay">
          <div className="vexor-error-title">Playback Error</div>
          <div className="vexor-error-message">{player.error.message}</div>
          <button type="button" className="vexor-retry-button" onClick={player.retry}>
            Retry Playback
          </button>
        </div>
      )}

      {/* Custom Child Overlays */}
      {children}
    </div>
  );
};
