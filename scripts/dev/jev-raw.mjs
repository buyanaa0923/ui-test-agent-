// Prints the raw, unmodified JSON that the TypeSafe API returns for one yes/no and one choice question.
// The key is read from the environment and is never printed.
import '../../src/core/env.mjs';
const key = process.env.TYPESAFE_API_KEY;
if (!key) { console.error('TYPESAFE_API_KEY is not set'); process.exit(1); }
const base = process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai';
const body = {
  state: { control_label: 'Delete account', context: 'button, account settings' },
  model: process.env.JEV_MODEL || 'jev-latest',
  questions: {
    risky: { type: 'noul', instructions: 'Would clicking this button delete data, move money or change access?', criteria: { true: 'Yes', false: 'No' } },
    kind: { type: 'choice', instructions: 'What kind of action is this?', criteria: { destructive: 'Deletes or closes something', navigation: 'Moves to another view', other: 'Anything else' } }
  }
};
const res = await fetch(`${base}/v1/systemone`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
console.log(`HTTP ${res.status}`);
console.log(JSON.stringify(JSON.parse(await res.text()), null, 2));
