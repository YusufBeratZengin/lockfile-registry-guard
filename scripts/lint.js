'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'coverage']);
const SOURCE_DIRS = ['bin', 'lib', 'scripts', 'test'];

/**
 * List JavaScript files below a directory.
 * @param {string} dir Absolute directory.
 * @param {string[]} out Collected paths.
 * @returns {string[]} Collected paths.
 */
function collect(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Check one file and return human readable problems.
 * @param {string} file Absolute path.
 * @returns {string[]} Problems found.
 */
function checkFile(file) {
  const problems = [];
  const relative = path.relative(ROOT, file).split(path.sep).join('/');
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) {
    problems.push(relative + ': syntax error: ' + (syntax.stderr || '').trim().split('\n')[0]);
    return problems;
  }

  const source = fs.readFileSync(file, 'utf8');
  if (source.indexOf('\r') !== -1) problems.push(relative + ': CRLF line ending');
  if (!source.endsWith('\n')) problems.push(relative + ': missing trailing newline');

  const restricted = relative.startsWith('lib/') || relative.startsWith('bin/');
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;
    if (/\s+$/.test(line)) problems.push(relative + ':' + lineNo + ': trailing whitespace');
    if (line.indexOf('\t') !== -1) problems.push(relative + ':' + lineNo + ': tab character');
    if (line.length > 160) problems.push(relative + ':' + lineNo + ': line longer than 160 characters');
    if (/^\s*var\s/.test(line)) problems.push(relative + ':' + lineNo + ': use const or let instead of var');
    if (restricted && /console\.(log|debug)\(/.test(line)) {
      problems.push(relative + ':' + lineNo + ': console output is not allowed in lib/ or bin/');
    }
  }
  return problems;
}

/**
 * Validate every JSON file that ships with the project.
 * @param {string[]} files JSON files.
 * @returns {string[]} Problems found.
 */
function checkJson(files) {
  const problems = [];
  for (const file of files) {
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push(path.relative(ROOT, file) + ': invalid JSON: ' + err.message);
    }
  }
  return problems;
}

/**
 * Run the linter.
 * @returns {number} Process exit code.
 */
function main() {
  const files = [];
  for (const dir of SOURCE_DIRS) collect(path.join(ROOT, dir), files);
  collect(ROOT, files);
  const unique = Array.from(new Set(files)).sort();

  const problems = [];
  for (const file of unique) {
    for (const problem of checkFile(file)) problems.push(problem);
  }
  problems.push(...checkJson([path.join(ROOT, 'package.json')]));
  const fixtures = path.join(ROOT, 'test', 'fixtures');
  const jsonFixtures = fs
    .readdirSync(fixtures)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(fixtures, name));
  problems.push(...checkJson(jsonFixtures));

  if (problems.length > 0) {
    process.stderr.write('lint: ' + problems.length + ' problem(s)\n');
    for (const problem of problems) process.stderr.write('  ' + problem + '\n');
    return 1;
  }
  process.stdout.write('lint: ' + unique.length + ' JavaScript file(s) clean\n');
  return 0;
}

process.exitCode = main();
