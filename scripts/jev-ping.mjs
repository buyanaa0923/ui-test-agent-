// One real Jev call to check the key, network and response shape. Prints latency, confidence, tokens and cost.
import { classifyRisk } from '../src/jev.mjs';
try {
  const r = await classifyRisk({ label: 'Delete account', context: 'button, account settings' });
  const usd = (r.usage.inputTokens * 0.042 + r.usage.outputTokens * 0) / 1e6;
  console.log(`Jev OK  ${r.ms} ms | risky=${r.risky} p=${r.p} confidence=${r.confidence}${r.derivedConfidence ? ' (derived from p: API sent none)' : ''} | ${r.usage.inputTokens} in / ${r.usage.outputTokens} out tokens | ~$${usd.toFixed(7)}`);
  const s = await classifyRisk({ label: 'Хайх', context: 'button, toolbar' });
  console.log(`Mongolian check: "Хайх" (search) -> risky=${s.risky} p=${s.p} confidence=${s.confidence}`);
} catch (e) { console.error(`Jev FAILED: ${e.message}`); process.exit(1); }
