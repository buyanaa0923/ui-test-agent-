// The command registry. Adding a command = add a module here. A command is
// { name, summary, usage, positionals, options (util.parseArgs shape + description), run({ values, positionals }) -> exit code }.
import dig from './dig.mjs';
import tunnel from './tunnel.mjs';
import ci from './ci.mjs';
import replay from './replay.mjs';
import doctor from './doctor.mjs';
import dashboard from './dashboard.mjs';
import mcp from './mcp.mjs';
import design from './design.mjs';

export const commands = [dig, tunnel, ci, design, replay, doctor, dashboard, mcp];
export const byName = new Map(commands.map((c) => [c.name, c]));
