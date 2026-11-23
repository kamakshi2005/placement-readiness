import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const CATEGORY_LABEL = { technical: 'Technical', project: 'Project', hr: 'HR' };
const SOURCE_LABEL = {
  missing: 'skill gap (missing)',
  partial: 'skill gap (partial)',
  matched: 'resume skill check',
  general: 'general',
  resume: 'your projects',
  hr: 'HR',
};
const STATUS_LABEL = { answered: 'answered', skipped: 'skipped', timed_out: 'time ran out', not_reached: 'not reached' };
const KP_STYLE = { covered: 'text-green-700', partial: 'text-amber-700', missing: 'text-red-700' };
const KP_ICON = { covered: '✓', partial: '½', missing: '✗' };

/** "62" or "62, range 58–66" — a range, not ±, because 2–3 runs can't support a ± statistic */
function ScoreText({ e }) {
  return (
    <span>
      <span className="text-2xl font-semibold text-slate-900">{e.score}</span>
      {e.scoreMax > e.scoreMin && (
        <span className="text-sm text-slate-500">
          , range {e.scoreMin}–{e.scoreMax}
        </span>
      )}
    </span>
  );
}

/**
 * The answer with evidence highlighted: green = earned a key point, amber = partly earned it,
 * red = a statement the examiners agreed is wrong. Hover shows why.
 */
function HighlightedAnswer({ text, keyPoints, errors }) {
  const spans = [
    ...errors.map((e) => ({ start: e.start, end: e.end, kind: 'error', note: `Incorrect: ${e.explanation}` })),
    ...keyPoints.flatMap((k) =>
      k.evidence.map((s) => ({ start: s.start, end: s.end, kind: k.label, note: `Key point (${k.label}): ${k.text}` }))
    ),
  ];
  if (!spans.length) return <span>{text}</span>;

  // Cut the text at every span boundary; each piece takes the most important span covering it
  // (error > covered > partial), and its tooltip lists all notes for that piece.
  const priority = { error: 3, covered: 2, partial: 1 };
  const cuts = [...new Set([0, text.length, ...spans.flatMap((s) => [s.start, s.end])])].sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const covering = spans.filter((s) => s.start <= a && s.end >= b);
    const top = covering.sort((x, y) => priority[y.kind] - priority[x.kind])[0];
    pieces.push({ text: text.slice(a, b), kind: top?.kind, note: [...new Set(covering.map((s) => s.note))].join('\n') });
  }
  const style = {
    error: 'bg-red-100 decoration-red-500 underline decoration-wavy',
    covered: 'bg-green-100',
    partial: 'bg-amber-100',
  };
  return pieces.map((p, i) =>
    p.kind ? (
      <mark key={i} title={p.note} className={`rounded-sm text-inherit ${style[p.kind]}`}>
        {p.text}
      </mark>
    ) : (
      <span key={i}>{p.text}</span>
    )
  );
}

/** A 0–4 (or 0–1) dimension as a bar, with the runs' min–max shown as a thin band */
function DimBar({ label, d, max }) {
  if (!d) return null;
  const pct = (x) => `${(x / max) * 100}%`;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-slate-600">{label}</span>
      <div className="relative h-2 flex-1 rounded bg-slate-100">
        <div className="absolute inset-y-0 left-0 rounded bg-slate-600" style={{ width: pct(d.value) }} />
        {d.max > d.min && (
          <div
            className="absolute -inset-y-0.5 rounded border border-slate-400"
            style={{ left: pct(d.min), width: `calc(${pct(d.max)} - ${pct(d.min)})` }}
            title={`runs ranged ${d.min}–${d.max}`}
          />
        )}
      </div>
      <span className="w-12 shrink-0 text-right tabular-nums text-slate-700">
        {max === 1 ? `${Math.round(d.value * 100)}%` : `${d.value}/4`}
      </span>
    </div>
  );
}

