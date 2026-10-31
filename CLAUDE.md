# CLAUDE.md — AI Mock Interview & Placement Readiness Platform

## About this project
MCA final year individual project (Kamakshi, Sathyabama Institute of Science and Technology).
Not a startup or research product — it must be finishable by one person, demo well, and be defensible in a viva.

**Positioning (the actual contribution):** the JD skill gap *drives* the interview questions, every score is *explained*, and weak skills are *retested* to measure per-skill improvement. Resume–JD matching and AI mock interviews by themselves already exist in prior work (Prepto, Kajal et al. 2026, etc.), so never present those as novel.

Full project report (abstract, literature survey, evaluation plan): https://claude.ai/code/artifact/c350d62f-dab0-48a3-9f41-4b2ffa059ffe

## How to work with me
- Go **step by step** and **confirm with me before each new step or module**.
- Explain what you're doing briefly, in plain words — I need to understand the code for my viva.
- Give honest feedback: flag drawbacks, risks and mistakes, not just positives.
- Prefer complete, working files over partial snippets.
- Don't add features outside the scope below without asking.
- I'm on Windows (PowerShell / VS Code terminal).

## Tech stack
- **Client:** React 18 (Vite), Tailwind CSS 3, React Router 6, Recharts (charts)
- **Server:** Node.js, Express 4 (ES modules), Mongoose 8, MongoDB Atlas
- **Auth:** JWT + bcrypt, roles: `student`, `admin`
- **AI:** Gemini API (free tier) — generation + embeddings. Wrap all LLM calls in ONE service (`server/src/services/llm.js`) so the provider can be swapped.
- **Resume parsing:** Multer + pdf-parse
- **Proctoring:** Page Visibility API (tab switch), TensorFlow.js BlazeFace (face presence only)
- **Deploy (later):** Vercel (client), Render (server)
- API keys stay on the server only. Never call the LLM from the client.

## Modules (core scope = 1–7)
1. **Auth & profile** — signup/login (JWT), role-based access.
2. **Resume & JD analysis** — PDF upload → text; JD paste-in; LLM extracts skills; **embedding cosine similarity** → match score + missing skills. (Baseline feature, not the novelty.)
3. **Interview engine** — LLM generates technical / project / HR questions **weighted towards JD skill gaps**; one question at a time, with timer.
4. **Explainable evaluation** — rubric per answer: technical correctness, completeness, clarity, grammar + semantic similarity to an LLM-generated reference answer. Feedback lists strong points, missing points, and the JD requirement not addressed. Tag each answer with the skills it tested.
5. **Adaptive practice & retest** — skills below a threshold become weak skills → targeted practice questions → short retest → store before/after score per skill. **This is the core contribution — build it carefully.**
6. **Proctored mode** — tab-switch/blur detection, webcam face-presence check, violation log attached to session report.
7. **Progress dashboard** — score trend across attempts, per-skill before/after, category breakdown, weakest topics.

**Stretch (only if time allows, ask first):** voice answers (Web Speech API), TPO/admin batch dashboard, low-bandwidth mode.

**Out of scope — do not build:** coding sandbox / code execution, aptitude test bank, resume builder, emotion/facial-expression analysis, video analysis, group discussion, chatbot, multilingual interviews.

## Evaluation plan (design data models to support it)
Small study: ~20 classmates, Group A repeats general mock interviews, Group B uses the adaptive loop. Compare per-skill score change (first interview → final retest). Also check scoring consistency (same answer scored multiple times). So: store every answer, its rubric scores, skill tags, attempt number and timestamps; support exporting results (CSV) later.

## Current status
- ✅ Step 1: scaffold — `server/` (Express, `/api/health`, Mongo connects only if `MONGO_URI` set) and `client/` (Vite + Tailwind setup-check page, `/api` proxied to port 5000).
- ✅ MongoDB Atlas: own project `placement-readiness`, M0 cluster, database `placement-readiness`. Free clusters auto-pause when inactive — check Atlas before demos.
- ✅ Module 1: auth — `User` model (bcryptjs hash), `/api/auth/signup|login|me`, `protect` + `requireRole` middleware, `npm run seed:admin` (signup always creates `student`). Client: AuthContext (JWT in localStorage), ProtectedRoute, Login/Signup/Dashboard/Admin placeholder; setup check moved to `/setup`.
- ✅ Module 2: resume & JD analysis — PDF (multer memory, 2 MB, `%PDF-` check) → pdf-parse v2 → `normalizeText` → regex PII redaction (email/phone/URL + user's name) → Gemini skill extraction (temp 0, structured JSON) → matcher: exact/alias map → embedding cosine with two thresholds (≥ high matched, < low missing, between → one batched LLM judge: yes/partial/no + reason) → weighted score (required ×2, partial ½). `LlmCache` (SHA-256 of kind+model+prompt version+text) for extraction, embeddings and judge verdicts. Each `Analysis` stores models, embed dims, prompt version, thresholds, weights. Routes `/api/analysis` (POST/GET list/GET :id owner-or-admin). Client: `/analyze`, `/analysis/:id` (per-skill "why"), list on dashboard.
  - Models (Oct 2026): `gemini-2.5-flash` is closed to new keys → default `gemini-3.5-flash`. `gemini-embedding-001` (batched). `gemini-embedding-2` needs one request per text (handled in `llm.js`).
  - Thresholds 0.95/0.80 are **provisional**. Evaluation tooling in `server/eval/` (`npm run eval:prepare`, `npm run eval:matcher`): 8 hand-labelled pairs, 6 tune / 2 holdout, threshold sweep → P/R/F1 (strict + lenient), ties broken by 3-class accuracy.
- ⏭️ Next: Kamakshi builds the 8-pair evaluation set → choose thresholds → Module 3 (interview engine).

## Known limitations (state honestly in report/viva)
- Years of experience and seniority are not considered; soft skills are excluded from matching.
- Temperature 0 is NOT deterministic on Gemini (observed: same JD extracted twice gave different skill lists, score 57 vs 58). Repeatability comes from the cache, not the temperature.
- Embeddings measure topical relatedness, not "skill A satisfies requirement B": with `gemini-embedding-001` unrelated skills score 0.81–0.95 (Java~JavaScript 0.898 > Git~version control 0.875), so most non-exact pairs go to the LLM judge.
- The judge sees only the two skill names, not the resume context.
- Matcher evaluation tests the matcher only (fixed skill lists); extraction errors are not measured by it. 8 pairs, single annotator → preliminary.
- Redaction is regex-based (unusual phone/email formats can slip through); name parts < 3 letters are not removed. Resume text still goes to Google (free tier may use data) — tell study participants.
- Free-tier latency: first analysis ~30–100 s, 503 "high demand" errors happen; cached repeats ~2 s. Pre-run demo analyses so they are cached.
- Server exits if MongoDB is unreachable at startup (a network blip needs a restart).

## Run
```
cd server && npm install && copy .env.example .env && npm run dev   # http://localhost:5000
cd client && npm install && npm run dev                             # http://localhost:5173
```
