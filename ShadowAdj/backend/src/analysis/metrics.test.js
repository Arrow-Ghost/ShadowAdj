import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rms,
  tokenize,
  syllables,
  mattr,
  longWordRate,
  countFillers,
  punctuationDensity,
  meanUnitLength,
  paceWpm,
  createVad,
  overlapFraction,
  percentile,
  zeroCrossingRate,
  detectLanguageSwitches,
  detectTopicDrift,
} from './metrics.js';
import { SessionAnalyzer } from './analyzer.js';

/* ------------------------------- helpers ------------------------------- */
function feed(a, { energy, ms, at }) {
  // push VIZ_FRAME_MS (200ms) chunks of constant energy
  for (let t = 0; t < ms; t += 200) a.pushAudio({ samples: new Float32Array(64).fill(energy), at: at + t });
}

/* ------------------------------- units ------------------------------- */
test('rms: silence 0, full-scale ~1', () => {
  assert.equal(rms(new Float32Array(64)), 0);
  assert.ok(Math.abs(rms(new Float32Array(64).fill(1)) - 1) < 1e-6);
});

test('tokenize keeps apostrophes, drops punctuation', () => {
  assert.deepEqual(tokenize("Hello, World! It's fine."), ['hello', 'world', "it's", 'fine']);
});

test('syllables: rough vowel-group count', () => {
  assert.equal(syllables('cat'), 1);
  assert.equal(syllables('policy'), 3);
  assert.ok(syllables('international') >= 4);
});

test('mattr is stable as text grows (not biased down)', () => {
  const short = 'the quick brown fox jumps over the lazy dog again today'.split(' ');
  const long = [...short, ...short, ...short];
  const a = mattr(short, 8);
  const b = mattr(long, 8);
  assert.ok(Math.abs(a - b) < 0.15, `mattr drifted: ${a} vs ${b}`);
});

test('longWordRate needs enough content words, else null', () => {
  assert.equal(longWordRate(tokenize('a the of to')), null);
  const r = longWordRate(tokenize('international development policy requires sustainable institutional cooperation between governments'));
  assert.ok(r > 0.3);
});

test('countFillers: hard vs soft, and "like" is context-gated', () => {
  const f = countFillers("So um, I was like, you know, uh I feel like we should, like, reconsider");
  assert.ok(f.hard.count >= 2, `hard: ${JSON.stringify(f.hard)}`);
  assert.ok(f.hard.tokens.includes('um'));
  // "I was like" (quotative) + ", like," (comma) count; "I feel like" does not.
  assert.ok(f.soft.tokens.filter((t) => t === 'like').length >= 1);
  assert.ok(f.soft.tokens.filter((t) => t === 'like').length <= 2);
  assert.ok(f.soft.tokens.includes('you know'));
});

test('countFillers does not flag lexical "like"/"actually"', () => {
  const f = countFillers('I would like to note that things like this actually matter to people');
  assert.equal(f.soft.tokens.filter((t) => t === 'like').length, 0);
});

test('punctuationDensity / meanUnitLength basis switch', () => {
  assert.ok(punctuationDensity('One two three. Four five.') > 0.02);
  assert.equal(meanUnitLength('One two three. Four five.').basis, 'punctuation');
  assert.equal(meanUnitLength('one two three four five six seven eight', [3, 5, 4]).basis, 'pauses');
});

test('paceWpm normalises by speaking seconds', () => {
  assert.equal(paceWpm(150, 60), 150);
  assert.equal(paceWpm(10, 0), null);
});

test('overlapFraction', () => {
  assert.equal(overlapFraction(0, 10, 5, 15), 0.5);
  assert.equal(overlapFraction(0, 10, 20, 30), 0);
});

/* --------------------------- streaming VAD --------------------------- */
test('percentile', () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 0.2), 2);
  assert.equal(percentile([], 0.5), 0);
});

test('createVad opens on sustained energy and closes after the hangover', () => {
  const vad = createVad();
  const segs = [];
  let t = 0;
  const step = (e, n) => {
    for (let i = 0; i < n; i += 1) {
      const c = vad.push(e, t, t + 50);
      if (c) segs.push(c);
      t += 50;
    }
  };
  step(0.0008, 20); // 1s quiet
  step(0.05, 40); // 2s speech
  step(0.0008, 20); // 1s quiet -> closes speech (hangover 550ms)
  step(0.05, 10);
  const speech = segs.filter((s) => s.kind === 'speech');
  assert.equal(speech.length, 1, JSON.stringify(segs));
  const dur = speech[0].end - speech[0].start;
  assert.ok(dur > 1600 && dur < 2200, `speech dur ${dur}`);
});

