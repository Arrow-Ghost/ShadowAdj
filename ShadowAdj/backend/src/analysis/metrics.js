// Pure, side-effect-free helpers for descriptive speech metrics.
// Nothing here scores a person or estimates authorship — these are the same
// kinds of numbers a speech coach jots on a notepad.

// Unambiguous hesitation sounds. Transcribers vary in whether they keep these,
// so the headline filler metric is reported with that caveat in the UI.
const HARD_FILLER = /\b(?:u+h+|u+m+|e+r+m*|hm+|mm+|mhm)\b/gi;

// Discourse markers that are *sometimes* fillers. Counted conservatively and
// reported separately from hard fillers.
const SOFT_FILLER_PHRASES = [
  /\byou know\b/gi,
  /\bi mean\b/gi,
  /\bsort of\b/gi,
  /\bkind of\b/gi,
  /\bi guess\b/gi,
];

// Words that, immediately before "like", make it a real word rather than a filler.
const LIKE_NOT_FILLER_PREV = new Set([
  'would', 'wouldnt', 'could', 'couldnt', 'should', 'shouldnt', 'do', 'dont',
  'does', 'doesnt', 'did', 'didnt', 'to', 'feel', 'feels', 'felt', 'look',
  'looks', 'looked', 'looking', 'seem', 'seems', 'seemed', 'sound', 'sounds',
  'sounded', 'just', 'not', 'really', 'much', 'things', 'something', 'anything',
  'nothing', 'stuff', 'people', 'someone', 'act', 'acts', 'acted', 'acting',
  'more', 'is', 'was', 'be', 'been',
]);

const FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at',
  'for', 'with', 'as', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'am', 'do', 'does', 'did', 'have', 'has', 'had', 'i', 'you', 'he', 'she',
  'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his',
  'its', 'our', 'their', 'this', 'that', 'these', 'those', 'so', 'not', 'no',
  'yes', 'up', 'out', 'about', 'into', 'over', 'than', 'then', 'from', 'will',
  'would', 'can', 'could', 'should', 'may', 'might', 'must', 'shall', 'there',
  'here', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'any',
  'some', 'more', 'most', 'other', 'such', 'only', 'own', 'same', 'just', 'very',
]);

/** Root-mean-square amplitude of a Float32 sample block, range 0..~1. */
export function rms(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Zero-crossing rate: ratio of sign changes in a sample block. High for noise/hiss/breath, low-to-mid for speech. */
export function zeroCrossingRate(samples) {
  if (!samples || samples.length < 2) return 0;
  let count = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) {
      count += 1;
    }
  }
  return count / (samples.length - 1);
}

