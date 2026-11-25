import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const STATUS = {
  not_yet: { label: 'not yet', cls: 'bg-red-50 text-red-700' },
  developing: { label: 'developing', cls: 'bg-amber-50 text-amber-800' },
  mastered: { label: 'mastered', cls: 'bg-green-50 text-green-700' },
};
const PRIOR_SOURCE = {
  missing: 'not on your resume',
  partial: 'a related skill is on your resume',
  matched: 'on your resume',
  unknown: 'not in your resume–JD analysis',
};
const pct = (x) => `${Math.round(x * 100)}%`;

/** Why this weight: the parts that made an answer count less than a full answer */
function weightNote(e) {
  const w = e.weightParts;
  const notes = [];
  if (w.confidence < 0.995) notes.push(`score confidence ${w.confidence.toFixed(2)}`);
  if (w.share < 1) notes.push('question tested 2 skills');
  if (w.skipped < 1) notes.push('skipped (counted as 0, half weight)');
  if (w.repeat < 1) notes.push('repeat of a question you had seen the answer to');
  return notes.length ? notes.join(' · ') : 'full weight';
}

function SkillRow({ s, masteredAt }) {
  const [open, setOpen] = useState(false);
  const st = STATUS[s.status];
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-slate-900">{s.name}</span>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
        </div>
        <span className="text-sm text-slate-700">
          <b>{pct(s.p)}</b> likely mastered <span className="text-slate-500">(range {pct(s.range.low)}–{pct(s.range.high)})</span>
        </span>
      </div>

      {/* bar: filled = P(mastered); outlined band = range; tick = mastery threshold */}
      <div className="relative mt-2 h-2.5 rounded bg-slate-100" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 rounded bg-slate-600" style={{ width: pct(s.p) }} />
        <div
          className="absolute -inset-y-0.5 rounded border border-slate-400"
          style={{ left: pct(s.range.low), width: `calc(${pct(s.range.high)} - ${pct(s.range.low)})` }}
        />
        <div className="absolute -inset-y-1 w-px bg-green-600" style={{ left: pct(masteredAt) }} title={`mastered at ${pct(masteredAt)}`} />
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          Based on {s.answers} answer{s.answers === 1 ? '' : 's'}
          {s.uncertainAnswers > 0 && `, ${s.uncertainAnswers} with a less certain score`} · started at {pct(s.prior)} ({PRIOR_SOURCE[s.priorSource]})
        </span>
        <button onClick={() => setOpen((o) => !o)} className="font-medium text-slate-600 hover:text-slate-900" aria-expanded={open}>
          {open ? '▾ hide why' : '▸ why'}
        </button>
      </div>

      {open && (
        <ol className="mt-2 space-y-1.5 rounded-md bg-slate-50 p-3 text-xs text-slate-700">
          {s.evidence.map((e, i) => (
            <li key={i}>
              {e.learnBefore && <div className="text-slate-500">↳ learning since your last interview: {pct(e.pBefore)} before this answer</div>}
              <span className="font-medium">score {e.score}</span> on "{e.question.length > 90 ? `${e.question.slice(0, 90)}…` : e.question}" — counted ×
              {e.weight.toFixed(2)} ({weightNote(e)}) — <span className="tabular-nums">{pct(e.pBefore)} → {pct(e.pAfter)}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export default function SkillMasteryPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/mastery?refresh=1')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data || !data.skills.length) return null; // nothing to show before the first scored interview

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="font-semibold text-slate-900">Your skills</h2>
      <p className="mt-1 text-xs text-slate-500">
        How likely it is that you have mastered each skill, from your scored answers (Bayesian Knowledge Tracing). The range
        shows how much this depends on the model's assumptions; it narrows as you answer more. Weakest first.
      </p>
      <ul className="mt-2 divide-y divide-slate-100">
        {data.skills.map((s) => (
          <SkillRow key={s.skill} s={s} masteredAt={data.masteredAt} />
        ))}
      </ul>
    </div>
  );
}
