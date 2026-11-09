'use strict';

/**
 * Minimal zero-dependency test harness: suites are declared with `describe`,
 * individual checks with `it`, and failures are collected so one broken test
 * does not hide the rest of the run.
 *
 * @typedef {Object} TestCase
 * @property {string} title Human readable test name.
 * @property {() => (void|Promise<void>)} fn Test body.
 *
 * @typedef {Object} Suite
 * @property {string} name Suite name.
 * @property {TestCase[]} tests Tests in declaration order.
 */

/** @type {Suite[]} */
const suites = [];

/**
 * Declare a suite.
 * @param {string} name Suite name.
 * @param {(it: (title: string, fn: () => (void|Promise<void>)) => void) => void} body Suite body.
 * @returns {void}
 */
function describe(name, body) {
  /** @type {TestCase[]} */
  const tests = [];
  suites.push({ name: name, tests: tests });
  body((title, fn) => {
    tests.push({ title: title, fn: fn });
  });
}

/**
 * Run every declared suite.
 * @returns {number} 0 when everything passed, 1 otherwise.
 */
async function runAll() {
  let passed = 0;
  let failed = 0;
  /** @type {{suite: string, title: string, error: Error}[]} */
  const failures = [];

  for (const suite of suites) {
    let suiteOk = true;
    if (suite.tests.length === 0) {
      suiteOk = false;
      failed += 1;
      failures.push({ suite: suite.name, title: '(no tests)', error: new Error('suite is empty') });
    }
    for (const test of suite.tests) {
      try {
        await test.fn();
        passed += 1;
      } catch (err) {
        suiteOk = false;
        failed += 1;
        failures.push({
          suite: suite.name,
          title: test.title,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }
    process.stdout.write((suiteOk ? '\u2714 ' : '\u2718 ') + suite.name + ' (' + suite.tests.length + ' tests)\n');
  }

  if (failures.length > 0) {
    process.stdout.write('\nFailures:\n');
    for (const failure of failures) {
      process.stdout.write('  \u2718 ' + failure.suite + ' \u203a ' + failure.title + '\n');
      const message = failure.error.message || String(failure.error);
      for (const line of message.split('\n')) process.stdout.write('      ' + line + '\n');
      if (failure.error.stack && !failure.error.message) process.stdout.write(failure.error.stack + '\n');
    }
    process.stdout.write('\n' + failed + ' test(s) failed, ' + passed + ' passed\n');
    return 1;
  }

  process.stdout.write('\nAll ' + suites.length + ' lockfile validation suites passed\n');
  return 0;
}

module.exports = { describe, runAll, suites };