/** Lowercase word tokens, punctuation stripped (apostrophes/hyphens kept). */
export function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Rough English syllable count for a single word (vowel-group heuristic). */
export function syllables(word) {
  const w = (word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return w.length ? 1 : 0;
  const groups = w
    .replace(/e\b/, '')
    .replace(/[^aeiouy]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return Math.max(1, groups.length);
}

/**
 * Moving-Average Type-Token Ratio: mean TTR over every window of `w` tokens.
 * Unlike a plain TTR it is not biased downward as the transcript grows, so it
 * is a fairer description of lexical variety over a whole session.
 */
export function mattr(tokens, w = 50) {
  if (tokens.length === 0) return null;
  if (tokens.length <= w) return new Set(tokens).size / tokens.length;
  let acc = 0;
  let n = 0;
  for (let i = 0; i + w <= tokens.length; i += 1) {
    acc += new Set(tokens.slice(i, i + w)).size / w;
    n += 1;
  }
  return acc / n;
}

/** Share of content words with 3+ syllables — a "reach for longer words" rate. */
export function longWordRate(tokens) {
  const content = tokens.filter((t) => !FUNCTION_WORDS.has(t));
  if (content.length < 8) return null;
  const long = content.filter((t) => syllables(t) >= 3).length;
  return long / content.length;
}

/**
 * Count hard fillers and (separately, conservatively) soft/discourse fillers.
 * `text` should be a transcript string; token context is used to gate "like".
 */
/**
 * Get a short snippet of surrounding text around a match for evidence.
 */
export function getContextExcerpt(text, index, length, radius = 25) {
  if (!text) return '';
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/**
 * Count hard fillers and (separately, conservatively) soft/discourse fillers.
 * `text` should be a transcript string; token context is used to gate "like".
 */
export function countFillers(text) {
  const src = text || '';
  const hard = (src.match(HARD_FILLER) || []).map((s) => s.toLowerCase());

  const soft = [];
  for (const re of SOFT_FILLER_PHRASES) {
    re.lastIndex = 0;
    const m = src.match(re) || [];
    soft.push(...m.map((s) => s.toLowerCase().replace(/\s+/g, ' ')));
  }

  // Contextual discourse markers:
  // "actually" and "basically" when clause-initial or comma-bounded.
  const contextualPatterns = [
    { re: /(?:^|[.!?])[,\s]*(actually)\b/gi, token: 'actually' },
    { re: /,\s*(actually)\b/gi, token: 'actually' },
    { re: /(?:^|[.!?])[,\s]*(basically)\b/gi, token: 'basically' },
    { re: /,\s*(basically)\b/gi, token: 'basically' },
    { re: /(?:^|[.!?])\s*(so)[,\s]+(?=[a-z])/gi, token: 'so' },
  ];
  for (const { re, token } of contextualPatterns) {
    re.lastIndex = 0;
    let cm;
    while ((cm = re.exec(src)) !== null) {
      soft.push(token);
    }
  }

  // "like" as filler: quotative ("I was like"), comma-bracketed, or clause-initial
  // — but not when the preceding word makes it lexical ("feel like", "things like").
  const toks = tokenize(src);
  const commaLike = (src.match(/,\s*like\b/gi) || []).length;
  let quotativeLike = 0;
  for (let i = 1; i < toks.length; i += 1) {
    if (toks[i] !== 'like') continue;
    const prev = toks[i - 1].replace(/'/g, '');
    if (LIKE_NOT_FILLER_PREV.has(prev)) continue;
    if (/^(?:i|he|she|they|we|you|im|hes|shes|theyre|were|youre|was|is)$/.test(prev)) {
      quotativeLike += 1;
    }
  }
  const likeFiller = Math.min(
    toks.filter((t) => t === 'like').length,
    commaLike + quotativeLike,
  );
  for (let i = 0; i < likeFiller; i += 1) soft.push('like');

  return {
    hard: { count: hard.length, tokens: hard },
    soft: { count: soft.length, tokens: soft },
  };
}

/**
 * Returns distinct occurrences of fillers with their character offsets and excerpts.
 */
export function findFillerInstances(text) {
  const src = text || '';
  const instances = [];

  let match;
  HARD_FILLER.lastIndex = 0;
  while ((match = HARD_FILLER.exec(src)) !== null) {
    instances.push({
      token: match[0].toLowerCase(),
      kind: 'hard',
      index: match.index,
      excerpt: getContextExcerpt(src, match.index, match[0].length),
    });
  }

  for (const re of SOFT_FILLER_PHRASES) {
    re.lastIndex = 0;
    while ((match = re.exec(src)) !== null) {
      instances.push({
        token: match[0].toLowerCase().replace(/\s+/g, ' '),
        kind: 'soft',
        index: match.index,
        excerpt: getContextExcerpt(src, match.index, match[0].length),
      });
    }
  }

  const contextualPatterns = [
    { re: /(?:^|[.!?])[,\s]*(actually)\b/gi, token: 'actually' },
    { re: /,\s*(actually)\b/gi, token: 'actually' },
    { re: /(?:^|[.!?])[,\s]*(basically)\b/gi, token: 'basically' },
    { re: /,\s*(basically)\b/gi, token: 'basically' },
    { re: /(?:^|[.!?])\s*(so)[,\s]+(?=[a-z])/gi, token: 'so' },
  ];
  for (const { re, token } of contextualPatterns) {
    re.lastIndex = 0;
    while ((match = re.exec(src)) !== null) {
      const idx = match.index + match[0].toLowerCase().indexOf(token);
      instances.push({
        token,
        kind: 'soft',
        index: idx,
        excerpt: getContextExcerpt(src, idx, token.length),
      });
    }
  }

  return instances.sort((a, b) => a.index - b.index);
}

/** Detect adjacent repeated words like "the the" or "we we". */
export function detectWordRepetitions(tokens) {
  const reps = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i] && tokens[i] === tokens[i + 1]) {
      reps.push({
        word: tokens[i],
        index: i,
        excerpt: `${tokens[i]} ${tokens[i + 1]}`,
      });
    }
  }
  return reps;
}

/** Detect repeated 2-4 word phrases within a window. */
export function detectPhraseRepetitions(tokens, minLen = 2, maxLen = 4, maxDistance = 30) {
  const reps = [];
  const covered = new Set();

  for (let len = maxLen; len >= minLen; len -= 1) {
    for (let i = 0; i + len <= tokens.length; i += 1) {
      if (covered.has(i)) continue;
      const phraseTokens = tokens.slice(i, i + len);
      const phrase = phraseTokens.join(' ');
      const hasContent = phraseTokens.some((t) => !FUNCTION_WORDS.has(t));
      if (!hasContent && len < 3) continue;

      for (let j = i + len; j + len <= Math.min(tokens.length, i + maxDistance); j += 1) {
        const nextPhrase = tokens.slice(j, j + len).join(' ');
        if (phrase === nextPhrase) {
          reps.push({
            phrase,
            indexA: i,
            indexB: j,
            wordCount: len,
            excerpt: `"${phrase}" repeated`,
          });
          for (let k = 0; k < len; k += 1) {
            covered.add(i + k);
            covered.add(j + k);
          }
          break;
        }
      }
    }
  }
  return reps;
}

/**
 * Detect speech restarts / false starts:
 * e.g. "I think the main... actually, the main reason is..."
 */
export function detectRestarts(text) {
  const src = text || '';
  const restarts = [];
  const seen = new Set();

  // Pattern 1: Retraction marker with preceding phrase and resumed phrase
  const markerRegex = /([a-zA-Z0-9'\s]{4,40}?)(?:\.\.\.|—|-|,)?\s*\b(actually|wait|no wait|let me start over|or rather)\b[,\s]*([a-zA-Z0-9'\s]{4,40})/gi;
  let m;
  while ((m = markerRegex.exec(src)) !== null) {
    const prev = m[1].trim();
    const marker = m[2].trim();
    const next = m[3].trim();
    if (prev.length >= 4 && next.length >= 4) {
      if (!seen.has(m.index)) {
        seen.add(m.index);
        restarts.push({
          type: 'restart-marker',
          abandoned: prev,
          marker,
          resumed: next,
          excerpt: m[0].trim(),
          index: m.index,
        });
      }
    }
  }

  // Pattern 2: Truncated start repeated after dash or ellipsis
  const cutoffRegex = /\b([a-zA-Z0-9']+(?:\s+[a-zA-Z0-9']+){1,3})\s*(?:\.\.\.|—|-)\s*([a-zA-Z0-9'\s]{4,40})/gi;
  while ((m = cutoffRegex.exec(src)) !== null) {
    if (!seen.has(m.index)) {
      seen.add(m.index);
      restarts.push({
        type: 'false-start',
        abandoned: m[1].trim(),
        marker: 'cutoff',
        resumed: m[2].trim(),
        excerpt: m[0].trim(),
        index: m.index,
      });
    }
  }

  return restarts;
}

/**
 * Detect self-corrections:
 * e.g. "Monday... sorry, Tuesday."
 */
export function detectSelfCorrections(text) {
  const src = text || '';
  const corrections = [];
  const regex = /\b([a-zA-Z0-9'-]+)\s*(?:[,\.\-—]+\s*|\s+)(sorry|excuse me|no|or rather)\s*(?:[,\.\-—]+\s*|\s+)([a-zA-Z0-9'-]+)\b/gi;
  let m;
  const invalidNextForNo = new Set(['matter', 'way', 'doubt', 'problem', 'worries', 'one', 'more', 'longer', 'idea', 'fear']);
  const invalidNextForSorry = new Set(['for', 'to', 'about', 'that']);

  while ((m = regex.exec(src)) !== null) {
    const original = m[1].trim().toLowerCase();
    const marker = m[2].trim().toLowerCase();
    const correction = m[3].trim().toLowerCase();

    if (marker === 'sorry' && invalidNextForSorry.has(correction)) continue;
    if (marker === 'no' && invalidNextForNo.has(correction)) continue;
    if (original === 'i' || original === 'we' || original === 'am' || original === 'is' || original === 'said') continue;

    corrections.push({
      original: m[1].trim(),
      marker: m[2].trim(),
      correction: m[3].trim(),
      excerpt: m[0].trim(),
      index: m.index,
    });
  }
  return corrections;
}

/**
 * Detect sentences longer than threshold words.
 */
export function detectLongSentences(text, threshold = 35) {
  const src = text || '';
  const sentences = src
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const longList = [];
  for (const s of sentences) {
    const tokens = tokenize(s);
    if (tokens.length >= threshold) {
      longList.push({
        sentence: s,
        wordCount: tokens.length,
        excerpt: tokens.slice(0, 10).join(' ') + `... (${tokens.length} words)`,
      });
    }
  }
  return longList;
}

/** How much terminal punctuation the transcript carries, per word. */
export function punctuationDensity(text) {
  const words = tokenize(text).length;
  if (words === 0) return 0;
  return ((text || '').match(/[.!?]/g) || []).length / words;
}

/**
 * Mean words per unit. If the transcript is punctuated, units are sentences.
 * Otherwise (common with live speech-to-text) units are the spans between
 * pauses, passed in as `pauseSpansWords`. Returns { value, basis }.
 */
export function meanUnitLength(text, pauseSpansWords) {
  if (punctuationDensity(text) >= 0.02) {
    const sentences = (text || '')
      .split(/[.!?]+/)
      .map((s) => tokenize(s).length)
      .filter((n) => n > 0);
    if (sentences.length === 0) return { value: null, basis: 'punctuation' };
    return {
      value: sentences.reduce((a, b) => a + b, 0) / sentences.length,
      basis: 'punctuation',
    };
  }
  if (Array.isArray(pauseSpansWords) && pauseSpansWords.length >= 2) {
    const spans = pauseSpansWords.filter((n) => n > 0);
    if (spans.length === 0) return { value: null, basis: 'pauses' };
    return { value: spans.reduce((a, b) => a + b, 0) / spans.length, basis: 'pauses' };
  }
  return { value: null, basis: 'pauses' };
}

/** Words per minute normalised by *speaking* time, not wall-clock time. */
export function paceWpm(wordCount, speakingSeconds) {
  if (!speakingSeconds || speakingSeconds <= 0) return null;
  return (wordCount / speakingSeconds) * 60;
}

/** p-th percentile (0..1) of an unsorted numeric array. */
export function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))];
}

