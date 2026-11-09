'use strict';

const { countViolations } = require('../validator');
const { formatHuman } = require('./human');
const { formatJson } = require('./json');
const { formatSarif } = require('./sarif');

/**
 * @typedef {import('../validator').Violation} Violation
 *
 * @typedef {Object} FileReport
 * @property {string} file Path or name shown in reports.
 * @property {string} format Lockfile dialect, e.g. `npm-v3`.
 * @property {number} packages Number of parsed package entries.
 * @property {Violation[]} violations Violations for this file.
 * @property {string} error Parse error message, empty when parsing succeeded.
 *
 * @typedef {Object} Report
 * @property {{name: string, version: string}} tool Tool identity.
 * @property {{allowedHosts: string[], allowedGitHosts: string[], enforceHttps: boolean,
 *   allowFileRefs: boolean, requireGitCommitPin: boolean, failOnWarnings: boolean,
 *   scoped: Record<string, {hosts: string[]}>}} policy Effective policy.
 * @property {FileReport[]} files Per-file results.
 * @property {Violation[]} violations Merged violations in file order.
 * @property {{files: number, packages: number, errors: number, warnings: number}} summary Totals.
 * @property {boolean} ok Whether the gate passes.
 */

/**
 * Merge per-file results into the report consumed by every renderer.
 * @param {FileReport[]} files Per-file results.
 * @param {import('../config').Config} config Effective configuration.
 * @param {string} version Tool version.
 * @returns {Report} Run report.
 */
function buildReport(files, config, version) {
  /** @type {Violation[]} */
  const violations = [];
  let packages = 0;
  for (const file of files) {
    packages += file.packages;
    for (const item of file.violations) violations.push(item);
  }
  let limited = violations;
  if (config.maxViolations > 0 && violations.length > config.maxViolations) {
    limited = violations.slice(0, config.maxViolations);
  }
  const counts = countViolations(violations);
  return {
    tool: { name: 'lockfile-registry-guard', version: version },
    policy: {
      allowedHosts: config.allowedHosts,
      allowedGitHosts: config.allowedGitHosts,
      enforceHttps: config.enforceHttps,
      allowFileRefs: config.allowFileRefs,
      requireGitCommitPin: config.requireGitCommitPin,
      failOnWarnings: config.failOnWarnings,
      scoped: config.scoped,
    },
    files: files,
    violations: limited,
    summary: {
      files: files.length,
      packages: packages,
      errors: counts.errors,
      warnings: counts.warnings,
    },
    ok: counts.errors === 0 && !(config.failOnWarnings && counts.warnings > 0),
  };
}

/**
 * Render a report in the requested format.
 * @param {Report} report Run report.
 * @param {'human'|'json'|'sarif'} format Output format.
 * @param {{color?: boolean, quiet?: boolean}} [options] Human renderer options.
 * @returns {string} Rendered output.
 */
function render(report, format, options) {
  if (format === 'json') return formatJson(report);
  if (format === 'sarif') return formatSarif(report);
  return formatHuman(report, options);
}

module.exports = { buildReport, render, formatHuman, formatJson, formatSarif };
