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
 * Coaching notes addressed to the speaker. Delivery and structure only — the
 * prompt forbids speculating about tools used or rating authorship, and the
 * output is framed as the speaker's own review material.
 */
export async function coachingNotes({ transcript, metrics }) {
  return generate(
    [
      {
        text: [
          'You are a supportive speech and debate coach writing private notes FOR THE SPEAKER',
          'to review after their own practice session. Base your notes only on delivery and',
          'structure. Do NOT speculate about whether the speaker used notes, AI, or any tool,',
          'and do NOT rate authenticity or authorship — that is out of scope and unreliable.',
          '',
          'Give 3-5 short, concrete, encouraging observations: what landed well, and one or',
          'two things to try next time (signposting, pacing on a specific passage, handling a',
          'pause). Reference phrases from the transcript where useful.',
          '',
          `Descriptive metrics from the session: ${JSON.stringify(metrics)}`,
          '',
          `Transcript:\n${transcript}`,
        ].join('\n'),
      },
    ],
    config.gemini.textModels,
  );
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