/**
 * Streaming voice-activity detector. Feed it one energy sample at a time.
 *
 * The noise floor is the low percentile of a rolling window of recent energy, so
 * it tracks both a quiet room and a hot mic instead of an absolute guess. On/off
 * thresholds differ (hysteresis) and a ~0.55s hangover keeps ordinary gaps
 * between words from chopping a phrase into dozens of "pauses". Finalised
 * speech/silence segments are returned as they close.
 */
export function createVad({
  windowFrames = 160, // rolling window for the floor estimate
  floorPercentile = 0.2,
  onFactor = 2.6,
  offFactor = 1.7,
  onAbs = 0.006,
  offAbs = 0.004,
  onMs = 180, // sustained over-threshold audio needed to open speech
  hangoverMs = 550, // sustained quiet needed to close speech (survives inter-word gaps)
} = {}) {
  const recent = [];
  let floor = 0.006; // seeded low so a hot start still detects speech
  let state = 'silence';
  let segStart = 0;
  let onAccum = 0;
  let offAccum = 0;
  let sawSpeech = false;

  return {
    /** @returns {null | {kind, start, end}} a finalised segment, when one closes */
    push(energy, tStart, tEnd, zcr = 0) {
      const dur = tEnd - tStart;
      recent.push(energy);
      if (recent.length > windowFrames) recent.shift();
      // Track the floor only while not mid-phrase (so speech can't inflate it).
      // It drops instantly to a quieter environment but rises slowly, which also
      // means a session that starts mid-speech isn't locked out.
      if (state === 'silence' || recent.length < 8) {
        const candidate = Math.max(1e-5, percentile(recent, floorPercentile));
        floor = candidate < floor ? candidate : floor * 0.98 + candidate * 0.02;
      }
      const onT = Math.max(floor * onFactor, onAbs);
      const offT = Math.max(floor * offFactor, offAbs);
      let closed = null;

      // Friction / breath noise check: very high zero-crossing rate (> 0.65) without proportional volume
      const isFrictionNoise = zcr > 0.65 && energy < onT * 2.2;

      if (state === 'silence') {
        onAccum = (energy > onT && !isFrictionNoise) ? onAccum + dur : 0;
        if (onAccum >= onMs) {
          const boundary = tEnd - onAccum; // speech actually began onMs ago
          if (boundary > segStart) closed = { kind: 'silence', start: segStart, end: boundary };
          state = 'speech';
          segStart = boundary;
          onAccum = 0;
          sawSpeech = true;
        }
      } else {
        offAccum = energy < offT ? offAccum + dur : 0;
        if (offAccum >= hangoverMs) {
          const end = tEnd - offAccum; // trim the trailing quiet used to confirm
          closed = { kind: 'speech', start: segStart, end: Math.max(end, segStart + dur) };
          state = 'silence';
          segStart = end;
          offAccum = 0;
        }
      }
      return closed;
    },
    get state() {
      return state;
    },
    get openSince() {
      return segStart;
    },
    get sawSpeech() {
      return sawSpeech;
    },
    get noiseFloor() {
      return floor;
    },
  };
}

