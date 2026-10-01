// A run that could not test anything says so. NotRun is never a pass: the CLI maps it to exit code 2.
export class NotRunError extends Error {
  constructor(problem) { super(problem); this.name = 'NotRunError'; this.problem = problem; }
}

// The run was asked for something it refuses to do (e.g. submit forms against a host that is not a dev host).
// Nothing starts; the CLI maps it to exit code 64 like any other usage error.
export class UsageError extends Error {
  constructor(message) { super(message); this.name = 'UsageError'; }
}

export const EXIT = { PASS: 0, DEFECTS: 1, NOT_RUN: 2 };
