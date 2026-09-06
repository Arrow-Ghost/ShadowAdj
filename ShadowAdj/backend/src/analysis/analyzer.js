import {
  rms,
  tokenize,
  mattr,
  longWordRate,
  countFillers,
  meanUnitLength,
  paceWpm,
  createVad,
  overlapFraction,
  findFillerInstances,
  detectWordRepetitions,
  detectPhraseRepetitions,
  detectRestarts,
  detectSelfCorrections,
  detectLongSentences,
  zeroCrossingRate,
  detectLanguageSwitches,
  detectTopicDrift,
} from './metrics.js';
import { createSpeechEvent, EVENT_TYPES } from './events.js';

const VIZ_FRAME_MS = 200; // energy-timeline resolution for the sphere/scrubber
const PACE_WINDOW_MS = 30_000;
const SHORT_PACE_WINDOW_MS = 15_000;
const PAUSE_MS = 700; // silence longer than this, mid-answer, is a "pause"
const LONG_PAUSE_MS = 2500;
const PACE_EMA = 0.3;
const MIN_SPEECH_MS = 200; // shorter "speech" segments are treated as noise blips
const PAUSE_MERGE_MS = 500; // pauses closer than this collapse into one

// Minimum evidence before a number is shown at all. Below this the snapshot
// reports null and the UI shows "—" rather than a noisy guess.
const MIN_PACE_WORDS = 6;
const MIN_PACE_SPEAKING_S = 4;
const MIN_FILLER_SPEAKING_S = 8;

/**
 * SessionAnalyzer consumes an audio-energy stream and a transcript stream and
 * emits *descriptive* snapshots and normalized timeline events.
 *
 * Timing is derived from the amount of audio ingested (sample count), so the
 * timeline stays aligned to the audio and the analyzer is deterministic under
 * test. Voice activity is detected by a streaming VAD (adaptive floor +
 * hysteresis + hangover) rather than re-segmenting the whole session each tick.
 *
 * There is deliberately no verdict, no per-person score, and no authorship
 * estimate anywhere in this class.
 */
export class SessionAnalyzer {
  constructor({ sampleRate = 16_000, sessionId = '' } = {}) {
    this.sampleRate = sampleRate;
    this.sessionId = sessionId;
    this.audioMs = 0;

    this._vad = createVad();
    this._speech = []; // finalised speech segments {start,end}, trimmed to last ~90s
    this._speakingMsTotal = 0;
    this._pauseBoundaries = []; // audioMs of each pause >= PAUSE_MS, for clause segmentation

    this._vizFrames = []; // {t, energy} at VIZ_FRAME_MS resolution
    this._vizAccum = { t: 0, peak: 0 };

    this.transcript = []; // {t0, t1, text, isFinal}
    this._wordEvents = []; // {tStart, tEnd, count} — words attributed across the span they were spoken
    this._lastFinalT = 0;
    this._committedWords = 0;

    this.questionMarks = [];
    this.timeline = [];
    this._eventSeq = 1;
    this._lastPaceKind = null;
    this._lastPaceChangeWpm = null;
    this._paceEma = null;
    this._transcriptSource = 'none';

    // Trackers to prevent duplicate event emissions
    this._seenFillerIndices = new Set();
    this._seenRestartIndices = new Set();
    this._seenCorrectionIndices = new Set();
    this._seenRepetitionKeys = new Set();
    this._seenLongSentences = new Set();
    this._respondedQuestions = new Set();
  }

  now() {
    return this.audioMs;
  }

  setTranscriptSource(src) {
    this._transcriptSource = src;
  }

