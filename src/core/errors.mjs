// A run that could not test anything says so. NotRun is never a pass: the CLI maps it to exit code 2.
export class NotRunError extends Error {
  constructor(problem) { super(problem); this.name = 'NotRunError'; this.problem = problem; }
}

export const EXIT = { PASS: 0, DEFECTS: 1, NOT_RUN: 2 };