/** Fraction of [aStart,aEnd] that lies inside [bStart,bEnd], 0..1. */
export function overlapFraction(aStart, aEnd, bStart, bEnd) {
  const span = aEnd - aStart;
  if (span <= 0) return 0;
  const lo = Math.max(aStart, bStart);
  const hi = Math.min(aEnd, bEnd);
  return hi > lo ? (hi - lo) / span : 0;
}

/**
 * Detect script or language switches in transcript (useful for multilingual/debate drills).
 */
export function detectLanguageSwitches(text) {
  const matches = [];
  const nonLatin = /([\p{Script=Devanagari}\p{Script=Han}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Hiragana}\p{Script=Katakana}]+)/gu;
  let m;
  while ((m = nonLatin.exec(text)) !== null) {
    matches.push({
      token: m[0],
      index: m.index,
      excerpt: getContextExcerpt(text, m.index, m[0].length),
    });
  }
  return matches;
}

/**
 * Detects topic drift when answer exceeds threshold and digresses significantly
 * from marked question / prompt keywords.
 */
export function detectTopicDrift(transcriptTokens, promptTokens, minWords = 80) {
  if (!promptTokens || promptTokens.length === 0 || transcriptTokens.length < minWords) {
    return null;
  }
  const promptKeywords = new Set(promptTokens.filter((t) => !FUNCTION_WORDS.has(t) && t.length > 2));
  if (promptKeywords.size === 0) return null;

  // Recent 40 content words
  const recentContent = transcriptTokens.slice(-40).filter((t) => !FUNCTION_WORDS.has(t));
  if (recentContent.length < 15) return null;

  const overlap = recentContent.filter((t) => promptKeywords.has(t)).length;
  const overlapRatio = overlap / promptKeywords.size;

  if (overlapRatio === 0) {
    return {
      recentExcerpt: recentContent.slice(-10).join(' '),
      promptKeywords: [...promptKeywords].slice(0, 5),
    };
  }
  return null;
}