  /** samples: Float32Array mono. `at` (tests only) overrides derived timing. */
  pushAudio({ samples, at }) {
    const testMode = at != null;
    const durMs = testMode ? VIZ_FRAME_MS : (samples.length / this.sampleRate) * 1000;
    const t0 = testMode ? at : this.audioMs;
    const t1 = t0 + durMs;
    this.audioMs = testMode ? Math.max(this.audioMs, t1) : this.audioMs + durMs;

    const energy = rms(samples);
    const zcr = zeroCrossingRate(samples);

    // Streaming VAD with zero-crossing rate noise gating.
    const closed = this._vad.push(energy, t0, t1, zcr);
    if (closed) this._onSegmentClosed(closed);

    // Viz frame accumulation.
    this._vizAccum.peak = Math.max(this._vizAccum.peak, energy);
    if (t1 - this._vizAccum.t >= VIZ_FRAME_MS) {
      this._vizFrames.push({ t: this._vizAccum.t, energy: this._vizAccum.peak });
      if (this._vizFrames.length > 900) this._vizFrames.shift();
      this._vizAccum = { t: t1, peak: 0 };
    }
  }

  _emitEvent(type, { timestamp, duration = 0, metrics = {}, evidence = null, audioChunkId = null } = {}) {
    const ev = createSpeechEvent({
      sessionId: this.sessionId,
      sequenceNumber: this._eventSeq++,
      timestamp: timestamp ?? this.now(),
      duration,
      audioChunkId,
      transcriptRevision: this.transcript.length,
      type,
      metrics,
      evidence,
    });
    // Backward compatibility aliases for existing UI and tests
    ev.t = ev.timestamp;
    ev.kind = ev.type.toLowerCase().replace(/_/g, '-');
    ev.meta = { ...ev.metrics };
    this.timeline.push(ev);
    return ev;
  }

  _timeAtCharIndex(charIndex, allText) {
    let accum = 0;
    for (const seg of this.transcript) {
      const len = seg.text.length + 1;
      if (charIndex >= accum && charIndex < accum + len) {
        const frac = (charIndex - accum) / Math.max(1, seg.text.length);
        return Math.round(seg.t0 + frac * (seg.t1 - seg.t0));
      }
      accum += len;
    }
    return this.now();
  }

  _onSegmentClosed(seg) {
    if (seg.kind === 'speech') {
      // Drop sub-200ms blips so they don't split silence into two pauses around them.
      if (seg.end - seg.start < MIN_SPEECH_MS) return;
      this._speakingMsTotal += seg.end - seg.start;
      this._speech.push(seg);
      const cutoff = this.audioMs - (PACE_WINDOW_MS + 60_000);
      while (this._speech.length && this._speech[0].end < cutoff) this._speech.shift();

      // Check if this is the start of an answer to an outstanding question
      const lastQ = this.questionMarks[this.questionMarks.length - 1];
      if (lastQ && !this._respondedQuestions.has(lastQ.t) && seg.start >= lastQ.t) {
        this._respondedQuestions.add(lastQ.t);
        const latencyMs = Math.round(seg.start - lastQ.t);
        this._emitEvent(EVENT_TYPES.RESPONSE_START, {
          timestamp: seg.start,
          duration: seg.end - seg.start,
          metrics: { latencyMs, questionLabel: lastQ.label },
          evidence: {
            textExcerpt: `Speech began ${latencyMs}ms after question`,
            tStart: lastQ.t,
            tEnd: seg.start,
          },
        });
      }
    } else {
      const dur = seg.end - seg.start;
      const lastPause = this._pauseBoundaries[this._pauseBoundaries.length - 1];
      const tooClose = lastPause != null && seg.start - lastPause < PAUSE_MERGE_MS;
      if (dur >= PAUSE_MS && this._speech.length > 0 && !tooClose) {
        this._pauseBoundaries.push(seg.start);
        const isLong = dur >= LONG_PAUSE_MS;
        const ev = this._emitEvent(EVENT_TYPES.PAUSE, {
          timestamp: seg.start,
          duration: Math.round(dur),
          metrics: { durationMs: Math.round(dur), isLong },
          evidence: {
            textExcerpt: `${isLong ? 'Long pause' : 'Pause'} of ${(dur / 1000).toFixed(1)}s`,
            tStart: seg.start,
            tEnd: seg.end,
          },
        });
        ev.kind = isLong ? 'long-pause' : 'pause';
      }
    }
  }

