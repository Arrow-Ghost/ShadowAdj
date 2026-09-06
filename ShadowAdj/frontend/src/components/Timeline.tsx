import { useState } from 'react';
import type { EnergyPoint, Snapshot, SpeechEvent } from '@/lib/store';
import { clock, ms } from '@/lib/format';

export const EVENT_STYLE: Record<string, { color: string; label: string; icon: string }> = {
  question: { color: '#00D4FF', label: 'Question asked', icon: '❓' },
  QUESTION_END: { color: '#00D4FF', label: 'Question asked', icon: '❓' },
  RESPONSE_START: { color: '#00FF9C', label: 'Response start', icon: '⚡' },
  pause: { color: '#8aa0b4', label: 'Pause', icon: '⏸' },
  PAUSE: { color: '#8aa0b4', label: 'Pause', icon: '⏸' },
  'long-pause': { color: '#FFB800', label: 'Long pause', icon: '⏳' },
  'pace-fast': { color: '#FFB800', label: 'Pace ↑ (Fast)', icon: '⏩' },
  'pace-measured': { color: '#00FF9C', label: 'Pace (Measured)', icon: '⏱' },
  PACE_CHANGE: { color: '#00D4FF', label: 'Pace change', icon: '📊' },
  FILLER: { color: '#FF9900', label: 'Filler', icon: '💬' },
  RESTART: { color: '#C084FC', label: 'Restart', icon: '🔄' },
  SELF_CORRECTION: { color: '#34D399', label: 'Self-correction', icon: '✏️' },
  REPETITION: { color: '#FB7185', label: 'Repetition', icon: '🔁' },
  LONG_SENTENCE: { color: '#A78BFA', label: 'Long sentence', icon: '📜' },
  LANGUAGE_SWITCH: { color: '#38BDF8', label: 'Language shift', icon: '🌐' },
  TOPIC_DRIFT: { color: '#F43F5E', label: 'Topic drift', icon: '🧭' },
  TOPIC_CHANGE: { color: '#FB923C', label: 'Topic change', icon: '🎯' },
  SPEECH_START: { color: '#4ADE80', label: 'Speech start', icon: '🎙️' },
  SPEECH_END: { color: '#94A3B8', label: 'Speech end', icon: '⏹️' },
};

function getEventStyle(kindOrType?: string) {
  if (!kindOrType) return { color: '#8aa0b4', label: 'Event', icon: '📍' };
  return EVENT_STYLE[kindOrType] || EVENT_STYLE[kindOrType.toLowerCase()] || {
    color: '#8aa0b4',
    label: kindOrType.replace(/_/g, ' '),
    icon: '📍',
  };
}

function getTimeTicks(durationMs: number) {
  let intervalMs = 15000;
  if (durationMs <= 30000) intervalMs = 5000;
  else if (durationMs <= 120000) intervalMs = 15000;
  else if (durationMs <= 300000) intervalMs = 30000;
  else intervalMs = 60000;

  const ticks: { ms: number; pct: number }[] = [];
  for (let t = 0; t <= durationMs; t += intervalMs) {
    ticks.push({ ms: t, pct: (t / Math.max(1, durationMs)) * 100 });
  }
  return ticks;
}

