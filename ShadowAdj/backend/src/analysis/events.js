import { randomUUID } from 'node:crypto';

export const EVENT_TYPES = Object.freeze({
  SPEECH_START: 'SPEECH_START',
  SPEECH_END: 'SPEECH_END',
  PAUSE: 'PAUSE',
  FILLER: 'FILLER',
  RESTART: 'RESTART',
  SELF_CORRECTION: 'SELF_CORRECTION',
  QUESTION_END: 'QUESTION_END',
  RESPONSE_START: 'RESPONSE_START',
  PACE_CHANGE: 'PACE_CHANGE',
  REPETITION: 'REPETITION',
  LONG_SENTENCE: 'LONG_SENTENCE',
  TOPIC_CHANGE: 'TOPIC_CHANGE',
  TOPIC_DRIFT: 'TOPIC_DRIFT',
  LANGUAGE_SWITCH: 'LANGUAGE_SWITCH',
});

/**
 * Creates a normalized SpeechEvent.
 *
 * @param {Object} params
 * @param {string} [params.sessionId]
 * @param {string} [params.eventId]
 * @param {number} params.sequenceNumber
 * @param {number} params.timestamp - Milliseconds from session start
 * @param {number} [params.duration=0] - Milliseconds duration of event
 * @param {number} [params.audioChunkId]
 * @param {number} [params.transcriptRevision]
 * @param {string} params.type - One of EVENT_TYPES
 * @param {Object} [params.metrics={}] - Quantitative snapshot/deltas
 * @param {Object} [params.evidence] - Observable evidence { textExcerpt, tStart, tEnd }
 * @returns {SpeechEvent}
 */
export function createSpeechEvent({
  sessionId = '',
  eventId,
  sequenceNumber = 0,
  timestamp = 0,
  duration = 0,
  audioChunkId,
  transcriptRevision,
  type,
  metrics = {},
  evidence = null,
}) {
  if (!type || !EVENT_TYPES[type]) {
    throw new Error(`Invalid or unknown event type: ${type}`);
  }

  return {
    sessionId,
    eventId: eventId || `evt_${randomUUID().slice(0, 8)}`,
    sequenceNumber,
    timestamp: Math.round(timestamp),
    duration: Math.round(duration),
    audioChunkId: audioChunkId ?? null,
    transcriptRevision: transcriptRevision ?? null,
    type,
    metrics: { ...metrics },
    evidence: evidence
      ? {
          textExcerpt: evidence.textExcerpt ? String(evidence.textExcerpt).trim() : '',
          tStart: Math.round(evidence.tStart ?? timestamp),
          tEnd: Math.round(evidence.tEnd ?? timestamp + duration),
        }
      : null,
  };
}
