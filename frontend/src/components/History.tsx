import { useEffect, useState } from 'react';
import { loadHistory, deleteHistory, download, toCSV, type HistoryEntry } from '@/lib/history';
import { clock, num, pct } from '@/lib/format';

export default function History() {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => setItems(loadHistory()), []);

  function remove(id: string) {
    deleteHistory(id);
    setItems(loadHistory());
  }

  if (items.length === 0) {
    return (
      <div className="glass mx-auto mt-10 max-w-lg p-8 text-center text-sm text-white/50">
        No saved sessions yet. Sessions you finish are stored in this browser only.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold">History</h1>
      <p className="mt-1 text-sm text-white/45">Stored locally in this browser. Nothing is kept on the server.</p>

      <div className="mt-6 grid gap-3">
        {items.map((e) => (
          <div key={e.id} className="glass p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{e.label}</div>
                <div className="text-xs text-white/40">
                  {new Date(e.savedAt).toLocaleString()} · {clock(e.durationMs)} · {e.mode}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn !px-3 !py-1 text-xs" onClick={() => setOpen(open === e.id ? null : e.id)}>
                  {open === e.id ? 'Hide' : 'Details'}
                </button>
                <button className="btn !px-3 !py-1 text-xs" onClick={() => download(`${e.label}.json`, JSON.stringify(e.export, null, 2))}>
                  JSON
                </button>
                <button className="btn !px-3 !py-1 text-xs" onClick={() => download(`${e.label}.csv`, toCSV(e), 'text/csv')}>
                  CSV
                </button>
                <button className="btn !px-3 !py-1 text-xs border-rose/40 text-rose" onClick={() => remove(e.id)}>
                  Delete
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <Stat label="Words" value={String(e.summary.wordCount)} />
              <Stat label="Pace" value={e.summary.paceWpm == null ? '—' : `${e.summary.paceWpm} wpm`} />
              <Stat label="Pauses" value={String(e.summary.pauseCount)} />
              <Stat label="Fillers/min" value={e.summary.fillersPerMin == null ? '—' : num(e.summary.fillersPerMin, 1)} />
              <Stat label="Vocab variety" value={pct(e.summary.variety)} />
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="metric-label">{label}</div>
      <div className="font-mono text-white/85">{value}</div>
    </div>
  );
}
