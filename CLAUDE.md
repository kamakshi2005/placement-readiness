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
**Phase workflow (from 2026-11-28):**
1. For each phase, write the plan (in `docs/plans/`) and **STOP for approval**. Kamakshi reviews plans with another assistant.
2. Once a plan is approved, **build, test, fix and commit the whole phase without asking** about routine decisions. When a design choice comes up, pick the recommended option and record it in the **Decision log** at the end of this file (date, decision, options, why).
3. **Only stop and ask** if something:
   - costs money (billing, paid APIs),
   - deletes or overwrites real data,
   - changes the approved scope or roadmap,
   - would use more than ~50 % of any model's daily quota in one go,
   - makes the repo public or shares data outside the project.
4. At the end of each phase, give **one report**: what was built, test/validation numbers, decisions made (from the log), weak spots, and anything for Kamakshi to decide.

**Always:**
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
- ✅ Phase 1, scoring (`server/src/services/scoring/`, settings in `config/scoring.js`, prompt **`s2`**):
  - `s2` (after `s1` validation): the scoring instruction is repeated AFTER the candidate's answer; a contradicted key point earns no credit (missing + error); `scoring/manipulation.js` detects text addressed to the examiner → `manipulationFlags`, score marked uncertain with the reason.
  - **Validation, s2** (`eval/scorer/results/scorer-2026-11-23-09-28.json`, 28 answers / 4 questions, live on lite models): mean score full 98, withError 80, half 76, ambiguous 89, halfInjection 74, vague 14, injection 11; Spearman vs expected quality 0.89 (ref-similarity 0.80); key points P 0.955 / R 1.00; inserted errors 4/4, no false errors on full answers; quotes 156/156 verified; manipulation: injection − vague ≤ 0 on all 4 questions (s1: +21 once), halfInjection − half ≤ 0, code check flagged 8/8 with 0 false flags; test–retest sd 1.6 and 0.0. **Uncertain flag (disagreement) fired on only 1/4 ambiguous answers**, although ambiguous answers triggered a 3rd run 3/4 times: the flag thresholds (range > 15, no-majority) look conservative but the sample is too small to tune; revisit with hand-labelled real answers.
  - **Continuous confidence** per answer (`AnswerEvaluation.confidence`, copied to `Answer.scoreConfidence`): from runs A/B before any tie-break: `abSpread` (points), `kpDisagreementAB` (share of key points labelled differently), `thirdRun`, `value` = 1 − ½·min(abSpread/40, 1) − ½·kpDisagreementAB (provisional weights; auto scores = 1). The boolean `uncertain` flag is unchanged. Validation (replay): mean confidence full 0.97, withError 0.95, half 0.95, halfInjection 0.90, vague 0.89, injection 0.88, **ambiguous 0.79**, so it separates ambiguous answers where the flag (1/4) didn't. The ranking metric (Spearman) uses only the originally ranked types (full, withError, half, vague, injection): **0.935**.
  - Rubric: coverage 40% (computed in code from key-point labels: covered 1 / partial ½ / missing 0), correctness 30%, depth 20%, clarity 10% (grammar inside clarity); 0–4 anchored levels; HR questions get HR readings of the same dimensions.
  - Runs: 2 independent runs (rubric wordings A + B, different output-field order; B/C use a seeded shuffle of the key-point order), a 3rd (C) only if the first two disagree (score gap > 10 or any key-point label differs); temp 0.5; variant + kpOrder stored per run. Aggregation: median label/dimension; error accepted if quoted by a majority of runs; score from the aggregated components; **range** = min–max of the runs (shown as "62, range 58–66", never ±); uncertain if range > 15 or a key point has no majority.
  - Evidence: AI quotes are verified against the answer (exact → normalized → fuzzy word-overlap ≥ 0.8); unverifiable quotes are dropped and counted. Spans stored as character offsets.
  - Skipped / not reached / empty → 0 without an AI call; timed-out answers with text are scored normally and flagged `timedOut`. Reference similarity (embedding cosine) is stored but NOT in the score.
  - `AnswerEvaluation` (versioned per answer; `errorSpans`, because `errors` is reserved in Mongoose) + score fields on `Answer`; key points stored as `{id, text}` on each question. Background scoring after completion/abandon (in-process, concurrency 3, `session.scoring` progress, resumes on restart).
  - `referenceShown`/`referenceShownAt` on `Answer` (set when the student opens the model answer, via `POST /api/interviews/:id/answers/:index/reference`); `resultsViewedAt` on the session (results list the key points, which reveals the gist of the answers too).
  - Client: results view with progress, highlighted evidence (green/amber/red with hover reasons), key-point checklist, rubric bars with run ranges, feedback, collapsed model answer, per-skill table.
  - Validation: `npm run eval:scorer` (known-quality AI-written answers: full / half / withError / ambiguous / vague, plus the permanent manipulation regression types injection and halfInjection, + test–retest; answer set `eval/scorer/answers-2026-11-23-09-28.json`, replay fixtures in `eval/scorer/fixtures/`), `npm run eval:label-sheet` + `npm run eval:human` (hand labels incl. whether the reference and each key point are correct), `npm run rescore -- <sessionId>`. Unit tests: `npm test` (`node:test`).
