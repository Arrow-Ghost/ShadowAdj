import { useState } from 'react';
import type { CognitiveMode, Snapshot } from '@/lib/store';
import { num, pct, ms } from '@/lib/format';

const METRIC_EXPLANATIONS: Record<string, { desc: string; disclaimer: string }> = {
  pace: {
    desc: 'Words spoken per minute, normalized by active speaking time rather than wall-clock time.',
    disclaimer: 'This does NOT determine confidence, intelligence, or communication quality.',
  },
  pauses: {
    desc: 'Silences over 0.7s occurring during an answer between spoken portions.',
    disclaimer: 'Pauses are natural tools for thought and emphasis, not flaws.',
  },
  fillers: {
    desc: 'Hesitation sounds (um/uh) and discourse markers (you know, like, actually, basically).',
    disclaimer: 'Fillers are normal discourse markers in natural speech, not signs of deception or weakness.',
  },
  vocabulary: {
    desc: 'Lexical variety measured via MATTR-50 (Moving-Average Type-Token Ratio) and longer word rate.',
    disclaimer: 'Vocabulary variety reflects register and subject matter, not capability.',
  },
  restarts: {
    desc: 'Moments where a sentence or clause was retracted or restarted.',
    disclaimer: 'Restarts are an ordinary part of formulating complex thoughts in real time.',
  },
  repetitions: {
    desc: 'Immediate repeated words ("we we") or repeated 2-4 word phrases.',
    disclaimer: 'Repetition is often used intentionally for rhetorical emphasis.',
  },
  sentences: {
    desc: 'Sentence length and runs exceeding 35 words.',
    disclaimer: 'Long sentences simply indicate complex syntactical structures.',
  },
  delivery: {
    desc: 'Proportion of total time spent speaking vs. pauses.',
    disclaimer: 'Talk ratio varies naturally by speech format and formality.',
  },
  latency: {
    desc: 'Time from when a question was asked to the onset of the speaker\'s first words.',
    disclaimer: 'Latency reflects formulation time, not preparedness or confidence.',
  },
};

