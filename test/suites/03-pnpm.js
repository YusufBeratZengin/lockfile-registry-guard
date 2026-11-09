'use strict';

const assert = require('node:assert');
const { describe } = require('../harness');
const h = require('../helpers');
const { parseLockfile, parsePnpm } = require('../../lib/parsers');
const { splitPackageKey } = require('../../lib/parsers/pnpm');
const { defaultConfig } = require('../../lib/config');
const { validateEntries } = require('../../lib/validator');

const ATTACKER_SHA = '0123456789abcdef0123456789abcdef01234567';

/**
 * Build a v9 lockfile whose git package has a commit-only resolution and a
 * package key that carries the remote (the shape that bypassed the gate).
 * @param {string} key Package key.
 * @param {string} importerVersion Importer `version` value.
 * @returns {string} Lockfile text.
 */
function commitOnlyLockfile(key, importerVersion) {
  return [
    "lockfileVersion: '9.0'",
    'importers:',
    '  .:',
    '    dependencies:',
    '      evildep:',
    '        specifier: git+https://git.attacker.example/evil/repo.git',
    '        version: ' + importerVersion,
    'packages:',
    '  ' + key + ':',
    '    resolution: {commit: ' + ATTACKER_SHA + '}',
    '',
  ].join('\n');
}

/**
 * Validate parsed pnpm text with the default policy.
 * @param {string} text Lockfile content.
 * @returns {import('../../lib/validator').Violation[]} Violations.
 */
function validateText(text) {
  const parsed = parsePnpm(text, 'pnpm-lock.yaml');
  return validateEntries(parsed.entries, defaultConfig(), 'pnpm-lock.yaml');
}

describe('pnpm parser', (it) => {
  it('parses the v5 fixture', () => {
    const parsed = parseLockfile(h.fixture('pnpm-v5.yaml'), 'pnpm-lock.yaml');
    assert.equal(parsed.format, 'pnpm-v5');
    assert.equal(parsed.entries.length, 3);
  });

  it('parses the v6 fixture', () => {
    const parsed = parseLockfile(h.fixture('pnpm-v6.yaml'), 'pnpm-lock.yaml');
    assert.equal(parsed.format, 'pnpm-v6');
    assert.equal(parsed.entries.length, 4);
  });

  it('parses the v9 fixture including git and directory resolutions', () => {
    const parsed = parseLockfile(h.fixture('pnpm-v9.yaml'), 'pnpm-lock.yaml');
    assert.equal(parsed.format, 'pnpm-v9');
    assert.equal(parsed.entries.length, 6);
    const gitdep = parsed.entries.find((entry) => entry.name === 'gitdep');
    assert.equal(gitdep.ref, 'git+ssh://git@github.com/example/gitdep.git#' + ATTACKER_SHA);
    const local = parsed.entries.find((entry) => entry.name === 'localdir');
    assert.equal(local.ref, 'file:../localdir');
  });

  it('reports the expected violations for every pnpm fixture', () => {
    for (const name of ['pnpm-v5.yaml', 'pnpm-v6.yaml', 'pnpm-v9.yaml']) {
      const parsed = parseLockfile(h.fixture(name), 'pnpm-lock.yaml');
      const codes = validateEntries(parsed.entries, defaultConfig(), name).map((item) => item.code);
      assert.deepEqual(codes, ['HOST_NOT_ALLOWED', 'INSECURE_PROTOCOL', 'HOST_NOT_ALLOWED'], name);
    }
  });

  it('validates a git package whose resolution only carries a commit', () => {
    const key = 'evildep@git+https://git.attacker.example/evil/repo.git#' + ATTACKER_SHA;
    const violations = validateText(commitOnlyLockfile(key, 'evildep@git+https://git.attacker.example/evil/repo.git'));
    assert.equal(violations.length, 1);
    assert.equal(violations[0].code, 'GIT_HOST_NOT_ALLOWED');
    assert.equal(violations[0].name, 'evildep');
  });

  it('recovers the git remote from a name-prefixed importer spec', () => {
    const text = commitOnlyLockfile(
      'evildep@0.0.0',
      'evildep@git+https://git.attacker.example/evil/repo.git#' + ATTACKER_SHA,
    );
    const violations = validateText(text);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].code, 'GIT_HOST_NOT_ALLOWED');
  });

  it('does not silently pass a commit-only entry without any remote', () => {
    const text = ["lockfileVersion: '9.0'", 'packages:', '  evildep@0.0.0:', '    resolution: {commit: ' + ATTACKER_SHA + '}', ''].join(
      '\n',
    );
    const violations = validateText(text);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].code, 'INVALID_URL');
  });

  it('keeps an scp-style git remote intact', () => {
    const text = [
      "lockfileVersion: '9.0'",
      'packages:',
      '  gitdep@0.0.0:',
      "    resolution: {commit: " + ATTACKER_SHA + ", repo: 'git@git.example:o/r.git', type: git}",
      '',
    ].join('\n');
    const violations = validateText(text);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].code, 'GIT_HOST_NOT_ALLOWED');
    assert.equal(violations[0].url, 'git@git.example:o/r.git#' + ATTACKER_SHA);
  });

  it('handles a git remote inside a scoped package key', () => {
    const split = splitPackageKey('@corp/pkg@git+ssh://git@git.example/c/p.git#' + ATTACKER_SHA);
    assert.equal(split.name, '@corp/pkg');
    assert.equal(split.version, 'git+ssh://git@git.example/c/p.git#' + ATTACKER_SHA);
  });

  it('still parses scoped and peer-suffixed keys', () => {
    assert.deepEqual(splitPackageKey('/@scope/ui@2.1.0'), { name: '@scope/ui', version: '2.1.0' });
    assert.deepEqual(splitPackageKey('name@1.0.0(peer@2.0.0)'), { name: 'name', version: '1.0.0' });
    assert.deepEqual(splitPackageKey('/express/4.18.2'), { name: 'express', version: '4.18.2' });
  });
});
