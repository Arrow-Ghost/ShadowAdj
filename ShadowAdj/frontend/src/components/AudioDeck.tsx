import { useState, useEffect, useRef, useCallback } from 'react';
import { clock } from '@/lib/format';

export interface AudioDeckProps {
  audioUrl: string | null;
  audioRef: React.RefObject<HTMLAudioElement>;
  durationMs: number;
  playbackTimeMs: number;
  onSeek: (timestampMs: number) => void;
  onTimeUpdate: (currentTimeMs: number) => void;
}

const SPEED_OPTIONS = [0.75, 1.0, 1.25, 1.5];

export default function AudioDeck({
  audioUrl,
  audioRef,
  durationMs,
  playbackTimeMs,
  onSeek,
  onTimeUpdate,
}: AudioDeckProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [audioDurationMs, setAudioDurationMs] = useState(durationMs);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);

  // A-B Looping states
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [isLooping, setIsLooping] = useState(false);

  const isDraggingRef = useRef(false);

  const totalMs = Math.max(1000, audioDurationMs || durationMs);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [audioRef]);

  const skipSeconds = useCallback(
    (deltaSeconds: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const nextTime = Math.max(0, Math.min(totalMs / 1000, audio.currentTime + deltaSeconds));
      audio.currentTime = nextTime;
      onSeek(nextTime * 1000);
    },
    [audioRef, totalMs, onSeek],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      if (isLooping && loopA != null) {
        audio.currentTime = loopA / 1000;
        audio.play().catch(() => {});
      } else {
        setIsPlaying(false);
      }
    };
    const handleDurationChange = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setAudioDurationMs(Math.max(durationMs, audio.duration * 1000));
      }
    };
    const handleTimeUpdate = () => {
      const curMs = audio.currentTime * 1000;
      if (isLooping && loopB != null && loopA != null && curMs >= loopB) {
        audio.currentTime = loopA / 1000;
        onTimeUpdate(loopA);
        return;
      }
      if (!isDraggingRef.current) {
        onTimeUpdate(curMs);
      }
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('loadedmetadata', handleDurationChange);
    audio.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('loadedmetadata', handleDurationChange);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [audioRef, onTimeUpdate, durationMs, isLooping, loopA, loopB]);

  // Global keyboard shortcuts for review deck
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        skipSeconds(-3);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        skipSeconds(3);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, skipSeconds]);

  if (!audioUrl) return null;

  const progressRatio = Math.max(0, Math.min(1, playbackTimeMs / totalMs));

  const changeSpeed = (speed: number) => {
    setPlaybackRate(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVol = Number(e.target.value);
    setVolume(nextVol);
    setIsMuted(nextVol === 0);
    if (audioRef.current) {
      audioRef.current.volume = nextVol;
      audioRef.current.muted = nextVol === 0;
    }
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (audioRef.current) {
      audioRef.current.muted = nextMuted;
    }
  };

  const setPointA = () => {
    setLoopA(playbackTimeMs);
    if (loopB != null && playbackTimeMs >= loopB) {
      setLoopB(null);
      setIsLooping(false);
    }
  };

  const setPointB = () => {
    if (loopA == null || playbackTimeMs <= loopA) {
      setLoopA(Math.max(0, playbackTimeMs - 3000));
    }
    setLoopB(playbackTimeMs);
    setIsLooping(true);
  };

  const clearLoop = () => {
    setLoopA(null);
    setLoopB(null);
    setIsLooping(false);
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextMs = Number(e.target.value);
    onTimeUpdate(nextMs);
    if (audioRef.current) {
      audioRef.current.currentTime = nextMs / 1000;
    }
    onSeek(nextMs);
  };

  return (
    <div className="glass mb-4 overflow-hidden border border-cyan/30 bg-gradient-to-r from-cyan/10 via-panel to-mint/5 p-4 shadow-xl">
      {/* Hidden audio element that provides the audio stream */}
      <audio ref={audioRef} src={audioUrl} preload="auto" className="hidden" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan/15 text-cyan shadow-[0_0_15px_rgba(0,212,255,0.25)]">
            <span className="text-xl">🎧</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight text-white">Shadow Replay</span>
              <span className="rounded bg-cyan/20 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-cyan">
                RAM ONLY
              </span>
              {isLooping && (
                <span className="rounded bg-mint/20 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-mint animate-pulse">
                  A-B Loop Active
                </span>
              )}
            </div>
            <p className="text-xs text-white/50">
              Interactive review deck · Space to Play/Pause · Left/Right arrows to seek
            </p>
          </div>
        </div>

        {/* Playback Controls & Speed & Volume */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Skip Back 5s */}
          <button
            onClick={() => skipSeconds(-5)}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/70 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
            title="Rewind 5 seconds (← arrow key)"
          >
            -5s
          </button>

          {/* Play/Pause Button */}
          <button
            onClick={togglePlay}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-cyan/50 bg-cyan/20 px-4 text-xs font-semibold text-cyan shadow-[0_0_15px_rgba(0,212,255,0.3)] transition hover:bg-cyan/30 active:scale-95"
          >
            {isPlaying ? (
              <>
                <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
                <span>Pause</span>
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
                <span>Play</span>
              </>
            )}
          </button>

          {/* Skip Forward 5s */}
          <button
            onClick={() => skipSeconds(5)}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/70 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
            title="Forward 5 seconds (→ arrow key)"
          >
            +5s
          </button>

          {/* Speed Selector */}
          <div className="flex items-center rounded-lg border border-white/10 bg-black/30 p-0.5 text-[11px] font-mono">
            {SPEED_OPTIONS.map((speed) => (
              <button
                key={speed}
                onClick={() => changeSpeed(speed)}
                className={`rounded px-1.5 py-0.5 transition ${
                  playbackRate === speed
                    ? 'bg-cyan/25 font-bold text-cyan shadow-sm'
                    : 'text-white/40 hover:text-white/80'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>

          {/* Volume Control */}
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2 py-1">
            <button
              onClick={toggleMute}
              className="text-xs text-white/60 hover:text-white"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0 ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="h-1.5 w-14 cursor-pointer"
              title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
            />
          </div>

          {/* A-B Loop Buttons */}
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 p-0.5 text-[11px] font-mono">
            <button
              onClick={setPointA}
              className={`rounded px-2 py-0.5 transition ${
                loopA != null ? 'bg-cyan/30 text-cyan font-semibold' : 'text-white/40 hover:text-white'
              }`}
              title="Set Loop Point [A] at current time"
            >
              [A {loopA != null ? clock(loopA) : ''}
            </button>
            <button
              onClick={setPointB}
              className={`rounded px-2 py-0.5 transition ${
                loopB != null ? 'bg-mint/30 text-mint font-semibold' : 'text-white/40 hover:text-white'
              }`}
              title="Set Loop Point [B] at current time"
            >
              B] {loopB != null ? clock(loopB) : ''}
            </button>
            {(loopA != null || loopB != null) && (
              <button
                onClick={clearLoop}
                className="rounded px-1.5 py-0.5 text-white/40 hover:text-rose"
                title="Clear loop"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrub Bar & Time Display */}
      <div className="mt-3 flex items-center gap-3">
        <span className="font-mono text-xs text-cyan">{clock(playbackTimeMs)}</span>
        <div className="relative flex-1">
          {/* Progress bar background fill */}
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-black/50">
            {/* A-B Loop segment highlight */}
            {loopA != null && loopB != null && loopB > loopA && (
              <div
                className="absolute top-0 bottom-0 bg-mint/35 border-x border-mint"
                style={{
                  left: `${(loopA / totalMs) * 100}%`,
                  width: `${((loopB - loopA) / totalMs) * 100}%`,
                }}
              />
            )}
            <div
              className="h-full bg-gradient-to-r from-cyan to-mint transition-all duration-75"
              style={{ width: `${progressRatio * 100}%` }}
            />
          </div>
          {/* Range input scrub control */}
          <input
            type="range"
            min={0}
            max={totalMs}
            value={playbackTimeMs}
            onMouseDown={() => {
              isDraggingRef.current = true;
            }}
            onMouseUp={() => {
              isDraggingRef.current = false;
            }}
            onTouchStart={() => {
              isDraggingRef.current = true;
            }}
            onTouchEnd={() => {
              isDraggingRef.current = false;
            }}
            onChange={handleSliderChange}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
        <span className="font-mono text-xs text-white/40">{clock(totalMs)}</span>
      </div>
    </div>
  );
}

