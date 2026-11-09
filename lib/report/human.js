'use strict';

/** ANSI escapes used by the human report. */
const COLORS = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
};

/**
 * Wrap text in an ANSI colour when colour is enabled.
 * @param {boolean} enabled Whether to emit escapes.
 * @param {keyof COLORS} name Colour name.
 * @param {string} text Text to wrap.
 * @returns {string} Painted text.
 */
function paint(enabled, name, text) {
  if (!enabled) return text;
  return COLORS[name] + text + COLORS.reset;
}

/**
 * Render the terminal report.
 * @param {import('./index').Report} report Run report.
 * @param {{color?: boolean, quiet?: boolean}} [options] Rendering options.
 * @returns {string} Report text, newline terminated.
 */
function formatHuman(report, options) {
  const color = Boolean(options && options.color);
  const quiet = Boolean(options && options.quiet);
  /** @type {string[]} */
  const lines = [];

  if (!quiet) {
    lines.push(paint(color, 'bold', report.tool.name + ' ' + report.tool.version));
    const policy = report.policy;
    const bits = [policy.enforceHttps ? 'https-only' : 'http allowed'];
    bits.push('hosts: ' + policy.allowedHosts.join(', '));
    if (policy.requireGitCommitPin) bits.push('git commit pin enforced');
    if (!policy.allowFileRefs) bits.push('file refs rejected');
    lines.push(paint(color, 'dim', 'policy: ' + bits.join(' | ')));
    lines.push('');
  }

  for (const file of report.files) {
    const label = file.file + ' (' + file.format + ')';
    if (file.error) {
      lines.push(paint(color, 'red', 'fail') + '  ' + label + ' — ' + file.error);
      continue;
    }
    const problems = file.violations.length;
    const status = problems === 0 ? paint(color, 'green', 'ok  ') : paint(color, 'red', 'fail');
    const plural = file.packages === 1 ? 'package' : 'packages';
    const detail =
      problems === 0
        ? file.packages + ' ' + plural
        : file.packages + ' ' + plural + ', ' + problems + ' problem(s)';
    lines.push(status + '  ' + label + ' — ' + detail);
  }

  if (report.violations.length > 0) {
    lines.push('');
    for (const item of report.violations) {
      const level =
        item.severity === 'warning' ? paint(color, 'yellow', 'warning') : paint(color, 'red', 'error  ');
      const location = item.file + ':' + (item.line || 1);
      const who = item.version ? item.name + '@' + item.version : item.name;
      lines.push('  ' + level + ' ' + item.code + '  ' + who + '  ' + paint(color, 'dim', location));
      lines.push('         ' + item.message);
      if (item.url) lines.push('         resolved: ' + item.url);
      lines.push('         expected: ' + item.expected);
    }
  }

  const summary = report.summary;
  lines.push('');
  lines.push(
    'summary: ' +
      summary.files +
      ' file(s), ' +
      summary.packages +
      ' package(s), ' +
      summary.errors +
      ' error(s), ' +
      summary.warnings +
      ' warning(s)',
  );

  if (report.ok) {
    lines.push(paint(color, 'green', 'CI gate passed.'));
  } else {
    const total = summary.errors + (report.policy.failOnWarnings ? summary.warnings : 0);
    lines.push(paint(color, 'red', 'CI gate failed: ' + total + ' blocking finding(s).'));
  }

  return lines.join('\n') + '\n';
}

module.exports = { formatHuman, COLORS, paint };