test('VAD holds one phrase together through a brief inter-word dip', () => {
  const vad = createVad();
  let t = 0;
  const segs = [];
  const push = (e) => {
    const c = vad.push(e, t, t + 50);
    if (c) segs.push(c);
    t += 50;
  };
  for (let i = 0; i < 15; i += 1) push(0.0008);
  for (let i = 0; i < 20; i += 1) push(0.05);
  for (let i = 0; i < 6; i += 1) push(0.002); // 300ms gap between words — under the 550ms hangover
  for (let i = 0; i < 20; i += 1) push(0.05);
  for (let i = 0; i < 20; i += 1) push(0.0008); // 1s quiet -> now it closes
  const speech = segs.filter((s) => s.kind === 'speech');
  assert.equal(speech.length, 1, `expected 1 unbroken phrase, got ${speech.length}: ${JSON.stringify(segs)}`);
});

/* --------------------------- analyzer end-to-end --------------------------- */
test('snapshot gates noisy metrics until there is enough evidence', () => {
  const a = new SessionAnalyzer();
  a.setTranscriptSource('browser');
  feed(a, { energy: 0.05, ms: 2000, at: 0 });
  a.pushTranscript({ text: 'short opener here', isFinal: true });
  const snap = a.snapshot();
  assert.equal(snap.pace.wpm, null, 'pace should not show on 2s of audio');
  assert.equal(snap.pace.ready, false);
  assert.equal(snap.fillers.hardPerMin, null);
});

test('pace becomes available and is bounded with realistic input', () => {
  const a = new SessionAnalyzer();
  a.setTranscriptSource('browser');
  // 20s of speech, ~50 words trickled in 5 finals of 10 words each.
  for (let k = 0; k < 5; k += 1) {
    feed(a, { energy: 0.06, ms: 4000, at: k * 4000 });
    a.pushTranscript({ text: Array(10).fill('word').join(' '), isFinal: true });
  }
  const snap = a.snapshot();
  assert.ok(snap.pace.ready, JSON.stringify(snap.pace));
  assert.ok(snap.pace.wpm > 60 && snap.pace.wpm < 320, `wpm out of range: ${snap.pace.wpm}`);
  assert.ok(snap.delivery.speakingSecondsTotal >= 15, `speaking total ${snap.delivery.speakingSecondsTotal}`);
  assert.ok(snap.delivery.talkRatio > 0.7);
});

test('detects a mid-answer pause of the right length', () => {
  const a = new SessionAnalyzer();
  feed(a, { energy: 0.06, ms: 3000, at: 0 });
  feed(a, { energy: 0.0008, ms: 1400, at: 3000 }); // ~1.4s pause
  feed(a, { energy: 0.06, ms: 3000, at: 4400 });
  const snap = a.snapshot();
  assert.equal(snap.pauses.count, 1, JSON.stringify(snap.timeline));
  assert.ok(snap.pauses.longestMs > 900 && snap.pauses.longestMs < 1800, `pause ${snap.pauses.longestMs}`);
});

test('answerLatency: question then silence then speech', () => {
  const a = new SessionAnalyzer();
  feed(a, { energy: 0.0008, ms: 1000, at: 0 });
  a.markQuestion({ label: 'Q1', at: 800 });
  feed(a, { energy: 0.0008, ms: 1200, at: 1000 });
  feed(a, { energy: 0.06, ms: 3000, at: 2200 });
  const lat = a.snapshot().answerLatency;
  assert.equal(lat.pending, false, JSON.stringify(lat));
  assert.ok(!('alreadySpeaking' in lat));
  assert.ok(lat.latencyMs >= 800 && lat.latencyMs < 2200, `latency ${lat.latencyMs}`);
});

test('answerLatency reports alreadySpeaking when marked mid-phrase', () => {
  const a = new SessionAnalyzer();
  feed(a, { energy: 0.06, ms: 4000, at: 0 });
  a.markQuestion({ label: 'Q1', at: 2000 });
  feed(a, { energy: 0.06, ms: 2000, at: 4000 });
  const lat = a.snapshot().answerLatency;
  assert.equal(lat.alreadySpeaking, true, JSON.stringify(lat));
});

test('snapshot never contains a verdict / authorship field', () => {
  const a = new SessionAnalyzer();
  a.setTranscriptSource('browser');
  feed(a, { energy: 0.06, ms: 12000, at: 0 });
  a.pushTranscript({ text: 'This is a normal practice answer about climate policy and trade unions.', isFinal: true });
  const json = JSON.stringify(a.snapshot()).toLowerCase();
  for (const banned of ['aiscore', 'ailikelihood', 'cheat', 'verdict', 'suspicion', 'authenticity', 'risk', 'accus']) {
    assert.ok(!json.includes(banned), `snapshot leaked "${banned}"`);
  }
});