- ✅ AI models, quota and record/replay (`config/models.js`, `services/llm.js`, `services/aiQuota.js`, `services/llmRecorder.js`):
  - **Free-tier limits (this key, Nov 2026):** gemini-3.5-flash (served as 3.6) and 3.8-flash: 5 RPM / **20 RPD**; gemini-3.5-flash-lite and 3.1-flash-lite: 15 RPM / 500 RPD; embeddings: 100 RPM / 1K RPD. Days reset at midnight Pacific.
  - Every call names a **task**: `extraction` + `questions` → gemini-3.5-flash (fallback 3.8-flash, one at a time); `judge` → 3.5-flash-lite; scoring `score_a` → **3.5-flash-lite**, `score_b` → **3.1-flash-lite**, `score_c` → 3.5-flash-lite (fallback = the other lite model); `eval` → lite. Override per task with `GEMINI_MODEL_<TASK>`.
  - `llm.js`: per-model pacing (concurrency + requests/minute), 429 classification (daily vs per-minute, from Google's QuotaFailure details), fallback chain, `generateJSON({ task, … })` returns `{ data, meta: { model, modelVersion, fallbackFrom } }`. The real model version is stored everywhere (scoring runs, `Analysis.config.modelVersions`, `session.config.questionModelVersion`, judge verdicts, `LlmCache.meta`).
  - Daily usage counter in MongoDB (`ModelUsage`, per model per Pacific day; `exhausted` when Google says so). Scoring checks quota first and sets `scoring.status = waiting_quota` with a message instead of failing mid-way; a 15-min timer resumes waiting sessions. Admin page shows today's usage.
  - `LLM_MODE=live|record|replay`: the app defaults to live; **scripts default to replay** (`--live` / `--record` to call the API); `npm test` replays fixtures from `test/fixtures/llm/` (validation fixtures in `eval/scorer/fixtures/`). Never record with real personal data: fixtures contain full prompts.
- ✅ Phase 2, Bayesian Knowledge Tracing (`services/mastery/`, settings in `config/mastery.js`, all provisional):
  - Per student per **canonical** skill (Module 2 alias map + normalisation: "Node", "NodeJS", "Node.js" are one skill). State = P(mastered). Priors from the most recent analysis listing the skill: missing 0.15 / partial 0.35 / matched 0.60 / unknown 0.30.
  - **Continuous evidence** (main): score/100 under two one-sided Beta curves mixed with a **15 % uniform part** (cautious; 5 % vs 15 % compared by simulation): mastered Beta(a, 1) rising towards 100, not mastered Beta(1, b) falling from 0; a, b fitted so P(score < 60 | mastered) = slip 0.10 and P(score ≥ 60 | not mastered) = guess 0.20 (with these: Beta(8.7, 1) / Beta(1, 1.97)). One-sided shapes guarantee a higher score is never weaker evidence (a hump-shaped curve made 100 weaker than 90). Likelihood ratio per answer ranges from ~0.08 (score 0) to ~34 (score 100); scores clamped to 2–98. The uniform part sets floors: slip ≥ eps·cut = 0.09, guess ≥ eps·(1 − cut) = 0.06, so slip 0.10 sits just above its floor. **Threshold** baseline (score ≥ 60 = correct, textbook BKT) is computed alongside (`pThreshold`).
  - Tempered Bayes update P ∝ P·L^w with weight w = scoring confidence × ½ for 2-skill questions × ½ for skipped (score 0) × ½ for a near-duplicate of a question already seen. Not reached = no evidence; HR = no skill. Learn 0.10 applied only between interviews, when the previous interview testing the skill had its results viewed; forget 0.
  - **Assumption:** answers within one interview are treated as **independent evidence** given the mastery state (and no learning between them, since there is no feedback mid-interview). Two answers on the same skill in one interview therefore both count fully, though in reality they are correlated (same day, same preparation), so mastery may move faster than it should when one interview asks several questions on a skill.
  - "Seen" = earliest of the session's `resultsViewedAt` and the answer's `referenceShownAt`. Near-duplicate = shares a skill AND (same normalised text OR embedding cosine ≥ **0.885**), calibrated by `npm run calibrate:repeats` (`eval/mastery/repeat-pairs.json`): reworded repeats 0.895–0.992 vs different questions on the same skill 0.734–0.873 (28 questions; margin only ~0.02).
  - **Range** = middle 80 % of P over 200 seeded draws of plausible parameters (widened after the first simulation: prior ×0.3–2, learn 0.02–0.2, guess 0.1–0.35, slip 0.05–0.2; draws below the uniform-part floors are raised): parameter uncertainty, not a confidence interval. Status: not yet < 40 % ≤ developing < 95 % ≤ mastered.
  - `SkillMastery` snapshots (recomputed from `Answer` records after every scored interview and on `GET /api/mastery?refresh=1`; includes the per-answer "why" log). Dashboard "Your skills" panel: P, range, threshold tick, evidence count, expandable why.
  - `npm run sim:mastery` (3000 trajectories × 7 scenarios × 8 interviews; same simulated answers for both settings):
    - First run (`sim-2026-11-24.json`, 5 %, narrow ranges): continuous beats threshold everywhere (Brier 0.056 vs 0.073 when assumptions hold); 85/90/95 % all reached after a median of 2 answers; false mastery at 95 % 1–6 % (at 85 % 3–13 %) → **keep 95 %**. Range coverage only 49–55 % when guess/slip or learn fell outside the sampled ranges → ranges widened.
    - Second run (`sim-2026-11-25.json`, widened ranges, 5 % vs 15 %): 15 % costs Brier +0.005–0.009 in scenarios A–E (≈ 8–14 %) and is slightly better when real scores are messier (F: 0.053 vs 0.055); it is under-confident in the middle range when scores are clean (ECE 0.023 vs 0.009: predicted 35 % → 48 % actually mastered); answers to 95 % median 2 → 3 (90th pct 4 → 5); false mastery at 95 % same or lower (1–5 %). Range coverage at 5 %: A 100 %, B 100 % (was 55 %), D 96 %, but C2 (learn 0.03, at the edge of the sampled range) still 56 %; at 15 % 48–96 % (lower in A–E because its curve deliberately differs from the simulated truth; 96 % in F).
  - Labelling sheet has `human_competent` + `model_confidence`; `eval:human` estimates slip/guess and checks whether low confidence goes with bigger disagreement.
- ⏭️ Next: Phase 3 (adaptive engine): plan in `docs/plans/phase-3-adaptive-engine.md`, **awaiting approval**. Pending for Kamakshi: ~20 hand-labelled real answers (now also: competent yes/no).

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
- BKT: the simulation generates students from the same kind of model it tests, so it checks the implementation and sensitivity, not real-student fit. Learn and priors can only be fitted from real multi-interview data. Single answers are still fairly strong evidence (likelihood ratio ~0.08–34 per answer with the 15 % uniform part): one score of 20 moves a 15 % prior to about 2 %. The uncertainty range only reflects the sampled parameter ranges; a true value at the edge of a range (e.g. learn 0.03) is covered only about half the time.
- The near-duplicate cut-off (cosine 0.885) was calibrated on only 28 questions with a margin of ~0.02 between reworded repeats and different questions on the same skill; recalibrate (`npm run calibrate:repeats`, add pairs to `eval/mastery/repeat-pairs.json`) as more questions accumulate. With an embedding model change it must be recalibrated.

## Run
```
cd server; npm install; copy .env.example .env; npm run dev   # http://localhost:5000
cd client; npm install; npm run dev                          # http://localhost:5173
```

## Decision log
Design decisions with their reasons. **K** = decided by Kamakshi, **C** = chosen by Claude under the phase workflow (recommended option). Newest at the bottom.

| Date | Decision | Options considered | Why | By |
|---|---|---|---|---|
| 2026-10-31 | Hybrid skill matcher: exact/alias → embeddings with two thresholds → LLM judge for the borderline band | embeddings only; exact only | Embeddings measure relatedness, not "satisfies the requirement" (Java~JavaScript 0.898) | K |
| 2026-11-23 | Drop the classmate A/B study and proctoring; new Phase 0–6 roadmap | keep the study | Standalone project, measurement layer is the contribution | K |
| 2026-11-23 | Scoring: 2 independent runs, 3rd only on disagreement; range (not ±) shown | fixed 3 or 5 runs | Saves free-tier calls; 2–3 runs can't support a ± statistic | K |
| 2026-11-23 | Runs on DIFFERENT lite models (A 3.5-flash-lite, B 3.1-flash-lite) with different rubric wordings; flash only for extraction + questions | all on flash; billing | Flash is 20 requests/day; different models make disagreement a stronger signal | K |
| 2026-11-23 | Record/replay for AI calls; scripts and tests replay by default | live calls in tests | Tests must not burn the daily quota | K |
| 2026-11-23 | Prompt s2: instruction repeated after the answer + code check for examiner-directed text | prompt-only fix | s1 let a manipulation attempt gain +21 points once | K |
| 2026-11-23 | Contradicted key point = missing + error (in s2) | allow "partial" | Models gave partial credit for a point the answer contradicted | C |
| 2026-11-24 | Continuous scoring confidence stored per answer; boolean flag unchanged | flag only | Flag fired on 1/4 ambiguous answers; continuous value separates them (0.79 vs ≥ 0.88) | K |
| 2026-11-24 | BKT with continuous evidence; threshold BKT as baseline | threshold only | Uses the full score; simulation: Brier 0.056 vs 0.073 | K |
| 2026-11-24 | One-sided Beta curves: mastered Beta(a,1), not mastered Beta(1,b) | hump-shaped Beta (means 0.8 / 0.3); normal curves | Hump shape made a 100 weaker evidence than a 90 (failed unit test); one-sided shapes guarantee higher score ⇒ never weaker evidence | C |
| 2026-11-24 | Near-duplicate cut-off 0.885 (midpoint) and only between questions sharing a skill | 0.895 (best F1 on the sample); compare all questions | 0.895 sat exactly on the lowest repeat (overfit); different-skill pairs reached 0.888 | C |
| 2026-11-24 | Skill display name taken from the JD (analysis) wording | first name seen in a question | Consistent, recognisable names | C |
| 2026-11-25 | Uniform part 15 % (cautious) | 5 % | Brier only +0.005–0.009 when scores are clean, better when messy; Kamakshi prefers caution until real data | K |
| 2026-11-25 | Wider parameter ranges for the mastery range | original ranges | Coverage was 49–55 % when reality fell outside them; B improved to 100 % | K |
| 2026-11-25 | Mastery threshold 95 % | 85 %, 90 % | Same median answers (2–3), false mastery 1–5 % vs 3–13 % at 85 % | K |
| 2026-11-28 | Phase workflow: plan → approval → autonomous build with this log | ask at every step | Saves time; stop only for money, real-data loss, scope, >50 % quota, sharing | K |
