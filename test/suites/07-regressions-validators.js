'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { describe } = require('../harness');
const { parsePnpm, parseYarn } = require('../../lib/parsers');
const { ParseError } = require('../../lib/errors');
const { defaultConfig } = require('../../lib/config');
const { validateEntries } = require('../../lib/validator');
const { buildReport, render } = require('../../lib/report');
const coverage = require('../../scripts/coverage');

const SHA = '0123456789abcdef0123456789abcdef01234567';

/**
 * Build a pnpm v9 lockfile whose single package resolves through a git
 * resolution with an explicit repo URL.
 * @param {string} repo Git remote stored in `resolution.repo`.
 * @returns {string} Lockfile text.
 */
function pnpmGitLockfile(repo) {
  return [
    "lockfileVersion: '9.0'",
    'packages:',
    '  evildep@0.0.0:',
    "    resolution: {type: git, repo: '" + repo + "', commit: " + SHA + '}',
    '',
  ].join('\n');
}

/**
 * Validate a single synthetic entry and build the report every renderer uses.
 * @param {string} ref Raw download reference.
 * @returns {import('../../lib/report').Report} Run report.
 */
function reportFor(ref) {
  const config = defaultConfig();
  const violations = validateEntries(
    [{ name: 'dep', version: '1.0.0', ref: ref, line: 3, parser: 'test' }],
    config,
    'package-lock.json',
  );
  return buildReport(
    [{ file: 'package-lock.json', format: 'npm-v3', packages: 1, violations: violations, error: '' }],
    config,
    '0.1.0',
  );
}

describe('validator regressions', (it) => {
  it('validates a pnpm git resolution repo against allowedGitHosts', () => {
    const entries = parsePnpm(pnpmGitLockfile('https://git.example.invalid/o/r.git'), 'pnpm-lock.yaml').entries;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ref, 'git+https://git.example.invalid/o/r.git#' + SHA);

    const registryOnly = defaultConfig();
    registryOnly.allowedHosts = ['git.example.invalid'];
    const codes = validateEntries(entries, registryOnly, 'pnpm-lock.yaml').map((item) => item.code);
    assert.deepEqual(codes, ['GIT_HOST_NOT_ALLOWED']);

    const gitAllowed = defaultConfig();
    gitAllowed.allowedGitHosts = ['git.example.invalid'];
    assert.deepEqual(validateEntries(entries, gitAllowed, 'pnpm-lock.yaml'), []);

    const plainHttp = parsePnpm(
      pnpmGitLockfile('http://git.example.invalid/o/r.git'),
      'pnpm-lock.yaml',
    ).entries;
    const httpCodes = validateEntries(plainHttp, gitAllowed, 'pnpm-lock.yaml').map((item) => item.code);
    assert.deepEqual(httpCodes, ['INSECURE_PROTOCOL']);
  });

  it('masks embedded credentials in human, JSON and SARIF output', () => {
    const secret = 'synth-' + crypto.randomBytes(8).toString('hex');
    const report = reportFor('git+https://deploy:' + secret + '@github.com/o/r.git#' + SHA);
    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].code, 'CREDENTIALS_IN_URL');

    const outputs = {
      human: render(report, 'human', { color: false }),
      json: render(report, 'json'),
      sarif: render(report, 'sarif'),
    };
    for (const name of Object.keys(outputs)) {
      assert.equal(outputs[name].includes(secret), false, name + ' output must not contain the password');
    }
    assert.ok(outputs.human.includes('***@github.com'), 'human report masks the userinfo');
    assert.equal(JSON.parse(outputs.json).violations[0].resolved, 'git+https://***@github.com/o/r.git#' + SHA);
    assert.equal(
      JSON.parse(outputs.sarif).runs[0].results[0].properties.resolved,
      'git+https://***@github.com/o/r.git#' + SHA,
    );
  });

  it('rejects a yarn __metadata block whose content is malformed', () => {
    for (const text of ['__metadata:\n  version: [\n', '__metadata:\n  version: "8\n']) {
      assert.throws(
        () => parseYarn(text, 'yarn.lock'),
        (err) => {
          assert.ok(err instanceof ParseError, 'ParseError expected for ' + JSON.stringify(text));
          assert.equal(err.code, 'PARSE_ERROR');
          return true;
        },
      );
    }
  });

  it('still accepts a well formed yarn __metadata block', () => {
    const parsed = parseYarn('__metadata:\n  version: 8\n  cacheKey: 10c0\n', 'yarn.lock');
    assert.equal(parsed.format, 'yarn-berry');
    assert.equal(parsed.entries.length, 0);
  });

  it('converts a Windows coverage file URL with fileURLToPath', () => {
    assert.equal(typeof coverage.filePathFromUrl, 'function');
    const converted = coverage.filePathFromUrl('file:///C:/x/lib/a.js', true);
    assert.equal(converted, 'C:\\x\\lib\\a.js');
    assert.equal(converted.startsWith('\\'), false, 'must not produce a rooted \\C: path');
    assert.equal(coverage.filePathFromUrl('file:///C:/x/my%20lib/a.js', true), 'C:\\x\\my lib\\a.js');
  });
});
