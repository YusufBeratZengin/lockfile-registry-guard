#!/usr/bin/env node
'use strict';

const { runCli } = require('../lib/cli');

process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
});

try {
  process.exitCode = runCli(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    isTTY: Boolean(process.stdout.isTTY),
  });
} catch (err) {
  const message = err && err.stack ? err.stack : String(err);
  process.stderr.write('lockfile-registry-guard: unexpected failure: ' + message + '\n');
  process.exitCode = 2;
}
