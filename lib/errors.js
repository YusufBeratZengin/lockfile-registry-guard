'use strict';

/**
 * Base class for every error the guard raises on purpose.
 */
class GuardError extends Error {
  /**
   * @param {string} message Human readable message.
   * @param {string} code Stable machine readable code.
   */
  constructor(message, code) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/**
 * Raised when a lockfile cannot be parsed. Always carries the file name so the
 * CLI can turn it into a single PARSE_ERROR violation instead of a stack trace.
 */
class ParseError extends GuardError {
  /**
   * @param {string} message Human readable message.
   * @param {string} file Lockfile name, e.g. `pnpm-lock.yaml`.
   * @param {number} line 1-based line number, 0 when unknown.
   */
  constructor(message, file, line) {
    super(message + (file ? ' (' + file + (line ? ':' + line : '') + ')' : ''), 'PARSE_ERROR');
    this.file = file;
    this.line = line || 0;
  }
}

/**
 * Raised for invalid CLI flags or an invalid configuration file.
 */
class ConfigError extends GuardError {
  /**
   * @param {string} message Human readable message.
   */
  constructor(message) {
    super(message, 'CONFIG_ERROR');
  }
}

module.exports = { GuardError, ParseError, ConfigError };
