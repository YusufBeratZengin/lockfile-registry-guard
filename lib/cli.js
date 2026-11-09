'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ConfigError, ParseError } = require('./errors');
const { parseArgs, resolveConfig } = require('./config');
const { detectLockfiles } = require('./detect');
const { parseLockfile } = require('./parsers');
const { validateEntries, RULES } = require('./validator');
const { buildReport, render, formatSarif } = require('./report');
const pkg = require('../package.json');

/**
 * @typedef {import('./config').Config} Config
 * @typedef {import('./report').FileReport} FileReport
 * @typedef {import('./validator').Violation} Violation
 * @typedef {Object} Io
 * @property {NodeJS.WritableStream} stdout Standard output.
 * @property {NodeJS.WritableStream} stderr Standard error.
 * @property {NodeJS.ProcessEnv} [env] Environment variables.
 * @property {boolean} [isTTY] Whether stdout is a terminal.
 */

const HELP = [
  'lockfile-registry-guard ' + pkg.version,
  'Reject lockfile entries that resolve outside your approved registries.',
  '',
  'Usage',
  '  lockfile-registry-guard [options] [lockfile|directory ...]',
  '',
  'Options',
  '  --allowed-hosts <host[,host...]>  Replace the registry allowlist (repeatable)',
  '  --add-host <host[,host...]>       Append to the registry allowlist (repeatable)',
  '  --allow-git-hosts <host[,host...]> Git hosts allowed for git dependencies',
  '  --scope <@scope=host,...>    Registry hosts required for a package scope',
  '  --enforce-https              Reject plain HTTP and unencrypted git (default)',
  '  --no-enforce-https           Allow plain HTTP (not recommended)',
  '  --allow-file-refs            Allow file:/link:/patch: references (default)',
  '  --no-allow-file-refs         Reject local file references',
  '  --require-git-commit-pin     Require a full commit SHA for git dependencies',
  '  --format <human|json|sarif>  Output format (default: human)',
  '  --json                       Shorthand for --format json',
  '  --sarif-file <path>          Also write a SARIF 2.1.0 report',
  '  --config <path>              Configuration file (JSON)',
  '  --max-violations <n>         Limit how many violations are reported',
  '  --quiet                      Only print violations and the verdict',
  '  --no-color                   Disable ANSI colours',
  '  --fail-on-warnings           Fail the gate on warnings too',
  '  --cwd <dir>                  Directory to scan (default: current directory)',
  '  -h, --help                   Show this help',
  '  -v, --version                Show the version',
  '',
  'Exit codes: 0 pass, 1 policy violation, 2 usage or configuration error.',
  '',
].join('\n');

/**
 * Resolve the lockfiles to scan from explicit arguments or discovery.
 * @param {Config} config Effective configuration.
 * @returns {string[]} Absolute lockfile paths.
 * @throws {ConfigError} When an explicit path does not exist.
 */
function collectTargets(config) {
  /** @type {string[]} */
  const targets = [];
  if (config.files.length > 0) {
    for (const entry of config.files) {
      const full = path.resolve(config.cwd, entry);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch (err) {
        throw new ConfigError('lockfile not found: ' + entry);
      }
      if (stat.isDirectory()) {
        for (const found of detectLockfiles(full)) targets.push(found);
      } else {
        targets.push(full);
      }
    }
  } else {
    for (const found of detectLockfiles(config.cwd)) targets.push(found);
  }
  return Array.from(new Set(targets));
}

/**
 * Build the violation used when a directory holds no supported lockfile.
 * @param {string} file Display name.
 * @returns {Violation} NO_LOCKFILE violation.
 */
function noLockfileViolation(file) {
  return {
    code: 'NO_LOCKFILE',
    severity: 'error',
    file: file,
    line: 0,
    name: '',
    version: '',
    url: '',
    message: 'no package-lock.json, yarn.lock or pnpm-lock.yaml was found in ' + file,
    expected: 'at least one supported lockfile',
    title: RULES.NO_LOCKFILE.title,
  };
}

/**
 * Build the violation used when a lockfile cannot be parsed.
 * @param {string} file Display name.
 * @param {ParseError} error Parse error.
 * @returns {Violation} PARSE_ERROR violation.
 */
function parseErrorViolation(file, error) {
  return {
    code: 'PARSE_ERROR',
    severity: 'error',
    file: file,
    line: error.line || 0,
    name: '',
    version: '',
    url: '',
    message: error.message,
    expected: 'a valid ' + path.basename(file),
    title: RULES.PARSE_ERROR.title,
  };
}

/**
 * Scan one lockfile and validate every entry.
 * @param {string} target Absolute path.
 * @param {Config} config Effective configuration.
 * @returns {FileReport} Result for this file.
 * @throws {ConfigError} When the file cannot be read.
 */
function scanFile(target, config) {
  const display = path.relative(config.cwd, target) || path.basename(target);
  let text;
  try {
    text = fs.readFileSync(target, 'utf8');
  } catch (err) {
    throw new ConfigError('cannot read ' + display);
  }
  try {
    const parsed = parseLockfile(text, display);
    return {
      file: display.split(path.sep).join('/'),
      format: parsed.format,
      packages: parsed.entries.length,
      violations: validateEntries(parsed.entries, config, display.split(path.sep).join('/')),
      error: '',
    };
  } catch (err) {
    if (err instanceof ParseError) {
      return {
        file: display.split(path.sep).join('/'),
        format: 'unknown',
        packages: 0,
        violations: [parseErrorViolation(display.split(path.sep).join('/'), err)],
        error: err.message,
      };
    }
    throw err;
  }
}

/**
 * Run the CLI.
 * @param {string[]} argv Arguments without node and script.
 * @param {Io} io Output streams.
 * @returns {number} Exit code: 0 pass, 1 violation, 2 usage error.
 */
function runCli(argv, io) {
  const stdout = io.stdout;
  const stderr = io.stderr;

  let args;
  let config;
  try {
    args = parseArgs(argv);
    if (args.help) {
      stdout.write(HELP);
      return 0;
    }
    if (args.version) {
      stdout.write(pkg.version + '\n');
      return 0;
    }
    config = resolveConfig(args, io.env || process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      stderr.write('lockfile-registry-guard: ' + err.message + '\n');
      return 2;
    }
    throw err;
  }
  config.color = config.color && Boolean(io.isTTY);

  /** @type {FileReport[]} */
  const files = [];
  try {
    const targets = collectTargets(config);
    if (targets.length === 0) {
      files.push({
        file: config.cwd,
        format: 'unknown',
        packages: 0,
        violations: [noLockfileViolation(config.cwd)],
        error: '',
      });
    } else {
      for (const target of targets) files.push(scanFile(target, config));
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      stderr.write('lockfile-registry-guard: ' + err.message + '\n');
      return 2;
    }
    throw err;
  }

  const report = buildReport(files, config, pkg.version);
  const options = { color: config.color, quiet: config.quiet };
  stdout.write(render(report, config.format, options));

  if (config.sarifFile) {
    try {
      const full = path.resolve(config.cwd, config.sarifFile);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, formatSarif(report));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stderr.write('lockfile-registry-guard: cannot write SARIF report: ' + message + '\n');
      return 2;
    }
  }

  return report.ok ? 0 : 1;
}

module.exports = { runCli, collectTargets, scanFile, HELP, noLockfileViolation, parseErrorViolation };
