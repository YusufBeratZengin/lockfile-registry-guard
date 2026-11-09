'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runAll } = require('./harness');

const SUITES_DIR = path.join(__dirname, 'suites');

/**
 * Load every suite module, then run all declared tests.
 * @returns {Promise<number>} Process exit code.
 */
async function main() {
  let names;
  try {
    names = fs
      .readdirSync(SUITES_DIR)
      .filter((name) => name.endsWith('.js'))
      .sort();
  } catch (err) {
    process.stderr.write('cannot read test suites: ' + SUITES_DIR + '\n');
    return 1;
  }

  if (names.length === 0) {
    process.stderr.write('no test suites found in ' + SUITES_DIR + '\n');
    return 1;
  }

  for (const name of names) require(path.join(SUITES_DIR, name));
  return runAll();
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write((err && err.stack ? err.stack : String(err)) + '\n');
    process.exitCode = 1;
  });
