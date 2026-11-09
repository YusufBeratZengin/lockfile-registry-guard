'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { describe } = require('../harness');
const h = require('../helpers');
const { defaultConfig } = require('../../lib/config');
const { scanFile } = require('../../lib/cli');
const { buildReport, render } = require('../../lib/report');

const SHA = '0123456789abcdef0123456789abcdef01234567';
const SECRET = 'synthetic-rendering-password';
const REMOTE = 'git+https://deploy:' + SECRET + '@github.com/o/r.git#' + SHA;
const MASKED = 'git+https://***@github.com/o/r.git#' + SHA;
const FORMATS = ['human', 'json', 'sarif'];

/**
 * Exercise every renderer directly and through the CLI with the same lockfile.
 * @param {string} file Lockfile basename.
 * @param {string} text Synthetic lockfile contents.
 * @returns {{report: import('../../lib/report').Report, outputs: string[], codes: (number|null)[]}} Results.
 */
function outputsFor(file, text) {
  const dir = fs.mkdtempSync(path.join(h.ROOT, '.lrg-rendering-'));
  try {
    h.writeFiles(dir, { [file]: text });
    const target = path.join(dir, file);
    const config = defaultConfig();
    const report = buildReport([scanFile(target, config)], config, '0.1.0');
    const direct = FORMATS.map((format) => render(report, format, { color: false }));
    const cli = FORMATS.map((format) => h.runCli(['--format', format, target]));
    assert.deepEqual(cli.map((result) => result.stderr), ['', '', '']);
    return { report: report, outputs: direct.concat(cli.map((result) => result.stdout)), codes: cli.map((result) => result.code) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Check credentials are reported without leaking any report field.
 * @param {ReturnType<typeof outputsFor>} result Renderer and CLI results.
 * @param {string} resolved Expected safe reference.
 * @param {string} version Expected safe version.
 * @returns {void}
 */
function assertMasked(result, resolved, version) {
  assert.deepEqual(result.codes, [1, 1, 1]);
  assert.deepEqual(result.report.violations.map((item) => item.code), ['CREDENTIALS_IN_URL']);
  assert.deepEqual(result.outputs.map((output) => output.includes(SECRET)), Array(6).fill(false));
  for (let offset = 0; offset < 6; offset += 3) {
    assert.ok(result.outputs[offset].includes('***@github.com'));
    const json = JSON.parse(result.outputs[offset + 1]);
    assert.equal(json.ok, false);
    assert.equal(json.violations[0].resolved, resolved);
    assert.equal(json.violations[0].version, version);
    const sarif = JSON.parse(result.outputs[offset + 2]).runs[0].results;
    assert.equal(sarif[0].ruleId, 'CREDENTIALS_IN_URL');
    assert.equal(sarif[0].properties.resolved, resolved);
    assert.equal(sarif[0].properties.version, version);
  }
}

describe('rendering regressions', (it) => {
  it('masks a name-prefixed Berry resolution in renderers and CLI', () => {
    const text = '__metadata:\n  version: 8\n"dep@npm:1.0.0":\n  version: 1.0.0\n  resolution: "dep@' + REMOTE + '"\n';
    assertMasked(outputsFor('yarn.lock', text), 'dep@' + MASKED, '1.0.0');
  });

  it('masks a pnpm git package version and message in renderers and CLI', () => {
    const text = "lockfileVersion: '9.0'\npackages:\n  'dep@" + REMOTE + "':\n    resolution: {type: git, commit: " + SHA + '}\n';
    assertMasked(outputsFor('pnpm-lock.yaml', text), MASKED, MASKED);
  });

  it('rejects mismatched metadata brackets in renderers and CLI', () => {
    for (const value of ['[}', '{]', '[{]}']) {
      const result = outputsFor('yarn.lock', '__metadata:\n  version: ' + value + '\n');
      assert.deepEqual(result.codes, [1, 1, 1], value);
      assert.deepEqual(result.report.violations.map((item) => item.code), ['PARSE_ERROR']);
      for (let offset = 0; offset < 6; offset += 3) {
        assert.match(result.outputs[offset], /PARSE_ERROR/);
        const json = JSON.parse(result.outputs[offset + 1]);
        assert.equal(json.ok, false);
        assert.equal(json.violations[0].code, 'PARSE_ERROR');
        assert.equal(json.violations[0].line, 2);
        const sarif = JSON.parse(result.outputs[offset + 2]).runs[0].results;
        assert.equal(sarif[0].ruleId, 'PARSE_ERROR');
        assert.equal(sarif[0].locations[0].physicalLocation.region.startLine, 2);
      }
    }
  });

  it('accepts a commented metadata header in renderers and CLI', () => {
    const result = outputsFor('yarn.lock', '__metadata: # generated metadata\n  version: 8\n  cacheKey: 10c0\n');
    assert.deepEqual(result.codes, [0, 0, 0]);
    assert.equal(result.report.ok, true);
    assert.equal(result.report.files[0].format, 'yarn-berry');
    assert.equal(result.report.summary.packages, 0);
    for (let offset = 0; offset < 6; offset += 3) {
      assert.match(result.outputs[offset], /CI gate passed/);
      const json = JSON.parse(result.outputs[offset + 1]);
      assert.equal(json.ok, true);
      assert.equal(json.summary.packages, 0);
      assert.deepEqual(json.violations, []);
      assert.deepEqual(JSON.parse(result.outputs[offset + 2]).runs[0].results, []);
    }
  });
});
