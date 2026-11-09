'use strict';

const assert = require('node:assert');
const { describe } = require('../harness');
const { defaultConfig } = require('../../lib/config');
const { parseRef } = require('../../lib/refs');
const { validateEntry } = require('../../lib/validator');

const SHA = '0123456789abcdef0123456789abcdef01234567';

/**
 * Build a minimal lockfile entry for a raw reference.
 * @param {string} ref Raw download reference.
 * @returns {import('../../lib/parsers/common').Entry} Entry.
 */
function entryOf(ref) {
  return { name: 'dep', version: '1.0.0', ref: ref, line: 1, parser: 'test' };
}

/**
 * Run validation with the default policy.
 * @param {string} ref Raw download reference.
 * @returns {import('../../lib/validator').Violation[]} Violations.
 */
function codesOf(ref) {
  return validateEntry(entryOf(ref), defaultConfig(), 'package-lock.json').map((item) => item.code);
}

describe('git reference credentials', (it) => {
  it('flags a password embedded in a git URL', () => {
    const codes = codesOf('git+https://u:t@github.com/o/r.git#' + SHA);
    assert.deepEqual(codes, ['CREDENTIALS_IN_URL']);
  });

  it('flags a token used as the git URL username', () => {
    const codes = codesOf('git+https://ghp_exampletoken@github.com/o/r.git#' + SHA);
    assert.ok(codes.includes('CREDENTIALS_IN_URL'), 'token-only userinfo is a credential');
  });

  it('does not flag the standard git@ SSH login', () => {
    assert.deepEqual(codesOf('git+ssh://git@github.com/o/r.git#' + SHA), []);
    assert.deepEqual(codesOf('ssh://git@github.com/o/r.git#' + SHA), []);
  });

  it('flags SSH URLs that carry a real password', () => {
    const codes = codesOf('git+ssh://deploy:secret@github.com/o/r.git#' + SHA);
    assert.deepEqual(codes, ['CREDENTIALS_IN_URL']);
  });

  it('still reports credentials when the git host is also disallowed', () => {
    const codes = codesOf('git+https://u:t@git.attacker.example/o/r.git#' + SHA);
    assert.ok(codes.includes('CREDENTIALS_IN_URL'));
    assert.ok(codes.includes('GIT_HOST_NOT_ALLOWED'));
  });

  it('keeps the plain HTTPS credential rule intact', () => {
    const codes = codesOf('https://user:secret@registry.npmjs.org/dep/-/dep-1.0.0.tgz');
    assert.deepEqual(codes, ['CREDENTIALS_IN_URL']);
  });

  it('exposes the parsed userinfo for callers', () => {
    const ref = parseRef('git+https://u:t@github.com/o/r.git#' + SHA, 'dep');
    assert.equal(ref.kind, 'git');
    assert.equal(ref.username, 'u');
    assert.equal(ref.hasPassword, true);
    assert.equal(ref.host, 'github.com');
  });
});