function Row({
  id,
  label,
  value,
  hint,
  fill,
  tone = 'cyan',
  pending,
}: {
  id: string;
  label: string;
  value: string;
  hint?: string;
  fill?: number;
  tone?: 'cyan' | 'mint' | 'amber';
  pending?: boolean;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const color = tone === 'mint' ? '#00FF9C' : tone === 'amber' ? '#FFB800' : '#00D4FF';
  const explanation = METRIC_EXPLANATIONS[id];

  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-1.5">
          <span className="metric-label">{label}</span>
          {explanation && (
            <button
              type="button"
              onClick={() => setShowInfo(!showInfo)}
              className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/20 text-[9px] text-white/40 hover:border-cyan/50 hover:text-cyan"
              title="Metric explanation"
            >
              i
            </button>
          )}
        </div>
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

      {showInfo && explanation && (
        <div className="mt-2 rounded-lg border border-white/10 bg-black/40 p-2.5 text-xs">
          <p className="text-white/80">{explanation.desc}</p>
          <p className="mt-1 font-semibold text-amber/90">{explanation.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

export default function MetricRail({
  snapshot,
  enabled,
  cognitiveMode = 'standard',
}: {
  snapshot: Snapshot | null;
  enabled: Record<string, boolean>;
  cognitiveMode?: CognitiveMode;
}) {
  const s = snapshot;
  const lat = s?.answerLatency;

  const showMinimal = cognitiveMode === 'minimal';
  const showStandard = cognitiveMode === 'standard';
  const showDebug = cognitiveMode === 'debug';

  return (
    <div className="glass divide-y divide-white/5 p-5">
      <div className="pb-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/80">Delivery metrics</h3>
          <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan">
            {cognitiveMode} view
          </span>
        </div>
        <p className="mt-1 text-xs text-white/40">
          Descriptive only — a mirror of how this answer sounds, not a score of the speaker. Values
          appear once there is enough audio to be meaningful.
        </p>
      </div>

      {/* Pace - Shown in Minimal, Standard, and Debug */}
      {enabled.pace && (
        <div>
          <Row
            id="pace"
            label="Speaking pace"
            value={s?.pace.wpm == null ? 'gathering…' : `${s.pace.currentWpm ?? s.pace.wpm} wpm`}
            pending={s?.pace.wpm == null}
            hint={
              s?.pace.wpm == null
                ? 'needs ~4s of speech and a few words'
                : showDebug && s.pace.sessionAverageWpm != null
                  ? `Current: ${s.pace.currentWpm ?? s.pace.wpm} wpm · Session avg: ${s.pace.sessionAverageWpm} wpm (${s.pace.changeWpm != null && s.pace.changeWpm > 0 ? '+' : ''}${s.pace.changeWpm ?? 0})`
                  : `${s?.pace.descriptor} · smoothed over ${s?.pace.window}`
            }
            fill={s?.pace.wpm == null ? 0 : Math.min(1, (s.pace.currentWpm ?? s.pace.wpm ?? 0) / 240)}
            tone={s?.pace.descriptor === 'fast' ? 'amber' : s?.pace.descriptor === 'measured' ? 'mint' : 'cyan'}
          />
          {s?.pace.wpm != null && (
            <div className="-mt-1.5 mb-2 flex justify-between px-0.5 text-[9px] font-mono text-white/30 select-none">
              <span>&lt;120 slow</span>
              <span>120-160 measured</span>
              <span>160-190 brisk</span>
              <span>&gt;190 rapid</span>
            </div>
          )}
        </div>
      )}

      {/* Pauses - Shown in Minimal, Standard, and Debug */}
      {enabled.pauses && (
        <Row
          id="pauses"
          label="Pauses"
          value={`${s?.pauses.count ?? 0}`}
          hint={
            s?.pauses.longestMs
              ? `mean ${ms(s.pauses.meanMs)} · longest ${ms(s.pauses.longestMs)}${showDebug ? ` · total silence ${ms(s.pauses.totalSilenceMs)}` : ''}`
              : 'silences over 0.7s during an answer'
          }
        />
      )}

      {/* Fillers - Shown in Standard and Debug */}
      {!showMinimal && enabled.fillers && (
        <Row
          id="fillers"
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

      {/* Restarts - Shown in Debug */}
      {showDebug && (
        <Row
          id="restarts"
          label="Restarts / False Starts"
          value={`${s?.restarts?.count ?? 0}`}
          hint="detected clause reformulations or retractions"
          tone="mint"
        />
      )}

      {/* Self-corrections - Shown in Debug */}
      {showDebug && (
        <Row
          id="restarts"
          label="Self-corrections"
          value={`${s?.selfCorrections?.count ?? 0}`}
          hint="localized corrections (e.g. 'Monday... sorry, Tuesday')"
          tone="cyan"
        />
      )}

      {/* Repetitions - Shown in Debug */}
      {showDebug && (
        <Row
          id="repetitions"
          label="Repetitions"
          value={`${s?.repetitions?.count ?? 0}`}
          hint="adjacent repeated words or repeated 2-4 word phrases"
          tone="amber"
        />
      )}

      {/* Sentence length - Shown in Debug */}
      {showDebug && (
        <Row
          id="sentences"
          label="Sentence Length"
          value={`~${num(s?.vocabulary.meanUnitLength ?? null, 1)} words`}
          hint={`${s?.sentences?.longCount ?? 0} long sentences (>35 words)`}
        />
      )}

      {/* Language / Topic Shifts - Shown in Debug */}
      {showDebug && s?.timeline && s.timeline.some((e) => e.type === 'LANGUAGE_SWITCH' || e.type === 'TOPIC_DRIFT') && (
        <Row
          id="topics"
          label="Topic / Language Shifts"
          value={`${s.timeline.filter((e) => e.type === 'LANGUAGE_SWITCH' || e.type === 'TOPIC_DRIFT').length}`}
          hint="detected script transitions or digressions from prompt"
          tone="amber"
        />
      )}

      {/* Vocabulary variety - Shown in Standard and Debug */}
      {!showMinimal && enabled.vocabulary && (
        <Row
          id="vocabulary"
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

      {/* Talk / silence - Shown in Standard and Debug */}
      {!showMinimal && enabled.delivery && (
        <Row
          id="delivery"
          label="Talk / silence"
          value={pct(s?.delivery.talkRatio ?? null)}
          hint={`${s?.delivery.speakingSecondsTotal ?? 0}s speaking${showDebug && s?.delivery.silenceSecondsTotal != null ? ` · ${s.delivery.silenceSecondsTotal}s silence` : ''}`}
          fill={s?.delivery.talkRatio ?? 0}
        />
      )}

      {/* Answer Latency - Shown in Standard and Debug */}
      {!showMinimal && enabled.latency && (
        <Row
          id="latency"
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

