import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { config, serverTranscription } from './config.js';
import { sessions, HttpError } from './session.js';
import { geminiEnabled, transcribeChunk, coachingNotes } from './gemini.js';

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    geminiEnabled: geminiEnabled(),
    model: config.gemini.transcribeModels[0],
    // What the client should use unless the user overrides it.
    defaultTranscription: serverTranscription ? 'server' : 'browser',
    transcriptionModes: geminiEnabled() ? ['server', 'browser'] : ['browser'],
  });
});

app.post('/api/sessions', (req, res, next) => {
  try {
    const { mode, label, consent } = req.body ?? {};
    const s = sessions.create({ mode, label, consent });
    res.status(201).json({
      id: s.id,
      mode: s.mode,
      label: s.label,
      consent: s.consent,
      wsUrl: `/ws?sessionId=${s.id}`,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/sessions/:id/export', (req, res, next) => {
  try {
    const s = sessions.get(req.params.id);
    res.json({ id: s.id, mode: s.mode, label: s.label, consent: s.consent, ...s.analyzer.export() });
  } catch (err) {
    next(err);
  }
});

app.post('/api/sessions/:id/end', (req, res, next) => {
  try {
    res.json(sessions.end(req.params.id));
  } catch (err) {
    next(err);
  }
});

// Self-directed coaching notes (opt-in, requires Gemini). Feedback is addressed
// to the speaker; it never returns an authorship or authenticity judgement.
app.post('/api/sessions/:id/coaching', async (req, res, next) => {
  try {
    if (!geminiEnabled()) throw new HttpError(400, 'Coaching notes need GEMINI_API_KEY');
    const s = sessions.get(req.params.id);
    const snap = s.analyzer.snapshot();
    if (snap.transcript.wordCount < 30) {
      throw new HttpError(422, 'Not enough transcript yet for useful notes');
    }
    const notes = await coachingNotes({
      transcript: snap.transcript.text,
      metrics: {
        pace: snap.pace,
        pauses: snap.pauses,
        fillers: snap.fillers,
        vocabulary: snap.vocabulary,
        delivery: snap.delivery,
      },
    });
    s.lastCoaching = { notes, at: Date.now() };
    res.json(s.lastCoaching);
  } catch (err) {
    next(err);
  }
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const SR = 16_000;
const BYTES_PER_S = SR * 2;
const MIN_CHUNK_BYTES = BYTES_PER_S * 6; // wait for ~6s before transcribing
const MAX_CHUNK_BYTES = BYTES_PER_S * 12; // cap a backlog chunk at ~12s
const OVERLAP_BYTES = Math.floor(BYTES_PER_S * 0.8); // carried into the next chunk

/**
 * Append `next` to `acc`, dropping a leading run of up to 12 words from `next`
 * that repeats the tail of `acc` (the overlap window re-transcribed). Always
 * returns a trimmed, single-spaced string.
 */
function dedupeJoin(acc, next) {
  const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');
  if (!acc) return clean(next);
  if (!next) return clean(acc);
  const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  const a = clean(acc).split(' ');
  const b = clean(next).split(' ');
  const maxK = Math.min(12, a.length, b.length);
  let best = 0;
  for (let k = maxK; k >= 1; k -= 1) {
    let ok = true;
    for (let i = 0; i < k; i += 1) {
      if (norm(a[a.length - k + i]) !== norm(b[i])) {
        ok = false;
        break;
      }
    }
    // A 1-word overlap is only trusted for a substantial word (avoids eating
    // a real "a" / "I" / "the" that merely repeats across the seam).
    if (ok && (k >= 2 || norm(b[0]).length >= 3)) {
      best = k;
      break;
    }
  }
  return [...a, ...b.slice(best)].join(' ');
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const sessionId = url.searchParams.get('sessionId');
  let session;
  try {
    session = sessions.get(sessionId);
  } catch {
    ws.close(4004, 'unknown session');
    return;
  }

  session.clients.add(ws);
  ws.send(JSON.stringify({ type: 'ready', geminiEnabled: geminiEnabled(), defaultTranscription: serverTranscription ? 'server' : 'browser' }));

  let transcriptSource = serverTranscription ? 'server' : 'browser';
  session.analyzer.setTranscriptSource(transcriptSource);

  let pcmBytes = 0;
  let pcmBuf = [];
  let overlap = Buffer.alloc(0); // tail of the previous chunk, prepended to the next
  let serverTranscript = '';
  let inFlight = false;
  let failures = 0;

  const tick = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(
      JSON.stringify({
        type: 'tick',
        snapshot: session.analyzer.snapshot(),
        energy: session.analyzer.energyTimeline(),
        transcribing: transcriptSource === 'server' && inFlight,
      }),
    );
  }, 500);

  async function pumpTranscription(force = false) {
    if (transcriptSource !== 'server' || inFlight) return;
    if (!force && pcmBytes < MIN_CHUNK_BYTES) return;
    if (force && pcmBytes < BYTES_PER_S) return; // < 1s left, skip
    inFlight = true;
    // Take up to MAX_CHUNK_BYTES; leave any excess for the next round.
    let take = 0;
    const parts = [];
    while (pcmBuf.length && take < MAX_CHUNK_BYTES) {
      const b = pcmBuf.shift();
      parts.push(b);
      take += b.length;
    }
    pcmBytes -= take;
    const body = Buffer.concat(parts);
    // Prepend a short overlap so a word split across the chunk boundary is still
    // heard; dedupeJoin removes the repeated words from the result.
    const chunk = Buffer.concat([overlap, body]);
    overlap = body.subarray(Math.max(0, body.length - OVERLAP_BYTES));
    try {
      const text = await transcribeChunk(chunk, SR);
      failures = 0;
      if (text) {
        const merged = dedupeJoin(serverTranscript, text);
        const delta = merged.slice(serverTranscript.length).trim();
        serverTranscript = merged;
        if (delta) {
          session.analyzer.pushTranscript({ text: delta, isFinal: true });
          broadcast(session, { type: 'transcript', text: delta, isFinal: true, source: 'server' });
        }
      }
    } catch (err) {
      failures += 1;
      console.error(`[shadowadj] transcription failed (${failures})`, err.message);
      if (failures >= 3) {
        transcriptSource = 'browser';
        session.analyzer.setTranscriptSource('browser');
        pcmBuf = [];
        pcmBytes = 0;
        ws.send(
          JSON.stringify({
            type: 'transcription-fallback',
            message: 'Gemini transcription is unavailable — switched to browser speech recognition.',
          }),
        );
      }
    } finally {
      inFlight = false;
      // Drain a backlog that built up during the request.
      if (pcmBytes >= MIN_CHUNK_BYTES) setImmediate(pumpTranscription);
    }
  }

  // Transcribe whatever audio is still buffered (used on session end).
  async function flushTranscription() {
    if (transcriptSource !== 'server') return;
    for (let i = 0; i < 60 && inFlight; i += 1) await new Promise((r) => setTimeout(r, 100));
    await pumpTranscription(true);
  }

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const samples = new Float32Array(buf.length / 2);
      for (let i = 0; i < samples.length; i += 1) samples[i] = buf.readInt16LE(i * 2) / 32768;
      session.analyzer.pushAudio({ samples });
      if (transcriptSource === 'server') {
        pcmBuf.push(buf);
        pcmBytes += buf.length;
        pumpTranscription();
      }
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    switch (msg.type) {
      case 'hello': {
        // Client may force 'browser'; 'server' only honoured when available.
        const want = msg.transcriptSource;
        transcriptSource =
          want === 'browser'
            ? 'browser'
            : want === 'server' && geminiEnabled()
              ? 'server'
              : serverTranscription
                ? 'server'
                : 'browser';
        session.analyzer.setTranscriptSource(transcriptSource);
        ws.send(JSON.stringify({ type: 'config', transcriptSource }));
        break;
      }
      case 'transcript':
        if (transcriptSource === 'browser') {
          session.analyzer.pushTranscript({ text: msg.text, isFinal: Boolean(msg.isFinal) });
        }
        break;
      case 'question':
        session.analyzer.markQuestion({ label: msg.label });
        broadcast(session, { type: 'timeline', event: { kind: 'question', label: msg.label } });
        break;
      case 'end':
        flushTranscription().finally(() => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'ended', export: session.analyzer.export() }));
          }
        });
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    clearInterval(tick);
    session.clients.delete(ws);
  });
});

function broadcast(session, payload) {
  const str = JSON.stringify(payload);
  for (const client of session.clients) {
    if (client.readyState === client.OPEN) client.send(str);
  }
}

server.listen(config.port, () => {
  console.log(`[shadowadj] backend on http://localhost:${config.port}`);
  console.log(`[shadowadj] CORS origin: ${config.corsOrigin}`);
});