/* --------------------------- P0 new telemetry tests --------------------------- */
import {
  detectRestarts,
  detectSelfCorrections,
  detectWordRepetitions,
  detectPhraseRepetitions,
  detectLongSentences,
  findFillerInstances,
} from './metrics.js';
import { createSpeechEvent, EVENT_TYPES } from './events.js';

test('detectRestarts finds false starts and retraction markers', () => {
  const t1 = 'I think the main... actually, the main reason is economic stability.';
  const r1 = detectRestarts(t1);
  assert.ok(r1.length >= 1, `expected restart in "${t1}", got ${JSON.stringify(r1)}`);
  assert.equal(r1[0].marker.toLowerCase(), 'actually');
  assert.ok(r1[0].abandoned.includes('main'));

  const t2 = 'We wanted to... we wanted to address the committee.';
  const r2 = detectRestarts(t2);
  assert.ok(r2.length >= 1, `expected false-start in "${t2}", got ${JSON.stringify(r2)}`);
});

test('detectSelfCorrections reliably finds localized corrections', () => {
  const t1 = 'The meeting will take place Monday... sorry, Tuesday afternoon.';
  const c1 = detectSelfCorrections(t1);
  assert.ok(c1.length >= 1, `expected self-correction in "${t1}", got ${JSON.stringify(c1)}`);
  assert.equal(c1[0].original.toLowerCase(), 'monday');
  assert.equal(c1[0].correction.toLowerCase(), 'tuesday');
  assert.equal(c1[0].marker.toLowerCase(), 'sorry');

  const t2 = 'There are five... no, six key objections to consider.';
  const c2 = detectSelfCorrections(t2);
  assert.ok(c2.length >= 1, `expected self-correction in "${t2}", got ${JSON.stringify(c2)}`);
  assert.equal(c2[0].original.toLowerCase(), 'five');
  assert.equal(c2[0].correction.toLowerCase(), 'six');

  // Should NOT flag ordinary "I am sorry" or "said no"
  const t3 = 'I am sorry for the delay and he said no to the offer.';
  const c3 = detectSelfCorrections(t3);
  assert.equal(c3.length, 0, `false positive in "${t3}": ${JSON.stringify(c3)}`);
});

test('detectWordRepetitions and detectPhraseRepetitions', () => {
  const tokens = tokenize('We we need to look at the budget, and we need to look at the surplus.');
  const wordReps = detectWordRepetitions(tokens);
  assert.ok(wordReps.length >= 1, `expected word repetition in tokens: ${JSON.stringify(wordReps)}`);
  assert.equal(wordReps[0].word, 'we');

  const phraseReps = detectPhraseRepetitions(tokens, 3, 4);
  assert.ok(phraseReps.length >= 1, `expected phrase repetition: ${JSON.stringify(phraseReps)}`);
  assert.ok(phraseReps[0].phrase.includes('need to look'));
});

test('detectLongSentences identifies sentences exceeding word threshold', () => {
  const normal = 'This is a brief, well-structured point. It delivers clear evidence.';
  assert.equal(detectLongSentences(normal, 15).length, 0);

  const long = 'This is an exceedingly long sentence that continues on without pausing for any terminal punctuation because the speaker is trying to pack far too many ideas into one single breath without stopping.';
  const detected = detectLongSentences(long, 20);
  assert.equal(detected.length, 1);
  assert.ok(detected[0].wordCount > 25);
});

test('findFillerInstances returns token, kind, and context excerpt', () => {
  const text = 'So um, I was like, you know, actually ready.';
  const instances = findFillerInstances(text);
  assert.ok(instances.length >= 3, `got ${instances.length}: ${JSON.stringify(instances)}`);
  const hard = instances.filter((i) => i.kind === 'hard');
  const soft = instances.filter((i) => i.kind === 'soft');
  assert.ok(hard.some((i) => i.token === 'um'));
  assert.ok(soft.some((i) => i.token.includes('you know')));
  assert.ok(instances.every((i) => typeof i.index === 'number' && i.excerpt));
});

test('createSpeechEvent creates normalized event matching schema', () => {
  const ev = createSpeechEvent({
    sessionId: 'sess-123',
    sequenceNumber: 5,
    timestamp: 12400,
    duration: 1500,
    type: EVENT_TYPES.PAUSE,
    metrics: { durationMs: 1500 },
    evidence: { textExcerpt: 'pause after introduction', tStart: 12400, tEnd: 13900 },
  });
  assert.equal(ev.sessionId, 'sess-123');
  assert.equal(ev.sequenceNumber, 5);
  assert.equal(ev.type, 'PAUSE');
  assert.equal(ev.duration, 1500);
  assert.ok(ev.eventId.startsWith('evt_'));
  assert.equal(ev.evidence.tStart, 12400);
});

