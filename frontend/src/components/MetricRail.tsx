import type { Snapshot } from '@/lib/store';
import { num, pct, ms } from '@/lib/format';

function Row({
  label,
  value,
  hint,
  fill,
  tone = 'cyan',
  pending,
}: {
  label: string;
  value: string;
  hint?: string;
  fill?: number;
  tone?: 'cyan' | 'mint' | 'amber';
  pending?: boolean;
}) {
  const color = tone === 'mint' ? '#00FF9C' : tone === 'amber' ? '#FFB800' : '#00D4FF';
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between">
        <span className="metric-label">{label}</span>
        <span className={`font-mono text-sm ${pending ? 'text-white/35' : 'text-white/90'}`}>{value}</span>
      </div>
      {fill != null && (
        <div className="bar-track mt-2 h-1.5 overflow-hidden rounded-full">
          <div
            className="h-full rounded-full transition-all duration-300 ease-out"
            style={{ width: `${Math.max(2, Math.min(100, fill * 100))}%`, background: color }}
          />
        </div>
      )}
      {hint && <p className="mt-1.5 text-xs text-white/40">{hint}</p>}
    </div>
  );
}

export default function MetricRail({
  snapshot,
  enabled,
}: {
  snapshot: Snapshot | null;
  enabled: Record<string, boolean>;
}) {
  const s = snapshot;
  const lat = s?.answerLatency;

  return (
    <div className="glass divide-y divide-white/5 p-5">
      <div className="pb-3">
        <h3 className="text-sm font-semibold text-white/80">Delivery metrics</h3>
        <p className="mt-1 text-xs text-white/40">
          Descriptive only — a mirror of how this answer sounds, not a score of the speaker. Values
          appear once there is enough audio to be meaningful.
        </p>
      </div>

      {enabled.pace && (
        <Row
          label="Speaking pace"
          value={s?.pace.wpm == null ? 'gathering…' : `${s.pace.wpm} wpm`}
          pending={s?.pace.wpm == null}
          hint={
            s?.pace.wpm == null
              ? 'needs ~4s of speech and a few words'
              : `${s?.pace.descriptor} · smoothed over ${s?.pace.window}`
          }
          fill={s?.pace.wpm == null ? 0 : Math.min(1, s.pace.wpm / 240)}
          tone={s?.pace.descriptor === 'fast' ? 'amber' : s?.pace.descriptor === 'measured' ? 'mint' : 'cyan'}
        />
      )}

      {enabled.pauses && (
        <Row
          label="Pauses"
          value={`${s?.pauses.count ?? 0}`}
          hint={
            s?.pauses.longestMs
              ? `mean ${ms(s.pauses.meanMs)} · longest ${ms(s.pauses.longestMs)}`
              : 'silences over 0.6s during an answer'
          }
        />
      )}

      {enabled.fillers && (
        <Row
          label="Filler rate"
          value={
            !s?.fillers.ready
              ? 'gathering…'
              : `${num(s.fillers.hardPerMin, 1)}/min hard`
          }
          pending={!s?.fillers.ready}
          hint={
            !s?.fillers.ready
              ? 'needs ~8s of speech'
              : `${num(s.fillers.softPerMin, 1)}/min discourse (${
                  s.fillers.softExamples.join(', ') || 'none'
                }) · ${s.fillers.hardExamples.join(', ') || 'no um/uh heard'}`
          }
          fill={Math.min(1, (s?.fillers.hardPerMin ?? 0) / 12)}
          tone="amber"
        />
      )}

      {enabled.vocabulary && (
        <Row
          label="Vocabulary variety"
          value={s?.vocabulary.variety == null ? 'gathering…' : pct(s.vocabulary.variety)}
          pending={s?.vocabulary.variety == null}
          hint={`${s?.vocabulary.distinctWords ?? 0} distinct · ${pct(
            s?.vocabulary.longWordRate ?? null,
          )} longer words · ~${num(s?.vocabulary.meanUnitLength ?? null, 1)} words/${
            s?.vocabulary.meanUnitBasis === 'punctuation' ? 'sentence' : 'phrase'
          }`}
          fill={s?.vocabulary.variety ?? 0}
          tone="mint"
        />
      )}

      {enabled.delivery && (
        <Row
          label="Talk / silence"
          value={pct(s?.delivery.talkRatio ?? null)}
          hint={`${s?.delivery.speakingSecondsTotal ?? 0}s of speech so far`}
          fill={s?.delivery.talkRatio ?? 0}
        />
      )}

      {enabled.latency && (
        <Row
          label="Answer latency"
          value={
            !lat
              ? 'no question marked'
              : 'alreadySpeaking' in lat
                ? 'was mid-answer'
                : lat.pending
                  ? `waiting ${ms(lat.sinceMs)}`
                  : ms(lat.latencyMs)
          }
          pending={!lat || (lat as any).pending || 'alreadySpeaking' in (lat as any)}
          hint="time from “question asked” to first words"
        />
      )}
    </div>
  );
}
