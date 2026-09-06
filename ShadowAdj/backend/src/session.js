import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionAnalyzer } from './analysis/analyzer.js';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(here, '../../data');

const VALID_MODES = new Set(['debate-practice', 'interview-prep', 'speech-coaching']);
const SESSION_TTL_MS = 3 * 60 * 60 * 1000; // 3h hard cap, then discarded

/** In-memory session store. Audio is never written to disk; only an opt-in
 *  transcript export is, and only when PERSIST_TRANSCRIPTS=1. */
class SessionStore {
  constructor() {
    this.sessions = new Map();
    setInterval(() => this._sweep(), 60_000).unref?.();
  }

  create({ mode, label, consent }) {
    if (!VALID_MODES.has(mode)) {
      throw new HttpError(400, `mode must be one of ${[...VALID_MODES].join(', ')}`);
    }
    const hasSpeakerConsent = consent && (consent.speakerAcknowledged === true || consent.speaker === true);
    if (!hasSpeakerConsent) {
      throw new HttpError(
        403,
        'A session cannot start until the person being recorded has acknowledged ' +
          'consent (consent.speakerAcknowledged must be true).',
      );
    }
    const id = randomUUID();
    const consentRecord = {
      sessionId: id,
      consentGiven: true,
      timestamp: new Date().toISOString(),
      processingMode: config.gemini.enabled ? 'hybrid' : 'local',
      transcriptionProvider: config.transcription,
      speakerAcknowledged: true,
      secondPartyAcknowledged: consent.secondPartyAcknowledged === true,
    };
    const session = {
      id,
      mode,
      label: label || defaultLabel(mode),
      consent: {
        speakerAcknowledged: true,
        secondPartyAcknowledged: consent.secondPartyAcknowledged === true,
        acknowledgedAt: consentRecord.timestamp,
      },
      consentRecord,
      createdAt: Date.now(),
      endedAt: null,
      analyzer: new SessionAnalyzer({ sessionId: id }),
      pcmForTranscription: [],
      lastCoaching: null,
      clients: new Set(),
      telemetryStatus: { degraded: false, message: null },
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id) {
    const s = this.sessions.get(id);
    if (!s) throw new HttpError(404, 'session not found');
    return s;
  }

  end(id) {
    const s = this.get(id);
    s.endedAt = Date.now();
    if (config.persistTranscripts) this._persist(s);
    return s.analyzer.export();
  }

  destroy(id) {
    const s = this.sessions.get(id);
    if (s) {
      for (const ws of s.clients) {
        try {
          ws.close(1000, 'session deleted');
        } catch {
          /* noop */
        }
      }
      s.clients.clear();
      this.sessions.delete(id);
    }
    return { ok: true, id, deleted: true };
  }

  _persist(session) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const file = path.join(DATA_DIR, `${session.id}.json`);
      fs.writeFileSync(
        file,
        JSON.stringify(
          {
            id: session.id,
            mode: session.mode,
            label: session.label,
            consent: session.consent,
            ...session.analyzer.export(),
          },
          null,
          2,
        ),
      );
    } catch (err) {
      console.error('[session] failed to persist transcript', err);
    }
  }

  _sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      const dead = s.endedAt && now - s.endedAt > 10 * 60_000;
      const expired = now - s.createdAt > SESSION_TTL_MS;
      if (dead || expired) this.sessions.delete(id);
    }
  }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function defaultLabel(mode) {
  return {
    'debate-practice': 'Debate practice',
    'interview-prep': 'Interview prep',
    'speech-coaching': 'Speech coaching',
  }[mode];
}

export const sessions = new SessionStore();
