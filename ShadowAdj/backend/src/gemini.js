import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from './config.js';

const genAI = config.gemini.enabled ? new GoogleGenerativeAI(config.gemini.apiKey) : null;

export const geminiEnabled = () => Boolean(genAI);

/**
 * Call generateContent, walking a model fallback list on 404 (model retired) or
 * 503 (temporarily overloaded).
 */
async function generate(parts, models) {
  if (!genAI) throw new Error('Gemini not configured');
  let lastErr;
  for (const name of models) {
    try {
      const model = genAI.getGenerativeModel({ model: name });
      const res = await model.generateContent(parts);
      return res.response.text().trim();
    } catch (err) {
      lastErr = err;
      if (!/\b(404|503)\b/.test(String(err?.message || ''))) throw err;
    }
  }
  throw lastErr;
}

/**
 * Transcribe a block of 16-bit PCM mono audio. Returns plain text ('' if the
 * block held no intelligible speech). Audio is sent inline and not stored.
 */
export async function transcribeChunk(pcm16, sampleRate = 16_000) {
  const wav = pcm16ToWav(pcm16, sampleRate);
  const text = await generate(
    [
      { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } },
      {
        text:
          'Transcribe this audio segment verbatim in English. It is one slice of a longer ' +
          'continuous stream, so it may start or end mid-sentence — transcribe only what is ' +
          'audible, do not complete or guess. Keep filler words (um, uh, like, you know) and ' +
          'false starts exactly as spoken. Return ONLY the transcript text, or nothing if there ' +
          'is no speech.',
      },
    ],
    config.gemini.transcribeModels,
  );
  if (/^\s*(?:there is no speech|no speech|\(silence\)|\[[^\]]*\])\s*$/i.test(text)) return '';
  return text;
}

/**
 * Evidence-linked coaching notes and single experiment recommendation.
 * Output is strictly structured, tied to observable timeline evidence,
 * and contains NO psychological judgements, AI-detection scores, or confidence scores.
 */
export async function coachingNotes({ transcript, metrics, timeline = [] }) {
  const eventsSummary = (timeline || []).slice(-30).map((e) => ({
    eventId: e.eventId || `evt_${e.t}`,
    type: e.type || e.kind,
    timeMs: e.timestamp || e.t,
    durationMs: e.duration || e.metrics?.durationMs || e.meta?.durationMs,
    evidence: e.evidence?.textExcerpt || '',
  }));

  const prompt = [
    'You are a supportive speech and debate coach writing private notes FOR THE SPEAKER.',
    'Base your notes ONLY on delivery and structure. Do NOT judge personality, confidence, honesty, or speculate about tools.',
    'You MUST tie your observations to the actual provided events and transcript. Never invent evidence.',
    '',
    `Descriptive metrics: ${JSON.stringify(metrics)}`,
    `Recent timeline events: ${JSON.stringify(eventsSummary)}`,
    `Transcript:\n${transcript}`,
    '',
    'Respond in valid JSON format with this exact structure:',
    '{',
    '  "observation": "Clear descriptive observation of what happened (e.g. speaking pace increased from X to Y, or pause of Z seconds occurred)",',
    '  "evidence": [',
    '    { "eventId": "matching eventId from events", "startTime": 12.3, "endTime": 14.5, "quote": "relevant transcript phrase" }',
    '  ],',
    '  "possibleExperiment": {',
    '    "title": "Short experiment title (e.g. Pause before answering, Shorten long sentences, Slow down during complex explanation)",',
    '    "goal": "Concrete target",',
    '    "action": "What to do on the next attempt"',
    '  },',
    '  "explanation": "Descriptive reflection on the delivery structure",',
    '  "summaryNotes": "3-4 concise, supportive bullet points for review"',
    '}',
  ].join('\n');

  try {
    const raw = await generate([{ text: prompt }], config.gemini.textModels);
    // Parse JSON block
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const exp = parsed.possibleExperiment
      ? {
          title: parsed.possibleExperiment.title || 'Delivery Experiment',
          description: parsed.possibleExperiment.action || parsed.possibleExperiment.description || parsed.possibleExperiment.goal,
          metricTarget: parsed.possibleExperiment.goal || parsed.possibleExperiment.metricTarget || 'Pacing',
        }
      : null;
    return {
      notes: parsed.summaryNotes || raw,
      structured: parsed,
      experiment: exp,
    };
  } catch {
    // Deterministic fallback if model output is unstructured or offline
    const longestPause = metrics?.pauses?.longestMs;
    const pace = metrics?.pace?.wpm;
    let fallbackExperiment = {
      title: 'Deliberate Pause',
      goal: 'Insert a 1-second pause before answering follow-up points.',
      action: 'Take one calm breath before beginning your next response.',
    };
    if (pace && pace > 170) {
      fallbackExperiment = {
        title: 'Pacing Modulation',
        goal: 'Maintain pace near 140 WPM during complex sentences.',
        action: 'Slightly slow down during the core thesis phrase.',
      };
    } else if (longestPause && longestPause > 3000) {
      fallbackExperiment = {
        title: 'Signposted Transition',
        goal: 'Use a short signpost phrase instead of an extended mid-sentence pause.',
        action: 'Say "First, let us examine..." when formulating the next point.',
      };
    }

    const exp = {
      title: fallbackExperiment.title,
      description: fallbackExperiment.action || fallbackExperiment.goal,
      metricTarget: fallbackExperiment.goal,
    };

    return {
      notes: `Observation: Pace averaged ${pace || '—'} WPM with ${metrics?.pauses?.count ?? 0} pauses.\nRecommendation: Try the experiment below in your next attempt.`,
      structured: {
        observation: `Delivery pace was ${pace || 'unmeasured'} WPM with ${metrics?.pauses?.count ?? 0} observable pauses.`,
        evidence: eventsSummary.slice(0, 2),
        possibleExperiment: fallbackExperiment,
        explanation: 'Descriptive feedback based on measured session telemetry.',
        summaryNotes: `Delivery pace: ${pace || '—'} WPM. Observed pauses: ${metrics?.pauses?.count ?? 0}.`,
      },
      experiment: exp,
    };
  }
}

function pcm16ToWav(pcm16, sampleRate) {
  const b = Buffer.alloc(44 + pcm16.length);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + pcm16.length, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(pcm16.length, 40);
  pcm16.copy(b, 44);
  return b;
}
