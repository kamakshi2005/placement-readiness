# CLAUDE.md — Adaptive Interview-Prep Engine

## About this project
A serious standalone project by Kamakshi (not a college submission, not a quick portfolio piece).

**Goal:** an adaptive, statistically grounded interview-prep engine. A job description's skill gaps drive
the questions; every score is explained with evidence from the answer and comes with a measure of how
certain it is; skill mastery is tracked probabilistically; and the engine picks the most informative next
question until each skill is mastered.

**Positioning:** resume–JD matching and plain AI mock interviews already exist (Prepto and others), so they
are not the contribution. The contribution is the measurement layer: evidence-grounded, uncertainty-aware
scoring → Bayesian per-skill mastery → adaptive item selection, with a simulation study showing whether
the adaptive approach beats fixed interviews.

## How to work with me
- Go **step by step** and **confirm with me before each new phase or module**; show a plan first for anything non-trivial.
- Explain what you're doing briefly, in plain words. I want to understand every part of the code.
- Give honest feedback: flag drawbacks, risks and mistakes, not just positives.
- Prefer complete, working files over partial snippets.
- Don't add features outside the roadmap without asking.
- I'm on Windows (PowerShell / VS Code terminal).

## Tech stack
- **Client:** React 18 (Vite), Tailwind CSS 3, React Router 6, Recharts (charts)
- **Server:** Node.js, Express 4 (ES modules), Mongoose 8, MongoDB Atlas
- **Auth:** JWT + bcryptjs, roles: `student`, `admin`
- **AI:** Gemini API (free tier): generation + embeddings. All provider calls go through ONE service (`server/src/services/llm.js`) so the provider can be swapped.
- **Resume parsing:** Multer + pdf-parse
- **Deploy (Phase 6):** Vercel (client), Render (server)
- API keys stay on the server only. Never call the LLM from the client.

## Roadmap
- **Phase 0**: one-question-per-prompt fix; commit + push Module 3. ✅
- **Phase 1**: Module 4 scoring: rubric scores, **evidence highlighting** (exact spans in the answer that earned or lost marks), **confidence-aware scoring** (score each answer several times, measure agreement, flag uncertain scores).
- **Phase 2**: **Bayesian Knowledge Tracing** per skill: mastery probability with uncertainty.
- **Phase 3**: adaptive engine: item difficulty (IRT-style) + choosing the most informative next question; practice-until-mastered loop.
- **Phase 4**: follow-up questions during the interview.
- **Phase 5**: simulation study with synthetic students of known true skill, comparing adaptive vs fixed interviews.
- **Phase 6**: tests, CI, job queue for AI calls, deploy, README, demo.
- **Stretch:** voice mode.

**Out of scope, do not build:** proctoring (tab-switch / webcam), coding sandbox / code execution,
aptitude test bank, resume builder, emotion/facial analysis, video analysis, group discussion, chatbot,
multilingual interviews.

**Dropped:** the classmate A/B study (groups, phases, consent, 8-pair matcher eval set). Its fields and
code stay (`User.studyGroup`, `InterviewSession.phase`/`studyGroup`, `/api/admin/users`,
`server/eval/` matcher tooling), but **don't build on them**. The study-group admin UI is hidden.

