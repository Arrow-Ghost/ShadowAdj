import { useEffect, useRef, useState } from 'react';
import { createSession, fetchCoaching, fetchIntegrityAnalysis, getHealth, type SessionMode } from '@/lib/api';
import { startCapture, type CaptureHandle } from '@/lib/audio';
import { browserSpeechSupported, startBrowserSpeech } from '@/lib/speech';
import { useConsole } from '@/lib/store';
import { saveHistory, download, toCSV, type HistoryEntry } from '@/lib/history';
import { clock } from '@/lib/format';
import { toast } from '@/lib/ui/toast';
import Sphere from './Sphere';
import MetricRail from './MetricRail';
import Timeline from './Timeline';
import ConsentVisualizer3D from './ConsentVisualizer3D';
import MicTester from './MicTester';

const MODES: { id: SessionMode; title: string; blurb: string; icon: string; tag: string }[] = [
  {
    id: 'debate-practice',
    title: 'Debate Practice',
    blurb: 'Rounds, clashes, rebuttals, and speaker drills with pace reflection.',
    icon: '01',
    tag: 'Competitive',
  },
  {
    id: 'interview-prep',
    title: 'Interview Prep',
    blurb: 'Rehearse behavioural answers, structural flow, and filler control.',
    icon: '02',
    tag: 'Executive',
  },
  {
    id: 'speech-coaching',
    title: 'Speech Coaching',
    blurb: 'Keynotes, toasts, presentations, and oratory cadence mastery.',
    icon: '03',
    tag: 'Rhetoric',
  },
];

const LANGUAGE_PRESETS = [
  { code: '', label: 'English (Default)' },
  { code: 'hi', label: 'Hindi (hi)' },
  { code: 'es', label: 'Spanish (es)' },
  { code: 'fr', label: 'French (fr)' },
  { code: 'de', label: 'German (de)' },
  { code: 'zh', label: 'Mandarin (zh)' },
];

const METRIC_KEYS = ['pace', 'pauses', 'fillers', 'vocabulary', 'delivery', 'latency'] as const;
const PREF_KEY = 'shadowadj.prefs.v2';

type Step = 'setup' | 'consent' | 'live' | 'ended';

interface Prefs {
  mode: SessionMode;
  label: string;
  transcriptSource: 'browser' | 'server';
  languages: string;
  expectSpeakers: number;
  metrics: Record<string, boolean>;
}

