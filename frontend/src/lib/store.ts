import { create } from 'zustand';

export interface Snapshot {
  elapsedMs: number;
  transcript: { text: string; wordCount: number; source: string };
  pace: { wpm: number | null; descriptor: string | null; window: string; ready: boolean };
  pauses: { count: number; meanMs: number | null; longestMs: number | null };
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
  delivery: { talkRatio: number | null; speakingSecondsTotal: number };
  answerLatency:
    | null
    | { pending: true; sinceMs: number }
    | { pending: false; latencyMs: number }
    | { pending: false; alreadySpeaking: true };
  timeline: Array<{ t: number; kind: string; meta?: any }>;
}

export type EnergyPoint = { t: number; v: number };

interface ConsoleState {
  status: 'idle' | 'connecting' | 'live' | 'ended';
  sessionId: string | null;
  label: string;
  snapshot: Snapshot | null;
  energy: EnergyPoint[];
  transcriptLive: string;
  transcribing: boolean;
  notices: string[];
  set: (p: Partial<ConsoleState>) => void;
  reset: () => void;
}

const initial = {
  status: 'idle' as const,
  sessionId: null,
  label: '',
  snapshot: null,
  energy: [] as EnergyPoint[],
  transcriptLive: '',
  transcribing: false,
  notices: [] as string[],
};

export const useConsole = create<ConsoleState>((set) => ({
  ...initial,
  set: (p) => set(p),
  reset: () => set({ ...initial }),
}));
