'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');

/**
 * Read a fixture file.
 * @param {string} name File name inside `test/fixtures`.
 * @returns {string} File content.
 */
function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

/**
 * Find the 1-based line of a substring so tests never hard-code line numbers.
 * @param {string} text Haystack.
 * @param {string} needle Substring to find.
 * @param {number} [occurrence] 1-based occurrence to locate.
 * @returns {number} Line number, 0 when not found.
 */
function lineOf(text, needle, occurrence) {
  const wanted = occurrence || 1;
  let index = -1;
  for (let i = 0; i < wanted; i += 1) {
    index = text.indexOf(needle, index + 1);
    if (index === -1) return 0;
  }
  return text.slice(0, index).split('\n').length;
}

/**
 * Create a temporary directory and return its path.
 * @param {string} prefix Directory name prefix.
 * @returns {string} Absolute path.
 */
function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lrg-' + prefix + '-'));
}

/**
 * Write files into a directory, creating parents as needed.
 * @param {string} dir Target directory.
 * @param {Record<string, string>} files Relative path to content.
 * @returns {void}
 */
function writeFiles(dir, files) {
  for (const name of Object.keys(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, files[name]);
  }
}

/**
 * Run the CLI in a child process.
 * @param {string[]} args CLI arguments.
 * @param {{cwd?: string, env?: Record<string, string>}} [options] Spawn options.
 * @returns {{code: number|null, stdout: string, stderr: string}} Result.
 */
function runCli(args, options) {
  const settings = options || {};
  const result = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'guard.js')].concat(args), {
    cwd: settings.cwd || ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { NO_COLOR: '1' }, settings.env || {}),
  });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

module.exports = { ROOT, FIXTURES, fixture, lineOf, tmpDir, writeFiles, runCli };
