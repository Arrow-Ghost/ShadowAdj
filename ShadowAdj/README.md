# ShadowADJ

A **consent-first, real-time speech practice & reflection console** for debate practice,
interview preparation, and speech coaching.

ShadowADJ listens to live speech and shows *descriptive* metrics about how someone is
speaking — pace, pauses, filler-word rate, vocabulary diversity, answer latency — plus
an optional set of self-directed coaching notes. It is a mirror, not a judge.

## What ShadowADJ deliberately does not do

- It does **not** produce an "AI-likelihood", "cheating probability", or any
  accept/review/reject verdict about a person.
- It does **not** run covert monitoring. The person being recorded always sees the
  same dashboard as everyone else, and a session cannot start until consent is
  acknowledged in the UI.
- It does **not** build a per-person "baseline" and then score deviations from it as
  suspicion. Baselines exist only as an optional personal progress comparison, shown
  to the speaker.

These constraints are enforced in the API surface (`backend/src/analysis`), not just
the UI copy.

## Architecture

```
cadence/
  backend/    Node + Express + ws  — audio ingest, descriptive analysis pipeline
  frontend/   Astro + Three.js + Tailwind + Zustand — dashboard, 3D visualization
```

### Data flow

```
Browser (MediaRecorder)  --PCM16 chunks over WebSocket-->  Backend
Backend  --descriptive metrics + transcript over WebSocket-->  Browser dashboard
```

## Setup

```bash
# from cadence/
cp .env.example .env      # then fill in GEMINI_API_KEY if you want transcription
npm install               # installs backend + frontend (npm workspaces)
npm run dev                # starts backend :8787 and frontend :4321
```

Open http://localhost:4321.

### Environment

| Variable                  | Required | Purpose                                                                                              |
| ------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`          | no       | Enables server-side transcription + coaching notes. Without it, ShadowADJ uses the browser Web Speech API (Chrome only). |
| `GEMINI_TRANSCRIBE_MODEL` | no       | Fast model for live transcription (default `gemini-3.5-flash-lite`; falls back to other lite models on 404/503). |
| `GEMINI_MODEL`            | no       | Stronger model for coaching notes (default `gemini-3.6-flash`).                                     |
| `TRANSCRIPTION`           | no       | `auto` (server when a key is set, else browser) or `browser` to force Web Speech.                   |
| `PORT`                    | no       | Backend port (default `8787`).                                                                     |
| `CORS_ORIGIN`             | no       | Allowed frontend origin (default `http://localhost:4321`).                                         |

**Never commit `.env`.** If a key is ever pasted into a chat, an issue, or a commit,
treat it as compromised and rotate it.

## License

MIT
