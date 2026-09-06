import { clock } from '@/lib/format';

// Session summaries are kept locally in the browser only (IndexedDB with localStorage fallback).
// ShadowADJ has no account system and stores nothing about a person server-side.

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
const DB_NAME = 'shadowadj_db';
const STORE_NAME = 'sessions';
const DB_VERSION = 1;

function getIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Asynchronous IndexedDB loader (bypasses 5MB localStorage limit) */
export async function loadHistoryAsync(): Promise<HistoryEntry[]> {
  try {
    const db = await getIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result as HistoryEntry[]) || [];
        items.sort((a, b) => b.savedAt - a.savedAt);
        resolve(items.length ? items : loadHistory());
      };
      req.onerror = () => resolve(loadHistory());
    });
  } catch {
    return loadHistory();
  }
}

/** Asynchronous IndexedDB saver */
export async function saveHistoryAsync(entry: HistoryEntry): Promise<void> {
  // Always save to IndexedDB
  try {
    const db = await getIDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
  } catch {
    /* fallback to localStorage */
  }
  // Also save lightweight entry to localStorage
  saveHistory(entry);
}

/** Asynchronous IndexedDB deleter */
export async function deleteHistoryAsync(id: string): Promise<void> {
  try {
    const db = await getIDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
  } catch {}
  deleteHistory(id);
}

/** Synchronous localStorage loader (for instant initial render) */
export function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

/** Synchronous localStorage saver */
export function saveHistory(entry: HistoryEntry) {
  try {
    const all = loadHistory().filter((e) => e.id !== entry.id);
    all.unshift(entry);
    // Keep most recent 30 in localStorage to stay well below 5MB quota
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 30)));
  } catch {
    /* quota exceeded or blocked */
  }
}

export function deleteHistory(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadHistory().filter((e) => e.id !== id)));
  } catch {}
}

export function toCSV(entry: HistoryEntry): string {
  const rows: string[][] = [['t_ms', 'kind', 'detail']];
  for (const ev of entry.export.timeline || []) {
    rows.push([String(ev.t ?? ev.timestamp ?? 0), ev.kind || ev.type, JSON.stringify(ev.meta ?? ev.metrics ?? {})]);
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

export function toMarkdown(entry: HistoryEntry): string {
  const snap = entry.export?.finalSnapshot;
  const dur = entry.durationMs ? clock(entry.durationMs) : '00:00';
  const lines: string[] = [
    `# ShadowADJ Session Debrief: ${entry.label || 'Session'}`,
    ``,
    `- **Date**: ${new Date(entry.savedAt).toLocaleString()}`,
    `- **Mode**: ${entry.mode}`,
    `- **Duration**: ${dur}`,
    `- **Words Spoken**: ${entry.summary.wordCount ?? 0}`,
    ``,
    `## Delivery Telemetry`,
    `- **Speaking Pace**: ${entry.summary.paceWpm ? `${entry.summary.paceWpm} wpm` : 'Gathering'} (${snap?.pace?.descriptor || 'calibrating'})`,
    `- **Pauses**: ${entry.summary.pauseCount ?? 0} (mean ${snap?.pauses?.meanMs ? `${(snap.pauses.meanMs / 1000).toFixed(1)}s` : '—'})`,
    `- **Filler Rate**: ${entry.summary.fillersPerMin != null ? `${entry.summary.fillersPerMin}/min` : '0/min'} hard fillers`,
    `- **Vocabulary Variety (MATTR-50)**: ${entry.summary.variety != null ? `${Math.round(entry.summary.variety * 100)}%` : '—'}`,
    `- **Talk / Silence Ratio**: ${snap?.delivery?.talkRatio != null ? `${Math.round(snap.delivery.talkRatio * 100)}%` : '—'}`,
    ``,
  ];

  const events = entry.export?.timeline || [];
  if (events.length > 0) {
    lines.push(`## Timeline Events (${events.length})`);
    lines.push(`| Timestamp | Type | Detail | Excerpt |`);
    lines.push(`| :--- | :--- | :--- | :--- |`);
    for (const ev of events) {
      const t = clock(ev.timestamp ?? ev.t ?? 0);
      const type = ev.type || ev.kind || 'EVENT';
      const detail = ev.metrics?.token
        ? `Token: "${ev.metrics.token}"`
        : ev.metrics?.durationMs
          ? `${(ev.metrics.durationMs / 1000).toFixed(1)}s`
          : ev.metrics?.wpm
            ? `${ev.metrics.wpm} wpm`
            : '—';
      const excerpt = (ev.evidence?.textExcerpt || '').replace(/\|/g, '\\|');
      lines.push(`| ${t} | ${type} | ${detail} | ${excerpt} |`);
    }
    lines.push(``);
  }

  if (entry.export?.transcript) {
    lines.push(`## Transcript`);
    lines.push(entry.export.transcript);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*Generated with ShadowADJ — Descriptive Speech Telemetry (No scoring / AI verdict)*`);
  return lines.join('\n');
}

