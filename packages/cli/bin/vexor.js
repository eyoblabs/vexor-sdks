#!/usr/bin/env node
import { run } from '../src/cli.js';

run(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : 'Unexpected CLI error';
  if (process.argv.includes('--json')) process.stderr.write(`${JSON.stringify({ error: { message } })}\n`);
  else process.stderr.write(`vexor: ${message}\n`);
  process.exitCode = 1;
});
