#!/usr/bin/env node
// Thin entry point: everything lives in src/cli.
import { main } from '../src/cli/main.mjs';

process.exitCode = await main(process.argv.slice(2));
