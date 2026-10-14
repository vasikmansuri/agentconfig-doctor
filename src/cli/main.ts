#!/usr/bin/env node
import { run } from './program.js';

process.exitCode = await run(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
});
