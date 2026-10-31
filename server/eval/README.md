# Skill matcher evaluation set

Goal: choose the matcher's two thresholds (`MATCH_HIGH`, `MATCH_LOW`) from data, and report
how accurate the matcher is — precision, recall and F1 against **manual labels**.

## Plan: 8 pairs
- **6 `tune` pairs**: used to choose the thresholds.
- **2 `holdout` pairs**: never used for choosing; reported once at the end. This shows whether the
  thresholds generalise, or only fit the 6 tuning pairs.
- Use different roles (backend, frontend, data/ML, full-stack, …) and resumes of different strength,
  so that every label type (present / partial / absent) appears.

## Steps for each pair
1. Save the JD as a `.txt` file, and get the resume as a text-based PDF
   (with the student's permission).
2. From the `server` folder:
   ```
   npm run eval:prepare -- path\to\resume.pdf path\to\jd.txt pair01 tune "Student Full Name"
   ```
   The name is only used for redaction; it is not written to the file.
3. Open `eval/pairs/pair01.json` and replace every `"TODO"` label with **your own** judgement,
   reading the actual resume:
   - `present`: the resume clearly shows this skill (listed, or used in a project).
   - `partial`: a close substitute (e.g. MySQL for PostgreSQL, JavaScript for TypeScript).
   - `absent`: not shown.

   Label from the resume itself. Don't look at what the app says.
4. You may fix obvious extraction mistakes in `resumeSkills` / `jdSkills`. This evaluation tests the
   **matcher**, not the extractor, so the skill lists only need to be sensible inputs.

## Run
```
npm run eval:matcher
npm run eval:matcher -- --embed-model gemini-embedding-2     (compare embedding models)
npm run eval:matcher -- --metric lenient                     (partial counts as a match)
```
The script also compares **three variants** on the same pairs, for tune and holdout:
- **A. exact/alias only**: name matching, no AI.
- **B. embeddings only**: one similarity threshold, no LLM judge.
- **C. hybrid**: rules + embeddings + LLM judge for the borderline band (what the app uses).

This shows what each layer adds, which makes a good report table. Everything is saved to
`eval/results/`: the full sweep (CSV + JSON) and `variants-*.csv`.

## Metrics
- **strict**: positive = labelled `present`; predicted positive = `matched`.
- **lenient**: positive = `present` or `partial`; predicted positive = `matched` or `partial`.
- **3-class accuracy**: exact agreement on present / partial / absent.
- **judge calls**: how many skills needed the LLM judge (= cost and time).

## Limitations (state these in the report)
- 8 pairs is a small, preliminary set, and one person did all the labelling, so there are no
  inter-annotator checks.
- Even with a holdout, 2 pairs give a noisy final number.
- The judge's verdicts are cached, so re-runs are repeatable. A different model or prompt version
  gives new verdicts.
