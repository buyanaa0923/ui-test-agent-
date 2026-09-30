// Client for TypeSafe's System One API (Jev). Documented at docs.typesafe.ai/api:
//   POST {base}/v1/systemone   Authorization: Bearer <key>
//   body { state, model, questions: { id: { type: noul|choice|score, instructions, criteria } } }
//   reply { model, answers: { id: { type, noul|choice|score, probabilities, confidence } }, usage }
// The reply is validated before use. Errors 429/529/5xx are retried with backoff, repeated failures open a circuit breaker.
import '../core/env.mjs';
import { withRetry, CircuitBreaker } from '../core/resilience.mjs';

const breaker = new CircuitBreaker({ threshold: 4, coolMs: 30000 });
export const resetBreaker = () => { breaker.fails = 0; breaker.openedAt = 0; };
const prob = (v) => typeof v === 'number' && v >= 0 && v <= 1;

// Docs show `confidence` on choice/score answers; a yes/no (noul) answer is itself a probability. If the API omits
// confidence on a noul answer, the decision confidence is max(p, 1-p), and the answer is flagged as derived so reports
// can say so. Anything else that is malformed is rejected, with the raw answer in the message for diagnosis.
export function validateAnswers(body, questions) {
  if (!body || typeof body !== 'object' || !body.answers) throw new Error(`Jev reply has no answers: ${JSON.stringify(body).slice(0, 200)}`);
  for (const [id, q] of Object.entries(questions)) {
    const a = body.answers[id];
    const bad = (why) => new Error(`Jev answer "${id}" ${why}: ${JSON.stringify(a).slice(0, 200)}`);
    if (!a) throw new Error(`Jev reply is missing answer "${id}": ${JSON.stringify(Object.keys(body.answers))}`);
    if (q.type === 'noul') {
      if (!prob(a.noul)) throw bad('has no valid noul probability');
      if (!prob(a.confidence)) { a.confidence = Math.max(a.noul, 1 - a.noul); a.confidenceDerived = true; }
    } else {
      if (!prob(a.confidence)) throw bad('has no valid confidence');
      if (q.type === 'choice' && !(typeof a.choice === 'string' && Object.keys(q.criteria).includes(a.choice))) throw bad('chose an option that was not offered');
      if (q.type === 'score' && typeof a.score !== 'number') throw bad('has no score');
    }
  }
  return body;
}

export async function systemOne({ state, questions, model = process.env.JEV_MODEL || 'jev-latest', key = process.env.TYPESAFE_API_KEY, base = process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai', fetchImpl = fetch, cache = null }) {
  const request = { state, model, questions };
  if (cache) { const hit = cache.get(request); if (hit) return { ...hit, cached: true }; if (cache.replayOnly) throw new Error('replay mode: no recorded response for this request'); }
  if (!key) throw new Error('TYPESAFE_API_KEY is not set');
  const t0 = performance.now();
  const body = await breaker.run(() => withRetry(async () => {
    const res = await fetchImpl(`${base}/v1/systemone`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(request) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { throw new Error(`Jev ${res.status}: non-JSON reply`); }
    if (!res.ok) throw new Error(`Jev ${res.status}: ${JSON.stringify(json).slice(0, 160)}`);
    return json;
  }, { tries: 4, baseMs: 500, retryOn: (e) => /\b(429|529|5\d\d)\b|fetch failed|ECONN|ETIMEDOUT/.test(e.message) }));
  validateAnswers(body, questions);
  const out = { answers: body.answers, derivedConfidence: Object.values(body.answers).some((x) => x.confidenceDerived), model: body.model, usage: { model: 'jev-1.13', inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 }, ms: Math.round(performance.now() - t0) };
  cache?.put(request, out);
  return out;
}
