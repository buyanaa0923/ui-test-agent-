// CLI dispatcher: parse arguments strictly, run the command, map every outcome to an exit code.
// Exit codes: 0 pass, 1 defects found, 2 NOT RUN (nothing was tested: a failure, never a pass), 64 bad usage.
import { parseArgs } from 'node:util';
import { byName } from './commands/index.mjs';
import { help, commandHelp } from './help.mjs';
import { NotRunError, UsageError, EXIT } from '../core/errors.mjs';
import { BudgetExceeded } from '../core/resilience.mjs';
import { version } from '../core/version.mjs';
import { ContractError } from '../engine/contract.mjs';

export async function main(argv) {
  const [name, ...rest] = argv;
  if (!name || ['-h', '--help', 'help'].includes(name)) { process.stdout.write(help() + '\n'); return 0; }
  if (['-v', '--version', 'version'].includes(name)) { process.stdout.write(version() + '\n'); return 0; }
  const cmd = byName.get(name);
  if (!cmd) { process.stderr.write(`mole: unknown command "${name}"\n\n${help()}\n`); return 64; }
  if (rest.includes('-h') || rest.includes('--help')) { process.stdout.write(commandHelp(cmd) + '\n'); return 0; }

  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: cmd.options || {}, allowPositionals: true, strict: true });
  } catch (e) {
    process.stderr.write(`mole ${name}: ${e.message}\n\n${commandHelp(cmd)}\n`);
    return 64;
  }
  if ((cmd.positionals || 0) > parsed.positionals.length) {
    process.stderr.write(`mole ${name}: missing <url>\n\n${commandHelp(cmd)}\n`);
    return 64;
  }
  try {
    return await cmd.run(parsed);
  } catch (e) {
    if (e instanceof NotRunError) { process.stderr.write(`NOT RUN: ${e.problem}\nNothing was tested.\n`); return EXIT.NOT_RUN; }
    if (e instanceof ContractError) { process.stderr.write(`mole ${name}: design contract: ${e.message}
Nothing was tested.
`); return 64; }
    if (e instanceof UsageError) { process.stderr.write(`mole ${name}: ${e.message}\nNothing was tested.\n`); return 64; }
    if (e instanceof BudgetExceeded) { process.stderr.write(`STOPPED: ${e.message}\n`); return EXIT.NOT_RUN; }
    process.stderr.write(`mole ${name}: ${e.stack || e.message}\n`);
    return EXIT.NOT_RUN; // an internal failure also means nothing trustworthy was tested
  }
}
