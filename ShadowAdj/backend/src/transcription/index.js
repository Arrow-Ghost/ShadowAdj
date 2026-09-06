import { transcribeChunk, geminiEnabled } from '../gemini.js';
import { config, serverTranscription } from '../config.js';

/**
 * Normalized transcript item structure across all providers.
 */
export function createNormalizedTranscript({
  text = '',
  timestamp = 0,
  duration = 0,
  isFinal = false,
  confidence = null,
  provider = 'unknown',
  revision = 1,
}) {
  return {
    text: String(text).trim(),
    timestamp: Math.round(timestamp),
    duration: Math.round(duration),
    isFinal: Boolean(isFinal),
    confidence: confidence != null ? Number(confidence) : null,
    provider,
    revision: Number(revision) || 1,
  };
}

/**
 * Base Transcriber interface.
 */
export class BaseTranscriber {
  constructor(name) {
    this.name = name;
  }

  async transcribeChunk(_pcm16, _sampleRate) {
    throw new Error('transcribeChunk not implemented');
  }
}

/**
 * Gemini server-side transcriber provider.
 */
export class GeminiTranscriber extends BaseTranscriber {
  constructor() {
    super('gemini');
  }

  isAvailable() {
    return geminiEnabled();
  }

  async transcribeChunk(pcm16, sampleRate = 16_000) {
    if (!this.isAvailable()) {
      throw new Error('Gemini transcription requested but GEMINI_API_KEY is not configured');
    }
    const text = await transcribeChunk(pcm16, sampleRate);
    return text;
  }
}

/**
 * Browser Speech API adapter provider (metadata wrapper).
 */
export class BrowserTranscriber extends BaseTranscriber {
  constructor() {
    super('browser');
  }

  isAvailable() {
    return true;
  }

  async transcribeChunk() {
    throw new Error('Browser transcription is client-driven via Web Speech API');
  }
}

/**
 * Registry of available transcription providers.
 */
export const providers = {
  gemini: new GeminiTranscriber(),
  browser: new BrowserTranscriber(),
};

/**
 * Resolves active transcription mode based on configuration and availability.
 * Mode can be 'auto', 'server', or 'browser'.
 */
export function resolveTranscriptionProvider(requestedMode) {
  const mode = (requestedMode || config.transcription || 'auto').toLowerCase();

  if (mode === 'server') {
    return providers.gemini.isAvailable() ? 'gemini' : 'browser';
  }

  if (mode === 'browser') {
    return 'browser';
  }

  // 'auto'
  return providers.gemini.isAvailable() ? 'gemini' : 'browser';
}
