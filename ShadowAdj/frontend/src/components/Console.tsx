import { useEffect, useRef, useState } from 'react';
import { createSession, fetchCoaching, getHealth, deleteSession, type SessionMode } from '@/lib/api';
import { startCapture, type CaptureHandle } from '@/lib/audio';
import { browserSpeechSupported, startBrowserSpeech } from '@/lib/speech';
import { useConsole, type CognitiveMode, type SpeechEvent } from '@/lib/store';
import { saveHistory, download, toCSV, toMarkdown, type HistoryEntry } from '@/lib/history';
import { clock } from '@/lib/format';
import Sphere from './Sphere';
import MetricRail from './MetricRail';
import Timeline from './Timeline';
import AudioDeck from './AudioDeck';

const MODES: { id: SessionMode; title: string; blurb: string }[] = [
  { id: 'debate-practice', title: 'Debate practice', blurb: 'Rounds, rebuttals, and speaker drills.' },
  { id: 'interview-prep', title: 'Interview prep', blurb: 'Rehearse answers and review your delivery.' },
  { id: 'speech-coaching', title: 'Speech coaching', blurb: 'Presentations, toasts, talks.' },
];

const METRIC_KEYS = ['pace', 'pauses', 'fillers', 'vocabulary', 'delivery', 'latency'] as const;
const PREF_KEY = 'shadowadj.prefs.v1';

type Step = 'setup' | 'consent' | 'live' | 'ended';

interface Prefs {
  mode: SessionMode;
  label: string;
  transcriptSource: 'browser' | 'server';
  metrics: Record<string, boolean>;
}
function defaultPrefs(): Prefs {
  return {
    mode: 'debate-practice',
    label: '',
    transcriptSource: 'server', // falls back to browser when no Gemini key
    metrics: Object.fromEntries(METRIC_KEYS.map((k) => [k, true])),
  };
}
function loadPrefs(): Prefs {
  try {
    return { ...defaultPrefs(), ...(JSON.parse(localStorage.getItem(PREF_KEY) || '{}') as Partial<Prefs>) };
  } catch {
    return defaultPrefs();
  }
}