test('SessionAnalyzer generates normalized events for fillers, restarts, and pauses', () => {
  const a = new SessionAnalyzer({ sessionId: 'session-norm-1' });
  a.setTranscriptSource('browser');

  feed(a, { energy: 0.06, ms: 2000, at: 0 });
  feed(a, { energy: 0.0008, ms: 1200, at: 2000 }); // pause
  feed(a, { energy: 0.06, ms: 3000, at: 3200 });

  a.pushTranscript({
    text: 'I think the main... actually, the main reason is um economic stability.',
    isFinal: true,
  });

  const snap = a.snapshot();
  assert.ok(snap.timeline.length >= 2, `timeline count: ${snap.timeline.length}`);

  const pauseEv = snap.timeline.find((e) => e.type === 'PAUSE');
  assert.ok(pauseEv, 'missing PAUSE event');
  assert.equal(pauseEv.sessionId, 'session-norm-1');
  assert.ok(pauseEv.evidence && pauseEv.evidence.tStart >= 2000);

  const restartEv = snap.timeline.find((e) => e.type === 'RESTART');
  assert.ok(restartEv, 'missing RESTART event');
  assert.ok(restartEv.evidence.textExcerpt.includes('actually'));

  const fillerEv = snap.timeline.find((e) => e.type === 'FILLER' && e.metrics.token === 'um');
  assert.ok(fillerEv, 'missing um FILLER event');
  assert.equal(fillerEv.metrics.token, 'um');
});

test('zeroCrossingRate differentiates speech-like wave from high-frequency noise', () => {
  const lowFreq = new Float32Array(160);
  for (let i = 0; i < 160; i++) lowFreq[i] = Math.sin((i / 160) * Math.PI * 2);
  const zcrLow = zeroCrossingRate(lowFreq);
  assert.ok(zcrLow < 0.1, `expected low zcr: ${zcrLow}`);

  const hiNoise = new Float32Array(160);
  for (let i = 0; i < 160; i++) hiNoise[i] = i % 2 === 0 ? 0.5 : -0.5;
  const zcrHi = zeroCrossingRate(hiNoise);
  assert.ok(zcrHi > 0.9, `expected high zcr: ${zcrHi}`);
});

test('detectLanguageSwitches identifies non-Latin script shifts', () => {
  const text = 'First we consider the fiscal policy, and then namaste नमस्ते to the delegates.';
  const detected = detectLanguageSwitches(text);
  assert.ok(detected.length >= 1, `expected language switch: ${JSON.stringify(detected)}`);
  assert.equal(detected[0].token, 'नमस्ते');
});

test('detectTopicDrift identifies when response departs from prompt keywords', () => {
  const promptTokens = tokenize('Should carbon tax be instituted globally to mitigate climate emissions?');
  const relatedTokens = tokenize('A carbon tax directly regulates climate emissions by placing a price on carbon production.');
  assert.equal(detectTopicDrift(relatedTokens, promptTokens, 10), null);

  const digression = 'Let us discuss medieval castle architecture with stone walls, drawbridges, and moats. The knights wore iron armor and rode horses across the countryside during feudal battles without any regard for castles or kings or royal crowns.'.repeat(3);
  const digressionTokens = tokenize(digression);
  const drift = detectTopicDrift(digressionTokens, promptTokens, 30);
  assert.ok(drift, 'expected topic drift detection');
  assert.ok(drift.promptKeywords.length > 0);
});

test('SessionAnalyzer does not duplicate events when transcript prefix is revised', () => {
  const a = new SessionAnalyzer({ sessionId: 'session-stable-dedupe' });
  feed(a, { energy: 0.05, ms: 2000, at: 0 });

  // Initial interim transcript
  a.pushTranscript({ text: 'I think um we need to look at this.', isFinal: false });
  const count1 = a.snapshot().timeline.filter((e) => e.type === 'FILLER').length;
  assert.equal(count1, 1);

  // Revised transcript with inserted leading word (shifting all character offsets)
  a.pushTranscript({ text: 'Yesterday, I think um we need to look at this.', isFinal: true });
  const count2 = a.snapshot().timeline.filter((e) => e.type === 'FILLER').length;
  assert.equal(count2, 1, 'filler should not be duplicated after character index shift');
});



