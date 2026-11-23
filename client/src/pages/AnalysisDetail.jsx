import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import StartInterview from '../components/StartInterview.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const STATUS_STYLE = {
  matched: 'bg-green-100 text-green-800',
  partial: 'bg-amber-100 text-amber-800',
  missing: 'bg-red-100 text-red-800',
};

const pct = (x) => `${Math.round(x * 100)}%`;

// Plain-language explanation of HOW each decision was made (explainability)
function evidence(r, thresholds) {
  // Missing: the "closest" resume skill is usually unrelated (e.g. Docker ~ CSS3), which
  // confuses students — so show a plain message, with the technical detail collapsed.
  if (r.status === 'missing') {
    if (!r.resumeSkill) return 'Not found in your resume.';
    const why =
      r.method === 'llm'
        ? `similarity ${pct(r.similarity)} was borderline; AI check said no: ${r.reason}`
        : `similarity ${pct(r.similarity)} is below the ${pct(thresholds.low)} threshold`;
    return (
      <>
        Not found in your resume.
        <details className="mt-1 text-xs text-slate-500">
          <summary className="cursor-pointer select-none">details</summary>
          Closest resume skill: "{r.resumeSkill}" — {why}.
        </details>
      </>
    );
  }
  switch (r.method) {
    case 'exact':
      return `Found "${r.resumeSkill}" in your resume.`;
    case 'alias':
      return `Found "${r.resumeSkill}" in your resume (same skill, different name).`;
    case 'embedding':
      return `Very similar to "${r.resumeSkill}" (similarity ${pct(r.similarity)} ≥ ${pct(thresholds.high)}).`;
    case 'llm':
      return `Closest in your resume: "${r.resumeSkill}" (similarity ${pct(r.similarity)}, borderline). AI check: ${r.reason}`;
    default:
      return '';
  }
}

export default function AnalysisDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [a, setA] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/analysis/${id}`)
      .then((d) => setA(d.analysis))
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!a) return <p className="text-sm text-slate-500">Loading…</p>;

  const count = (s) => a.results.filter((r) => r.status === s).length;
  const missingRequired = a.results.filter((r) => r.status === 'missing' && r.importance === 'required');
  const order = { missing: 0, partial: 1, matched: 2 };
  const rows = [...a.results].sort(
    (x, y) => order[x.status] - order[y.status] || (x.importance === 'required' ? -1 : 1) - (y.importance === 'required' ? -1 : 1)
  );
  const { thresholds, weights } = a.config;
  const red = a.redactions || {};

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-900">← Back</Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">{a.jdTitle || 'Resume–JD analysis'}</h1>
        <p className="text-sm text-slate-500">
          {a.resumeFileName} · {new Date(a.createdAt).toLocaleString()}
        </p>
      </div>

      {/* Score */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Skill match score</p>
          <p className="mt-1 text-4xl font-semibold text-slate-900">{a.matchScore}%</p>
          <p className="mt-1 text-xs text-slate-500">
            Required skills count ×{weights.required}, nice-to-have ×{weights.nice_to_have}; partial = half credit.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">JD skills</p>
          <p className="mt-2 flex flex-wrap gap-2 text-sm">
            <span className={`rounded px-2 py-0.5 ${STATUS_STYLE.matched}`}>{count('matched')} matched</span>
            <span className={`rounded px-2 py-0.5 ${STATUS_STYLE.partial}`}>{count('partial')} partial</span>
            <span className={`rounded px-2 py-0.5 ${STATUS_STYLE.missing}`}>{count('missing')} missing</span>
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Whole-document similarity</p>
          <p className="mt-1 text-2xl font-semibold text-slate-700">{a.docSimilarity?.toFixed(2)}</p>
          <p className="mt-1 text-xs text-slate-500">
            For comparison only. One number for the whole text; it can't tell you which skills are missing.
          </p>
        </div>
      </div>

      {/* Missing required skills — these drive the interview in the next module */}
      {missingRequired.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm font-medium text-red-900">Required skills missing from your resume</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {missingRequired.map((r) => (
              <span key={r.jdSkill} className="rounded bg-white px-2 py-1 text-sm text-red-800 ring-1 ring-red-200">
                {r.jdSkill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Next step: interview driven by the gaps above (owner only) */}
      {a.user === user?._id && <StartInterview analysisId={a._id} />}

      {/* Per-skill explanation */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">JD skill</th>
                <th className="px-4 py-2 font-medium">Importance</th>
                <th className="px-4 py-2 font-medium">Result</th>
                <th className="px-4 py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.jdSkill}>
                  <td className="px-4 py-2 font-medium text-slate-900">{r.jdSkill}</td>
                  <td className="px-4 py-2 text-slate-600">{r.importance === 'required' ? 'Required' : 'Nice to have'}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{evidence(r, thresholds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resume skills found */}
      <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">
          Skills found in your resume ({a.resumeSkills.length})
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {a.resumeSkills.map((s) => (
            <span key={s} className="rounded bg-slate-100 px-2 py-1 text-sm text-slate-700">{s}</span>
          ))}
        </div>
      </details>

      {/* How this was calculated — reproducibility */}
      <details className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        <summary className="cursor-pointer font-medium text-slate-700">How this was calculated</summary>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>Skills were extracted from the resume and JD by {a.config.genModel} (prompt {a.config.promptVersion}, temperature 0, cached).</li>
          <li>Skills with the same name (or a known alias like JS → JavaScript) match directly.</li>
          <li>
            Otherwise, {a.config.embedModel} embeddings compare meanings: similarity ≥ {pct(thresholds.high)} = match,
            below {pct(thresholds.low)} = missing, in between = checked by the AI (yes / partial / no, with a reason).
          </li>
          <li>Removed before AI processing: {red.names ?? 0} name, {red.emails ?? 0} email, {red.phones ?? 0} phone, {red.urls ?? 0} link mentions.</li>
          <li>Not considered: years of experience, seniority, and soft skills.</li>
        </ul>
      </details>
    </div>
  );
}
