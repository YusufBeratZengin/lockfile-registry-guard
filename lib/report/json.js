'use strict';

/**
 * Machine readable shape of one violation.
 * @typedef {Object} JsonViolation
 * @property {string} code Rule id.
 * @property {string} severity `error` or `warning`.
 * @property {string} file Lockfile name.
 * @property {number} line 1-based line number.
 * @property {string} package Package name.
 * @property {string} version Package version.
 * @property {string} resolved Offending reference.
 * @property {string} message Explanation.
 * @property {string} expected Expected value.
 */

/**
 * Convert a violation to its stable JSON shape.
 * @param {import('../validator').Violation} item Violation.
 * @returns {JsonViolation} JSON friendly violation.
 */
function serialize(item) {
  return {
    code: item.code,
    severity: item.severity,
    file: item.file,
    line: item.line,
    package: item.name,
    version: item.version,
    resolved: item.url,
    message: item.message,
    expected: item.expected,
  };
}

/**
 * Render the JSON report used by `--format json`.
 * @param {import('./index').Report} report Run report.
 * @returns {string} Pretty printed JSON with a trailing newline.
 */
function formatJson(report) {
  const payload = {
    tool: report.tool,
    ok: report.ok,
    summary: report.summary,
    policy: report.policy,
    files: report.files.map((file) => ({
      file: file.file,
      format: file.format,
      packages: file.packages,
      error: file.error,
      violations: file.violations.map(serialize),
    })),
    violations: report.violations.map(serialize),
  };
  return JSON.stringify(payload, null, 2) + '\n';
}

module.exports = { formatJson, serialize };