function ModelAnswer({ sessionId, index, alreadyShown }) {
  const [ref, setRef] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    if (!open && !ref) {
      try {
        const d = await api(`/interviews/${sessionId}/answers/${index}/reference`, { method: 'POST' });
        setRef(d.reference);
      } catch (e) {
        return setError(e.message);
      }
    }
    setOpen((o) => !o);
  }

  return (
    <div className="mt-3">
      <button onClick={toggle} className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline">
        {open ? '▾ Hide model answer' : '▸ Show model answer'}
      </button>
      {!open && !alreadyShown && (
        <span className="ml-2 text-xs text-slate-400">(viewing it is recorded, so later practice can account for it)</span>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {open && ref && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <p className="whitespace-pre-line">{ref.answer}</p>
        </div>
      )}
    </div>
  );
}

function AnswerCard({ sessionId, it }) {
  const e = it.evaluation;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-slate-700">
          Q{it.index + 1} · {CATEGORY_LABEL[it.category]}
        </span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">{it.difficulty}</span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">{SOURCE_LABEL[it.skillSource]}</span>
        {it.skills.map((s) => (
          <span key={s} className="rounded bg-blue-50 px-2 py-0.5 text-blue-700">{s}</span>
        ))}
      </div>
      <p className="mt-2 text-slate-900">{it.text}</p>

      <div className="mt-3 flex flex-wrap items-baseline gap-3">
        {e ? <ScoreText e={e} /> : <span className="text-sm text-slate-400">Scoring…</span>}
        {it.answer && it.answer.status !== 'answered' && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{STATUS_LABEL[it.answer.status]}</span>
        )}
        {e?.uncertain && (
          <span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800" title={e.uncertainReasons.join('\n')}>
            uncertain score
          </span>
        )}
      </div>
      {e?.uncertain && <p className="mt-1 text-xs text-purple-800">{e.uncertainReasons.join(' ')}</p>}
      {e?.method === 'auto' && <p className="mt-1 text-xs text-slate-500">Scored 0 automatically ({e.autoReason}).</p>}

      {it.answer?.text?.trim() && (
        <div className="mt-3 whitespace-pre-line rounded-md bg-slate-50 p-3 text-sm leading-relaxed text-slate-800">
          {e?.method === 'llm' ? <HighlightedAnswer text={it.answer.text} keyPoints={e.keyPoints} errors={e.errors} /> : it.answer.text}
        </div>
      )}

      {e?.method === 'llm' && (
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Key points</p>
            <ul className="mt-2 space-y-1 text-sm">
              {e.keyPoints.map((k) => (
                <li key={k.id} className="flex gap-2">
                  <span className={`w-4 shrink-0 font-semibold ${KP_STYLE[k.label]}`} title={k.label}>{KP_ICON[k.label]}</span>
                  <span className="text-slate-700">
                    {k.text}
                    {k.unresolved && <span className="ml-1 text-xs text-purple-700">(examiners split)</span>}
                  </span>
                </li>
              ))}
            </ul>
            {e.errors.length > 0 && (
              <>
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Incorrect statements</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-red-800">
                  {e.errors.map((x, i) => (
                    <li key={i}>
                      "{x.text}" — {x.explanation}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Rubric</p>
            <DimBar label="Coverage (40%)" d={e.dimensions.coverage} max={1} />
            <DimBar label="Correctness (30%)" d={e.dimensions.correctness} max={4} />
            <DimBar label="Depth (20%)" d={e.dimensions.depth} max={4} />
            <DimBar label="Clarity (10%)" d={e.dimensions.clarity} max={4} />
            <p className="pt-1 text-xs text-slate-400">
              Scored {e.runs.length}× independently ({e.runs.map((r) => `${r.variant}: ${r.overall}`).join(', ')}).
              {e.refSimilarity != null && ` Similarity to model answer: ${e.refSimilarity.toFixed(2)} (not part of the score).`}
            </p>
          </div>
        </div>
      )}

      {e && (e.feedback?.strengths?.length > 0 || e.feedback?.improvements?.length > 0 || e.feedback?.jdGaps?.length > 0) && (
        <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
          {e.feedback.strengths?.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-green-700">Strengths</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-700">
                {e.feedback.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {(e.feedback.improvements?.length > 0 || e.feedback.jdGaps?.length > 0) && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-amber-700">To improve</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-700">
                {e.feedback.improvements?.map((s, i) => <li key={i}>{s}</li>)}
                {e.feedback.jdGaps?.map((s, i) => <li key={`jd${i}`} className="text-slate-600">{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {e && <ModelAnswer sessionId={sessionId} index={it.index} alreadyShown={it.answer?.referenceShown} />}
    </div>
  );
}

export default function InterviewResults({ interview }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // Poll while scoring runs in the background
  useEffect(() => {
    let stop = false;
    let timer;
    const load = async () => {
      try {
        const d = await api(`/interviews/${interview._id}/results`);
        if (stop) return;
        setData(d);
        if (['pending', 'running'].includes(d.scoring.status)) timer = setTimeout(load, 3000);
        // waiting for the daily AI quota: the server retries every 15 min, so check back slowly
        else if (d.scoring.status === 'waiting_quota') timer = setTimeout(load, 60000);
      } catch (e) {
        if (!stop) setError(e.message);
      }
    };
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [interview._id]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading results…</p>;

  const busy = ['pending', 'running'].includes(data.scoring.status);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          Interview {interview.status === 'abandoned' ? 'abandoned' : 'complete'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Attempt {interview.attemptNumber} · {interview.mode === 'gap' ? 'gap-focused' : interview.mode} · {interview.total} questions
        </p>

        {busy && (
          <div className="mt-4" role="status" aria-live="polite">
            <p className="text-sm text-slate-700">
              Scoring your answers… {data.scoring.done ?? 0} of {data.scoring.total ?? '?'} done
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-200">
              <div className="h-full rounded bg-slate-700 transition-all" style={{ width: `${((data.scoring.done || 0) / (data.scoring.total || 1)) * 100}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Each answer is scored 2–3 times independently to check how certain the score is. This usually takes 1–3 minutes; you can leave and come back.
            </p>
          </div>
        )}
        {data.scoring.status === 'waiting_quota' && (
          <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="status">
            {data.scoring.error} Your answers are saved; you can leave this page.
          </p>
        )}
        {data.scoring.status === 'failed' && (
          <p className="mt-3 text-sm text-red-600">Some answers could not be scored: {data.scoring.error}</p>
        )}
        {data.scoring.status === 'none' && <p className="mt-3 text-sm text-slate-500">This interview has not been scored.</p>}

        {data.overall != null && !busy && (
          <div className="mt-4 flex flex-wrap items-end gap-6">
            <div>
              <p className="text-sm text-slate-500">Overall</p>
              <p className="text-4xl font-semibold text-slate-900">{data.overall}</p>
            </div>
            {data.skills.length > 0 && (
              <table className="text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="pr-6 font-medium">Skill</th>
                    <th className="pr-6 font-medium">Score</th>
                    <th className="font-medium">Questions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.skills.map((s) => (
                    <tr key={s.skill}>
                      <td className="pr-6 text-slate-800">{s.skill}</td>
                      <td className="pr-6 tabular-nums text-slate-800">
                        {s.score}
                        {s.uncertain && <span className="ml-1 text-xs text-purple-700">uncertain</span>}
                      </td>
                      <td className="tabular-nums text-slate-600">{s.questions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {!busy && data.overall != null && (
          <p className="mt-3 text-xs text-slate-500">
            Highlights in your answers: <mark className="bg-green-100">green</mark> earned a key point,{' '}
            <mark className="bg-amber-100">amber</mark> partly, <mark className="bg-red-100">red</mark> was judged incorrect. Hover for details.
          </p>
        )}
      </div>

      {data.items.map((it) => (
        <AnswerCard key={it.index} sessionId={interview._id} it={it} />
      ))}
    </div>
  );
}
