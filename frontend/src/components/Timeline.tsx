import type { EnergyPoint, Snapshot } from '@/lib/store';
import { clock } from '@/lib/format';

const KIND_STYLE: Record<string, { color: string; label: string }> = {
  question: { color: '#00D4FF', label: 'Question asked' },
  pause: { color: '#8aa0b4', label: 'Pause' },
  'long-pause': { color: '#FFB800', label: 'Long pause' },
  'pace-fast': { color: '#FFB800', label: 'Faster passage' },
  'pace-measured': { color: '#00FF9C', label: 'Measured passage' },
};

/**
 * Neutral session timeline. Markers are observations a speaker or coach can
 * refer back to for reflection — deliberately not called "flags" and never
 * coloured as risk. Audio is not retained, so there is nothing to "seek".
 */
export default function Timeline({
  energy,
  snapshot,
}: {
  energy: EnergyPoint[];
  snapshot: Snapshot | null;
}) {
  const dur = Math.max(1, snapshot?.elapsedMs ?? 1);
  const events = (snapshot?.timeline ?? []).filter((e) => KIND_STYLE[e.kind]);
  const recent = [...events].reverse().slice(0, 6);

  return (
    <div className="glass p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/80">Session timeline</h3>
        <span className="font-mono text-xs text-white/40">{clock(dur)}</span>
      </div>

      <div className="relative h-24 w-full overflow-hidden rounded-xl border border-white/5 bg-black/20">
        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 1000 100">
          <polyline
            points={energy
              .map((p, i) => `${(i / Math.max(1, energy.length - 1)) * 1000},${100 - p.v * 92 - 4}`)
              .join(' ')}
            fill="none"
            stroke="#00D4FF"
            strokeOpacity="0.55"
            strokeWidth="1.5"
          />
        </svg>
        {events.map((ev, i) => {
          const st = KIND_STYLE[ev.kind];
          return (
            <div
              key={i}
              title={`${st.label} @ ${clock(ev.t)}`}
              className="absolute top-0 h-full w-[2px]"
              style={{ left: `${(ev.t / dur) * 100}%`, background: st.color, opacity: 0.85 }}
            />
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/45">
        {Object.entries(KIND_STYLE).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: v.color }} />
            {v.label}
          </span>
        ))}
      </div>

      {recent.length > 0 && (
        <ul className="mt-3 space-y-1 font-mono text-xs text-white/55">
          {recent.map((ev, i) => (
            <li key={i}>
              <span className="text-white/35">{clock(ev.t)}</span> · {KIND_STYLE[ev.kind].label}
              {ev.meta?.durationMs ? ` (${(ev.meta.durationMs / 1000).toFixed(1)}s)` : ''}
              {ev.meta?.wpm ? ` (${ev.meta.wpm} wpm)` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