  pushTranscript({ text, isFinal = false, t0, t1 }) {
    if (!text || !text.trim()) return;
    const now = this.now();
    const last = this.transcript[this.transcript.length - 1];
    if (last && !last.isFinal) {
      this.transcript[this.transcript.length - 1] = {
        t0: last.t0,
        t1: t1 ?? now,
        text,
        isFinal,
      };
    } else {
      this.transcript.push({ t0: t0 ?? now, t1: t1 ?? now, text, isFinal });
    }

    if (isFinal) {
      const totalFinalWords = this.transcript
        .filter((s) => s.isFinal)
        .reduce((n, s) => n + tokenize(s.text).length, 0);
      const newWords = Math.max(0, totalFinalWords - this._committedWords);
      this._committedWords = totalFinalWords;
      if (newWords > 0) {
        const raw = now - this._lastFinalT;
        const span = Math.min(Math.max(raw, newWords * 180), newWords * 600);
        this._wordEvents.push({ tStart: now - span, tEnd: now, count: newWords });
        const cutoff = now - (PACE_WINDOW_MS + 60_000);
        while (this._wordEvents.length && this._wordEvents[0].tEnd < cutoff) {
          this._wordEvents.shift();
        }
      }
      this._lastFinalT = now;
    }

    // Run telemetry pattern detection across accumulated transcript
    const allText = this._fullText();
    const allTokens = tokenize(allText);

    // 1. Fillers
    const fillerOccurrences = new Map();
    const fillerInstances = findFillerInstances(allText);
    for (const fi of fillerInstances) {
      const tok = fi.token.toLowerCase();
      const occ = fillerOccurrences.get(tok) || 0;
      fillerOccurrences.set(tok, occ + 1);
      const stableKey = `fi_${tok}_${occ}`;

      if (this._seenFillerIndices.has(stableKey) || this._seenFillerIndices.has(fi.index)) continue;
      this._seenFillerIndices.add(stableKey);
      this._seenFillerIndices.add(fi.index);
      const tEv = this._timeAtCharIndex(fi.index, allText);
      this._emitEvent(EVENT_TYPES.FILLER, {
        timestamp: tEv,
        duration: Math.round(fi.token.length * 70),
        metrics: { token: fi.token, kind: fi.kind },
        evidence: {
          textExcerpt: fi.excerpt,
          tStart: tEv,
          tEnd: tEv + Math.round(fi.token.length * 70),
        },
      });
    }

    // 2. Restarts
    const restartOccurrences = new Map();
    const restarts = detectRestarts(allText);
    for (const r of restarts) {
      const mark = (r.marker || 'restart').toLowerCase();
      const occ = restartOccurrences.get(mark) || 0;
      restartOccurrences.set(mark, occ + 1);
      const stableKey = `re_${mark}_${occ}`;

      if (this._seenRestartIndices.has(stableKey) || this._seenRestartIndices.has(r.index)) continue;
      this._seenRestartIndices.add(stableKey);
      this._seenRestartIndices.add(r.index);
      const tEv = this._timeAtCharIndex(r.index, allText);
      this._emitEvent(EVENT_TYPES.RESTART, {
        timestamp: tEv,
        duration: 1200,
        metrics: { marker: r.marker, abandoned: r.abandoned, resumed: r.resumed },
        evidence: {
          textExcerpt: r.excerpt,
          tStart: Math.max(0, tEv - 1000),
          tEnd: tEv + 1500,
        },
      });
    }

    // 3. Self-Corrections
    const correctionOccurrences = new Map();
    const corrections = detectSelfCorrections(allText);
    for (const c of corrections) {
      const mark = (c.marker || 'correction').toLowerCase();
      const occ = correctionOccurrences.get(mark) || 0;
      correctionOccurrences.set(mark, occ + 1);
      const stableKey = `sc_${mark}_${occ}`;

      if (this._seenCorrectionIndices.has(stableKey) || this._seenCorrectionIndices.has(c.index)) continue;
      this._seenCorrectionIndices.add(stableKey);
      this._seenCorrectionIndices.add(c.index);
      const tEv = this._timeAtCharIndex(c.index, allText);
      this._emitEvent(EVENT_TYPES.SELF_CORRECTION, {
        timestamp: tEv,
        duration: 800,
        metrics: { original: c.original, marker: c.marker, correction: c.correction },
        evidence: {
          textExcerpt: c.excerpt,
          tStart: Math.max(0, tEv - 500),
          tEnd: tEv + 1000,
        },
      });
    }

    // 4. Repetitions
    const wordRepOccurrences = new Map();
    const wordReps = detectWordRepetitions(allTokens);
    for (const wr of wordReps) {
      const w = wr.word.toLowerCase();
      const occ = wordRepOccurrences.get(w) || 0;
      wordRepOccurrences.set(w, occ + 1);
      const stableKey = `wr_${w}_${occ}`;

      if (this._seenRepetitionKeys.has(stableKey) || this._seenRepetitionKeys.has(`w_${wr.word}_${wr.index}`)) continue;
      this._seenRepetitionKeys.add(stableKey);
      this._seenRepetitionKeys.add(`w_${wr.word}_${wr.index}`);
      const tEv = this.now();
      this._emitEvent(EVENT_TYPES.REPETITION, {
        timestamp: tEv,
        duration: 500,
        metrics: { phrase: wr.word, wordCount: 1, type: 'word-repeat' },
        evidence: {
          textExcerpt: wr.excerpt,
          tStart: Math.max(0, tEv - 1000),
          tEnd: tEv,
        },
      });
    }

    const phraseRepOccurrences = new Map();
    const phraseReps = detectPhraseRepetitions(allTokens);
    for (const pr of phraseReps) {
      const p = pr.phrase.toLowerCase();
      const occ = phraseRepOccurrences.get(p) || 0;
      phraseRepOccurrences.set(p, occ + 1);
      const stableKey = `pr_${p}_${occ}`;

      if (this._seenRepetitionKeys.has(stableKey) || this._seenRepetitionKeys.has(`p_${pr.phrase}_${pr.indexA}_${pr.indexB}`)) continue;
      this._seenRepetitionKeys.add(stableKey);
      this._seenRepetitionKeys.add(`p_${pr.phrase}_${pr.indexA}_${pr.indexB}`);
      const tEv = this.now();
      this._emitEvent(EVENT_TYPES.REPETITION, {
        timestamp: tEv,
        duration: 1000,
        metrics: { phrase: pr.phrase, wordCount: pr.wordCount, type: 'phrase-repeat' },
        evidence: {
          textExcerpt: pr.excerpt,
          tStart: Math.max(0, tEv - 2000),
          tEnd: tEv,
        },
      });
    }

    // 5. Long Sentences
    const longSens = detectLongSentences(allText, 35);
    for (const ls of longSens) {
      const cleanNorm = ls.sentence.toLowerCase().trim().slice(0, 50);
      if (this._seenLongSentences.has(cleanNorm) || this._seenLongSentences.has(ls.sentence)) continue;
      this._seenLongSentences.add(cleanNorm);
      this._seenLongSentences.add(ls.sentence);
      const tEv = this.now();
      this._emitEvent(EVENT_TYPES.LONG_SENTENCE, {
        timestamp: tEv,
        duration: 2000,
        metrics: { wordCount: ls.wordCount },
        evidence: {
          textExcerpt: ls.excerpt,
          tStart: Math.max(0, tEv - 4000),
          tEnd: tEv,
        },
      });
    }

    // 6. Language Switch detection
    const langSwitches = detectLanguageSwitches(allText);
    for (const ls of langSwitches) {
      const tEv = this._timeAtCharIndex(ls.index, allText);
      const stableKey = `lang_${ls.token}_${Math.round(tEv / 1000)}`;
      if (this._seenLanguageSwitches?.has(stableKey)) continue;
      this._seenLanguageSwitches = this._seenLanguageSwitches || new Set();
      this._seenLanguageSwitches.add(stableKey);
      this._emitEvent(EVENT_TYPES.LANGUAGE_SWITCH, {
        timestamp: tEv,
        duration: 800,
        metrics: { token: ls.token },
        evidence: {
          textExcerpt: ls.excerpt,
          tStart: Math.max(0, tEv - 500),
          tEnd: tEv + 800,
        },
      });
    }

    // 7. Topic Drift detection
    const lastQuestion = this.questionMarks[this.questionMarks.length - 1];
    if (lastQuestion && !this._driftEmitted) {
      const qTokens = tokenize(lastQuestion.label);
      const drift = detectTopicDrift(allTokens, qTokens, 80);
      if (drift) {
        this._driftEmitted = true;
        const tEv = this.now();
        this._emitEvent(EVENT_TYPES.TOPIC_DRIFT, {
          timestamp: tEv,
          duration: 2000,
          metrics: { promptKeywords: drift.promptKeywords },
          evidence: {
            textExcerpt: `Discussion drifted away from prompt keywords (${drift.promptKeywords.join(', ')})`,
            tStart: Math.max(0, tEv - 5000),
            tEnd: tEv,
          },
        });
      }
    }
  }

