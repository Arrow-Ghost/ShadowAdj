// Session summaries are kept in localStorage only — ShadowADJ has no account
// system and stores nothing about a person server-side beyond the live session.

export interface HistoryEntry {
  id: string;
  label: string;
  mode: string;
  savedAt: number;
  durationMs: number;
  summary: {
    wordCount: number;
    paceWpm: number | null;
    pauseCount: number;
    fillersPerMin: number | null;
    variety: number | null;
  };
  export: any;
}

const KEY = 'shadowadj.history.v1';

export function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveHistory(entry: HistoryEntry) {
  const all = loadHistory();
  all.unshift(entry);
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 40)));
}

export function deleteHistory(id: string) {
  localStorage.setItem(KEY, JSON.stringify(loadHistory().filter((e) => e.id !== id)));
}

export function toCSV(entry: HistoryEntry): string {
  const rows: string[][] = [['t_ms', 'kind', 'detail']];
  for (const ev of entry.export.timeline || []) {
    rows.push([String(ev.t), ev.kind, JSON.stringify(ev.meta ?? {})]);
  }
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function download(name: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
