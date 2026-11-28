# Phase 3 plan: adaptive engine

Status: **awaiting approval** (2026-11-28). Approving this plan also approves the defaults in
section 10; anything listed there can be changed before the build starts.

## 1. Goal (in plain words)
Today an interview is **fixed**: all questions are written up front and every skill is treated the
same. The adaptive engine works **one question at a time**:

1. look at what we currently believe about each skill (Phase 2's P(mastered));
2. pick the question that teaches us — or the student — the most right now: which skill, how hard;
3. score it, update mastery, repeat;
4. stop a skill once it is mastered; stop the session when the target skills are done or a limit
   is reached.

The fixed interview (Module 3) stays unchanged; it is also the "fixed" baseline for Phase 5.

## 2. Context and constraints
- Phase 2 mastery: P(mastered) per canonical skill, continuous evidence with one-sided Beta score
  curves (15 % uniform part), guess 0.20 / slip 0.10, learn 0.10 between viewed interviews, 95 %
  mastery threshold.
- Free-tier quota: flash (question writing) **20 requests/day**; lite (scoring) 500/day per model;
  embeddings 1000/day. One flash call per question is therefore impossible.
- Scoring an answer takes 2–3 lite calls (~5–20 s).
- Essentially one user: no data from many students per question.

## 3. Item difficulty ("IRT-style")
Real IRT estimates each question's difficulty from **many students' answers to that question**.
There are none, so full IRT now would be pretending.

**Approach: difficulty-aware BKT** (known in the literature as KT-IDEM: guess/slip depend on the
item). The question's difficulty level changes how a score is read:

| Level | guess: P(score ≥ 60 \| not mastered) | slip: P(score < 60 \| mastered) | Meaning |
|---|---|---|---|
| easy | 0.35 | 0.10 | a good score proves little; a bad one is telling |
| medium | 0.20 | 0.10 | today's values, unchanged |
| hard | 0.08 | 0.25 | a good score is strong proof; a bad one is forgivable |

The 15 % uniform part sets floors (slip ≥ 0.09, guess ≥ 0.06), so "easy" mainly raises guess and
"hard" mainly raises slip. Each level keeps its own fitted one-sided Beta curves, so a higher score
is still never weaker evidence (unit-tested).

**Per-item calibration:** every answer is stored against its item. Once an item has ≥ 10 answers,
an item-specific adjustment of guess/slip is estimated and **shrunk towards its level's values**.
With one user this rarely triggers; it is built now and exercised in the simulation.

Risk: the generator's difficulty labels may be wrong (an "easy" Docker question we saw was really a
comparison question). Average scores per level are reported so mislabelling becomes visible.

## 4. Choosing the next question
For each candidate (skill × difficulty), compute the **expected information gain**: the expected
reduction in uncertainty (entropy) about the skill's mastery state, averaged over all possible
scores (0–100 in steps of 2, weighted by the predicted score distribution, with the expected
scoring confidence as the evidence weight). Pure maths, no AI.

- P ≈ 50 % → a medium question is most informative; P ≈ 85 % → a hard one; P near 0 or 1 → almost
  nothing to learn, the skill is skipped.
- Multiplied by **JD importance** (required ×2, nice-to-have ×1).
- Constraints: **≤ 4 questions per skill per session** (the independence assumption weakens with many
  same-skill answers); no item the student has already answered; no near-duplicate of a question
  whose answer the student has seen (Phase 2 rule).
- Every pick stores and shows its reason, e.g. *"Docker: 48 % likely mastered, the most uncertain
  required skill; a medium question tells us the most right now."*

## 5. Two modes
| | Assessment | Practice (default) |
|---|---|---|
| Aim | measure quickly what the student knows | help the student learn |
| Skill choice | highest expected information gain × importance | weakest required skills first (lowest P, not yet mastered) |
| Difficulty | the most informative level | the level whose **predicted P(score ≥ 60) is closest to 70 %** (learning works best at roughly 60–80 % success) |
| Feedback | at the end (like the fixed interview) | **after every answer**: score, highlights, key points, model answer offered |
| Learning between questions | none (no feedback) | yes, `learnPractice` = 0.05 per question after feedback was shown |

Predicted success for a level d: P(score ≥ 60) = P·(1 − slip_d) + (1 − P)·guess_d.

## 6. Question supply: item bank
- One flash call writes a **batch**: up to 3 skills × 3 levels = 9 items, each with a reference
  answer and key points (`{id, text}`), the same single-question rules and multi-part repair as
  Module 3 (prompt `b1`).
- The bank is topped up when a needed (skill, level) has no unused item for the student.
- **Bank items are generic technical questions** (no resume context), so they can be reused across
  students and gather answers for calibration. **Project questions stay per session** and are not
  banked (they use the resume). No HR questions in adaptive mode (no technical skill to trace).
