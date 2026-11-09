'use strict';

const fs = require('node:fs');
const path = require('node:path');

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
 * Resolve a relative module path the way require() would.
 * @param {string} from File containing the reference.
 * @param {string} spec Relative or package specifier.
 * @returns {boolean} True when the target exists.
 */
function resolves(from, spec) {
  try {
    require.resolve(spec, { paths: [path.dirname(from)] });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Resolve a JSDoc import() type path.
 * @param {string} from File containing the annotation.
 * @param {string} spec Relative path without extension.
 * @returns {boolean} True when the file exists.
 */
function typeResolves(from, spec) {
  if (!spec.startsWith('.')) return true;
  const base = path.resolve(path.dirname(from), spec);
  return fs.existsSync(base) || fs.existsSync(base + '.js') || fs.existsSync(path.join(base, 'index.js'));
}

/**
 * Check the require() graph and JSDoc type imports of one file.
 * @param {string} file Absolute path.
 * @returns {string[]} Problems found.
 */
function checkFile(file) {
  const problems = [];
  const relative = path.relative(ROOT, file).split(path.sep).join('/');
  const source = fs.readFileSync(file, 'utf8');

  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match = requireRe.exec(source);
  while (match !== null) {
    const spec = match[1];
    if (spec.startsWith('.') && !resolves(file, spec)) {
      problems.push(relative + ': cannot resolve require("' + spec + '")');
    }
    match = requireRe.exec(source);
  }

  const typeRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  match = typeRe.exec(source);
  while (match !== null) {
    const spec = match[1];
    if (!typeResolves(file, spec)) {
      problems.push(relative + ': cannot resolve JSDoc type import("' + spec + '")');
    }
    match = typeRe.exec(source);
  }
  return problems;
}

/**
 * Run the type contract check.
 * @returns {number} Process exit code.
 */
function main() {
  const files = [];
  for (const dir of SOURCE_DIRS) collect(path.join(ROOT, dir), files);
  const unique = Array.from(new Set(files)).sort();

  const problems = [];
  for (const file of unique) {
    for (const problem of checkFile(file)) problems.push(problem);
  }

  if (problems.length > 0) {
    process.stderr.write('typecheck: ' + problems.length + ' problem(s)\n');
    for (const problem of problems) process.stderr.write('  ' + problem + '\n');
    return 1;
  }
  process.stdout.write('typecheck: ' + unique.length + ' module(s), require and JSDoc types resolve\n');
  return 0;
}

process.exitCode = main();