  markQuestion({ label = 'Question', at = this.now() } = {}) {
    this.questionMarks.push({ t: at, label });
    const ev = this._emitEvent(EVENT_TYPES.QUESTION_END, {
      timestamp: at,
      duration: 0,
      metrics: { label },
      evidence: { textExcerpt: `Question marked: ${label}`, tStart: at, tEnd: at },
    });
    ev.kind = 'question';
  }

  // --- derived quantities -------------------------------------------------

  _speakingSecondsInWindow(fromMs, toMs) {
    let ms = 0;
    for (const s of this._speech) {
      const a = Math.max(s.start, fromMs);
      const b = Math.min(s.end, toMs);
      if (b > a) ms += b - a;
    }
    if (this._vad.state === 'speech') {
      const a = Math.max(this._vad.openSince, fromMs);
      const b = Math.min(this.audioMs, toMs);
      if (b > a) ms += b - a;
    }
    return ms / 1000;
  }

  _speakingSecondsTotal() {
    let ms = this._speakingMsTotal;
    if (this._vad.state === 'speech') ms += this.audioMs - this._vad.openSince;
    return ms / 1000;
  }

  _windowedWordCount(fromMs, toMs) {
    let n = 0;
    for (const e of this._wordEvents) {
      n += e.count * overlapFraction(e.tStart, e.tEnd, fromMs, toMs);
    }
    return n;
  }

