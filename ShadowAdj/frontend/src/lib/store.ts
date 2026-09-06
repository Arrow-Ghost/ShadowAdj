import { create } from 'zustand';

export interface SpeechEvent {
  sessionId?: string;
  eventId: string;
  sequenceNumber?: number;
  timestamp: number;
  duration: number;
  audioChunkId?: number | null;
  transcriptRevision?: number | null;
  type?: string;
  kind?: string;
  metrics?: Record<string, any>;
  meta?: Record<string, any>;
  evidence?: {
    textExcerpt?: string;
    tStart?: number;
    tEnd?: number;
  } | null;
  t?: number;
}

export interface Snapshot {
  elapsedMs: number;
  transcript: { text: string; wordCount: number; source: string };
  pace: {
    wpm: number | null;
    currentWpm?: number | null;
    rollingWpm?: number | null;
    sessionAverageWpm?: number | null;
    changeWpm?: number | null;
    descriptor: string | null;
    window: string;
    ready: boolean;
  };
  pauses: {
    count: number;
    meanMs: number | null;
    longestMs: number | null;
    totalSilenceMs?: number;
  };
  fillers: {
    ready: boolean;
    hardPerMin: number | null;
    softPerMin: number | null;
    hardExamples: string[];
    softExamples: string[];
    note: string;
  };
  vocabulary: {
    variety: number | null;
    varietyBasis: string;
    longWordRate: number | null;
    distinctWords: number;
    meanUnitLength: number | null;
    meanUnitBasis: 'punctuation' | 'pauses';
  };
  restarts?: { count: number };
  selfCorrections?: { count: number };
  repetitions?: { count: number };
  sentences?: { longCount: number; meanUnitLength: number | null };
  delivery: {
    talkRatio: number | null;
    speakingSecondsTotal: number;
    silenceSecondsTotal?: number;
  };
  answerLatency:
    | null
    | { pending: true; sinceMs: number }
    | { pending: false; latencyMs: number }
    | { pending: false; alreadySpeaking: true };
  timeline: SpeechEvent[];
}

export type EnergyPoint = { t: number; v: number };
export type CognitiveMode = 'minimal' | 'standard' | 'debug';

export interface SingleExperiment {
  title: string;
  goal: string;
  action: string;
}

interface ConsoleState {
  status: 'idle' | 'connecting' | 'live' | 'ended';
  sessionId: string | null;
  label: string;
  cognitiveMode: CognitiveMode;
  snapshot: Snapshot | null;
  energy: EnergyPoint[];
  transcriptLive: string;
  transcribing: boolean;
  notices: string[];
  selectedEvent: SpeechEvent | null;
  audioReplayUrl: string | null;
  replayTime: number;
  telemetryStatus: { degraded: boolean; message: string | null };
  singleExperiment: SingleExperiment | null;
  set: (p: Partial<ConsoleState>) => void;
  reset: () => void;
}

const initial = {
  status: 'idle' as const,
  sessionId: null,
  label: '',
  cognitiveMode: 'standard' as CognitiveMode,
  snapshot: null,
  energy: [] as EnergyPoint[],
  transcriptLive: '',
  transcribing: false,
  notices: [] as string[],
  selectedEvent: null as SpeechEvent | null,
  audioReplayUrl: null as string | null,
  replayTime: 0,
  telemetryStatus: { degraded: false, message: null },
  singleExperiment: null as SingleExperiment | null,
};

export const useConsole = create<ConsoleState>((set) => ({
  ...initial,
  set: (p) => set(p),
  reset: () => set({ ...initial }),
}));