export default function Console() {
  const [step, setStep] = useState<Step>('setup');
  const [prefs, setPrefs] = useState(loadPrefs);
  const [health, setHealth] = useState<{
    geminiEnabled: boolean;
    model?: string;
    defaultTranscription?: 'server' | 'browser';
  } | null>(null);
  const [consent, setConsent] = useState({ speaker: false, second: false });
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [coaching, setCoaching] = useState<{ notes: string; loading: boolean; error: string | null }>({
    notes: '',
    loading: false,
    error: null,
  });

  const store = useConsole();
  const captureRef = useRef<CaptureHandle | null>(null);
  const stopSpeechRef = useRef<() => void>(() => {});
  const exportRef = useRef<any>(null);
  const startedAtRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playbackTimeMs, setPlaybackTimeMs] = useState(0);
  const [highlightedEvent, setHighlightedEvent] = useState<SpeechEvent | null>(null);

  const seekAudio = (timestampMs: number) => {
    setPlaybackTimeMs(timestampMs);
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, timestampMs / 1000);
      audioRef.current.play().catch(() => {});
    }
  };

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setError('Backend not reachable on :8787 — is it running?'));
  }, []);

  useEffect(() => {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => () => teardown(), []); // unmount safety

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (e.key === 'q' || e.key === 'Q') {
        if (step === 'live') {
          e.preventDefault();
          markQuestion();
        }
      } else if (e.key === '1') {
        e.preventDefault();
        store.set({ cognitiveMode: 'minimal' });
      } else if (e.key === '2') {
        e.preventDefault();
        store.set({ cognitiveMode: 'standard' });
      } else if (e.key === '3') {
        e.preventDefault();
        store.set({ cognitiveMode: 'debug' });
      } else if (e.key === '?') {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      } else if (e.key === 'Escape') {
        setShowShortcuts(false);
        setHighlightedEvent(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, store]);

  function teardown() {
    captureRef.current?.stop();
    captureRef.current = null;
    stopSpeechRef.current?.();
  }

  async function beginSession() {
    setError(null);
    try {
      const useServer = prefs.transcriptSource === 'server' && health?.geminiEnabled;
      const s = await createSession({
        mode: prefs.mode,
        label: prefs.label || undefined,
        consent: { speakerAcknowledged: consent.speaker, secondPartyAcknowledged: consent.second },
      });
      store.reset();
      store.set({ status: 'connecting', sessionId: s.id, label: s.label });

      const handle = await startCapture({
        sessionId: s.id,
        transcriptSource: useServer ? 'server' : 'browser',
        onMessage: onSocketMessage,
        onClose: () => {},
      });
      captureRef.current = handle;

      if (!useServer) {
        if (browserSpeechSupported()) {
          startBrowserTranscription(handle.socket);
        } else {
          store.set({
            notices: [
              ...useConsole.getState().notices,
              'This browser has no speech recognition. Set a GEMINI_API_KEY for server transcription, or use Chrome.',
            ],
          });
        }
      }

      startedAtRef.current = Date.now();
      store.set({ status: 'live' });
      setStep('live');
    } catch (e: any) {
      setError(e.message || 'could not start');
      teardown();
    }
  }

  function startBrowserTranscription(socket: WebSocket) {
    stopSpeechRef.current?.();
    stopSpeechRef.current = startBrowserSpeech({
      onResult: (text, isFinal) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'transcript', text, isFinal }));
        }
        store.set({ transcriptLive: isFinal ? '' : text });
      },
      onError: (e) => store.set({ notices: [...useConsole.getState().notices, e] }),
    });
  }

  function onSocketMessage(msg: any) {
    if (msg.type === 'tick') {
      store.set({
        snapshot: msg.snapshot,
        energy: msg.energy,
        transcribing: Boolean(msg.transcribing),
        telemetryStatus: msg.telemetryStatus || store.telemetryStatus,
      });
    } else if (msg.type === 'degraded') {
      store.set({
        telemetryStatus: { degraded: true, message: msg.message },
        notices: [...useConsole.getState().notices, msg.message],
      });
    } else if (msg.type === 'transcript' && msg.source === 'server') {
      store.set({ transcriptLive: '' }); // transcript text arrives via the next tick snapshot
    } else if (msg.type === 'transcription-fallback') {
      store.set({ notices: [...useConsole.getState().notices, msg.message] });
      const sock = captureRef.current?.socket;
      if (sock && browserSpeechSupported()) startBrowserTranscription(sock);
    } else if (msg.type === 'notice') {
      store.set({ notices: [...useConsole.getState().notices, msg.message] });
    } else if (msg.type === 'ended') {
      exportRef.current = msg.export;
    }
  }

  function markQuestion() {
    const sock = captureRef.current?.socket;
    if (sock?.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ type: 'question', label: `Q${(store.snapshot?.timeline.filter((t) => t.kind === 'question' || t.type === 'QUESTION_END').length ?? 0) + 1}` }));
    }
  }

  async function endSession() {
    store.set({ status: 'ended' });
    setStep('ended');
    setFinalizing(true);
    stopSpeechRef.current?.();

    const replayUrl = captureRef.current?.getReplayUrl() ?? null;
    if (replayUrl) store.set({ audioReplayUrl: replayUrl });

    // Let the backend transcribe the trailing audio before we snapshot.
    let finalExport: any = null;
    try {
      finalExport = await (captureRef.current?.finish(8000) ?? Promise.resolve(null));
    } catch {
      /* fall back to the last live snapshot */
    }
    captureRef.current = null;
    setFinalizing(false);

    const snap = finalExport?.finalSnapshot ?? useConsole.getState().snapshot;
    if (snap) store.set({ snapshot: snap });

    const entry: HistoryEntry = {
      id: store.sessionId || crypto.randomUUID(),
      label: store.label || 'Session',
      mode: prefs.mode,
      savedAt: Date.now(),
      durationMs: snap?.elapsedMs ?? Date.now() - startedAtRef.current,
      summary: {
        wordCount: snap?.transcript.wordCount ?? 0,
        paceWpm: snap?.pace.wpm ?? null,
        pauseCount: snap?.pauses.count ?? 0,
        fillersPerMin: snap?.fillers.hardPerMin ?? null,
        variety: snap?.vocabulary.variety ?? null,
      },
      export: {
        finalSnapshot: snap,
        timeline: finalExport?.timeline ?? snap?.timeline ?? [],
        transcript: snap?.transcript.text ?? '',
      },
    };
    exportRef.current = entry;
    try {
      saveHistory(entry);
    } catch {
      /* localStorage might be full/blocked */
    }
  }

  async function getCoaching() {
    if (!store.sessionId) return;
    setCoaching({ notes: '', loading: true, error: null });
    try {
      const r = await fetchCoaching(store.sessionId);
      setCoaching({ notes: r.notes, loading: false, error: null });
      if (r.experiment) {
        store.set({ singleExperiment: r.experiment });
      }
    } catch (e: any) {
      setCoaching({ notes: '', loading: false, error: e.message });
    }
  }

  const serverAvailable = Boolean(health?.geminiEnabled);

  /* ----------------------------- render ----------------------------- */

  if (step === 'setup') {
    return (
      <Shell>
        <h1 className="text-2xl font-bold">Start a session</h1>
        <p className="mt-1 text-sm text-white/50">
          ShadowADJ shows how an answer <em>sounds</em> — pace, pauses, filler words, vocabulary variety.
          It never scores the speaker or guesses whether an answer was AI-assisted.
        </p>
        {error && <Banner tone="rose">{error}</Banner>}

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setPrefs((p) => ({ ...p, mode: m.id }))}
              className={`glass p-4 text-left transition ${prefs.mode === m.id ? 'ring-2 ring-cyan/60' : 'opacity-80 hover:opacity-100'}`}
            >
              <div className="font-semibold">{m.title}</div>
              <div className="mt-1 text-xs text-white/45">{m.blurb}</div>
            </button>
          ))}
        </div>

        <label className="mt-5 block">
          <span className="metric-label">Session label (optional)</span>
          <input
            value={prefs.label}
            onChange={(e) => setPrefs((p) => ({ ...p, label: e.target.value }))}
            placeholder="e.g. Round 3 — rebuttal practice"
            className="mt-1 w-full rounded-xl border border-stroke bg-black/30 px-3 py-2 text-sm outline-none focus:border-cyan/50"
          />
        </label>

        <div className="mt-5">
          <span className="metric-label">Transcription</span>
          <div className="mt-2 flex gap-2">
            <Toggle
              active={prefs.transcriptSource === 'server'}
              disabled={!serverAvailable}
              onClick={() => serverAvailable && setPrefs((p) => ({ ...p, transcriptSource: 'server' }))}
            >
              Gemini {health?.model ? `(${health.model})` : ''}{!serverAvailable && ' — no key set'}
              {serverAvailable && ' · recommended'}
            </Toggle>
            <Toggle active={prefs.transcriptSource === 'browser'} onClick={() => setPrefs((p) => ({ ...p, transcriptSource: 'browser' }))}>
              Browser Web Speech
            </Toggle>
          </div>
          <p className="mt-1.5 text-xs text-white/40">
            Gemini transcription runs on the backend and works in any browser. Web Speech is
            Chrome-only and silently does nothing elsewhere (e.g. Opera, Firefox).
          </p>
        </div>

        <div className="mt-5">
          <span className="metric-label">Metrics to show</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {METRIC_KEYS.map((k) => (
              <Toggle
                key={k}
                active={prefs.metrics[k]}
                onClick={() => setPrefs((p) => ({ ...p, metrics: { ...p.metrics, [k]: !p.metrics[k] } }))}
              >
                {k}
              </Toggle>
            ))}
          </div>
        </div>

        <button className="btn btn-primary mt-7" onClick={() => setStep('consent')}>
          Continue to consent →
        </button>
      </Shell>
    );
  }

  if (step === 'consent') {
    return (
      <Shell>
        <h1 className="text-2xl font-bold">Consent</h1>
        <div className="glass mt-4 space-y-3 p-5 text-sm text-white/70">
          <p>During this session ShadowADJ will:</p>
          <ul className="list-disc space-y-1 pl-5 text-white/60">
            <li>capture microphone audio and stream it to the local backend for analysis;</li>
            <li>show live metrics and a transcript on this screen — the same screen everyone in the room sees;</li>
            <li>keep audio in memory only and discard it when the session ends (no audio file is written).</li>
          </ul>
          <p className="text-white/60">
            It will <strong>not</strong> produce a risk score, a “review” verdict, or an estimate of whether
            answers were AI-assisted.
          </p>
        </div>

        {error && <Banner tone="rose">{error}</Banner>}

        <label className="mt-5 flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={consent.speaker} onChange={(e) => setConsent((c) => ({ ...c, speaker: e.target.checked }))} />
          <span>
            I am the person being recorded (or I am setting this up on their behalf with their agreement), and
            I consent to this session. <span className="text-rose">Required.</span>
          </span>
        </label>
        <label className="mt-3 flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={consent.second} onChange={(e) => setConsent((c) => ({ ...c, second: e.target.checked }))} />
          <span>A coach / interviewer is also present and has acknowledged the above. (Optional)</span>
        </label>

        <div className="mt-7 flex gap-3">
          <button className="btn" onClick={() => setStep('setup')}>
            ← Back
          </button>
          <button className="btn btn-primary disabled:opacity-40" disabled={!consent.speaker} onClick={beginSession}>
            Grant mic &amp; start
          </button>
        </div>
      </Shell>
    );
  }

  // live + ended share the dashboard chrome
  const snap = store.snapshot;
  const latestEnergy = store.energy.length > 0 ? store.energy[store.energy.length - 1].v : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${step === 'live' ? 'animate-pulse bg-mint' : 'bg-white/30'}`} />
            <h1 className="text-lg font-semibold">{store.label || 'Session'}</h1>
            <span className="font-mono text-sm text-white/40">{clock(snap?.elapsedMs ?? 0)}</span>

            {/* Live Audio / VAD Level Meter */}
            {step === 'live' && (
              <div className="ml-2 flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-2.5 py-0.5">
                <div className="flex items-center gap-0.5">
                  <div
                    className={`h-2.5 w-1 rounded-full transition-all duration-75 ${
                      latestEnergy > 0.01 ? 'bg-mint' : 'bg-white/15'
                    }`}
                  />
                  <div
                    className={`h-3.5 w-1 rounded-full transition-all duration-75 ${
                      latestEnergy > 0.03 ? 'bg-mint' : 'bg-white/15'
                    }`}
                  />
                  <div
                    className={`h-4.5 w-1 rounded-full transition-all duration-75 ${
                      latestEnergy > 0.07 ? 'bg-cyan' : 'bg-white/15'
                    }`}
                  />
                  <div
                    className={`h-3 w-1 rounded-full transition-all duration-75 ${
                      latestEnergy > 0.12 ? 'bg-amber' : 'bg-white/15'
                    }`}
                  />
                </div>
                <span
                  className={`font-mono text-[10px] uppercase tracking-wider ${
                    latestEnergy > 0.02 ? 'font-semibold text-mint' : 'text-white/40'
                  }`}
                >
                  {latestEnergy > 0.02 ? 'Speaking' : 'Silence'}
                </span>
              </div>
            )}
          </div>
          <p className="mt-0.5 text-xs text-white/40">
            {MODES.find((m) => m.id === prefs.mode)?.title} · transcript:{' '}
            {snap?.transcript.source === 'server'
              ? `Gemini${health?.model ? ` (${health.model})` : ''}`
              : snap?.transcript.source === 'browser'
                ? 'browser Web Speech'
                : '…'}
            {store.transcribing && <span className="ml-1 text-cyan">· transcribing…</span>}
          </p>
        </div>

        {/* Cognitive Load Mode Selector with Shortcut Badges */}
        <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/40 p-1">
          {[
            { id: 'minimal', key: '1' },
            { id: 'standard', key: '2' },
            { id: 'debug', key: '3' },
          ].map(({ id, key }) => (
            <button
              key={id}
              onClick={() => store.set({ cognitiveMode: id as CognitiveMode })}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition ${
                store.cognitiveMode === id
                  ? 'border border-cyan/40 bg-cyan/20 text-cyan shadow-sm'
                  : 'text-white/40 hover:text-white/80'
              }`}
            >
              <span>{id}</span>
              <kbd className="opacity-60">{key}</kbd>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Shortcuts cheatsheet toggle */}
          <button
            onClick={() => setShowShortcuts((s) => !s)}
            className="btn !px-2.5 !py-1.5 text-xs text-white/60 hover:text-white"
            title="Keyboard shortcuts (?)"
          >
            ⌨️ <kbd>?</kbd>
          </button>

          {step === 'live' && (
            <>
              <button className="btn" onClick={markQuestion} title="Mark Question Asked (Q key)">
                <span>Mark “question”</span>
                <kbd>Q</kbd>
              </button>
              <button className="btn border-rose/40 bg-rose/10 text-rose hover:bg-rose/20" onClick={endSession}>
                End session
              </button>
            </>
          )}
          {step === 'ended' && (
            <>
              {finalizing && <span className="self-center text-xs text-cyan">Finalizing transcript…</span>}
              <button
                className="btn border-rose/30 bg-rose/10 text-rose hover:bg-rose/20"
                onClick={async () => {
                  if (store.sessionId) {
                    try {
                      await deleteSession(store.sessionId);
                    } catch {}
                  }
                  store.reset();
                  setStep('setup');
                  setCoaching({ notes: '', loading: false, error: null });
                }}
                title="Permanently remove this session and all in-memory telemetry immediately"
              >
                Delete session
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  store.reset();
                  setStep('setup');
                  setCoaching({ notes: '', loading: false, error: null });
                }}
              >
                New session
              </button>
            </>
          )}
        </div>
      </header>

      {store.notices.length > 0 && (
        <Banner tone="amber">{store.notices[store.notices.length - 1]}</Banner>
      )}

      {/* Shadow Replay Audio Deck (Ended Step) */}
      {step === 'ended' && store.audioReplayUrl && (
        <AudioDeck
          audioUrl={store.audioReplayUrl}
          audioRef={audioRef}
          durationMs={snap?.elapsedMs || 1000}
          playbackTimeMs={playbackTimeMs}
          onSeek={seekAudio}
          onTimeUpdate={(tMs) => setPlaybackTimeMs(tMs)}
        />
      )}

      {/* Visualizers & Metric Rail */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {store.cognitiveMode === 'minimal' ? (
          <div className="glass flex min-h-[300px] flex-col items-center justify-center border border-cyan/25 bg-gradient-to-b from-panel to-cyan/5 p-8 text-center shadow-lg">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-cyan">
              <span className="h-2 w-2 rounded-full bg-cyan animate-pulse" />
              Minimal View
            </div>
            <div
              className={`text-5xl font-extrabold tracking-tight transition-all duration-300 ${
                snap?.pace.descriptor === 'fast'
                  ? 'text-amber drop-shadow-[0_0_20px_rgba(255,184,0,0.35)]'
                  : snap?.pace.descriptor === 'measured'
                    ? 'text-mint drop-shadow-[0_0_20px_rgba(0,255,156,0.35)]'
                    : 'text-cyan drop-shadow-[0_0_20px_rgba(0,212,255,0.35)]'
              }`}
            >
              {snap?.pace.descriptor ? snap.pace.descriptor.toUpperCase() : 'CALIBRATING'}
            </div>
            <div className="mt-3 font-mono text-base text-white/70">
              <span className="font-bold text-white">{snap?.pace.currentWpm ?? snap?.pace.wpm ?? '—'}</span> WPM · {clock(snap?.elapsedMs ?? 0)}
            </div>
            <p className="mt-4 max-w-xs text-xs text-white/40">
              Minimal mode keeps visual stimulation low so you can concentrate entirely on speaking.
            </p>
          </div>
        ) : (
          <div className="glass relative min-h-[340px] overflow-hidden p-0">
            <Sphere
              analyser={captureRef.current?.analyser ?? null}
              descriptor={(snap?.pace.descriptor as any) ?? null}
              live={step === 'live'}
            />
            <div className="pointer-events-none absolute left-4 top-4 text-xs text-white/45">
              colour = pace ({snap?.pace.descriptor ?? '—'}) · size = live volume
            </div>
          </div>
        )}
        <MetricRail snapshot={snap} enabled={{ ...prefs.metrics }} cognitiveMode={store.cognitiveMode} />
      </div>

      {/* Timeline (Always in Standard & Debug; optional in Minimal) */}
      <div className="mt-4">
        <Timeline
          energy={store.energy}
          snapshot={snap}
          audioReplayUrl={store.audioReplayUrl}
          playbackTimeMs={playbackTimeMs}
          onSeekAudio={seekAudio}
          onSelectEvent={setHighlightedEvent}
        />
      </div>

      {/* Transcript & Self-Review */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="glass p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white/80">
              Transcript
              {store.transcribing && <span className="text-[11px] font-normal text-cyan animate-pulse">Gemini transcribing…</span>}
            </h3>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={transcriptSearch}
                onChange={(e) => setTranscriptSearch(e.target.value)}
                placeholder="Search words…"
                className="w-28 rounded-lg border border-white/10 bg-black/40 px-2 py-0.5 text-xs text-white placeholder-white/30 outline-none focus:border-cyan/50 focus:w-36 transition-all"
              />
              <span className="font-mono text-[11px] text-white/40">
                {snap?.transcript.wordCount ?? 0} words
              </span>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-white/75 pr-1">
            <InteractiveTranscript
              text={snap?.transcript.text || ''}
              liveText={store.transcriptLive}
              totalDurationMs={snap?.elapsedMs || 1000}
              playbackTimeMs={playbackTimeMs}
              highlightedEvent={highlightedEvent}
              searchQuery={transcriptSearch}
              onSeek={seekAudio}
            />
          </div>
        </div>

        <div className="glass p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white/80">Self-review</h3>
            {step === 'ended' && (
              <div className="flex gap-2">
                <button
                  className="btn !px-3 !py-1 text-xs"
                  onClick={() => download(`${store.label || 'session'}.md`, toMarkdown(exportRef.current), 'text/markdown')}
                  title="Download structured Markdown debrief"
                >
                  Markdown
                </button>
                <button
                  className="btn !px-3 !py-1 text-xs"
                  onClick={() => download(`${store.label || 'session'}.json`, JSON.stringify(exportRef.current, null, 2))}
                  title="Download JSON telemetry"
                >
                  JSON
                </button>
                <button
                  className="btn !px-3 !py-1 text-xs"
                  onClick={() => download(`${store.label || 'session'}.csv`, toCSV(exportRef.current), 'text/csv')}
                  title="Download timeline CSV"
                >
                  CSV
                </button>
              </div>
            )}
          </div>

          {step !== 'ended' ? (
            <p className="mt-2 text-xs text-white/40">
              Coaching notes become available when you end the session.
            </p>
          ) : serverAvailable ? (
            <div className="mt-3">
              {!coaching.notes && !coaching.loading && (
                <button className="btn btn-primary text-xs" onClick={getCoaching}>
                  Generate coaching notes
                </button>
              )}
              {coaching.loading && <p className="text-xs text-white/50">Thinking through your delivery…</p>}
              {coaching.error && <Banner tone="rose">{coaching.error}</Banner>}
              {coaching.notes && (
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-white/75">{coaching.notes}</div>
              )}

              {/* Single Recommended Experiment Card */}
              {store.singleExperiment && (
                <div className="mt-4 rounded-xl border border-mint/30 bg-mint/5 p-4">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-mint/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-mint">
                      Single Recommended Experiment
                    </span>
                    <span className="text-[11px] text-white/40">Focused for your next run</span>
                  </div>
                  <h4 className="mt-2 text-sm font-semibold text-white/90">{store.singleExperiment.title}</h4>
                  <p className="mt-1 text-xs text-white/70">{store.singleExperiment.description}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2">
                    <span className="font-mono text-[11px] text-cyan">
                      Focus: {store.singleExperiment.metricTarget}
                    </span>
                    <button
                      className="btn btn-primary !px-3 !py-1 text-xs"
                      onClick={() => {
                        const expTitle = store.singleExperiment?.title;
                        store.reset();
                        setStep('setup');
                        setPrefs((p) => ({ ...p, label: `Experiment: ${expTitle}` }));
                      }}
                    >
                      Retry with this experiment →
                    </button>
                  </div>
                </div>
              )}

              <p className="mt-3 text-[11px] text-white/35">
                Notes are addressed to you and cover delivery and structure only.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-white/40">
              Set <code className="text-white/60">GEMINI_API_KEY</code> to enable written coaching notes. Your
              metrics and transcript above are still fully available.
            </p>
          )}
        </div>
      </div>

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="glass w-full max-w-md border border-cyan/40 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                <span>⌨️</span> Keyboard Shortcuts
              </h3>
              <button
                onClick={() => setShowShortcuts(false)}
                className="text-sm text-white/40 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-white/70">Mark “Question Asked” (during live session)</span>
                <kbd>Q</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/70">Toggle Play / Pause (during review)</span>
                <kbd>Space</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/70">Seek Replay ±3 seconds</span>
                <div className="flex gap-1">
                  <kbd>←</kbd>
                  <kbd>→</kbd>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/70">Switch Cognitive Mode (Minimal / Standard / Debug)</span>
                <div className="flex gap-1">
                  <kbd>1</kbd>
                  <kbd>2</kbd>
                  <kbd>3</kbd>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/70">Toggle this Shortcuts Cheatsheet</span>
                <kbd>?</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/70">Close Modal / Dismiss Inspector</span>
                <kbd>Esc</kbd>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------- little bits --------------------------- */

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-2xl px-4 py-10">{children}</div>;
}

function Banner({ children, tone }: { children: React.ReactNode; tone: 'rose' | 'amber' }) {
  const c = tone === 'rose' ? 'border-rose/40 bg-rose/10 text-rose' : 'border-amber/40 bg-amber/10 text-amber';
  return <div className={`mt-4 rounded-xl border px-4 py-2 text-sm ${c}`}>{children}</div>;
}

function Toggle({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs capitalize transition ${
        active ? 'border-cyan/60 bg-cyan/10 text-cyan' : 'border-stroke text-white/55 hover:text-white/80'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function InteractiveTranscript({
  text,
  liveText,
  totalDurationMs,
  playbackTimeMs,
  highlightedEvent,
  searchQuery,
  onSeek,
}: {
  text: string;
  liveText?: string;
  totalDurationMs: number;
  playbackTimeMs: number;
  highlightedEvent: SpeechEvent | null;
  searchQuery?: string;
  onSeek: (timestampMs: number) => void;
}) {
  if (!text) {
    return (
      <span className="text-white/30">
        Listening… first transcript lands a few seconds in.
      </span>
    );
  }

  const rawSegments = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const dur = Math.max(1, totalDurationMs);
  const totalChars = Math.max(1, text.length);

  let charOffset = 0;
  const segments = rawSegments.map((seg) => {
    const startChar = charOffset;
    const endChar = charOffset + seg.length;
    charOffset = endChar;

    const startRatio = startChar / totalChars;
    const endRatio = endChar / totalChars;
    const startMs = startRatio * dur;
    const endMs = endRatio * dur;

    const isCurrentPlaying = playbackTimeMs >= startMs && playbackTimeMs <= endMs && playbackTimeMs > 0;

    let isEvidence = false;
    if (highlightedEvent?.evidence?.textExcerpt) {
      const excerpt = highlightedEvent.evidence.textExcerpt.toLowerCase();
      isEvidence = seg.toLowerCase().includes(excerpt) || excerpt.includes(seg.trim().toLowerCase());
    } else if (highlightedEvent?.metrics?.token) {
      isEvidence = seg.toLowerCase().includes(highlightedEvent.metrics.token.toLowerCase());
    }

    const isSearchMatch = Boolean(searchQuery && searchQuery.trim().length > 1 && seg.toLowerCase().includes(searchQuery.trim().toLowerCase()));

    return {
      seg,
      startMs,
      endMs,
      isCurrentPlaying,
      isEvidence,
      isSearchMatch,
    };
  });

  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {segments.map((s, idx) => (
        <span
          key={idx}
          onClick={() => onSeek(s.startMs)}
          title={`Click to jump replay to ${clock(s.startMs)}`}
          className={`cursor-pointer rounded transition-all duration-150 ${
            s.isEvidence
              ? 'transcript-evidence-highlight'
              : s.isSearchMatch
                ? 'transcript-search-highlight'
                : s.isCurrentPlaying
                  ? 'transcript-active-phrase'
                  : 'hover:bg-white/10 hover:text-white'
          }`}
        >
          {s.seg}{' '}
        </span>
      ))}
      {liveText && <span className="text-white/35 italic"> {liveText}</span>}
    </div>
  );
}


