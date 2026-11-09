'use strict';

/**
 * @typedef {Object} Entry
 * @property {string} name Package name as written in the lockfile.
 * @property {string} version Resolved version, empty string when unknown.
 * @property {string|null} ref The raw download reference (URL, git spec, file spec).
 * @property {number} line 1-based line of the reference, 0 when unknown.
 * @property {string} parser Parser id, e.g. `npm`.
 */

/**
 * Build an array with the offset of every line start. Offsets are 0-based.
 * @param {string} text Source text.
 * @returns {number[]} Line start offsets.
 */
function buildLineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/**
 * Map a character offset to a 1-based line number using binary search.
 * @param {number[]} starts Line start offsets from {@link buildLineIndex}.
 * @param {number} offset Character offset.
 * @returns {number} 1-based line number.
 */
function lineAt(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/**
 * Collect every `"resolved": "..."` value of a JSON lockfile together with the
 * line it sits on. Lockfile URLs are unique in practice, but the values are
 * stored as a queue so duplicated URLs still get their own line numbers.
 * @param {string} text Raw JSON text.
 * @returns {Map<string, number[]>} URL to the lines it appears on, in file order.
 */
function collectResolvedLines(text) {
  const starts = buildLineIndex(text);
  const map = new Map();
  const re = /"resolved"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match = re.exec(text);
  while (match !== null) {
    const value = match[1].replace(/\\(["\\/])/g, '$1');
    const list = map.get(value);
    const line = lineAt(starts, match.index);
    if (list) list.push(line);
    else map.set(value, [line]);
    match = re.exec(text);
  }
  return map;
}

/**
 * Pop the next known line for a reference, or 0 when the line is unknown.
 * @param {Map<string, number[]>} lines Result of {@link collectResolvedLines}.
 * @param {string} value Reference value.
 * @returns {number} 1-based line number or 0.
 */
function takeLine(lines, value) {
  const list = lines.get(value);
  if (!list || list.length === 0) return 0;
  return list.shift();
}

/**
 * Remove a UTF-8 byte order mark, which some Windows tools leave behind.
 * @param {string} text Raw text.
 * @returns {string} Text without BOM.
 */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Cheaply guess the YAML dialect of a pnpm lockfile from its lockfileVersion.
 * @param {string} value Value of the top level `lockfileVersion` key.
 * @returns {string} One of `pnpm-v5`, `pnpm-v6`, `pnpm-v9` and `pnpm` for unknown.
 */
function pnpmDialect(value) {
  const major = parseInt(String(value || '0').split('.')[0], 10);
  if (major >= 9) return 'pnpm-v9';
  if (major >= 6) return 'pnpm-v6';
  if (major >= 5) return 'pnpm-v5';
  return 'pnpm';
}

module.exports = {
  buildLineIndex,
  lineAt,
  collectResolvedLines,
  takeLine,
  stripBom,
  pnpmDialect,
};