  _fullText() {
    return this.transcript.map((s) => s.text).join(' ').trim();
  }

  /** Word counts for the spans between detected pauses — clause-length basis. */
  _pauseSpanWordCounts() {
    if (this._pauseBoundaries.length < 2) return [];
    const bounds = [0, ...this._pauseBoundaries, this.audioMs];
    const totalWords = tokenize(this._fullText()).length;
    const totalDur = this.audioMs || 1;
    return bounds.slice(1).map((b, i) => {
      const dur = b - bounds[i];
      return (totalWords * dur) / totalDur;
    });
  }

  _answerLatency() {
    const q = this.questionMarks[this.questionMarks.length - 1];
    if (!q) return null;
    const openAtMark =
      this._vad.state === 'speech' && this._vad.openSince <= q.t;
    const priorSpeech = this._speech.some((s) => s.start <= q.t && s.end >= q.t);
    if (openAtMark || priorSpeech) return { pending: false, alreadySpeaking: true };

    const onset = [...this._speech, this._vad.state === 'speech' ? { start: this._vad.openSince, end: this.audioMs } : null]
      .filter(Boolean)
      .filter((s) => s.start >= q.t && s.end - s.start >= 300)
      .sort((a, b) => a.start - b.start)[0];
    if (!onset) return { pending: true, sinceMs: this.now() - q.t };
    return { pending: false, latencyMs: Math.round(onset.start - q.t) };
  }

