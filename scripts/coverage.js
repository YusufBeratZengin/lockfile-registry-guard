'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fileURLToPath } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

/**
 * Convert a V8 coverage script URL to a normalized file system path.
 *
 * `new URL(...).pathname` keeps URL syntax (`/C:/...`) and percent escapes.
 * On Windows that normalizes to `\C:\...`, so no file matches the lib/bin
 * filter. `fileURLToPath` applies the platform's file URL rules instead.
 * @param {string} urlText Script URL from the coverage report.
 * @param {boolean} [windows] Force Windows path rules (used by tests).
 * @returns {string} Normalized path, empty when the URL cannot be converted.
 */
function filePathFromUrl(urlText, windows) {
  try {
    if (!windows) return path.normalize(fileURLToPath(urlText));
    const converted = fileURLToPath(urlText, { windows: true });
    // Node < 20.13 ignores the option and keeps the URL-style leading slash.
    return path.win32.normalize(/^\/[A-Za-z]:/.test(converted) ? converted.slice(1) : converted);
  } catch (err) {
    return '';
  }
}

/**
 * Merge V8 line coverage for one script into a per-line hit map.
 * @param {string} source Script source.
 * @param {Object[]} functions V8 coverage functions.
 * @returns {{hit: number, total: number, percent: string}} Line coverage.
 */
function lineCoverage(source, functions) {
  const marks = new Int32Array(source.length).fill(-1);
  for (const fn of functions) {
    for (const range of fn.ranges || []) {
      const start = Math.max(0, range.startOffset);
      const end = Math.min(source.length, range.endOffset);
      for (let i = start; i < end; i += 1) marks[i] = range.count;
    }
  }
  const lines = source.split('\n');
  let offset = 0;
  let hit = 0;
  let total = 0;
  for (const line of lines) {
    if (line.trim() !== '') {
      total += 1;
      let covered = false;
      for (let i = 0; i < line.length; i += 1) {
        if (marks[offset + i] > 0) {
          covered = true;
          break;
        }
      }
      if (covered) hit += 1;
    }
    offset += line.length + 1;
  }
  const percent = total === 0 ? '100.0' : ((hit / total) * 100).toFixed(1);
  return { hit: hit, total: total, percent: percent };
}

/**
 * Run the test suite under V8 coverage and print a per-file summary.
 * @returns {number} Process exit code.
 */
function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lrg-coverage-'));
  try {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'test', 'index.js')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { NODE_V8_COVERAGE: dir }),
    });
    process.stdout.write(result.stdout || '');
    if (result.status !== 0) {
      process.stderr.write(result.stderr || '');
      process.stderr.write('coverage: tests failed, not reporting coverage\n');
      return result.status === null ? 1 : result.status;
    }

    const reports = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
    /** @type {Map<string, {hit: number, total: number, percent: string}>} */
    const byFile = new Map();
    for (const name of reports) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      for (const script of data.result || []) {
        if (!script.url || !script.url.startsWith('file://')) continue;
        const file = filePathFromUrl(script.url);
        if (!file) continue;
        if (!file.startsWith(path.join(ROOT, 'lib') + path.sep) && !file.startsWith(path.join(ROOT, 'bin') + path.sep)) {
          continue;
        }
        const source = fs.readFileSync(file, 'utf8');
        const summary = lineCoverage(source, script.functions || []);
        const existing = byFile.get(file);
        if (!existing || summary.total > existing.total) byFile.set(file, summary);
      }
    }

    let totalLines = 0;
    let hitLines = 0;
    const rows = [];
    for (const file of Array.from(byFile.keys()).sort()) {
      const summary = byFile.get(file);
      totalLines += summary.total;
      hitLines += summary.hit;
      rows.push(
        '  ' +
          path.relative(ROOT, file).split(path.sep).join('/') +
          '  ' +
          summary.percent +
          '% (' +
          summary.hit +
          '/' +
          summary.total +
          ' lines)',
      );
    }
    if (rows.length === 0) {
      process.stderr.write('coverage: no lib/bin coverage data was produced\n');
      return 1;
    }
    process.stdout.write('\ncoverage:\n' + rows.join('\n') + '\n');
    const percent = totalLines === 0 ? '100.0' : ((hitLines / totalLines) * 100).toFixed(1);
    process.stdout.write('total: ' + percent + '% (' + hitLines + '/' + totalLines + ' lines)\n');
    return 0;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { main, filePathFromUrl };