export default function Timeline({
  energy,
  snapshot,
  audioReplayUrl,
  playbackTimeMs,
  onSeekAudio,
  onSelectEvent,
}: {
  energy: EnergyPoint[];
  snapshot: Snapshot | null;
  audioReplayUrl?: string | null;
  playbackTimeMs?: number;
  onSeekAudio?: (timestampMs: number) => void;
  onSelectEvent?: (ev: SpeechEvent | null) => void;
}) {
  const [selectedEvent, setSelectedEvent] = useState<SpeechEvent | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [zoom, setZoom] = useState<number>(1);
  const [hoverTimeMs, setHoverTimeMs] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const dur = Math.max(1, snapshot?.elapsedMs ?? 1);
  const rawEvents = snapshot?.timeline ?? [];

  const events = rawEvents
    .filter((e) => {
      const typeKey = e.type || e.kind || '';
      if (filterType === 'all') return true;
      if (filterType === 'fillers') return typeKey.includes('FILLER') || typeKey === 'filler';
      if (filterType === 'pauses') return typeKey.includes('PAUSE') || typeKey.includes('pause');
      if (filterType === 'restarts') return typeKey.includes('RESTART') || typeKey.includes('SELF_CORRECTION');
      if (filterType === 'pace') return typeKey.includes('PACE');
      if (filterType === 'topics') return typeKey.includes('TOPIC') || typeKey.includes('LANGUAGE');
      return true;
    })
    .sort((a, b) => (a.timestamp ?? a.t ?? 0) - (b.timestamp ?? b.t ?? 0));

  const recent = [...events].reverse().slice(0, 8);
  const timeTicks = getTimeTicks(dur);

  const selectedIndex = events.findIndex(
    (e) =>
      (e.eventId && e.eventId === selectedEvent?.eventId) ||
      (e.timestamp ?? e.t) === (selectedEvent?.timestamp ?? selectedEvent?.t),
  );
  const hasPrev = selectedIndex > 0;
  const hasNext = selectedIndex !== -1 && selectedIndex < events.length - 1;

  const handleSelectEvent = (ev: SpeechEvent) => {
    setSelectedEvent(ev);
    onSelectEvent?.(ev);
    const tMs = ev.timestamp ?? ev.t ?? 0;
    onSeekAudio?.(tMs);
  };

  const handleClearSelection = () => {
    setSelectedEvent(null);
    onSelectEvent?.(null);
  };

  return (
    <div className="glass p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold tracking-tight text-white/90">Speech Debugger Timeline</h3>
          <span className="font-mono text-xs text-white/40">{clock(dur)}</span>
          <span className="text-[11px] text-white/30">({events.length} events)</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center rounded-lg border border-white/10 bg-black/30 p-0.5 text-xs font-mono">
            {[1, 2, 4].map((z) => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`rounded px-2 py-0.5 transition ${
                  zoom === z ? 'bg-cyan/25 font-bold text-cyan' : 'text-white/40 hover:text-white/80'
                }`}
                title={`Zoom timeline to ${z}x`}
              >
                {z}x
              </button>
            ))}
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap gap-1 text-xs">
            {['all', 'pauses', 'fillers', 'restarts', 'pace', 'topics'].map((f) => (
              <button
                key={f}
                onClick={() => setFilterType(f)}
                className={`rounded-lg px-2.5 py-1 capitalize transition ${
                  filterType === f
                    ? 'border border-cyan/50 bg-cyan/15 font-medium text-cyan shadow-[0_0_10px_rgba(0,212,255,0.2)]'
                    : 'border border-white/10 bg-white/5 text-white/50 hover:text-white/80'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scrollable Container for Zoom */}
      <div className="overflow-x-auto pb-1">
        {/* Waveform & Event Scrub Track */}
        <div
          className="group relative h-28 cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-black/50 transition-all duration-200 hover:border-white/25 hover:shadow-[0_0_20px_rgba(0,0,0,0.5)]"
          style={{ width: `${zoom * 100}%`, minWidth: '100%' }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const ratio = Math.max(0, Math.min(1, clickX / rect.width));
            const clickTime = ratio * dur;
            onSeekAudio?.(clickTime);

            // Find closest event within 5s
            let closest: SpeechEvent | null = null;
            let minDiff = Infinity;
            for (const ev of events) {
              const evT = ev.timestamp ?? ev.t ?? 0;
              const diff = Math.abs(evT - clickTime);
              if (diff < minDiff && diff <= 5000) {
                minDiff = diff;
                closest = ev;
              }
            }
            if (closest) {
              setSelectedEvent(closest);
              onSelectEvent?.(closest);
            }
          }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const ratio = Math.max(0, Math.min(1, clickX / rect.width));
            setHoverTimeMs(ratio * dur);
            setHoverX(clickX);
          }}
          onMouseLeave={() => {
            setHoverTimeMs(null);
            setHoverX(null);
          }}
        >
        {/* Subtle grid lines */}
        <div className="pointer-events-none absolute inset-0 flex justify-between opacity-15">
          <div className="h-full w-px bg-white" />
          <div className="h-full w-px bg-white" />
          <div className="h-full w-px bg-white" />
          <div className="h-full w-px bg-white" />
        </div>

        {/* Dynamic Energy Waveform SVG */}
        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 1000 100">
          <defs>
            <linearGradient id="waveGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00D4FF" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#00D4FF" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          {energy.length > 1 && (
            <polygon
              points={`0,100 ${energy
                .map((p, i) => `${(i / Math.max(1, energy.length - 1)) * 1000},${100 - p.v * 92 - 4}`)
                .join(' ')} 1000,100`}
              fill="url(#waveGrad)"
            />
          )}
          <polyline
            points={energy
              .map((p, i) => `${(i / Math.max(1, energy.length - 1)) * 1000},${100 - p.v * 92 - 4}`)
              .join(' ')}
            fill="none"
            stroke="#00D4FF"
            strokeOpacity="0.75"
            strokeWidth="1.5"
          />
        </svg>

        {/* Dynamic Playhead indicator (real-time playback cursor) */}
        {playbackTimeMs != null && playbackTimeMs > 0 && (
          <div
            className="playhead-line pointer-events-none absolute top-0 bottom-0 z-30 w-[2px] bg-cyan transition-all duration-75"
            style={{ left: `${Math.max(0, Math.min(100, (playbackTimeMs / dur) * 100))}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 h-2.5 w-2.5 rounded-full bg-cyan shadow-[0_0_10px_#00d4ff]" />
          </div>
        )}

        {/* Hover scrub tooltip */}
        {hoverTimeMs != null && hoverX != null && (
          <div
            className="pointer-events-none absolute top-2 z-40 -translate-x-1/2 rounded-md border border-white/20 bg-ink/95 px-2 py-0.5 font-mono text-[10px] text-cyan shadow-lg backdrop-blur-md"
            style={{ left: `${hoverX}px` }}
          >
            {clock(hoverTimeMs)}
          </div>
        )}

        {/* Render event tick marks */}
        {events.map((ev, i) => {
          const tMs = ev.timestamp ?? ev.t ?? 0;
          const leftPct = Math.max(0, Math.min(100, (tMs / dur) * 100));
          const st = getEventStyle(ev.type || ev.kind);
          const isSelected = selectedEvent?.eventId === ev.eventId || (selectedEvent && (selectedEvent.timestamp ?? selectedEvent.t) === tMs);

          return (
            <div
              key={ev.eventId || i}
              onClick={(e) => {
                e.stopPropagation();
                handleSelectEvent(ev);
              }}
              title={`${st.label} @ ${clock(tMs)}`}
              className={`group/pin absolute top-0 h-full cursor-pointer transition-all duration-150 ${
                isSelected ? 'z-20 w-[4px]' : 'z-10 w-[2px] hover:w-[4px]'
              }`}
              style={{
                left: `${leftPct}%`,
                background: st.color,
                opacity: isSelected ? 1 : 0.85,
                boxShadow: isSelected ? `0 0 12px ${st.color}` : undefined,
              }}
            >
              <div
                className={`absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full p-0.5 transition-all ${
                  isSelected ? 'scale-125 opacity-100' : 'opacity-0 group-hover/pin:opacity-100'
                }`}
                style={{ background: st.color }}
              >
                <div className="h-2 w-2 rounded-full bg-black" />
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {/* Time Ruler Ticks */}
      <div className="relative mt-1.5 h-4 w-full overflow-hidden text-[10px] font-mono text-white/30 select-none">
        {timeTicks.map((tick) => (
          <div
            key={tick.ms}
            className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
            style={{ left: `${tick.pct}%` }}
          >
            <div className="h-1.5 w-px bg-white/20" />
            <span className="mt-0.5">{clock(tick.ms)}</span>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/50">
        {[
          { key: 'PAUSE', label: 'Pause' },
          { key: 'long-pause', label: 'Long pause' },
          { key: 'FILLER', label: 'Filler' },
          { key: 'RESTART', label: 'Restart' },
          { key: 'SELF_CORRECTION', label: 'Self-correction' },
          { key: 'REPETITION', label: 'Repetition' },
          { key: 'PACE_CHANGE', label: 'Pace change' },
          { key: 'LANGUAGE_SWITCH', label: 'Language shift' },
          { key: 'TOPIC_DRIFT', label: 'Topic drift' },
          { key: 'QUESTION_END', label: 'Question' },
        ].map((item) => {
          const st = getEventStyle(item.key);
          return (
            <span key={item.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: st.color }} />
              {item.label}
            </span>
          );
        })}
      </div>

      {/* Selected Event Inspector Drawer */}
      {selectedEvent && (
        <div className="mt-4 rounded-xl border border-cyan/30 bg-black/60 p-4 shadow-xl backdrop-blur-xl transition-all animate-in fade-in slide-in-from-top-2">
          <div className="flex items-start justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-block rounded-md px-2 py-0.5 text-xs font-semibold text-black shadow-sm"
                style={{ background: getEventStyle(selectedEvent.type || selectedEvent.kind).color }}
              >
                {getEventStyle(selectedEvent.type || selectedEvent.kind).label}
              </span>
              <span className="font-mono text-sm font-medium text-white/90">
                @ {clock(selectedEvent.timestamp ?? selectedEvent.t ?? 0)}
              </span>
              {(selectedEvent.duration || selectedEvent.metrics?.durationMs || selectedEvent.meta?.durationMs) && (
                <span className="text-xs text-white/40">
                  ({ms(selectedEvent.duration || selectedEvent.metrics?.durationMs || selectedEvent.meta?.durationMs)})
                </span>
              )}
            </div>

            {/* Controls: Prev, Next, Close */}
            <div className="flex items-center gap-1">
              <button
                disabled={!hasPrev}
                onClick={selectPrev}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                title="Previous event"
              >
                ← Prev
              </button>
              <button
                disabled={!hasNext}
                onClick={selectNext}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                title="Next event"
              >
                Next →
              </button>
              <button
                onClick={handleClearSelection}
                className="rounded-lg p-1 text-xs text-white/40 transition hover:bg-white/10 hover:text-white ml-1"
                title="Close inspector"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="mt-2.5 space-y-2 text-xs text-white/70">
            {selectedEvent.evidence?.textExcerpt ? (
              <p className="rounded-lg border border-white/10 bg-white/5 p-3 font-sans leading-relaxed text-white/90">
                "{selectedEvent.evidence.textExcerpt}"
              </p>
            ) : selectedEvent.metrics?.token ? (
              <p className="rounded-lg border border-white/10 bg-white/5 p-3 font-sans text-white/90">
                Filler sound: <span className="font-semibold text-cyan">"{selectedEvent.metrics.token}"</span> ({selectedEvent.metrics.kind || 'discourse marker'})
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 font-mono text-[11px] text-white/50">
              <span>
                Span:{' '}
                {clock(selectedEvent.evidence?.startTime ?? selectedEvent.timestamp ?? selectedEvent.t ?? 0)} →{' '}
                {clock(
                  selectedEvent.evidence?.endTime ??
                    (selectedEvent.timestamp ?? selectedEvent.t ?? 0) + (selectedEvent.duration ?? 0),
                )}
              </span>
              {audioReplayUrl && (
                <button
                  onClick={() => onSeekAudio?.(selectedEvent.timestamp ?? selectedEvent.t ?? 0)}
                  className="inline-flex items-center gap-1 rounded-lg border border-cyan/40 bg-cyan/15 px-2.5 py-1 text-xs font-semibold text-cyan shadow-sm transition hover:bg-cyan/25 active:scale-95"
                >
                  ▶ Replay this moment
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity Log */}
      {recent.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-3">
          <div className="metric-label mb-2">Recent Speech Telemetry Events</div>
          <ul className="grid gap-1.5 font-mono text-xs text-white/60 sm:grid-cols-2">
            {recent.map((ev, i) => {
              const tMs = ev.timestamp ?? ev.t ?? 0;
              const st = getEventStyle(ev.type || ev.kind);
              const isSelected = selectedEvent?.eventId === ev.eventId || (selectedEvent && (selectedEvent.timestamp ?? selectedEvent.t) === tMs);

              return (
                <li
                  key={ev.eventId || i}
                  onClick={() => handleSelectEvent(ev)}
                  className={`flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 transition ${
                    isSelected ? 'border border-cyan/40 bg-cyan/10 text-white' : 'hover:bg-white/5'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: st.color }} />
                    <span className="text-white/40">{clock(tMs)}</span>
                    <span className="text-white/80">{st.label}</span>
                  </span>
                  <span className="text-[11px] text-white/40">
                    {ev.metrics?.token
                      ? `"${ev.metrics.token}"`
                      : ev.metrics?.durationMs
                        ? `${(ev.metrics.durationMs / 1000).toFixed(1)}s`
                        : ev.metrics?.wpm
                          ? `${ev.metrics.wpm} wpm`
                          : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
