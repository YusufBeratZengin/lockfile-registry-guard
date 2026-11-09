'use strict';

const { ParseError } = require('../errors');
const { parseNpm } = require('./npm');
const { parseYarn } = require('./yarn');
const { parsePnpm } = require('./pnpm');
const { detectParser } = require('../detect');

/**
 * @typedef {import('./common').Entry} Entry
 */

/**
 * Parse a lockfile with the parser that matches its name or content.
 * @param {string} text Raw lockfile content.
 * @param {string} file File name, used for parser selection and error messages.
 * @returns {{format: string, entries: Entry[]}} Parsed lockfile.
 * @throws {ParseError} When the file is unsupported or malformed.
 */
function parseLockfile(text, file) {
  const parser = detectParser(file, text);
  if (parser === 'npm') return parseNpm(text, file);
  if (parser === 'yarn') return parseYarn(text, file);
  if (parser === 'pnpm') return parsePnpm(text, file);
  throw new ParseError('unsupported lockfile format', file, 0);
}

module.exports = { parseLockfile, parseNpm, parseYarn, parsePnpm };
