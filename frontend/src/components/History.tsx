import { useEffect, useState } from 'react';
import { loadHistory, deleteHistory, download, toCSV, type HistoryEntry } from '@/lib/history';
import { clock, num, pct } from '@/lib/format';
import AnimatedNumber from '@/lib/ui/AnimatedNumber';
import { toast } from '@/lib/ui/toast';

export default function History() {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // A tick of skeleton so the read from localStorage doesn't flash.
    const t = setTimeout(() => {
      setItems(loadHistory());
      setLoading(false);
    }, 180);
    return () => clearTimeout(t);
  }, []);

  function remove(id: string) {
    deleteHistory(id);
    setItems(loadHistory());
    toast.success('Session deleted');
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="skeleton h-8 w-40" />
        <div className="skeleton mt-2 h-4 w-72" />
        <div className="mt-6 grid gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass p-4">
              <div className="skeleton h-5 w-48" />
              <div className="skeleton mt-2 h-3 w-64" />
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[0, 1, 2, 3, 4].map((j) => (
                  <div key={j} className="skeleton h-9" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="reveal reveal-scale glass mx-auto mt-12 max-w-lg p-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan/30 bg-cyan/10 font-mono text-xs font-bold text-cyan">
          ARCHIVE
        </div>
        <h1 className="mt-4 text-lg font-semibold text-white">No saved sessions yet</h1>
        <p className="mt-1.5 text-sm text-white/50">
          Finish a practice run and it's stored in this browser only — nothing is kept on the server.
        </p>
        <a href="/console" className="btn btn-primary mt-5 text-sm">
          Start a session
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="reveal text-2xl font-bold">History</h1>
      <p className="reveal mt-1 text-sm text-white/45">
        Stored locally in this browser. Nothing is kept on the server.
      </p>

      <div className="mt-6 grid gap-3">
        {items.map((e) => (
          <div key={e.id} className="reveal glass p-4 transition-colors hover:border-white/20">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{e.label}</div>
                <div className="text-xs text-white/40">
                  {new Date(e.savedAt).toLocaleString()} · {clock(e.durationMs)} · {e.mode}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn !px-3 !py-1 text-xs"
                  onClick={() => setOpen(open === e.id ? null : e.id)}
                >
                  {open === e.id ? 'Hide' : 'Details'}
                </button>
                <button
                  className="btn !px-3 !py-1 text-xs"
                  onClick={() => {
                    download(`${e.label}.json`, JSON.stringify(e.export, null, 2));
                    toast('Exported JSON');
                  }}
                >
                  JSON
                </button>
                <button
                  className="btn !px-3 !py-1 text-xs"
                  onClick={() => {
                    download(`${e.label}.csv`, toCSV(e), 'text/csv');
                    toast('Exported CSV');
                  }}
                >
                  CSV
                </button>
                <button
                  className="btn !px-3 !py-1 text-xs border-rose/40 text-rose"
                  onClick={() => remove(e.id)}
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <Stat label="Words" value={e.summary.wordCount} />
              <Stat
                label="Pace"
                value={e.summary.paceWpm}
                suffix=" wpm"
                fallback={e.summary.paceWpm == null}
              />
              <Stat label="Pauses" value={e.summary.pauseCount} />
              <Stat
                label="Fillers/min"
                value={e.summary.fillersPerMin}
                decimals={1}
                fallback={e.summary.fillersPerMin == null}
              />
              <Stat
                label="Vocab variety"
                value={e.summary.variety == null ? null : e.summary.variety * 100}
                suffix="%"
                fallback={e.summary.variety == null}
              />
            </div>

            {open === e.id && (
              <div className="mt-4 space-y-3 border-t border-white/5 pt-3">
                <div>
                  <div className="metric-label">Transcript</div>
                  <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-white/70">
                    {e.export.transcript || '—'}
                  </p>
                </div>
                <div>
                  <div className="metric-label">Timeline</div>
                  <ul className="mt-1 space-y-0.5 font-mono text-xs text-white/55">
                    {(e.export.timeline || []).map((ev: any, i: number) => (
                      <li key={i}>
                        {clock(ev.t)} · {ev.kind}
                        {ev.meta?.durationMs ? ` (${ev.meta.durationMs}ms)` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  suffix = '',
  decimals = 0,
  fallback = false,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  decimals?: number;
  fallback?: boolean;
}) {
  return (
    <div>
      <div className="metric-label">{label}</div>
      <div className="font-mono text-white/85">
        {fallback || value == null ? (
          '—'
        ) : (
          <>
            <AnimatedNumber value={value} format={(n) => n.toFixed(decimals)} />
            {suffix}
          </>
        )}
      </div>
    </div>
  );
}
