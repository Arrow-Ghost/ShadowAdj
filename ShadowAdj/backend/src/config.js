import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Load cadence/.env regardless of where node is launched from.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const transcription = (process.env.TRANSCRIPTION || 'auto').toLowerCase();

export const config = {
  port: Number(process.env.PORT) || 8787,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:4321',
  // 'auto' -> server transcription when a key is present; 'browser' -> force Web Speech API
  transcription: transcription === 'browser' ? 'browser' : 'auto',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    // Head of each list is primary; the rest are fallbacks tried on 404/503.
    // Transcription wants a fast lite model; coaching notes want a stronger one.
    transcribeModels: dedupe([
      process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.5-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-3.1-flash-lite',
    ]),
    textModels: dedupe([
      process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      'gemini-flash-latest',
      'gemini-3.5-flash',
    ]),
    get enabled() {
      return this.apiKey.length > 0;
    },
  },
  persistTranscripts: process.env.PERSIST_TRANSCRIPTS === '1',
};

export const serverTranscription = config.transcription === 'auto' && config.gemini.enabled;

function dedupe(arr) {
  return [...new Set(arr.filter(Boolean))];
}

console.log(
  serverTranscription
    ? `[shadowadj] transcription: server-side via ${config.gemini.transcribeModels[0]} (coaching: ${config.gemini.textModels[0]})`
    : '[shadowadj] transcription: browser Web Speech API (no key, or TRANSCRIPTION=browser)',
);