- Items store model + version + prompt version like everything else.

## 7. Data and API
- **`Item`** (new): canonical skill, display name, difficulty level, text, reference answer + key
  points (server-only, `select:false`), model/version/prompt, answer statistics, per-item
  adjustment (when calibrated), `active` flag.
- **`InterviewSession`**: `mode: 'adaptive'`, `goal: 'assess' | 'practice'`, target skills, limits.
  Questions are appended one at a time; each stores `itemId`, the selection reason (information
  gain, predicted success, text) and P(mastered) before it.
- **`Answer`**: `itemId`. In practice mode the answer is scored **immediately** (synchronously,
  progress shown) instead of in the background.
- **Mastery**: evidence uses each item's level (and calibrated adjustment) for guess/slip; practice
  answers apply `learnPractice` before the next answer once feedback was shown.
- **Routes**: `POST /api/interviews` with `mode: 'adaptive'` + `goal`; after each answer the
  response carries the score/feedback (practice) and the next question with its reason, or the end
  of the session. Existing routes keep working for fixed interviews.

## 8. What the student sees
- Start box: "Adaptive practice" (default) or "Adaptive assessment", target skills (defaults: the
  JD's required skills that are not yet mastered).
- Question page: question + "Why this question?" + live mastery bars for the target skills.
- Practice: after submitting, the scored answer (same highlights/key points as Phase 1) and the
  mastery change, then "Next question".
- End: mastery before → after per skill, questions asked, and "study first" nudges.

## 9. Stopping rules
- A skill stops being asked when P ≥ 95 % (mastered).
- After **3 practice answers on a skill with P still < 40 %**, the engine stops asking it this
  session and suggests studying the key points / model answers first.
- A session ends when all target skills are mastered or stopped, after **10 questions**, or when the
  student stops. Every answer is saved as it happens.

## 10. Defaults (approved together with this plan unless changed)
1. Difficulty model: **difficulty-aware BKT** (not full IRT, which would replace Phase 2's model).
2. Guess/slip per level: **easy 0.35/0.10, medium 0.20/0.10, hard 0.08/0.25**.
3. Modes: **both; practice is the default; 70 % target success**.
4. Item bank: **generic shareable technical items; project questions per session; no HR**.
5. Limits: **4 questions per skill per session, 10 per session, study nudge after 3 answers < 40 %**.
6. Per-item calibration: **build now** (≥ 10 answers, shrunk to the level), exercised in the simulation.
7. `learnPractice` **0.05 per question** after feedback (half the between-interview 0.10: one
   question's feedback teaches less than a full results review).

## 11. Testing and validation (acceptance criteria)
- **Unit tests**: information gain is highest near P = 0.5 and ~0 at P = 0 / 1; per-level likelihoods
  keep "higher score ⇒ never weaker evidence"; selection prefers required + uncertain skills and
  respects the per-skill cap, answered-item and near-duplicate rules; practice difficulty hits the
  level closest to 70 %; stopping rules; per-item shrinkage.
- **Simulation** (`npm run sim:adaptive`, no AI, seeded): simulated students with known mastery over
  ~5 skills; compare **information-gain selection** vs **round-robin fixed order** vs **random** on
  (a) questions needed until every skill is correctly classified (mastered ≥ 95 % / not), (b)
  classification accuracy at a fixed budget of 10 and 20 questions, (c) the effect of wrong
  difficulty labels (items labelled one level off). Report whatever comes out — Phase 5 does the
  full adaptive-vs-fixed study.
- **Live end-to-end check**: one practice session of ~6 questions through the API and the browser:
  bank generation, immediate scoring, mastery updates, reasons shown, stop rule.

## 12. Quota budget for building and testing
- Bank generation: ~2–3 flash calls in total (≤ 15 % of the 20/day).
- Live check: ~6 answers × ~2.1 scoring calls ≈ 13 per lite model (< 3 %), plus a few embeddings.
- Everything else (unit tests, simulation) uses no AI calls; new live calls are recorded as fixtures.

## 13. Risks
- Difficulty levels are assumptions until real answers accumulate (slow with one user).
- Information gain is only as good as the model behind it; if the score curves are off, "most
  informative" may not be.
- Many same-skill answers in one session strain the independence assumption; the cap of 4 and the
  feedback-based learning step limit but don't remove this.
- The flash quota limits bank growth (≤ 9 items per call; shared with analyses and fixed
  interviews).
- Immediate scoring makes practice slower per question (5–20 s wait after each answer).

## 14. Out of scope for Phase 3
Follow-up questions within an answer (Phase 4); the full adaptive-vs-fixed simulation study
(Phase 5); a job queue (Phase 6); fitting learn/priors from real data (needs more usage).
