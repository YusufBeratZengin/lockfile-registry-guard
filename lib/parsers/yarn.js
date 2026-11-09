'use strict';

const { ParseError } = require('../errors');

/**
 * @typedef {import('./common').Entry} Entry
 */

/**
 * Extract a package name from a Yarn descriptor such as
 * `@scope/pkg@^1.0.0`, `pkg@npm:^1.0.0` or `pkg@https://example.test/pkg.tgz`.
 * @param {string} descriptor Raw descriptor (quotes already stripped).
 * @returns {string} Package name, empty string when it cannot be derived.
 */
function nameFromDescriptor(descriptor) {
  const text = descriptor.trim();
  if (!text) return '';
  if (text[0] === '@') {
    const slash = text.indexOf('/');
    if (slash === -1) return text;
    const at = text.indexOf('@', slash);
    return at === -1 ? text : text.slice(0, at);
  }
  const at = text.indexOf('@');
  return at === -1 ? text : text.slice(0, at);
}

/**
 * Split a comma separated descriptor list on top level commas.
 * @param {string} text Descriptor list, e.g. `"a@^1", "a@^2"`.
 * @returns {string[]} Individual descriptors with quotes removed.
 */
function splitDescriptors(text) {
  /** @type {string[]} */
  const out = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ',') {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * Whether a `__metadata` value is a single, balanced YAML scalar.
 *
 * Metadata values are plain scalars in every Berry release; an unclosed flow
 * collection or quote means the block was truncated and must not be trusted.
 * @param {string} value Raw value after the colon.
 * @returns {boolean} True when brackets and quotes balance.
 */
function isBalancedScalar(value) {
  let quote = '';
  /** @type {string[]} */
  const brackets = [];
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '#' && brackets.length === 0) break;
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') brackets.push(ch);
    else if (ch === ']' || ch === '}') {
      if (brackets.pop() !== (ch === ']' ? '[' : '{')) return false;
    }
  }
  return quote === '' && brackets.length === 0;
}

/**
 * Validate the indented block under a yarn Berry `__metadata:` header.
 * @param {string[]} lines Lockfile lines.
 * @param {number} headerIndex Index of the `__metadata:` line.
 * @param {string} file File name used in error messages.
 * @returns {void}
 * @throws {ParseError} When a metadata line is not a well formed `key: value`.
 */
function validateMetadata(lines, headerIndex, file) {
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (/^[ \t]*/.exec(raw)[0].length === 0) return;
    const match = /^[A-Za-z][A-Za-z0-9_-]*:\s+(\S.*)$/.exec(trimmed);
    if (!match || !isBalancedScalar(match[1])) {
      throw new ParseError('malformed __metadata block', file, i + 1);
    }
  }
}

/**
 * Parse a `yarn.lock` file, both the classic (v1) and the Berry (v2+) dialects.
 *
 * Classic entries carry a `resolved "https://..."` line, Berry entries carry a
 * `resolution: "pkg@npm:1.0.0"` line. Both are returned as references and the
 * validator decides which of them are acceptable.
 * @param {string} text Raw lockfile content.
 * @param {string} file File name used in error messages.
 * @returns {{format: string, entries: Entry[]}} Parsed lockfile.
 * @throws {ParseError} When the document does not look like a yarn.lock.
 */
function parseYarn(text, file) {
  const lines = text.split(/\r?\n/);
  const berry = /^__metadata:/m.test(text) || /^\s{2}resolution: /m.test(text);
  const format = berry ? 'yarn-berry' : 'yarn-classic';
  /** @type {Entry[]} */
  const entries = [];
  let current = null;
  let sawHeader = false;
  let sawMetadata = false;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNo = i + 1;
    if (/^\s*(#|$)/.test(raw)) continue;
    if (/^__metadata:/.test(raw)) {
      if (!/^__metadata:(?:[ \t]+#.*)?[ \t]*$/.test(raw)) {
        throw new ParseError('malformed __metadata block', file, lineNo);
      }
      sawMetadata = true;
      validateMetadata(lines, i, file);
      current = null;
      continue;
    }
    const indent = /^[ \t]*/.exec(raw)[0].length;
    const body = raw.trim();

    if (indent === 0) {
      if (!body.endsWith(':')) {
        throw new ParseError('expected a descriptor header ending with ":"', file, lineNo);
      }
      sawHeader = true;
      const descriptors = splitDescriptors(body.slice(0, -1));
      const descriptor = descriptors[0] || '';
      current = {
        name: nameFromDescriptor(descriptor),
        version: '',
        ref: null,
        line: 0,
        parser: 'yarn',
        descriptor: descriptor,
        resolved: null,
        versionLine: lineNo,
      };
      entries.push(current);
      continue;
    }

    if (!current) continue;
    if (indent !== 2) continue;

    const classic = /^([a-zA-Z]+)\s+(.*)$/.exec(body);
    const modern = /^([a-zA-Z]+):\s*(.*)$/.exec(body);
    if (berry && modern) {
      const key = modern[1];
      const value = modern[2].trim().replace(/^"(.*)"$/, '$1');
      if (key === 'version') current.version = value;
      else if (key === 'resolution') {
        current.resolved = value;
        current.ref = value;
        current.line = lineNo;
      }
    } else if (!berry && classic) {
      const key = classic[1];
      const value = classic[2].trim().replace(/^"(.*)"$/, '$1');
      if (key === 'version') current.version = value;
      else if (key === 'resolved') {
        current.resolved = value;
        current.ref = value;
        current.line = lineNo;
      }
    }
  }

  const hasContent = lines.some((line) => {
    const trimmed = line.trim();
    return trimmed !== '' && !trimmed.startsWith('#');
  });
  if (!sawHeader && !sawMetadata && hasContent) {
    throw new ParseError('no package blocks found', file, 0);
  }

  /** @type {Entry[]} */
  const cleaned = [];
  for (const item of entries) {
    if (!item.name) continue;
    cleaned.push({
      name: item.name,
      version: item.version,
      ref: item.ref,
      line: item.line || item.versionLine,
      parser: 'yarn',
    });
  }
  return { format: format, entries: cleaned };
}

module.exports = { parseYarn, nameFromDescriptor, splitDescriptors };
