# ShadowADJ

**Consent-First, Real-Time Speech Practice, Adjudication & Competition Operating System**

ShadowADJ is a complete platform for speech practice, competitive debate tournaments, interview preparation, and oratory coaching. It combines:
1. **A Real-Time Speech Reflection Console** providing descriptive delivery metrics (pace, pauses, fillers, vocabulary diversity, answer latency) over live audio.
2. **A Rubric-Driven Judge Engine** with grounded transcript evidence quotes, confidence grading, and human-in-the-loop score overrides.
3. **An Integrity & Ethics Review Engine** analyzing multi-signal source matches, cross-participant similarity, style deviation, preparedness, and session integrity hashing without pseudo-scientific "AI %" verdicts.
4. **An Adaptive Coaching Studio** targeting weaknesses quoted verbatim from judge evaluations, generating interactive drills and dynamic AI sparring opponents.
5. **A Competition OS** featuring multi-judge consensus aggregation, deterministic tie-breaking, public/admin leaderboard splits, post-event analytics, tamper-evident replay bundles, background job queues, and role-based access control (RBAC).

---

## Table of Contents

- [Core Philosophy & Non-Negotiables](#core-philosophy--non-negotiables)
- [System Architecture](#system-architecture)
- [Key Features & Modules](#key-features--modules)
  - [1. Real-Time Speech Core & Reflection Console (`/console`)](#1-real-time-speech-core--reflection-console-console)
  - [2. Rubric-Driven Judge Engine (`/judge`)](#2-rubric-driven-judge-engine-judge)
  - [3. Integrity & Source Review Engine (`/review`)](#3-integrity--source-review-engine-review)
  - [4. Adaptive Coaching Studio (`/coach`)](#4-adaptive-coaching-studio-coach)
  - [5. Competition OS & Admin Suite (`/admin`)](#5-competition-os--admin-suite-admin)
  - [6. Multilingual & Diarization Engine](#6-multilingual--diarization-engine)
  - [7. Authentication & RBAC](#7-authentication--rbac)
- [Frontend Views & Navigation](#frontend-views--navigation)
- [Data Model & Entities](#data-model--entities)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation & Local Setup](#installation--local-setup)
  - [Environment Variables](#environment-variables)
  - [AI Model Routing & Providers](#ai-model-routing--providers)
- [API & WebSocket Reference](#api--websocket-reference)
  - [REST API Endpoints](#rest-api-endpoints)
  - [WebSocket Protocol (`/ws`)](#websocket-protocol-ws)
- [End-to-End Workflows](#end-to-end-workflows)
  - [Workflow A: Standalone Speech Practice](#workflow-a-standalone-speech-practice)
  - [Workflow B: Running a Competition Round](#workflow-b-running-a-competition-round)
  - [Workflow C: Coaching & Sparring Drills](#workflow-c-coaching--sparring-drills)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [Security & Data Integrity](#security--data-integrity)
- [License](#license)

---

## Core Philosophy & Non-Negotiables

ShadowADJ is built on strict ethical principles enforced at the code and testing levels:

- **Descriptive, Never Accusatory:** Delivery metrics (WPM, pause count, filler rate) describe *how* a person speaks without assigning virtue or suspicion.
- **Strict Performance vs. Integrity Separation:** Evaluation scores assess delivery and argumentation only. Integrity signals exist in an independent pipeline and never artificially distort a participant's score.
- **No Pseudo-Scientific "AI Percentage" Scores:** The Integrity Engine outputs multi-sourced risk levels (`LOW`, `MODERATE`, `HIGH`, `CRITICAL`), transparent evidence references, and explicit "what this does not establish" caveats. It never issues a definitive automated cheat verdict.
- **Consent-First & No Covert Monitoring:** Sessions require an explicit consent acknowledgment before audio streaming begins. The speaker always sees the same real-time dashboard.
- **Human-in-the-Loop Authority:** Only human judges can override scores, and only human reviewers can move an integrity case to `confirmed` status. All overrides require recorded rationale and are preserved in immutable audit logs.
- **Grounded Coaching:** The Coach Engine generates feedback and drills derived directly and verbatim from the Judge's findings—never hallucinating generic critiques.

---

## System Architecture

```
ShadowAdj/
├── backend/                  # Node.js 25+ (ES Modules, TypeScript, direct execution)
│   ├── src/
│   │   ├── speech-core/      # Audio ingest, streaming VAD, metrics analyzer, timeline
│   │   ├── ai/               # AIGateway (Gemini & Groq multi-model routing, fallback cascades, cost tracking)
│   │   ├── storage/          # StorageProvider interface + SqliteStorage (node:sqlite, WAL mode)
│   │   ├── domain/           # Domain types, entity creators, validation, rubric presets
│   │   ├── judge-engine/     # Rubric evaluation, confidence guards, human overrides
│   │   ├── integrity/        # Source search, cross-participant similarity, style baselines, appeals
│   │   ├── coach/            # Weakness extraction, adaptive drills, AI opponent sparring, progress
│   │   ├── competition/      # Multi-judge consensus, tie-breaking, leaderboards, replay bundles
│   │   ├── auth/             # scrypt hashing, HMAC-SHA256 signed tokens, RBAC middleware
│   │   ├── jobs/             # In-process asynchronous job queue
│   │   ├── shared/           # Strongly typed WebSocket protocol
│   │   ├── session.ts        # SessionManager (runtime orchestrator ↔ storage)
│   │   ├── seed.ts           # Demo tournament data seeder
│   │   └── index.ts          # Express REST API & WebSocket transport server
│   └── data/                 # SQLite database storage (shadowadj.db)
│
├── frontend/                 # Astro 4 + React 18 Islands + Three.js + Tailwind CSS + Zustand
│   ├── src/
│   │   ├── pages/            # Astro routes (/console, /judge, /review, /coach, /admin, /history, /about)
│   │   ├── components/       # React interactive views, 3D FFT Sphere, MicTester, MetricRail, Timelines
│   │   ├── lib/              # AudioWorklet stream, Web Speech fallback, REST clients, Zustand stores
│   │   └── styles/           # Global design system tokens
│   └── public/               # Static assets & AudioWorklet processor scripts
```

### Data Flow

```
+-------------+  16 kHz PCM16 Frames   +---------------+  6-12s Chunks   +-------------------+
|   Browser   | ---------------------> |  SpeechCore   | -------------> | AIGateway (Gemini/ |
| AudioWorklet|                        | Streaming VAD |                |       Groq)       |
+-------------+                        +---------------+                +-------------------+
       ^                                      |                                   |
       | 500ms Descriptive Snapshots          v                                   v
       +------------------------------ SQLite Storage <------------------- Transcripts
                                      (node:sqlite)
                                             |
                      +----------------------+----------------------+
                      |                      |                      |
                      v                      v                      v
               Judge Engine           Integrity Engine         Coach Engine
             (Rubrics & Evidence)   (Multi-Signal Risk)    (Drills & Opponent)
```

---

## Key Features & Modules

### 1. Real-Time Speech Core & Reflection Console (`/console`)
- **Streaming Voice Activity Detection (VAD):** Rolling-percentile noise floor calculation with hysteresis and a 550ms hangover window.
- **Descriptive Delivery Metrics:**
  - **Pace:** Words per minute (WPM) calculated over active speech intervals.
  - **Pauses:** Micro-pauses (250–1000ms), long pauses (>1000ms), and pause rate per minute.
  - **Filler Word Detection:** Hard fillers (`um`, `uh`, `er`, `ah`) and soft context-gated fillers (`like`, `you know`, `actually`, `basically`).
  - **Vocabulary Variety:** Moving-Average Type-Token Ratio (MATTR) and long-word percentage.
  - **Answer Latency:** Measures elapsed time between an interviewer's question mark and the speaker's response onset.
- **Visual Presentation:** 3D audio-reactive FFT Icosahedron rendered with Three.js, live waveform timeline, and real-time metric gauges.

### 2. Rubric-Driven Judge Engine (`/judge`)
- **Structured Rubrics:** Support for criteria weighting, custom score ranges (e.g. 1–10 or 1–100), descriptive scale anchors, and evaluation guidelines.
- **Built-in Presets:** Debate, Job Interview, Speech & Oratory, Hackathon Pitch, Model UN (MUN), and Custom.
- **Evidence-Grounded AI Scoring:** Scores are tied to exact verbatim transcript quotes with timestamps (`startMs`, `endMs`), strengths, weaknesses, and rationale.
- **Confidence Guard:** Evaluates transcript quality and speech duration to prevent high-confidence claims on sparse data.
- **Human Overrides & Auditing:** Judges can override AI scores per criterion with mandatory reasoning notes while preserving the original AI baseline. Evaluations can be finalized and reopened.

### 3. Integrity & Source Review Engine (`/review`)
- **Multi-Signal Aggregation:** Combines independent evidence sources to assign risk levels (`LOW`, `MODERATE`, `HIGH`, `CRITICAL`):
  - **Source Search Matching:** Computes shingle containment, Jaccard similarity, phrase uniqueness, and attribution status (`attributed`, `quoted`, `paraphrased`, `copied`).
  - **Cross-Participant Similarity:** Detects verbatim or high-similarity phrase sharing across different participants in the same event.
  - **Style Baseline Deviation:** Computes z-scores across historical metrics (WPM, pause rate, MATTR) when at least 2 baseline sessions exist.
  - **Preparedness Analysis:** Distinguishes between spontaneous, prepared, and highly rehearsed delivery patterns.
  - **Session Integrity & Artifact Hashing:** SHA-256 cryptographic hashing of transcripts, metrics, and timelines, alongside anomaly detection (timestamp skips, duplicated segments, stream disconnects).
- **Reviewer Decisions:** Reviewers can mark cases as `dismiss`, `monitor`, `investigate`, or `confirm`.
- **Participant Appeals Workflow:** Participants can submit formal appeals with source attributions, viewable in a redacted format.
- **Interactive Source Graph:** Node-edge graph visualization mapping relationships between participants and matched external sources.

### 4. Adaptive Coaching Studio (`/coach`)
- **Grounded Action Plans:** Focus areas directly prioritize the lowest-scoring rubric criteria.
- **Coach Personas:** Supportive, Analytical, Strict, Executive, Debate Coach, and Interview Coach.
- **Targeted Drill Library:**
  - *Rebuttal Sprint*, *Evidence Challenge*, *Conciseness Drill*, *Signposting Drill*, *Pace Drill*, *POI Gauntlet*, *Cross-Examination*, *Pressure Drill*, *Interview Drill*, and *Retry*.
- **Interactive AI Sparring Opponent:** Multi-turn conversational practice with configurable aggression (`measured`, `firm`, `aggressive`), argumentation styles, and difficulty.
- **Before / After Comparison:** Side-by-side metric and rubric delta analysis across practice attempts.
- **Progress Tracking:** Longitudinal tracking of WPM, filler rates, pause frequency, and rubric scores over time.

### 5. Competition OS & Admin Suite (`/admin`)
- **Multi-Judge Consensus:** Aggregates evaluations across multiple AI and human judges, calculating overall means, score spreads, standard deviations, and identifying outlier judges.
- **Deterministic Tie-Breaking:** Multi-stage tie-breaking rules (overall score -> criterion priorities -> consensus spread -> head-to-head -> human judge preference) with human-readable traces.
- **Dual-View Leaderboard:**
  - *Public View:* Ranks participants with clean status badges (`clear` vs `under-review`).
  - *Admin View:* Exposes consensus spreads, open integrity cases, and per-criterion averages.
- **Post-Event Analytics:** Score distribution histograms, criterion averages, judge generosity/harshness deviations, and integrity case breakdowns.
- **Replay Archive Bundles:** Tamper-evident JSON archive containing full session data, transcripts, metrics, evaluations, consensus, and audit history.
- **Background Job Queue:** In-process asynchronous task runner for intensive operations (`integrity.analyzeSession`, `judge.evaluate`, `event.analytics`).

### 6. Multilingual & Diarization Engine
- **Multilingual Transcription:** Real-time speech transcription across international languages.
- **Code-Switching Detection:** Identifies mid-sentence or mid-speech language switches and reports language share percentages.
- **Side-by-Side Translation:** Generates translations alongside original transcripts without mutating the authoritative source text.
- **Best-Effort Diarization:** Identifies speaker turns and speaking duration for multi-speaker sessions (flagged as low-confidence/best-effort).

### 7. Authentication & RBAC
- **Four Distinct Roles:** `admin`, `reviewer`, `judge`, `participant`.
- **Cryptographic Security:** Passwords hashed with `scrypt`; session tokens signed with `HMAC-SHA256`.
- **Dev-Mode Bypass:** Unset `AUTH_SECRET` allows the console to operate seamlessly in single-user dev mode (auto-assigns admin permissions).
- **Bootstrap Auto-Provisioning:** The first registered account automatically becomes the system `admin`.

---

## Frontend Views & Navigation

| Route | View Component | Target Audience | Purpose |
| --- | --- | --- | --- |
| `/` | `index.astro` + `ViewLauncher.tsx` | All Users | Landing page, feature overview, and rapid view switcher. |
| `/console` | `Console.tsx` | Speakers / Candidates | Real-time speech practice console with 3D audio sphere and metrics. |
| `/judge` | `JudgeView.tsx` | Judges / Adjudicators | Rubric evaluation, evidence inspector, score overrides, and finalization. |
| `/review` | `ReviewView.tsx` | Ethics / Integrity Reviewers | Multi-signal integrity review, source graph, anomaly logs, and appeals. |
| `/coach` | `CoachView.tsx` | Speakers & Coaches | Grounded coaching plans, adaptive drills, and AI opponent sparring. |
| `/admin` | `AdminView.tsx` | Tournament Admins | Leaderboards, judge consensus, tie-breakers, analytics, audit logs, and jobs. |
| `/history` | `History.tsx` | All Users | Local and database-backed session replay and export history. |
| `/about` | `about.astro` | All Users | Architectural principles, consent methodology, and ethical guarantees. |

---

## Data Model & Entities

The platform persists all data in SQLite (`node:sqlite`). All entities chain back to a core `Session`:

```
Event ──< Round
  │
  ├──< Participant ──< StyleBaseline
  │         │
  │         └──< Session ──< TranscriptSegment
  │                 │    ──< SpeechMetric
  │                 │    ──< TimelineEvent
  │                 │    ──< JudgeEvaluation ──< CriterionScore
  │                 │    ──< IntegrityCase ──< IntegrityAppeal
  │                 │    ──< SessionArtifacts
  │                 │    ──< CoachPlan ──< Drill ──< DrillExchange
  │                 │    ──< AuditEvent
  │                 │
  └──< Rubric ──< RubricCriterion
```

---

## Getting Started

### Prerequisites

- **Node.js:** v22.10.0 or higher (v25+ recommended for native TypeScript and `node:sqlite`).
- **npm:** v10+ (configured with npm workspaces).
- **Browser:** Google Chrome (recommended for full AudioWorklet and Web Speech API support).

### Installation & Local Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Arrow-Ghost/ShadowAdj.git
   cd ShadowAdj
   ```

2. **Configure Environment Variables:**
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` and provide your `GROQ_API_KEY` or `GEMINI_API_KEY`.*

3. **Install Dependencies:**
   ```bash
   npm install
   ```

4. **Start Development Servers:**
   ```bash
   npm run dev
   ```
   *Starts the Backend on `http://localhost:8787` and Frontend on `http://localhost:4321` concurrently.*

5. **Open the Application:**
   Visit **`http://localhost:4321`** in your browser.

---

### Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `GROQ_API_KEY` | *empty* | API key for Groq Cloud (Whisper large-v3 & LLM inference). |
| `GEMINI_API_KEY` | *empty* | API key for Google Gemini models. |
| `AI_PROVIDER` | `groq` (if key set) else `gemini` | Primary AI provider (`groq` or `gemini`). |
| `GEMINI_TRANSCRIBE_MODEL` | `gemini-3.5-flash-lite` | Fast transcription model (Gemini). |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Text and reasoning model for judging and coaching (Gemini). |
| `GROQ_TRANSCRIBE_MODEL` | `whisper-large-v3-turbo` | Audio transcription model (Groq). |
| `GROQ_MODEL` | `groq/compound` | Reasoning and coaching model (Groq). |
| `TRANSCRIPTION` | `auto` | `auto` (server transcription if key present) or `browser` (Web Speech API). |
| `DATABASE_URL` | `file:./data/shadowadj.db` | SQLite database file location (`:memory:` for testing). |
| `SEARCH_PROVIDER` | `mock` | Source search provider (`mock`, `exa`, `brave`, or `bing`). |
| `AUTH_SECRET` | *empty* | Secret string for HMAC token signing. Leave empty for Dev Mode (auto-admin). |
| `PORT` | `8787` | Backend HTTP & WebSocket server port. |
| `CORS_ORIGIN` | `http://localhost:4321` | Allowed frontend origin for CORS. |
| `MULTILINGUAL` | `auto` | Multilingual transcription mode (`auto`, `always`, or `off`). |
| `TRANSLATE_TO` | `en` | Target translation language code (BCP-47). |

---

### AI Model Routing & Providers

The backend features an adaptive **`AIGateway`** supporting both Google Gemini and Groq with automated fallback cascades:

- **Transcription Fallback Chain:**
  - *Gemini:* `gemini-3.5-flash-lite` → `gemini-2.5-flash` → `gemini-1.5-flash` → `gemini-2.0-flash`.
  - *Groq:* `whisper-large-v3-turbo` → `whisper-large-v3`.
- **Reasoning / Text Fallback Chain:**
  - *Gemini:* `gemini-3.6-flash` → `gemini-flash-latest` → `gemini-3.5-flash`.
  - *Groq:* `groq/compound` → `openai/gpt-oss-120b` → `openai/gpt-oss-20b`.
- **Zero-Key Resilience:** When no API key is supplied, ShadowADJ automatically routes transcription to the client's browser Web Speech API.

---

## API & WebSocket Reference

### REST API Endpoints

#### System & Auth
- `GET /api/health` — Service status, active AI provider, and transcription mode.
- `POST /api/seed` — Seeds complete demo tournament data (events, sessions, evaluations, cases, drills).
- `GET /api/ai/cost` — Cumulative token usage and estimated API cost summaries.
- `POST /api/auth/register` — Register a user account (first account becomes `admin`).
- `POST /api/auth/login` — Authenticate and receive HMAC signed JWT cookie/token.
- `POST /api/auth/logout` — Clear auth cookie.
- `GET /api/auth/me` — Retrieve active session user context and role.
- `GET /api/auth/users` — List registered users *(Requires `admin`)*.

#### Events & Rubrics
- `GET /api/events` | `POST /api/events` — List or create competition events.
- `GET /api/events/:id` — Retrieve event details, rounds, and participants.
- `POST /api/events/:id/rounds` — Add a round to an event.
- `POST /api/events/:id/participants` — Register a participant for an event.
- `PUT /api/events/:id/rubric` — Assign a rubric or preset to an event.
- `GET /api/rubrics/presets` — List standard rubric presets (Debate, Interview, Pitch, etc.).
- `GET /api/rubrics` | `POST /api/rubrics` — List or create custom rubrics.
- `GET /api/rubrics/:id` — Get rubric details.

#### Sessions & Audio
- `GET /api/sessions` | `POST /api/sessions` — List or initialize practice/competition sessions.
- `POST /api/sessions/simulate` — Simulate a complete debate round with audio and transcripts.
- `POST /api/sessions/:id/end` — Finalize a live session and flush analyzers.
- `GET /api/sessions/:id/transcript` — Retrieve final transcripts (supports `?translate=en`).
- `GET /api/sessions/:id/timeline` — Retrieve evidence timeline events.
- `GET /api/sessions/:id/export` — Export full session snapshot JSON.
- `GET /api/sessions/:id/audit` — Retrieve immutable audit trail for the session.
- `GET /api/sessions/:id/language` — Code-switching and language share profile.
- `GET /api/sessions/:id/speakers` — Diarization summary and speaking turn breakdown.
- `GET /api/sessions/:id/artifacts` — SHA-256 hashes for transcript, snapshot, and timeline.

#### Judging Engine
- `POST /api/sessions/:id/evaluations` — Run AI rubric evaluation on session transcript.
- `GET /api/sessions/:id/evaluations` — List all evaluations for a session.
- `GET /api/evaluations/:id` — Retrieve specific evaluation with criteria scores and quotes.
- `PATCH /api/evaluations/:id/criteria/:criterionId` — Apply human score override *(Requires `judge`)*.
- `POST /api/evaluations/:id/finalize` — Finalize evaluation status *(Requires `judge`)*.
- `POST /api/evaluations/:id/reopen` — Reopen finalized evaluation *(Requires `judge`)*.

#### Integrity & Appeals
- `POST /api/sessions/:id/integrity` — Run multi-signal integrity analysis on a session.
- `GET /api/sessions/:id/integrity` — Get integrity cases and analytics for a session.
- `GET /api/events/:id/integrity` — List all integrity cases across an event.
- `GET /api/integrity-cases/:id` — Retrieve full integrity case details.
- `GET /api/integrity-cases/:id/participant-view` — Redacted case view for participants.
- `GET /api/integrity-cases/:id/graph` — Node-edge source similarity graph.
- `POST /api/integrity-cases/:id/review` — Submit reviewer verdict *(Requires `reviewer`)*.
- `POST /api/integrity-cases/:id/appeal` — Submit a participant appeal.
- `POST /api/integrity-appeals/:id/respond` — Resolve an appeal *(Requires `reviewer`)*.

#### Coaching & Drills
- `POST /api/sessions/:id/coaching` — Generate fast coaching notes from live session.
- `POST /api/sessions/:id/coach/plan` — Generate comprehensive weakness-grounded coaching plan.
- `GET /api/sessions/:id/coach/plans` — List coach plans for a session.
- `GET /api/coach-plans/:id` — Retrieve coach plan and associated drills.
- `POST /api/coach-plans/:id/drills` — Instantiate an adaptive drill targeting a weakness.
- `GET /api/drills/:id` — Get drill status and prompt.
- `POST /api/drills/:id/opponent` — Advance multi-turn AI sparring opponent debate.
- `POST /api/drills/:id/grade` — Grade completed drill response.
- `POST /api/coach/compare` — Compare two sessions (before vs. after delta).
- `GET /api/participants/:id/progress` — Retrieve participant longitudinal skill trends.

#### Competition Administration
- `GET /api/sessions/:id/consensus` — Calculate multi-judge consensus and variance *(Requires `judge`)*.
- `POST /api/events/:id/tiebreak` — Deterministic tie-break execution *(Requires `judge`)*.
- `GET /api/events/:id/leaderboard` — Public or admin leaderboard (`?view=admin`).
- `GET /api/events/:id/analytics` — Event score distribution and judge statistics *(Requires `reviewer`)*.
- `GET /api/events/:id/audit` — Event-wide audit log *(Requires `admin`)*.
- `GET /api/sessions/:id/replay` — Download tamper-evident JSON replay bundle *(Requires `judge`)*.
- `GET /api/jobs` | `POST /api/jobs` — View or enqueue background tasks *(Requires `judge`)*.

---

### WebSocket Protocol (`/ws`)

Connect via WebSocket to `/ws?sessionId=<SESSION_ID>`:

#### Client → Server Messages
- `Binary Frame` (PCM16, 16 kHz Mono Audio Buffer) — Raw microphone audio stream.
- `{"type":"hello", "transcriptSource":"server"|"browser"}` — Handshake and STT mode selection.
- `{"type":"transcript", "text":"...", "isFinal":true|false}` — Client-side Web Speech transcript ingest.
- `{"type":"question", "label":"Interviewer question"}` — Mark question boundary for answer latency timing.
- `{"type":"end"}` — Finalize recording and trigger session export.

#### Server → Client Messages
- `{"type":"ready", "geminiEnabled":true, "defaultTranscription":"server"}` — Session ready confirmation.
- `{"type":"config", "transcriptSource":"server"|"browser"}` — Active session configuration.
- `{"type":"tick", "snapshot":{...}, "energy":[...], "transcribing":false, "timer":{...}}` — Real-time metrics broadcast every 500ms.
- `{"type":"transcript", "segment":{...}}` — Live finalized transcript delta.
- `{"type":"timeline", "event":{...}}` — Timeline observation event.
- `{"type":"ended", "export":{...}}` — Session ended payload.

---

## End-to-End Workflows

### Workflow A: Standalone Speech Practice
1. Navigate to **`/console`**.
2. Select your practice mode (*Debate Practice*, *Interview Prep*, or *Speech Coaching*).
3. Test your microphone with the built-in **Mic Tester** and complete the **Consent Confirmation**.
4. Click **Start Session** and begin speaking.
5. Monitor real-time delivery gauges (WPM, pause frequency, filler count) and the 3D FFT audio sphere.
6. Click **End Session** to view your summary, transcript, and AI coaching notes.

### Workflow B: Running a Competition Round
1. Go to **`/admin`** (or create an event via `POST /api/events`).
2. Attach a judging rubric (e.g. `PUT /api/events/:id/rubric {"preset":"debate"}`).
3. Create rounds and register participants.
4. Record or simulate sessions attached to the event.
5. Navigate to **`/judge?session=<id>`** to review automated AI rubric scores, inspect evidence quotes, and apply score overrides if necessary.
6. Check **`/review?session=<id>`** to inspect source-matching similarity and integrity signals.
7. Return to **`/admin`** to inspect multi-judge consensus spreads, execute tie-breaking, and publish the final leaderboard.

### Workflow C: Coaching & Sparring Drills
1. Open **`/coach`** with a completed session ID.
2. Generate an Action Plan—the coach automatically identifies weaknesses verbatim from the judge's score sheet.
3. Choose a Coach Persona (*Debate Coach*, *Strict*, *Supportive*, etc.).
4. Launch an adaptive drill (e.g. *Rebuttal Sprint* or *POI Gauntlet*).
5. Spar against the **AI Opponent**, exchanging arguments with dynamic responses.
6. Complete the drill to receive feedback, scores, and track your longitudinal progress over time.

---

## Testing & Quality Assurance

ShadowADJ includes a comprehensive unit and integration test suite (150+ tests) verifying domain constraints, metric calculations, VAD stability, rubric evaluation, integrity risk thresholds, and consensus algorithms.

### Running Tests

```bash
# Run the complete test suite (backend)
npm --workspace backend test

# Run TypeScript typechecks across the project
npm --workspace backend run typecheck
```

### Key Test Guarantees
- **Snapshot Purity Test:** Asserts that real-time speech snapshots never output suspicion, cheat probability, or verdict strings.
- **Multi-Signal Aggregation Test:** Asserts that no single integrity signal can escalate a case to `HIGH` risk on its own.
- **Human Authority Test:** Verifies that automated systems cannot move an integrity case to `confirmed` status without an explicit human reviewer ID.
- **Verbatim Weakness Guarantee:** Asserts that coaching drills strictly target exact quotes from judging evaluations.

---

## Security & Data Integrity

- **Cryptographic Hashing:** Transcripts, metric snapshots, and event timelines are hashed with SHA-256 upon session completion to detect tampering.
- **Session Isolation:** Audio frames and transcript buffers are scoped strictly to the active session lifecycle and flushed on close.
- **Redacted Views:** Participants accessing integrity reports receive a sanitized view that removes internal weighting and other participant identifiers.
- **Audit Logging:** Administrative operations (rubric updates, score overrides, appeal decisions, user registrations) are written to an append-only audit log.

---

## License

This project is licensed under the **MIT License**.

