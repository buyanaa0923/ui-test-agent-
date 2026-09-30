// Keeps model calls from taking a run down: retry with backoff, a circuit breaker, and a hard budget cap.
export class BudgetExceeded extends Error {
  constructor(spent, cap) { super(`budget cap reached: $${spent.toFixed(4)} spent, cap $${cap}`); this.name = 'BudgetExceeded'; }
}

export async function withRetry(fn, { tries = 3, baseMs = 400, retryOn = (e) => !/\b(400|401|403)\b/.test(e.message) } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (e.name === 'BudgetExceeded' || !retryOn(e) || i === tries - 1) break;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw last;
}

// After `threshold` consecutive failures the breaker opens: calls fail instantly for `coolMs`, and the caller degrades
// to the deterministic path instead of waiting on a dead API for every step.
export class CircuitBreaker {
  constructor({ threshold = 3, coolMs = 30000 } = {}) { this.threshold = threshold; this.coolMs = coolMs; this.fails = 0; this.openedAt = 0; }
  get open() { return this.fails >= this.threshold && Date.now() - this.openedAt < this.coolMs; }
  async run(fn) {
    if (this.open) throw new Error('circuit open: model service unavailable, using fallback');
    try { const r = await fn(); this.fails = 0; return r; } catch (e) {
      this.fails++; if (this.fails >= this.threshold) this.openedAt = Date.now(); throw e;
    }
  }
}
