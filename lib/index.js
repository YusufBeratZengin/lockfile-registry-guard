'use strict';

const { defaultConfig, applyConfigData, resolveConfig, parseArgs } = require('./config');
const { validateEntries } = require('./validator');
const { parseLockfile } = require('./parsers');

/**
 * @typedef {import('./config').Config} Config
 * @typedef {import('./parsers/common').Entry} Entry
 * @typedef {import('./validator').Violation} Violation
 */

/**
 * Build a configuration object from defaults plus overrides, without touching
 * the file system. Useful when the guard is embedded in another tool.
 * @param {Record<string, unknown>} [overrides] Configuration keys.
 * @returns {Config} Configuration.
 * @throws {import('./errors').ConfigError} When a key or value is invalid.
 */
function createConfig(overrides) {
  const config = defaultConfig();
  if (overrides) applyConfigData(config, overrides, 'config');
  return config;
}

/**
 * Parse and validate a lockfile held in memory.
 * @param {string} text Lockfile content.
 * @param {{file?: string, config?: Config}} [options] File name and policy.
 * @returns {{format: string, entries: Entry[], violations: Violation[], ok: boolean}} Result.
 * @throws {import('./errors').ParseError} When the lockfile cannot be parsed.
 */
function validateLockfile(text, options) {
  const settings = options || {};
  const file = settings.file || 'package-lock.json';
  const config = settings.config || defaultConfig();
  const parsed = parseLockfile(text, file);
  const violations = validateEntries(parsed.entries, config, file);
  return {
    format: parsed.format,
    entries: parsed.entries,
    violations: violations,
    ok: violations.length === 0,
  };
}

module.exports = {
  createConfig,
  validateLockfile,
  parseLockfile,
  parseArgs,
  resolveConfig,
  validateEntries,
  defaultConfig,
};