function defaultPrefs(): Prefs {
  return {
    mode: 'debate-practice',
    label: '',
    transcriptSource: 'server',
    languages: '',
    expectSpeakers: 1,
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
    provider?: string;
    model?: string;
    defaultTranscription?: 'server' | 'browser';
  } | null>(null);
  const [consent, setConsent] = useState({ speaker: false, second: false });
  const [showOnboard, setShowOnboard] = useState(false);
  const [testAudioLevel, setTestAudioLevel] = useState(0);
  const [testAnalyser, setTestAnalyser] = useState<AnalyserNode | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coaching, setCoaching] = useState<{ notes: string; loading: boolean; error: string | null }>({
    notes: '',
    loading: false,
    error: null,
  });
  const [integrity, setIntegrity] = useState<{ data: any | null; loading: boolean; error: string | null }>({
    data: null,
    loading: false,
    error: null,
  });

  const store = useConsole();
  const captureRef = useRef<CaptureHandle | null>(null);
  const stopSpeechRef = useRef<() => void>(() => {});
  const exportRef = useRef<any>(null);
  const startedAtRef = useRef<number>(0);
  const transcriptBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcriptBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [store.snapshot?.transcript.text, store.transcriptLive]);

  // Resilient health check: the backend runs with --watch and restarts on every
  // save, so a one-shot probe often lands in a dead window and then the banner
  // sticks forever. Retry a few times, then keep polling; recover on its own
  // when the backend comes back.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let misses = 0;

    const ping = async () => {
      try {
        const h = await getHealth();
        if (!alive) return;
        setHealth(h);
        setError((e) => (e && e.startsWith('Backend not reachable') ? null : e));
        misses = 0;
        timer = setTimeout(ping, 15_000); // steady re-check while it's up
      } catch {
        if (!alive) return;
        misses += 1;
        if (misses >= 3) {
          setHealth(null);
          setError('Backend not reachable on :8787 — start it with `npm run dev` (only one instance), then it reconnects automatically.');
        }
        timer = setTimeout(ping, Math.min(1000 * misses, 4000)); // fast retry while down
      }
    };
    ping();

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => () => teardown(), []);

  useEffect(() => {
    try {
      setShowOnboard(!localStorage.getItem('shadowadj.onboarded.v1'));
    } catch {
      /* private mode — just skip the tip */
    }
  }, []);

  function dismissOnboard() {
    setShowOnboard(false);
    try {
      localStorage.setItem('shadowadj.onboarded.v1', '1');
    } catch {
      /* noop */
    }
  }

  // Surface the newest notice as a transient toast (the banner keeps the
  // persistent copy for anything the user needs to keep reading).
  const lastNoticeRef = useRef(0);
  useEffect(() => {
    const n = store.notices;
    if (n.length > lastNoticeRef.current) {
      toast.warn(n[n.length - 1]);
      lastNoticeRef.current = n.length;
    }
  }, [store.notices]);

  // Keyboard shortcuts while a round is live: Q question · C clash · P POI · E end.
  useEffect(() => {
    if (step !== 'live') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'q') { sendTimelineTag('question', 'Q'); toast('Question marked'); }
      else if (k === 'c') { sendTimelineTag('clash', 'CLASH-'); toast('Clash marked'); }
      else if (k === 'p') { sendTimelineTag('poi', 'POI-'); toast('POI marked'); }
      else if (k === 'e') endSession();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function teardown() {
    captureRef.current?.stop();
    captureRef.current = null;
    stopSpeechRef.current?.();
  }

  async function beginSession() {
    setError(null);
    try {
      const useServer = prefs.transcriptSource === 'server' && health?.geminiEnabled;
      const languages = prefs.languages
        .split(/[,\s]+/)
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
      const s = await createSession({
        mode: prefs.mode,
        label: prefs.label || undefined,
        consent: { speakerAcknowledged: consent.speaker, secondPartyAcknowledged: consent.second },
        languages: languages.length ? languages : undefined,
        expectSpeakers: prefs.expectSpeakers > 1 ? prefs.expectSpeakers : undefined,
        transcriptSource: useServer ? 'server' : 'browser',
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
              'This browser has no speech recognition. Switch to server transcription, or use Chrome.',
            ],
          });
        }
      } else {
        // In server mode, if the browser supports SpeechRecognition, run it in parallel for zero-latency interim live preview
        if (browserSpeechSupported()) {
          stopSpeechRef.current?.();
          stopSpeechRef.current = startBrowserSpeech({
            onResult: (text, isFinal) => {
              if (!isFinal && text) {
                store.set({ transcriptLive: text });
              }
            },
            onError: () => {},
          });
        }
      }

      startedAtRef.current = Date.now();
      store.set({ status: 'live' });
      setStep('live');
    } catch (e: any) {
      setError(e.message || 'Could not initialize session capture');
      teardown();
    }
  }

  function startBrowserTranscription(socket: WebSocket) {
    stopSpeechRef.current?.();
    stopSpeechRef.current = startBrowserSpeech({
      onResult: (text, isFinal) => {
        if (!text) return;
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'transcript', text, isFinal }));
        }
        if (isFinal) {
          store.set((state) => {
            const current = state.snapshot?.transcript.text || '';
            const updated = current ? `${current} ${text}` : text;
            return {
              snapshot: state.snapshot
                ? {
                    ...state.snapshot,
                    transcript: {
                      ...state.snapshot.transcript,
                      text: updated,
                      wordCount: updated.split(/\s+/).filter(Boolean).length,
                    },
                  }
                : null,
              transcriptLive: '',
            };
          });
        } else {
          store.set({ transcriptLive: text });
        }
      },
      onError: (e) => store.set({ notices: [...useConsole.getState().notices, e] }),
    });
  }

  function onSocketMessage(msg: any) {
    if (msg.type === 'tick') {
      store.set({ snapshot: msg.snapshot, energy: msg.energy, transcribing: Boolean(msg.transcribing) });
    } else if (msg.type === 'transcript') {
      if (msg.text && msg.isFinal) {
        store.set((state) => {
          const current = state.snapshot?.transcript.text || '';
          if (current.endsWith(msg.text) || current.includes(msg.text)) {
            return { transcriptLive: '' };
          }
          const updated = current ? `${current} ${msg.text}` : msg.text;
          return {
            snapshot: state.snapshot
              ? {
                  ...state.snapshot,
                  transcript: {
                    ...state.snapshot.transcript,
                    text: updated,
                    wordCount: updated.split(/\s+/).filter(Boolean).length,
                  },
                }
              : null,
            transcriptLive: '',
          };
        });
      } else {
        store.set({ transcriptLive: '' });
      }
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

  function sendTimelineTag(kind: 'question' | 'clash' | 'poi' | 'rebuttal', labelPrefix: string) {
    const sock = captureRef.current?.socket;
    if (sock?.readyState === WebSocket.OPEN) {
      const count = (store.snapshot?.timeline.filter((t) => t.kind === kind).length ?? 0) + 1;
      sock.send(JSON.stringify({ type: 'question', label: `${labelPrefix}${count}` }));
    }
  }

  async function endSession() {
    store.set({ status: 'ended' });
    setStep('ended');
    setFinalizing(true);
    stopSpeechRef.current?.();

    let finalExport: any = null;
    try {
      finalExport = await (captureRef.current?.finish(8000) ?? Promise.resolve(null));
    } catch {
      /* fallback */
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
      /* safe fallback */
    }
  }

  async function getCoaching() {
    if (!store.sessionId) return;
    setCoaching({ notes: '', loading: true, error: null });
    try {
      const r = await fetchCoaching(store.sessionId);
      setCoaching({ notes: r.notes, loading: false, error: null });
    } catch (e: any) {
      setCoaching({ notes: '', loading: false, error: e.message });
    }
  }

  async function getIntegrity() {
    if (!store.sessionId) return;
    setIntegrity({ data: null, loading: true, error: null });
    try {
      const r = await fetchIntegrityAnalysis(store.sessionId);
      setIntegrity({ data: r, loading: false, error: null });
    } catch (e: any) {
      setIntegrity({ data: null, loading: false, error: e.message });
    }
  }

  const serverAvailable = Boolean(health?.geminiEnabled);

  /* ----------------------------- STEP 1: SETUP ----------------------------- */
  if (step === 'setup') {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Top Header Badge */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-cyan/10 px-3.5 py-1 text-xs font-semibold text-cyan">
            <span className="h-2 w-2 rounded-full bg-cyan animate-ping" />
            <span>SESSION CONFIGURATION // HUD</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-white/40">Transcription:</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${
              serverAvailable ? 'border border-mint/40 bg-mint/10 text-mint' : 'border border-amber/40 bg-amber/10 text-amber'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${serverAvailable ? 'bg-mint' : 'bg-amber'}`} />
              {serverAvailable ? 'SERVER · READY' : 'BROWSER FALLBACK'}
            </span>
          </div>
        </div>

        <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Initialize <span className="bg-gradient-to-r from-cyan to-mint bg-clip-text text-transparent">Telemetry Console</span>
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-white/60 max-w-2xl">
          ShadowADJ captures speech cadence, pauses, filler distribution, and vocabulary depth in real time.
          Configure your session parameters before authenticating audio access.
        </p>

        {error && <Banner tone="rose">{error}</Banner>}

        {showOnboard && (
          <div className="reveal mt-5 flex items-start gap-3 rounded-2xl border border-cyan/25 bg-cyan/[0.06] p-4">
            <span className="font-mono text-[11px] font-bold tracking-wider text-cyan px-2 py-0.5 rounded border border-cyan/30 bg-cyan/10">GUIDE</span>
            <div className="flex-1 text-sm text-white/75">
              <p className="font-semibold text-white">New here? Three quick steps.</p>
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-[13px] text-white/60">
                <li>Pick a mode and (optionally) name the round.</li>
                <li>Keep <span className="text-cyan">Server AI Transport</span> selected — it works in every browser.</li>
                <li>Acknowledge consent, allow the mic, and talk. Metrics fill in as you go.</li>
              </ol>
              <p className="mt-1.5 text-[12px] text-white/40">
                While live: <kbd>Q</kbd> mark question · <kbd>C</kbd> clash · <kbd>P</kbd> POI · <kbd>E</kbd> end.
              </p>
            </div>
            <button
              onClick={dismissOnboard}
              className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/50 transition hover:border-white/25 hover:text-white"
            >
              Got it
            </button>
          </div>
        )}

        {/* Mode Selector Cards */}
        <div className="mt-8">
          <label className="metric-label block mb-3 text-cyan/80">Select Practice Mode</label>
          <div className="grid gap-3 sm:grid-cols-3">
            {MODES.map((m) => {
              const active = prefs.mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPrefs((p) => ({ ...p, mode: m.id }))}
                  className={`glass relative p-5 text-left transition-all duration-200 ease-pop ${
                    active
                      ? 'border-cyan/70 bg-gradient-to-br from-cyan/15 via-slate-900/80 to-mint/10 shadow-[0_0_25px_rgba(0,212,255,0.25)] ring-1 ring-cyan/50'
                      : 'border-white/10 hover:border-white/20 hover:bg-white/[0.03] opacity-80 hover:opacity-100'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-sm font-semibold tracking-wider text-cyan/80">{m.icon}</span>
                    <span className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                      active ? 'bg-cyan/20 text-cyan border border-cyan/40' : 'bg-white/5 text-white/40'
                    }`}>
                      {m.tag}
                    </span>
                  </div>
                  <div className="font-bold text-white text-base">{m.title}</div>
                  <div className="mt-1.5 text-xs text-white/50 leading-relaxed">{m.blurb}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Session Metadata Grid */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {/* Label Input */}
          <div className="glass p-5">
            <span className="metric-label block mb-2">Round / Session Identifier</span>
            <input
              value={prefs.label}
              onChange={(e) => setPrefs((p) => ({ ...p, label: e.target.value }))}
              placeholder="e.g. Finals — 1st Opposition Rebuttal"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder-white/30 outline-none transition focus:border-cyan/60 focus:shadow-[0_0_15px_rgba(0,212,255,0.2)]"
            />
            <p className="mt-2 text-[11px] text-white/40">Optional tag used when generating audit logs and CSV exports.</p>
          </div>

          {/* Speaker Count Counter */}
          <div className="glass p-5">
            <span className="metric-label block mb-2">Expected Debaters / Speakers</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center rounded-xl border border-white/10 bg-black/40 p-1">
                <button
                  type="button"
                  onClick={() => setPrefs((p) => ({ ...p, expectSpeakers: Math.max(1, p.expectSpeakers - 1) }))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white hover:bg-white/10 transition active:scale-95"
                >
                  -
                </button>
                <span className="w-12 text-center font-mono text-base font-bold text-cyan">
                  {prefs.expectSpeakers}
                </span>
                <button
                  type="button"
                  onClick={() => setPrefs((p) => ({ ...p, expectSpeakers: Math.min(8, p.expectSpeakers + 1) }))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white hover:bg-white/10 transition active:scale-95"
                >
                  +
                </button>
              </div>
              <span className="text-xs text-white/50">
                {prefs.expectSpeakers > 1 ? 'Multi-speaker turn diarization active' : 'Solo speaker practice profile'}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-white/40">Multi-speaker tracks individual turn timestamps & clashes.</p>
          </div>
        </div>

        {/* Language Target Selector */}
        <div className="glass mt-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="metric-label">Spoken Languages &amp; Gloss</span>
            <span className="text-[11px] text-white/40">Multilingual audio is glossed into English automatically</span>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {LANGUAGE_PRESETS.map((preset) => {
              const active = prefs.languages === preset.code;
              return (
                <button
                  key={preset.code}
                  type="button"
                  onClick={() => setPrefs((p) => ({ ...p, languages: preset.code }))}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? 'border-mint/60 bg-mint/15 text-mint shadow-[0_0_12px_rgba(0,255,156,0.2)]'
                      : 'border-white/10 bg-white/5 text-white/60 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <input
            value={prefs.languages}
            onChange={(e) => setPrefs((p) => ({ ...p, languages: e.target.value }))}
            placeholder="Custom language codes (e.g. en, hi, es, fr)"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-cyan/50"
          />
        </div>

        {/* Transcription Engine Options */}
        <div className="glass mt-4 p-5">
          <span className="metric-label block mb-2">Speech Recognition Pipeline</span>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={!serverAvailable}
              onClick={() => serverAvailable && setPrefs((p) => ({ ...p, transcriptSource: 'server' }))}
              className={`rounded-xl border p-3.5 text-left transition ${
                prefs.transcriptSource === 'server'
                  ? 'border-cyan/60 bg-cyan/10 ring-1 ring-cyan/40 text-white'
                  : 'border-white/10 bg-black/30 text-white/60 hover:border-white/20'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-cyan">Server AI Transport</span>
                <span className="font-mono text-[10px] text-mint">RECOMMENDED</span>
              </div>
              <p className="mt-1 text-xs text-white/50">
                Low-latency server transcription. Works on every browser.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setPrefs((p) => ({ ...p, transcriptSource: 'browser' }))}
              className={`rounded-xl border p-3.5 text-left transition ${
                prefs.transcriptSource === 'browser'
                  ? 'border-cyan/60 bg-cyan/10 ring-1 ring-cyan/40 text-white'
                  : 'border-white/10 bg-black/30 text-white/60 hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-white">Browser Web Speech</span>
                <span className="font-mono text-[10px] text-white/40">CHROME ONLY</span>
              </div>
              <p className="mt-1 text-xs text-white/50">
                Local on-device browser recognition API. No API key required.
              </p>
            </button>
          </div>
        </div>

        {/* Telemetry Metrics To Track */}
        <div className="glass mt-4 p-5">
          <span className="metric-label block mb-2">Live Telemetry Metrics</span>
          <div className="flex flex-wrap gap-2">
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

        {/* Next Step Action Button */}
        <div className="mt-8 flex justify-end">
          <button
            type="button"
            className="btn btn-primary text-sm px-6 py-3 shadow-[0_0_25px_rgba(0,212,255,0.35)]"
            onClick={() => setStep('consent')}
          >
            Proceed to Biometric Consent &amp; Verification →
          </button>
        </div>
      </div>
    );
  }

  /* ----------------------------- STEP 2: CONSENT (NEXT-GEN 3D HUD) ----------------------------- */
  if (step === 'consent') {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Top Header Badge */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-mint/30 bg-mint/10 px-3.5 py-1 text-xs font-semibold text-mint">
            <span className="h-2 w-2 rounded-full bg-mint animate-pulse" />
            <span>ETHICAL AUDIT &amp; AUDIO CONSENT PROTOCOL</span>
          </div>

          <div className="font-mono text-xs text-white/50">
            MODE: <span className="text-cyan font-bold uppercase">{prefs.mode}</span> · SPEAKERS: <span className="text-white">{prefs.expectSpeakers}</span>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_1.3fr]">
          {/* Left Column: 3D Holographic WebGL Integrity Node & Mode Card */}
          <div className="flex flex-col gap-4">
            <div className="h-[360px] w-full">
              <ConsentVisualizer3D
                consentGranted={consent.speaker}
                audioLevel={testAudioLevel}
                analyser={testAnalyser}
              />
            </div>

            {/* Session Config Recap Box */}
            <div className="glass p-4">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="metric-label">Target Session Profile</span>
                <span className="text-mint font-mono text-[11px]">READY FOR AUTH</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-black/30 border border-white/5 p-2.5">
                  <div className="text-white/40 text-[10px]">MODE</div>
                  <div className="font-semibold text-white mt-0.5">{MODES.find((m) => m.id === prefs.mode)?.title}</div>
                </div>
                <div className="rounded-lg bg-black/30 border border-white/5 p-2.5">
                  <div className="text-white/40 text-[10px]">PIPELINE</div>
                  <div className="font-semibold text-cyan mt-0.5 capitalize">{prefs.transcriptSource} AI</div>
                </div>
              </div>
            </div>

            {/* Pre-Flight Live Microphone Check */}
            <MicTester
              onAudioLevel={(lvl) => setTestAudioLevel(lvl)}
              onAnalyserCreated={(analyser) => setTestAnalyser(analyser)}
            />
          </div>

          {/* Right Column: Security Protocol Pillars & Biometric Checkers */}
          <div className="flex flex-col justify-between space-y-4">
            {/* Protocol Pillars */}
            <div className="space-y-3">
              <div className="glass p-4 transition hover:border-cyan/30">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan/40 bg-cyan/10 font-mono text-xs font-bold text-cyan">
                    01
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-white">Ephemeral RAM Audio Stream</h3>
                    <p className="mt-1 text-xs text-white/60 leading-relaxed">
                      Microphone audio is captured via 16 kHz PCM AudioWorklet, streamed to the local backend solely for feature extraction, and <strong>instantly discarded from volatile memory</strong> when the session terminates. No permanent WAV/MP3 files are ever recorded.
                    </p>
                  </div>
                </div>
              </div>

              <div className="glass p-4 transition hover:border-mint/30">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-mint/40 bg-mint/10 font-mono text-xs font-bold text-mint">
                    02
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-white">Pure Linguistic Telemetry · No Automated Verdicts</h3>
                    <p className="mt-1 text-xs text-white/60 leading-relaxed">
                      ShadowADJ extracts objective acoustic signals (WPM pacing, pause duration, MATTR vocabulary depth, filler count). It <strong>never issues automated cheating scores</strong> or replaces the authority of human adjudicators.
                    </p>
                  </div>
                </div>
              </div>

              <div className="glass p-4 transition hover:border-amber/30">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber/40 bg-amber/10 font-mono text-xs font-bold text-amber">
                    03
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-white">Mutual Glass Transparency</h3>
                    <p className="mt-1 text-xs text-white/60 leading-relaxed">
                      All live metrics and transcript logs are projected on this exact shared HUD. Every debater, adjudicator, and coach sees identical real-time telemetry with full auditability.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {error && <Banner tone="rose">{error}</Banner>}

            {/* Interactive Agreement Checklist */}
            <div className="space-y-3 pt-2">
              {/* Primary Speaker Consent */}
              <div
                onClick={() => setConsent((c) => ({ ...c, speaker: !c.speaker }))}
                className={`glass cursor-pointer p-4 transition-all duration-200 ${
                  consent.speaker
                    ? 'border-mint/60 bg-mint/[0.07] ring-1 ring-mint/40 shadow-[0_0_20px_rgba(0,255,156,0.15)]'
                    : 'border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition ${
                      consent.speaker
                        ? 'border-mint bg-mint text-slate-950 font-bold shadow-[0_0_10px_#00ff9c]'
                        : 'border-white/30 bg-black/40'
                    }`}
                  >
                    {consent.speaker && (
                      <svg className="h-3.5 w-3.5 text-slate-950 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">Primary Speaker Authorization</span>
                      <span
                        className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded ${
                          consent.speaker ? 'bg-mint/20 text-mint border border-mint/40' : 'bg-rose/20 text-rose border border-rose/40'
                        }`}
                      >
                        {consent.speaker ? 'VERIFIED' : 'REQUIRED'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-white/60 leading-relaxed">
                      I confirm that I am the active debater (or authorized setup facilitator) and formally consent to live speech telemetry extraction for this round.
                    </p>
                  </div>
                </div>
              </div>

              {/* Coach / Second Party Optional Acknowledgment */}
              <div
                onClick={() => setConsent((c) => ({ ...c, second: !c.second }))}
                className={`glass cursor-pointer p-4 transition-all duration-200 ${
                  consent.second
                    ? 'border-cyan/60 bg-cyan/[0.07] ring-1 ring-cyan/40 shadow-[0_0_20px_rgba(0,212,255,0.15)]'
                    : 'border-white/10 hover:border-white/20 opacity-80 hover:opacity-100'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition ${
                      consent.second
                        ? 'border-cyan bg-cyan text-slate-950 font-bold shadow-[0_0_10px_#00d4ff]'
                        : 'border-white/30 bg-black/40'
                    }`}
                  >
                    {consent.second && (
                      <svg className="h-3.5 w-3.5 text-slate-950 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">Adjudicator / Coach Co-Sign</span>
                      <span className="font-mono text-[10px] bg-white/10 text-white/60 px-2 py-0.5 rounded">
                        OPTIONAL
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-white/60 leading-relaxed">
                      An adjudicator, coach, or peer observer is present in the room and acknowledges the telemetry parameters.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation & Action Launch Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/10">
              <button
                type="button"
                className="btn text-xs px-4 py-2.5"
                onClick={() => setStep('setup')}
              >
                ← Back to Configuration
              </button>

              <button
                type="button"
                disabled={!consent.speaker}
                onClick={beginSession}
                className={`btn text-sm px-7 py-3 font-bold transition-all duration-300 ${
                  consent.speaker
                    ? 'btn-mint shadow-[0_0_30px_rgba(0,255,156,0.5)] animate-pulse'
                    : 'opacity-40 cursor-not-allowed border-white/10 bg-white/5 text-white/40'
                }`}
              >
                {consent.speaker ? 'Authorize Mic & Launch Console' : 'Check Required Consent Above'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ----------------------------- STEP 3 & 4: LIVE & ENDED CONSOLE ----------------------------- */
  const snap = store.snapshot;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Top Telemetry HUD Ticker */}
      <div className="mb-5 rounded-2xl border border-white/10 bg-slate-950/70 p-4 backdrop-blur-2xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <span className={`inline-block h-3 w-3 rounded-full ${
                step === 'live' ? 'animate-pulse bg-mint shadow-[0_0_12px_#00ff9c]' : 'bg-white/30'
              }`} />
              <div>
                <h1 className="text-lg font-bold text-white flex items-center gap-2">
                  {store.label || 'Debate Session Telemetry'}
                  <span className="font-mono text-xs font-normal text-cyan bg-cyan/10 border border-cyan/30 px-2 py-0.5 rounded-full">
                    {MODES.find((m) => m.id === prefs.mode)?.title || 'Live'}
                  </span>
                </h1>
                <p className="text-[11px] text-white/40 font-mono">
                  PIPE: {snap?.transcript.source === 'server'
                    ? 'SERVER TRANSCRIPTION'
                    : snap?.transcript.source === 'browser'
                      ? 'BROWSER TRANSCRIPTION'
                      : 'PCM 16KHZ WORKLET'}
                  {store.transcribing && <span className="ml-1.5 text-cyan animate-pulse">● transcribing…</span>}
                </p>
              </div>
            </div>
          </div>

          {/* Real-time Clock & Status Indicators */}
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="font-mono text-xl font-bold tracking-wider text-mint">
                {clock(snap?.elapsedMs ?? 0)}
              </div>
              <div className="font-mono text-[10px] text-white/40 uppercase">
                ELAPSED SESSION TIME
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex items-center gap-2">
              {step === 'live' && (
                <>
                  <button
                    type="button"
                    onClick={() => { sendTimelineTag('question', 'Q'); toast('Question marked'); }}
                    className="btn !px-3 !py-2 text-xs border-cyan/40 bg-cyan/10 text-cyan hover:bg-cyan/20"
                    title="Timestamp a question asked in this debate round (Q)"
                  >
                    Mark Question <kbd className="ml-1">Q</kbd>
                  </button>
                  <button
                    type="button"
                    onClick={() => { sendTimelineTag('clash', 'CLASH-'); toast('Clash marked'); }}
                    className="btn !px-3 !py-2 text-xs border-amber/40 bg-amber/10 text-amber hover:bg-amber/20"
                    title="Timestamp an argument clash (C)"
                  >
                    Clash <kbd className="ml-1">C</kbd>
                  </button>
                  <button
                    type="button"
                    onClick={() => { sendTimelineTag('poi', 'POI-'); toast('POI marked'); }}
                    className="btn !px-3 !py-2 text-xs border-mint/40 bg-mint/10 text-mint hover:bg-mint/20"
                    title="Timestamp a Point of Information (P)"
                  >
                    POI <kbd className="ml-1">P</kbd>
                  </button>
                  <button
                    type="button"
                    onClick={endSession}
                    className="btn btn-danger !px-4 !py-2 text-xs font-bold shadow-[0_0_15px_rgba(255,92,122,0.4)]"
                  >
                    End Session
                  </button>
                </>
              )}

              {step === 'ended' && (
                <>
                  {finalizing && <span className="text-xs text-cyan animate-pulse">Finalizing transcript telemetry…</span>}
                  <button
                    type="button"
                    onClick={() => {
                      store.reset();
                      setStep('setup');
                      setCoaching({ notes: '', loading: false, error: null });
                      setIntegrity({ data: null, loading: false, error: null });
                    }}
                    className="btn btn-primary !px-4 !py-2 text-xs font-bold"
                  >
                    + New Session
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {store.notices.length > 0 && (
        <Banner tone="amber">{store.notices[store.notices.length - 1]}</Banner>
      )}

      {/* Main 3D Sphere & Real-time Metrics Grid */}
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="glass relative min-h-[380px] overflow-hidden p-0 border border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.6)]">
          <Sphere
            analyser={captureRef.current?.analyser ?? null}
            descriptor={(snap?.pace.descriptor as any) ?? null}
            live={step === 'live'}
          />

          <div className="pointer-events-none absolute top-4 left-4 flex items-center gap-2 font-mono text-[10px] text-cyan/70">
            <span className="inline-block h-2 w-2 rounded-full bg-cyan animate-ping" />
            <span>3D ACOUSTIC SPEECH LATTICE</span>
          </div>

          <div className="pointer-events-none absolute bottom-4 left-4 right-4 flex items-center justify-between font-mono text-[10px] text-white/40">
            <span>
              PACE: <strong className="text-white uppercase">{snap?.pace.descriptor ?? 'IDLE'}</strong> · COLOR GRADIENT DRIVEN BY CADENCE
            </span>
            <span>SIZE = REALTIME FFT VOLUME</span>
          </div>
        </div>

        <MetricRail snapshot={snap} enabled={{ ...prefs.metrics }} />
      </div>

      {/* Real-time Timeline Wave */}
      <div className="mt-4">
        <Timeline energy={store.energy} snapshot={snap} />
      </div>

      {/* Transcript & Self-Review / Coaching Panels */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Live Multilingual Transcript Box */}
        <div className="glass p-5">
          <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <span>Live Speech Transcript</span>
              {store.transcribing && <span className="font-mono text-[10px] text-cyan animate-pulse">● TRANSCRIBING…</span>}
              {step === 'live' && (
                <span className="font-mono text-[10px] text-mint/80 flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-mint animate-pulse" /> LIVE MIC
                </span>
              )}
            </h3>
            <span className="font-mono text-[11px] text-white/40">
              {snap?.transcript.wordCount ?? 0} words
            </span>
          </div>

          <div className="max-h-72 min-h-[140px] overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-white/80 p-3 rounded-xl bg-black/25 border border-white/10 shadow-inner">
            {snap?.transcript.text ? (
              <>
                <span>{snap.transcript.text}</span>
                {store.transcriptLive && (
                  <span className="text-cyan font-medium animate-pulse"> {store.transcriptLive}</span>
                )}
              </>
            ) : store.transcriptLive ? (
              <span className="text-cyan font-medium animate-pulse">{store.transcriptLive}</span>
            ) : (
              <span className="text-white/30 italic flex items-center gap-2">
                {step === 'live' ? (
                  <>
                    <span className="inline-block h-2 w-2 rounded-full bg-cyan/60 animate-ping" />
                    Listening… speak into your mic to see real-time transcription.
                  </>
                ) : (
                  'No transcript recorded.'
                )}
              </span>
            )}
            <div ref={transcriptBottomRef} />
          </div>
        </div>

        {/* Self-Review & Coaching Notes */}
        <div className="glass p-5">
          <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
            <h3 className="text-sm font-semibold text-white">Coaching Insights &amp; Export</h3>
            {step === 'ended' && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn !px-2.5 !py-1 text-xs"
                  onClick={() => download(`${store.label || 'debate-session'}.json`, JSON.stringify(exportRef.current, null, 2))}
                >
                  JSON
                </button>
                <button
                  type="button"
                  className="btn !px-2.5 !py-1 text-xs"
                  onClick={() => download(`${store.label || 'debate-session'}.csv`, toCSV(exportRef.current), 'text/csv')}
                >
                  CSV
                </button>
              </div>
            )}
          </div>

          {step !== 'ended' ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-xs text-white/40">
              <span className="font-mono text-xs text-white/40 mb-2 uppercase tracking-wider">[IN PROGRESS]</span>
              <p>Session in progress. Post-round speech coaching &amp; structure reflection unlock automatically once the round ends.</p>
            </div>
          ) : serverAvailable ? (
            <div>
              {!coaching.notes && !coaching.loading && (
                <button
                  type="button"
                  className="btn btn-primary text-xs w-full py-2.5 font-semibold"
                  onClick={getCoaching}
                >
                  Generate AI Speech &amp; Delivery Notes
                </button>
              )}

              {coaching.loading && (
                <div className="py-6 text-center text-xs text-cyan animate-pulse">
                  Analyzing cadence, transition seams, and argumentative structure…
                </div>
              )}

              {coaching.error && <Banner tone="rose">{coaching.error}</Banner>}

              {coaching.notes && (
                <div className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-white/80 p-3 rounded-xl bg-black/30 border border-white/5">
                  {coaching.notes}
                </div>
              )}

              <p className="mt-3 text-[11px] text-white/40">
                Coaching notes evaluate vocal delivery, cadence balance, and clarity without assigning arbitrary point penalties.
              </p>
            </div>
          ) : (
            <p className="text-xs text-white/40">
              Server transcription is offline, so automated speech coaching is unavailable for this session.
            </p>
          )}
        </div>
      </div>

      {/* Ended Round AI & Plagiarism Integrity Audit */}
      {step === 'ended' && (
        <div className="glass mt-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Source &amp; Linguistic Integrity Audit</h3>
              <p className="text-xs text-white/40">
                Cross-references the round transcript against public corpora to surface unattributed external citations and AI phrasing patterns.
              </p>
            </div>
            {!integrity.data && !integrity.loading && (
              <button type="button" className="btn btn-primary text-xs font-semibold" onClick={getIntegrity}>
                Run Source &amp; Integrity Check
              </button>
            )}
          </div>

          {integrity.loading && (
            <p className="mt-3 text-xs text-cyan animate-pulse">
              Scanning external reference corpora &amp; running stylistic variance analysis…
            </p>
          )}

          {integrity.error && <Banner tone="rose">{integrity.error}</Banner>}

          {integrity.data && (
            <div className="mt-4 space-y-3">
              {integrity.data.case ? (
                <>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-xs text-white">Risk Classification:</span>
                    <span
                      className={`rounded-md px-2.5 py-0.5 font-mono text-xs font-bold ${
                        integrity.data.case.riskLevel === 'HIGH' || integrity.data.case.riskLevel === 'CRITICAL'
                          ? 'border border-rose/40 bg-rose/10 text-rose'
                          : integrity.data.case.riskLevel === 'MODERATE'
                            ? 'border border-amber/40 bg-amber/10 text-amber'
                            : 'border border-mint/40 bg-mint/10 text-mint'
                      }`}
                    >
                      {integrity.data.case.riskLevel}
                    </span>
                    <span className="text-xs text-white/40 font-mono">
                      (Composite Score: {Math.round(integrity.data.case.compositeScore * 100)}%)
                    </span>
                  </div>

                  {integrity.data.case.reasons && integrity.data.case.reasons.length > 0 && (
                    <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                      <div className="metric-label mb-1.5">Integrity Observations</div>
                      <ul className="list-disc pl-4 text-xs text-white/70 space-y-1">
                        {integrity.data.case.reasons.map((r: string, idx: number) => (
                          <li key={idx}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {integrity.data.case.sourceMatches && integrity.data.case.sourceMatches.length > 0 ? (
                    <div className="mt-3">
                      <div className="metric-label">Matched Sources &amp; Plagiarism</div>
                      <div className="mt-1 space-y-1.5">
                        {integrity.data.case.sourceMatches.map((m: any, idx: number) => (
                          <div key={idx} className="rounded-lg border border-white/5 bg-black/20 p-2 text-xs">
                            <div className="flex justify-between font-medium text-white/80">
                              <span>{m.title || m.domain || 'Source match'}</span>
                              <span className="font-mono text-cyan">
                                {Math.round(m.exactSimilarity * 100)}% similarity ({m.classification})
                              </span>
                            </div>
                            <p className="mt-1 text-white/60 italic">“{m.matchedText}”</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-mint/80">[CLEAN] No unattributed source matches detected in this transcript.</p>
                  )}
                </>
              ) : integrity.data.analytics ? (
                <div className="text-xs text-white/70">
                  <p className="text-mint">[PERMITTED] Tournament policy permits AI assistance — logged as disclosure telemetry.</p>
                  <p className="mt-1 text-white/40">Source matches: {integrity.data.analytics.sourceMatchCount}</p>
                </div>
              ) : (
                <p className="text-xs text-mint">[VERIFIED] Transcript verified — clean.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------- UI Helper Components --------------------------- */

function Banner({ children, tone }: { children: React.ReactNode; tone: 'rose' | 'amber' }) {
  const c = tone === 'rose' ? 'border-rose/40 bg-rose/10 text-rose' : 'border-amber/40 bg-amber/10 text-amber';
  return <div className={`mt-4 rounded-xl border px-4 py-2.5 text-sm ${c}`}>{children}</div>;
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
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs capitalize transition ${
        active
          ? 'border-cyan/60 bg-cyan/15 text-cyan shadow-[0_0_10px_rgba(0,212,255,0.2)]'
          : 'border-white/10 bg-black/30 text-white/50 hover:text-white/80 hover:bg-white/5'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}
