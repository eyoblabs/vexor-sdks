import React, { useState, useRef, useEffect, useCallback } from "react";
import type { QualityLevel } from "../types";

interface ControlsProps {
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
  visible: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onQualityChange: (levelIndex: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  onToggleFullscreen: () => void;
  onTogglePiP: () => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const Controls: React.FC<ControlsProps> = ({
  isPlaying,
  currentTime,
  duration,
  buffered,
  volume,
  isMuted,
  isFullscreen,
  qualityLevels,
  currentQuality,
  playbackRate,
  visible,
  onPlayPause,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onQualityChange,
  onPlaybackRateChange,
  onToggleFullscreen,
  onTogglePiP,
}) => {
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [pictureInPictureSupported, setPictureInPictureSupported] = useState(false);

  useEffect(() => {
    setPictureInPictureSupported(
      typeof document !== "undefined" && document.pictureInPictureEnabled
    );
  }, []);

  const playedPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];

  const handleScrub = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!progressRef.current || duration <= 0) return;
      const rect = progressRef.current.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(pos * duration);
    },
    [duration, onSeek]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsScrubbing(true);
    handleScrub(e);
  };

  const handleTimelineKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const step = e.shiftKey ? 30 : 5;
    let nextTime: number | undefined;
    if (e.key === "ArrowLeft") nextTime = currentTime - step;
    if (e.key === "ArrowRight") nextTime = currentTime + step;
    if (e.key === "Home") nextTime = 0;
    if (e.key === "End") nextTime = duration;
    if (nextTime !== undefined) {
      e.preventDefault();
      onSeek(Math.max(0, Math.min(duration, nextTime)));
    }
  };

  return (
    <div className={`vexor-controls ${visible ? "" : "is-hidden"}`}>
      {/* Timeline Scrubber */}
      <div
        className="vexor-progress-container"
        ref={progressRef}
        onPointerDown={handlePointerDown}
        onPointerMove={(event) => { if (isScrubbing) handleScrub(event); }}
        onPointerUp={(event) => {
          if (progressRef.current?.hasPointerCapture(event.pointerId)) {
            progressRef.current.releasePointerCapture(event.pointerId);
          }
          setIsScrubbing(false);
        }}
        onPointerCancel={() => setIsScrubbing(false)}
        onKeyDown={handleTimelineKeyDown}
        tabIndex={0}
        role="slider"
        aria-label="Video timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.min(currentTime, duration || 0)}
        aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
      >
        <div className="vexor-progress-track">
          <div className="vexor-progress-buffer" style={{ width: `${buffered}%` }} />
          <div className="vexor-progress-played" style={{ width: `${playedPercent}%` }} />
          <div className="vexor-progress-thumb" style={{ left: `${playedPercent}%` }} />
        </div>
      </div>

      {/* Control Buttons Row */}
      <div className="vexor-controls-row">
        {/* Left Side: Play/Pause, Volume, Time */}
        <div className="vexor-controls-group">
          <button
            type="button"
            className="vexor-btn"
            onClick={onPlayPause}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </button>

          <div className="vexor-volume-wrapper">
            <button
              type="button"
              className="vexor-btn"
              onClick={onToggleMute}
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted || volume === 0 ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              className="vexor-volume-slider"
              aria-label="Volume slider"
            />
          </div>

          <span className="vexor-time-display">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        {/* Right Side: Speed, Quality, PiP, Fullscreen */}
        <div className="vexor-controls-group">
          {/* Speed Selector */}
          <div className="vexor-menu-anchor">
            <button
              type="button"
              className="vexor-btn"
              onClick={() => {
                setShowSpeedMenu(!showSpeedMenu);
                setShowQualityMenu(false);
              }}
              aria-label="Playback speed"
              style={{ fontSize: "11px", fontWeight: 600, padding: "4px 8px" }}
            >
              {playbackRate === 1 ? "1x" : `${playbackRate}x`}
            </button>

            {showSpeedMenu && (
              <div className="vexor-menu-dropdown">
                {speedOptions.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    className={`vexor-menu-item ${playbackRate === rate ? "is-active" : ""}`}
                    onClick={() => {
                      onPlaybackRateChange(rate);
                      setShowSpeedMenu(false);
                    }}
                  >
                    <span>{rate}x</span>
                    {playbackRate === rate && <span>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Quality Levels Selector */}
          {qualityLevels.length > 0 && (
            <div className="vexor-menu-anchor">
              <button
                type="button"
                className="vexor-btn"
                onClick={() => {
                  setShowQualityMenu(!showQualityMenu);
                  setShowSpeedMenu(false);
                }}
                aria-label="Video quality"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>

              {showQualityMenu && (
                <div className="vexor-menu-dropdown">
                  <button
                    type="button"
                    className={`vexor-menu-item ${currentQuality === -1 ? "is-active" : ""}`}
                    onClick={() => {
                      onQualityChange(-1);
                      setShowQualityMenu(false);
                    }}
                  >
                    <span>Auto</span>
                    {currentQuality === -1 && <span>✓</span>}
                  </button>
                  {qualityLevels.map((lvl) => (
                    <button
                      key={lvl.id}
                      type="button"
                      className={`vexor-menu-item ${currentQuality === lvl.id ? "is-active" : ""}`}
                      onClick={() => {
                        onQualityChange(lvl.id);
                        setShowQualityMenu(false);
                      }}
                    >
                      <span>{lvl.label}</span>
                      {currentQuality === lvl.id && <span>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Picture in Picture */}
          {pictureInPictureSupported && (
            <button
              type="button"
              className="vexor-btn"
              onClick={onTogglePiP}
              aria-label="Picture in picture"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <rect x="12" y="9" width="8" height="6" rx="1" fill="currentColor" fillOpacity="0.4" />
              </svg>
            </button>
          )}

          {/* Fullscreen Toggle */}
          <button
            type="button"
            className="vexor-btn"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
