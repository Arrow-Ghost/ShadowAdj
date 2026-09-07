import { useEffect, useMemo, useState } from 'react';
import LanguageLine from './LanguageLine';
import ViewLauncher from './ViewLauncher';
import {
  clock,
  finalizeEvaluation,
  getEvaluation,
  getTimeline,
  listEvaluations,
  listRubrics,
  overrideCriterion,
  reopenEvaluation,
  runEvaluation,
  type Confidence,
  type CriterionScore,
  type JudgeEvaluation,
  type TimelineEvent,
} from '@/lib/judgeApi';
import { getSessionIntegrity, runIntegrity, type IntegrityCase } from '@/lib/reviewApi';
import { readOriginality, type OriginalityRead } from '@/lib/originality';
import { toast } from '@/lib/ui/toast';

const CONF: Record<Confidence, { label: string; cls: string }> = {
  high: { label: 'High confidence', cls: 'border-signal-ok/40 bg-signal-ok/10 text-signal-ok' },
  medium: { label: 'Medium confidence', cls: 'border-teal/40 bg-teal/10 text-teal' },
  low: { label: 'Low confidence', cls: 'border-signal-warn/40 bg-signal-warn/10 text-signal-warn' },
};

function Pill({ conf }: { conf: Confidence }) {
  const c = CONF[conf];
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${c.cls}`}>{c.label}</span>;
}

function useQuery(key: string) {
  return useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get(key);
  }, [key]);
}

import { API_BASE } from '@/lib/api';

export default function JudgeView() {
  const sessionId = useQuery('session');
  const evalIdParam = useQuery('evaluation');

  const [evaluation, setEvaluation] = useState<JudgeEvaluation | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [rubrics, setRubrics] = useState<{ id: string; name: string }[]>([]);
  const [allSessions, setAllSessions] = useState<
    Array<{ id: string; label: string; eventId?: string | null }>
  >([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Originality / plagiarism check (Integrity Engine, shown here as read-only).
  const [orig, setOrig] = useState<IntegrityCase | null>(null);
  const [origBusy, setOrigBusy] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/sessions?limit=100`)
      .then((r) => r.json())
      .then((rows) => setAllSessions(rows))
      .catch(() => {})
      .finally(() => setSessionsLoaded(true));
  }, []);

  async function loadOriginality(sid: string) {
    try {
      const r = await getSessionIntegrity(sid);
      setOrig(r.cases?.[0] ?? null);
    } catch {
      /* not analysed yet — the panel shows a "check" button */
    }
  }

  async function runOriginality() {
    const sid = evaluation?.sessionId ?? sessionId;
    if (!sid) return;
    setOrigBusy(true);
    try {
      const r = await runIntegrity(sid);
      if (r.case) {
        setOrig(r.case);
        toast.success('Originality check complete');
      } else {
        toast('This event permits AI assistance — recorded as disclosure analytics, no case.');
      }
    } catch {
      /* jf() already toasted the error */
    } finally {
      setOrigBusy(false);
    }
  }

  async function load() {
    setError(null);
    try {
      if (evalIdParam) {
        const ev = await getEvaluation(evalIdParam);
        setEvaluation(ev);
        setTimeline(await getTimeline(ev.sessionId));
        void loadOriginality(ev.sessionId);
        return;
      }
      if (!sessionId) return;
      const list = await listEvaluations(sessionId);
      setEvaluation(list.at(-1) ?? null);
      setTimeline(await getTimeline(sessionId));
      void loadOriginality(sessionId);
      // Always load the rubric list: a session that isn't attached to an event
      // can only be judged by passing an explicit rubric, so the picker below is
      // its only working path.
      if (list.length === 0) setRubrics(await listRubrics().catch(() => []));
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, evalIdParam]);

  const currentSession = allSessions.find((s) => s.id === sessionId);
  // Only offer the "event rubric" run once we know the session actually has an
  // event — otherwise that button always 400s ("no rubric: pass rubricId …").
  const sessionHasEvent = Boolean(currentSession?.eventId);

  async function doRun(rubricId?: string) {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const ev = await runEvaluation(sessionId, rubricId);
      setEvaluation(ev);
      setTimeline(await getTimeline(sessionId));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doOverride(c: CriterionScore) {
    if (!evaluation) return;
    const raw = window.prompt(
      `New score for "${c.criterionName}" (${1}–${evaluation.scaleMax}). AI proposed ${c.aiScore ?? '—'}.`,
      String(c.score),
    );
    if (raw == null) return;
    const score = Number(raw);
    if (!Number.isFinite(score)) return;
    const reason = window.prompt('Reason for the override (recorded in the audit trail):', '') ?? '';
    setBusy(true);
    try {
      setEvaluation(await overrideCriterion(evaluation.id, c.criterionId, score, reason));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doFinalize() {
    if (!evaluation) return;
    const notes = window.prompt('Finalise this evaluation. Optional panel notes:', evaluation.notes ?? '') ?? '';
    setBusy(true);
    try {
      setEvaluation(await finalizeEvaluation(evaluation.id, notes));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doReopen() {
    if (!evaluation) return;
    setBusy(true);
    try {
      setEvaluation(await reopenEvaluation(evaluation.id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function startSimulation(scenario: 'clean' | 'elevated') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/sessions/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      if (!res.ok) throw new Error('Failed to start live simulation');
      const data = await res.json();
      window.location.href = `/judge?session=${encodeURIComponent(data.id)}`;
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (!sessionId && !evalIdParam) {
    return (
      <div>
        <ViewLauncher
          kind="judge"
          accent="cyan"
          eyebrow="Rubric-driven evaluation & Real-Time Monitoring"
          title="Score a session or monitor a live debate round."
          blurb="The AI judge scores every criterion with quoted evidence, a confidence level and reasoning. You can score an existing session or launch a live simulated debate round below."
          extraParams={[{ name: 'evaluation', label: 'evaluation', hint: 'open a saved evaluation directly' }]}
        />
        <div className="mx-auto max-w-5xl px-4 pb-12">
          <div className="glass p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-cyan">
              Live Debate Round Simulator
            </h2>
            <p className="mt-1 text-sm text-white/60 leading-relaxed">
              Experience ShadowADJ's real-time assistance monitoring live without needing a microphone.
              Simulate a debate round and observe how live telemetry, speaking rate, and non-disruptive risk signals stream in real time.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => startSimulation('elevated')}
              >
                {busy ? 'Launching…' : 'Launch Live Round (Elevated Risk Signal)'}
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => startSimulation('clean')}
              >
                {busy ? 'Launching…' : 'Launch Live Round (Clean Standard)'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {error && (
        <div className="mb-4 rounded-xl border border-rose/40 bg-rose/10 px-4 py-2 text-sm text-rose">{error}</div>
      )}

      {!evaluation ? (
        <div className="glass p-6">
          <h1 className="text-lg font-semibold">No evaluation yet</h1>
          <p className="mt-1 text-sm text-white/50">
            Run the AI judge against this session. It scores every rubric criterion with evidence, confidence
            and reasoning — a recommendation you can adjust.
          </p>
          {sessionsLoaded && !sessionHasEvent && (
            <p className="mt-2 text-xs text-amber/80">
              This session isn’t attached to an event, so there’s no event rubric to inherit. Pick a rubric
              below to score it{rubrics.length === 0 ? ' (create one under Admin first)' : ''}.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {sessionHasEvent && (
              <button className="btn btn-primary" disabled={busy} onClick={() => doRun()}>
                {busy ? 'Judging…' : 'Run evaluation (event rubric)'}
              </button>
            )}
            {rubrics.map((r, i) => (
              <button
                key={r.id}
                className={`btn ${!sessionHasEvent && i === 0 ? 'btn-primary' : ''}`}
                disabled={busy}
                onClick={() => doRun(r.id)}
              >
                {busy && !sessionHasEvent && i === 0 ? 'Judging…' : `Use “${r.name}”`}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <header className="glass mb-4 flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <div className="flex items-center gap-3">
                <span className="metric-label">{evaluation.rubricName}</span>
                {allSessions.length > 0 && (
                  <select
                    value={evaluation.sessionId}
                    onChange={(e) => {
                      if (e.target.value) {
                        window.location.href = `/judge?session=${encodeURIComponent(e.target.value)}`;
                      }
                    }}
                    className="rounded-lg border border-stroke bg-black/40 px-2.5 py-1 text-xs text-white outline-none focus:border-cyan/50"
                  >
                    {allSessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label || 'Untitled session'} ({s.id})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="font-mono text-3xl font-semibold">
                  {evaluation.overallScore.toFixed(1)}
                  <span className="text-base text-white/40"> / {evaluation.scaleMax}</span>
                </span>
                <Pill conf={evaluation.overallConfidence} />
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    evaluation.status === 'final'
                      ? 'border-mint/40 bg-mint/10 text-mint'
                      : 'border-white/15 text-white/50'
                  }`}
                >
                  {evaluation.status === 'final' ? 'Finalised' : 'Draft'}
                </span>
                <span className="text-[11px] text-white/40">
                  {evaluation.judgeType === 'human' ? 'AI + human' : 'AI recommendation'}
                </span>
              </div>
              <LanguageLine sessionId={evaluation.sessionId} />
            </div>
            <div className="flex items-center gap-2">
              {evaluation.status === 'draft' ? (
                <button className="btn btn-primary" disabled={busy} onClick={doFinalize}>
                  Finalise
                </button>
              ) : (
                <button className="btn" disabled={busy} onClick={doReopen}>
                  Reopen
                </button>
              )}
            </div>
          </header>

          <div className="grid gap-3">
            {evaluation.criteria.map((c) => (
              <div key={c.criterionId} className="glass p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-3">
                    <h3 className="text-sm font-semibold text-white/90">{c.criterionName}</h3>
                    <span className="text-[11px] text-white/35">{Math.round(c.weight * 100)}% of total</span>
                    <Pill conf={c.confidence} />
                  </div>
                  <div className="flex items-baseline gap-2 font-mono">
                    <span className="text-xl font-semibold">{c.score}</span>
                    {c.humanScore != null && c.aiScore != null && c.humanScore !== c.aiScore && (
                      <span className="text-[11px] text-white/40">
                        AI {c.aiScore} → human {c.humanScore}
                      </span>
                    )}
                    {evaluation.status === 'draft' && (
                      <button className="btn !px-2 !py-0.5 text-[11px]" disabled={busy} onClick={() => doOverride(c)}>
                        Adjust
                      </button>
                    )}
                  </div>
                </div>

                {c.confidenceReasons.length > 0 && (
                  <p className="mt-1.5 text-[11px] text-amber/80">Confidence limited by: {c.confidenceReasons.join('; ')}</p>
                )}
                {c.overrideReason && (
                  <p className="mt-1.5 text-[11px] text-white/45">
                    Overridden by {c.overriddenBy}: “{c.overrideReason}”
                  </p>
                )}

                {c.reasoning && <p className="mt-2 text-sm leading-relaxed text-white/75">{c.reasoning}</p>}

                {(c.strengths.length > 0 || c.weaknesses.length > 0) && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {c.strengths.length > 0 && (
                      <div>
                        <div className="metric-label text-mint/70">Strengths</div>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-white/70">
                          {c.strengths.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {c.weaknesses.length > 0 && (
                      <div>
                        <div className="metric-label text-amber/70">To work on</div>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-white/70">
                          {c.weaknesses.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {c.evidence.length > 0 && (
                  <div className="mt-3 border-t border-white/5 pt-2">
                    <div className="metric-label">Evidence</div>
                    <ul className="mt-1 space-y-1.5">
                      {c.evidence.map((e, i) => (
                        <li key={i} className="text-xs">
                          <span className="font-mono text-white/40">
                            {clock(e.startMs)}–{clock(e.endMs)}
                          </span>{' '}
                          <span className="text-white/80">“{e.quote}”</span>
                          {e.reason && <span className="text-white/45"> — {e.reason}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>

          <OriginalityPanel
            sessionId={evaluation.sessionId}
            data={orig}
            busy={origBusy}
            onRun={runOriginality}
          />

          {timeline.length > 0 && (
            <div className="glass mt-4 p-5">
              <h3 className="mb-2 text-sm font-semibold text-white/80">Evidence timeline</h3>
              <ul className="space-y-1 font-mono text-xs text-white/55">
                {timeline.map((e) => (
                  <li key={e.id}>
                    <span className="text-white/35">{clock(e.atMs)}</span>{' '}
                    <span
                      className={
                        e.severity === 'concern'
                          ? 'text-rose'
                          : e.severity === 'notable'
                            ? 'text-amber'
                            : 'text-white/55'
                      }
                    >
                      {e.type}
                    </span>
                    {e.description ? ` · ${e.description}` : ''}
                    <span className="text-white/25"> [{e.source}]</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-4 text-[11px] text-white/35">
            The scores above are a performance evaluation and do <em>not</em> factor in the originality signals
            below — similarity is evidence for a human, never a scoring penalty on its own.
          </p>
        </>
      )}
    </div>
  );
}

/* --------------------------- originality panel --------------------------- */

const ORIG_TONE: Record<OriginalityRead['label'], { ring: string; text: string; bar: string }> = {
  original: { ring: 'border-mint/40', text: 'text-mint', bar: '#00FF9C' },
  'mostly-original': { ring: 'border-cyan/40', text: 'text-cyan', bar: '#00D4FF' },
  'notable-overlap': { ring: 'border-amber/40', text: 'text-amber', bar: '#FFB800' },
  'heavy-overlap': { ring: 'border-rose/40', text: 'text-rose', bar: '#FF5C7A' },
};

function OriginalityPanel({
  sessionId,
  data,
  busy,
  onRun,
}: {
  sessionId: string;
  data: IntegrityCase | null;
  busy: boolean;
  onRun: () => void;
}) {
  const read = data ? readOriginality(data) : null;

  return (
    <div className="glass mt-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white/85">Originality &amp; source check</h3>
        <div className="flex items-center gap-2">
          <a href={`/review?session=${encodeURIComponent(sessionId)}`} className="text-[11px] text-cyan hover:underline">
            Open full review →
          </a>
          <button className="btn !px-3 !py-1 text-[11px]" disabled={busy} onClick={onRun}>
            {busy ? 'Checking…' : read ? 'Re-check' : 'Check now'}
          </button>
        </div>
      </div>

      {busy && !read && (
        <div className="mt-3 space-y-2">
          <div className="skeleton h-6 w-40" />
          <div className="skeleton h-16" />
        </div>
      )}

      {!busy && !read && (
        <p className="mt-2 text-sm text-white/55">
          Runs the Integrity Engine against this answer: how much of the distinctive phrasing traces to an
          external source, how word-for-word the overlap is, whether it was attributed, and any overlap with
          another debater in the same event.
        </p>
      )}

      {read && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border ${ORIG_TONE[read.label].ring} bg-black/30`}>
              <span className={`font-mono text-xl font-bold ${ORIG_TONE[read.label].text}`}>{read.index}</span>
            </div>
            <div className="min-w-[12rem] flex-1">
              <p className={`text-sm font-semibold ${ORIG_TONE[read.label].text}`}>{read.headline}</p>
              <div className="bar-track mt-1.5 h-1.5 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.max(3, read.index)}%`, background: ORIG_TONE[read.label].bar }}
                />
              </div>
              <p className="mt-1 text-[11px] text-white/40">
                Originality index (100 = nothing traced to a source) · risk {read.riskLevel} · {read.confidence} confidence
              </p>
            </div>
          </div>

          <p className="mt-3 text-xs text-white/60">
            <span className="text-white/80">How it reads:</span>{' '}
            {read.naturalness === 'reads-rehearsed'
              ? 'assembled / rehearsed'
              : read.naturalness === 'reads-natural'
                ? 'spontaneous'
                : 'unclear'}{' '}
            — {read.naturalnessNote}
          </p>

          {read.sources.length > 0 ? (
            <div className="mt-3">
              <div className="metric-label">
                Matched sources — {read.matchedPhraseCount} distinctive phrase{read.matchedPhraseCount === 1 ? '' : 's'}
                {read.unattributedCount > 0 && `, ${read.unattributedCount} without attribution`}
              </div>
              <ul className="mt-1.5 space-y-2">
                {read.sources.map((s, i) => (
                  <li key={i} className="rounded-lg border border-white/5 bg-black/15 p-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <a href={s.url} target="_blank" rel="noreferrer noopener" className="font-medium text-cyan hover:underline">
                        {s.domain}
                      </a>
                      <span className="text-white/30">
                        {s.sourceType} · credibility {Math.round(s.credibility * 100)}%
                      </span>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${s.attributed ? 'border-mint/30 text-mint/80' : 'border-rose/30 text-rose/80'}`}>
                        {s.attributed ? 'attributed' : 'no attribution'}
                      </span>
                      <span className="ml-auto font-mono text-white/70">{Math.round(s.peakSimilarity * 100)}% word-for-word</span>
                    </div>
                    <p className="mt-1 text-white/70">
                      {s.atMs != null && <span className="font-mono text-white/35">{clock(s.atMs)} · </span>}
                      “{s.phrase.slice(0, 160)}{s.phrase.length > 160 ? '…' : ''}”
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-xs text-white/45">
              No distinctive phrasing matched the searched corpus.
            </p>
          )}

          {read.crossParticipant.others.length > 0 && (
            <div className="mt-3">
              <div className="metric-label text-amber/70">
                Overlap with another debater — up to {Math.round(read.crossParticipant.maxSimilarity * 100)}%
              </div>
              <ul className="mt-1 space-y-1 text-xs text-white/65">
                {read.crossParticipant.others.map((o, i) => (
                  <li key={i}>
                    <span className="text-white/85">{o.label}</span> — {Math.round(o.similarity * 100)}% shared distinctive phrasing
                    {o.phrases.length > 0 && (
                      <ul className="mt-0.5 list-disc pl-4 text-white/40">
                        {o.phrases.map((p, j) => (
                          <li key={j}>“{p.slice(0, 100)}{p.length > 100 ? '…' : ''}”</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-white/35">
            {read.searchCoverage} {read.caveat}
          </p>
        </div>
      )}
    </div>
  );
}
