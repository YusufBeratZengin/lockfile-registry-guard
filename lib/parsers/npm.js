'use strict';

const { ParseError } = require('../errors');
const {
  buildLineIndex,
  lineAt,
  collectResolvedLines,
  takeLine,
  stripBom,
} = require('./common');

/**
 * @typedef {import('./common').Entry} Entry
 */

/**
 * Extract a 1-based line number from a V8 JSON.parse error message.
 * @param {string} message Error message.
 * @param {string} text Original text, used as a fallback.
 * @returns {number} 1-based line number or 0.
 */
function errorLine(message, text) {
  const direct = /line (\d+) column (\d+)/.exec(message);
  if (direct) return parseInt(direct[1], 10);
  const pos = /position (\d+)/.exec(message);
  if (!pos) return 0;
  return lineAt(buildLineIndex(text), parseInt(pos[1], 10));
}

/**
 * Derive the package name from a `node_modules/...` path used as a key in the
 * npm v2/v3 `packages` map.
 * @param {string} key Map key, e.g. `node_modules/a/node_modules/@s/b`.
 * @returns {string} Package name, empty string for the root entry.
 */
function nameFromPath(key) {
  if (!key) return '';
  const marker = 'node_modules/';
  const index = key.lastIndexOf(marker);
  if (index === -1) return '';
  return key.slice(index + marker.length);
}

/**
 * Parse an npm lockfile (`package-lock.json` or `npm-shrinkwrap.json`).
 *
 * Supports v1 (nested `dependencies`), v2 and v3 (`packages` map). When a v2
 * file carries both shapes the `packages` map wins, which prevents every
 * package from being reported twice.
 * @param {string} text Raw lockfile content.
 * @param {string} file File name used in error messages.
 * @returns {{format: string, entries: Entry[]}} Parsed lockfile.
 * @throws {ParseError} When the file is not valid JSON or has no dependencies.
 */
function parseNpm(text, file) {
  const source = stripBom(text);
  let data;
  try {
    data = JSON.parse(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ParseError('invalid JSON: ' + message, file, errorLine(message, source));
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ParseError('lockfile root must be a JSON object', file, 0);
  }

  const version = Number(data.lockfileVersion || 1);
  const format = version >= 3 ? 'npm-v3' : version === 2 ? 'npm-v2' : 'npm-v1';
  const lines = collectResolvedLines(source);
  /** @type {Entry[]} */
  const entries = [];

  /**
   * @param {unknown} pkg Candidate package object.
   * @param {string} fallbackName Name derived from the map key.
   * @returns {void}
   */
  const push = (pkg, fallbackName) => {
    if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) return;
    const record = /** @type {Record<string, unknown>} */ (pkg);
    const resolved = typeof record.resolved === 'string' ? record.resolved : '';
    const name = typeof record.name === 'string' && record.name ? record.name : fallbackName;
    if (!resolved || !name) return;
    if (record.link === true) return;
    entries.push({
      name: name,
      version: typeof record.version === 'string' ? record.version : '',
      ref: resolved,
      line: takeLine(lines, resolved),
      parser: 'npm',
    });
  };

  const packages = data.packages;
  if (packages && typeof packages === 'object' && !Array.isArray(packages)) {
    for (const key of Object.keys(packages)) {
      if (!key) continue;
      push(packages[key], nameFromPath(key));
    }
  } else if (data.dependencies && typeof data.dependencies === 'object') {
    /**
     * Walk the v1 nested dependency tree depth first, matching file order.
     * @param {Record<string, unknown>} deps Dependency map.
     * @returns {void}
     */
    const walk = (deps) => {
      for (const name of Object.keys(deps)) {
        const pkg = deps[name];
        push(pkg, name);
        if (pkg && typeof pkg === 'object') {
          const nested = /** @type {Record<string, unknown>} */ (pkg).dependencies;
          if (nested && typeof nested === 'object') {
            walk(/** @type {Record<string, unknown>} */ (nested));
          }
        }
      }
    };
    walk(/** @type {Record<string, unknown>} */ (data.dependencies));
  } else {
    throw new ParseError('no "packages" or "dependencies" section found', file, 0);
  }

  return { format: format, entries: entries };
}

module.exports = { parseNpm, nameFromPath };
