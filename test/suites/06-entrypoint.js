'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { describe, suites } = require('../harness');

const ROOT = path.resolve(__dirname, '..', '..');
const SUITES_DIR = path.join(ROOT, 'test', 'suites');

describe('test entrypoint', (it) => {
  it('loads every test/suites/*.js module', () => {
    const files = fs
      .readdirSync(SUITES_DIR)
      .filter((name) => name.endsWith('.js'))
      .sort();
    assert.ok(files.length >= 5, 'suite files exist');
    assert.equal(suites.length, files.length, 'each suite file declares exactly one suite');
    for (const file of files) {
      const source = fs.readFileSync(path.join(SUITES_DIR, file), 'utf8');
      assert.match(source, /describe\(/, file + ' declares tests');
    }
  });

  it('points package.json at runnable scripts and existing entrypoints', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.test, 'node test/index.js');
    const targets = {
      test: 'test/index.js',
      lint: 'scripts/lint.js',
      typecheck: 'scripts/typecheck.js',
      check: 'scripts/check.sh',
      coverage: 'scripts/coverage.js',
    };
    for (const name of Object.keys(targets)) {
      const target = path.join(ROOT, targets[name]);
      assert.ok(fs.existsSync(target), name + ' target exists: ' + targets[name]);
    }
  });

  it('publishes the documented files it promises in package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const name of ['README.md', 'README.tr.md', 'CHANGELOG.md']) {
      assert.ok(pkg.files.includes(name), name + ' is listed in files');
      assert.ok(fs.existsSync(path.join(ROOT, name)), name + ' exists');
    }
  });
});