  energyTimeline(maxPoints = 220) {
    const slice = this._vizFrames.slice(-maxPoints);
    const peak = Math.max(0.02, ...slice.map((f) => f.energy));
    return slice.map((f) => ({ t: f.t, v: Math.min(1, f.energy / peak) }));
  }

  // --- snapshot ---------------------------------------------------------

  snapshot() {
    const elapsed = this.now();
    const from = Math.max(0, elapsed - PACE_WINDOW_MS);
    const shortFrom = Math.max(0, elapsed - SHORT_PACE_WINDOW_MS);

    const allText = this._fullText();
    const allTokens = tokenize(allText);

    const speakS = this._speakingSecondsInWindow(from, elapsed);
    const shortSpeakS = this._speakingSecondsInWindow(shortFrom, elapsed);
    const speakTotalS = this._speakingSecondsTotal();
    const windowWords = this._windowedWordCount(from, elapsed);
    const shortWords = this._windowedWordCount(shortFrom, elapsed);

    let rollingWpm = null;
    if (windowWords >= MIN_PACE_WORDS && speakS >= MIN_PACE_SPEAKING_S) {
      const raw = paceWpm(windowWords, speakS);
      this._paceEma = this._paceEma == null ? raw : PACE_EMA * raw + (1 - PACE_EMA) * this._paceEma;
      rollingWpm = Math.round(this._paceEma);
    }

    let currentWpm = null;
    if (shortWords >= 3 && shortSpeakS >= 2) {
      currentWpm = Math.round(paceWpm(shortWords, shortSpeakS));
    } else {
      currentWpm = rollingWpm;
    }

    const sessionAverageWpm =
      allTokens.length >= MIN_PACE_WORDS && speakTotalS >= MIN_PACE_SPEAKING_S
        ? Math.round(paceWpm(allTokens.length, speakTotalS))
        : null;

    const changeWpm =
      currentWpm != null && sessionAverageWpm != null ? currentWpm - sessionAverageWpm : null;

    const wpm = rollingWpm;
    const paceDescriptor = wpm == null ? null : wpm > 185 ? 'fast' : wpm < 115 ? 'measured' : 'steady';
    if (paceDescriptor && paceDescriptor !== this._lastPaceKind && paceDescriptor !== 'steady') {
      const ev = this._emitEvent(EVENT_TYPES.PACE_CHANGE, {
        timestamp: elapsed,
        duration: 1000,
        metrics: { wpm, currentWpm, sessionAverageWpm, changeWpm, descriptor: paceDescriptor },
        evidence: {
          textExcerpt: `Pace shifted to ${wpm} WPM (${paceDescriptor})`,
          tStart: Math.max(0, elapsed - 3000),
          tEnd: elapsed,
        },
      });
      ev.kind = `pace-${paceDescriptor}`;
    }
    if (paceDescriptor) this._lastPaceKind = paceDescriptor;

    // Trigger explicit PACE_CHANGE event if difference is substantial (>= 20 WPM)
    if (
      currentWpm != null &&
      sessionAverageWpm != null &&
      Math.abs(changeWpm) >= 20 &&
      (this._lastPaceChangeWpm == null || Math.abs(currentWpm - this._lastPaceChangeWpm) >= 20)
    ) {
      this._lastPaceChangeWpm = currentWpm;
      this._emitEvent(EVENT_TYPES.PACE_CHANGE, {
        timestamp: elapsed,
        duration: 1000,
        metrics: { currentWpm, sessionAverageWpm, changeWpm, descriptor: paceDescriptor },
        evidence: {
          textExcerpt: `Current pace: ${currentWpm} WPM · Session average: ${sessionAverageWpm} WPM · Change: ${changeWpm > 0 ? '+' : ''}${changeWpm} WPM`,
          tStart: Math.max(0, elapsed - 3000),
          tEnd: elapsed,
        },
      });
    }

    const fillers = countFillers(allText);
    const unit = meanUnitLength(allText, this._pauseSpanWordCounts());

    const pauses = this.timeline.filter((e) => e.type === EVENT_TYPES.PAUSE || e.kind === 'pause' || e.kind === 'long-pause');
    const pauseDur = pauses.map((e) => e.duration || e.metrics?.durationMs || e.meta?.durationMs || 0).filter(Boolean);

    const enoughForFillers = speakTotalS >= MIN_FILLER_SPEAKING_S;

    const restartCount = this.timeline.filter((e) => e.type === EVENT_TYPES.RESTART).length;
    const correctionCount = this.timeline.filter((e) => e.type === EVENT_TYPES.SELF_CORRECTION).length;
    const repetitionCount = this.timeline.filter((e) => e.type === EVENT_TYPES.REPETITION).length;
    const longSentenceCount = this.timeline.filter((e) => e.type === EVENT_TYPES.LONG_SENTENCE).length;

    return {
      elapsedMs: elapsed,
      transcript: {
        text: allText,
        wordCount: allTokens.length,
        source: this._transcriptSource,
      },
      pace: {
        wpm,
        currentWpm,
        rollingWpm,
        sessionAverageWpm,
        changeWpm,
        descriptor: paceDescriptor,
        window: 'last 30s of speaking time',
        ready: wpm != null,
      },
      pauses: {
        count: pauses.length,
        meanMs: pauseDur.length ? Math.round(pauseDur.reduce((a, b) => a + b, 0) / pauseDur.length) : null,
        longestMs: pauseDur.length ? Math.max(...pauseDur) : null,
        totalSilenceMs: Math.max(0, Math.round(elapsed - speakTotalS * 1000)),
      },
      fillers: {
        ready: enoughForFillers,
        hardPerMin: enoughForFillers ? rate(fillers.hard.count, speakTotalS) : null,
        softPerMin: enoughForFillers ? rate(fillers.soft.count, speakTotalS) : null,
        hardExamples: [...new Set(fillers.hard.tokens)].slice(0, 6),
        softExamples: [...new Set(fillers.soft.tokens)].slice(0, 6),
        note: 'Some transcribers drop “um/uh”; treat hard-filler counts as a floor.',
      },
      vocabulary: {
        variety: round(mattr(allTokens, 50)),
        varietyBasis: 'MATTR-50',
        longWordRate: round(longWordRate(allTokens)),
        distinctWords: new Set(allTokens).size,
        meanUnitLength: round(unit.value, 1),
        meanUnitBasis: unit.basis,
      },
      restarts: {
        count: restartCount,
      },
      selfCorrections: {
        count: correctionCount,
      },
      repetitions: {
        count: repetitionCount,
      },
      sentences: {
        longCount: longSentenceCount,
        meanUnitLength: round(unit.value, 1),
      },
      delivery: {
        talkRatio: elapsed > 0 ? round(Math.min(1, speakTotalS / (elapsed / 1000))) : 0,
        speakingSecondsTotal: Math.round(speakTotalS),
        silenceSecondsTotal: Math.max(0, Math.round(elapsed / 1000 - speakTotalS)),
      },
      answerLatency: this._answerLatency(),
      timeline: this.timeline.slice(-100),
    };
  }

  export() {
    return {
      durationMs: this.now(),
      sessionId: this.sessionId,
      transcriptSource: this._transcriptSource,
      transcript: this.transcript,
      questionMarks: this.questionMarks,
      timeline: this.timeline,
      finalSnapshot: this.snapshot(),
    };
  }
}

function round(x, places = 2) {
  if (x == null || Number.isNaN(x)) return null;
  const f = 10 ** places;
  return Math.round(x * f) / f;
}
function rate(count, seconds) {
  if (!seconds || seconds <= 0) return 0;
  return Math.round((count / seconds) * 60 * 10) / 10;
}