## Current status
- ✅ Scaffold: `server/` (Express, `/api/health`) and `client/` (Vite + Tailwind, `/api` proxied to port 5000). Setup check at `/setup`.
- ✅ MongoDB Atlas: own project `placement-readiness`, M0 cluster, database `placement-readiness`. Free clusters auto-pause when inactive; check Atlas before demos.
- ✅ Module 1, auth: `User` model (bcryptjs hash), `/api/auth/signup|login|me`, `protect` + `requireRole` middleware, `npm run seed:admin` (signup always creates `student`). Client: AuthContext (JWT in localStorage), ProtectedRoute, Login/Signup/Dashboard.
- ✅ Module 2, resume & JD analysis: PDF (multer memory, 2 MB, `%PDF-` check) → pdf-parse v2 → `normalizeText` → regex PII redaction (email/phone/URL + user's name) → Gemini skill extraction (temp 0, structured JSON) → matcher: exact/alias map → embedding cosine with two thresholds (≥ high matched, < low missing, between → one batched LLM judge: yes/partial/no + reason) → weighted score (required ×2, partial ½). `LlmCache` (SHA-256 of kind+model+prompt version+text) for extraction, embeddings and judge verdicts. Each `Analysis` stores models, embed dims, prompt version, thresholds, weights. Routes `/api/analysis`. Client: `/analyze`, `/analysis/:id` (per-skill "why"), list on dashboard.
  - Models (Oct 2026): `gemini-2.5-flash` is closed to new keys → default `gemini-3.5-flash`. `gemini-embedding-001` (batched); `gemini-embedding-2` needs one request per text (handled in `llm.js`).
  - Matcher thresholds 0.95/0.80 are provisional (the planned labelled eval set was dropped with the study; `eval:matcher` tooling still works if labelled pairs are added).
- ✅ Module 3, interview engine:
  - Plan built **in code** (`services/interviewPlanner.js`): gap mode = ceil(60%) of technical slots from gaps (missing-required > partial-required > missing-nice > partial-nice), the rest from matched-required; general mode = random JD skills. Difficulty from source (missing easy, partial/matched/general medium; `config/interview.js`). Presets `standard` 5/2/1, `study` 4/1/1 (shown as "Short"); times 180/180/120 s, grace 10 s.
  - One LLM call writes all questions + reference answers + keyPoints (`services/questionGenerator.js`, prompt `q2`, temp 0.7, not cached, earlier questions passed as "don't repeat"). Multi-part questions are detected (`isMultiPart`) and rewritten in one repair call. References are stored server-side only (`select:false`, never in responses).
  - `InterviewSession` (phase/mode, attemptNumber, unique one-in-progress-per-user index) + `Answer` (one doc per question; status answered/skipped/timed_out/not_reached; copies skills, difficulty, attempt).
  - Phase rule (legacy, from the study): the first completed interview on an analysis is `baseline` (gap mode), later ones `practice` with mode chosen by the student.
  - The server enforces the timer (refresh doesn't reset it; expired questions are auto-recorded as timed_out). Routes `/api/interviews` (start, list, get, `/current`, `/answer`, `/abandon`). Client: start box on the analysis page, `/interview/:id` (live + summary), interviews on the dashboard.
- ✅ Git: `main` on https://github.com/kamakshi2005/placement-readiness (private).
- ✅ Phase 1, scoring (`server/src/services/scoring/`, settings in `config/scoring.js`, prompt `s1`):
  - Rubric: coverage 40% (computed in code from key-point labels: covered 1 / partial ½ / missing 0), correctness 30%, depth 20%, clarity 10% (grammar inside clarity); 0–4 anchored levels; HR questions get HR readings of the same dimensions.
  - Runs: 2 independent runs (rubric wordings A + B, different output-field order; B/C use a seeded shuffle of the key-point order), a 3rd (C) only if the first two disagree (score gap > 10 or any key-point label differs); temp 0.5; variant + kpOrder stored per run. Aggregation: median label/dimension; error accepted if quoted by a majority of runs; score from the aggregated components; **range** = min–max of the runs (shown as "62, range 58–66", never ±); uncertain if range > 15 or a key point has no majority.
  - Evidence: AI quotes are verified against the answer (exact → normalized → fuzzy word-overlap ≥ 0.8); unverifiable quotes are dropped and counted. Spans stored as character offsets.
  - Skipped / not reached / empty → 0 without an AI call; timed-out answers with text are scored normally and flagged `timedOut`. Reference similarity (embedding cosine) is stored but NOT in the score.
  - `AnswerEvaluation` (versioned per answer; `errorSpans`, because `errors` is reserved in Mongoose) + score fields on `Answer`; key points stored as `{id, text}` on each question. Background scoring after completion/abandon (in-process, concurrency 3, `session.scoring` progress, resumes on restart).
  - `referenceShown`/`referenceShownAt` on `Answer` (set when the student opens the model answer, via `POST /api/interviews/:id/answers/:index/reference`); `resultsViewedAt` on the session (results list the key points, which reveals the gist of the answers too).
  - Client: results view with progress, highlighted evidence (green/amber/red with hover reasons), key-point checklist, rubric bars with run ranges, feedback, collapsed model answer, per-skill table.
  - Validation: `npm run eval:scorer` (known-quality AI-written answers: full / half / withError / vague / injection + test–retest), `npm run eval:label-sheet` + `npm run eval:human` (hand labels incl. whether the reference and each key point are correct), `npm run rescore -- <sessionId>`. Unit tests: `npm test` (`node:test`).
- ✅ AI models, quota and record/replay (`config/models.js`, `services/llm.js`, `services/aiQuota.js`, `services/llmRecorder.js`):
  - **Free-tier limits (this key, Nov 2026):** gemini-3.5-flash (served as 3.6) and 3.8-flash: 5 RPM / **20 RPD**; gemini-3.5-flash-lite and 3.1-flash-lite: 15 RPM / 500 RPD; embeddings: 100 RPM / 1K RPD. Days reset at midnight Pacific.
  - Every call names a **task**: `extraction` + `questions` → gemini-3.5-flash (fallback 3.8-flash, one at a time); `judge` → 3.5-flash-lite; scoring `score_a` → **3.5-flash-lite**, `score_b` → **3.1-flash-lite**, `score_c` → 3.5-flash-lite (fallback = the other lite model); `eval` → lite. Override per task with `GEMINI_MODEL_<TASK>`.
  - `llm.js`: per-model pacing (concurrency + requests/minute), 429 classification (daily vs per-minute, from Google's QuotaFailure details), fallback chain, `generateJSON({ task, … })` returns `{ data, meta: { model, modelVersion, fallbackFrom } }`. The real model version is stored everywhere (scoring runs, `Analysis.config.modelVersions`, `session.config.questionModelVersion`, judge verdicts, `LlmCache.meta`).
  - Daily usage counter in MongoDB (`ModelUsage`, per model per Pacific day; `exhausted` when Google says so). Scoring checks quota first and sets `scoring.status = waiting_quota` with a message instead of failing mid-way; a 15-min timer resumes waiting sessions. Admin page shows today's usage.
  - `LLM_MODE=live|record|replay`: the app defaults to live; **scripts default to replay** (`--live` / `--record` to call the API); `npm test` replays fixtures from `test/fixtures/llm/` (validation fixtures in `eval/scorer/fixtures/`). Never record with real personal data: fixtures contain full prompts.
- ⏭️ Next: Phase 2 (Bayesian Knowledge Tracing) plan. Pending for Kamakshi: ~20 hand-labelled real answers.

## Known limitations (be honest about these)
- Years of experience and seniority are not considered; soft skills are excluded from matching.
- Temperature 0 is NOT deterministic on Gemini (observed: the same JD extracted twice gave different skill lists, score 57 vs 58). Repeatability comes from the cache, not the temperature.
- Embeddings measure topical relatedness, not "skill A satisfies requirement B": with `gemini-embedding-001` unrelated skills score 0.81–0.95 (Java~JavaScript 0.898 > Git~version control 0.875), so most non-exact pairs go to the LLM judge.
- The judge sees only the two skill names, not the resume context.
- Redaction is regex-based (unusual phone/email formats can slip through); name parts < 3 letters are not removed. Resume text still goes to Google (the free tier may use data).
- Free-tier latency: first analysis ~30–100 s, question generation ~15–90 s, 503 "high demand" errors happen; cached repeats ~2 s. AI calls run inside the HTTP request until Phase 6 adds a job queue.
- The server exits if MongoDB is unreachable at startup (a network blip needs a restart).
- Interview questions are LLM-written: quality/difficulty vary between calls. Two-part questions are caught by a heuristic (`isMultiPart`), which can miss some or over-flag some.
- Questions are generated up front; no follow-ups based on answers until Phase 4.
- Unit + replay tests exist (`npm test`, no quota used); no CI yet (Phase 6).
- Free tier: flash is limited to 20 requests/day, so about one new analysis + interview per day; scoring runs on lite models (500/day each). Pacing is per server process: two processes (e.g. the server + an eval script) can together exceed requests/minute; 429 retries cover this.
- Scoring uses lite models, which may judge less accurately than flash; `eval:scorer` measures this.
- Google serves `gemini-3.5-flash` as 3.6, so the requested model name ≠ the model that answered; the actual `modelVersion` is stored with every result.
- Phase 5's simulation will use synthetic response outcomes from known student skill levels, not LLM calls.

## Run
```
cd server; npm install; copy .env.example .env; npm run dev   # http://localhost:5000
cd client; npm install; npm run dev                          # http://localhost:5173
```
