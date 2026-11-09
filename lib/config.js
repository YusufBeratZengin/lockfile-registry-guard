'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ConfigError } = require('./errors');

/**
 * @typedef {Object} Config
 * @property {string[]} allowedHosts Registry hosts a package may be downloaded from.
 * @property {string[]} allowedGitHosts Git hosts a dependency may be fetched from.
 * @property {boolean} enforceHttps Reject plain HTTP and unencrypted git transports.
 * @property {boolean} allowFileRefs Allow `file:`, `link:` and `patch:` references.
 * @property {boolean} requireGitCommitPin Require a full commit SHA for git dependencies.
 * @property {Record<string, {hosts: string[]}>} scoped Per-scope registry rules.
 * @property {'human'|'json'|'sarif'} format Output format.
 * @property {string} sarifFile Optional path for an extra SARIF report.
 * @property {boolean} quiet Only print violations and the final verdict.
 * @property {boolean} color Use ANSI colours.
 * @property {boolean} failOnWarnings Treat warnings as a failing gate.
 * @property {number} maxViolations Stop reporting after N violations, 0 = unlimited.
 * @property {string} cwd Directory used to discover lockfiles.
 * @property {string[]} files Explicit lockfile paths, empty for auto-detection.
 * @property {string} configPath Path of the configuration file in use, empty when none.
 */

/** Configuration file names looked up in the working directory, in order. */
const CONFIG_FILES = ['.lockfileguardrc', '.lockfileguardrc.json', 'lockfileguard.config.json'];

/** Keys accepted in a configuration file. */
const CONFIG_KEYS = [
  'allowedHosts',
  'allowedGitHosts',
  'enforceHttps',
  'allowFileRefs',
  'requireGitCommitPin',
  'scoped',
  'format',
  'sarifFile',
  'quiet',
  'failOnWarnings',
];

/**
 * @returns {Config} Configuration with the documented defaults.
 */
function defaultConfig() {
  return {
    allowedHosts: ['registry.npmjs.org', 'registry.yarnpkg.com'],
    allowedGitHosts: ['github.com', 'gitlab.com', 'bitbucket.org'],
    enforceHttps: true,
    allowFileRefs: true,
    requireGitCommitPin: false,
    scoped: {},
    format: 'human',
    sarifFile: '',
    quiet: false,
    color: true,
    failOnWarnings: false,
    maxViolations: 0,
    cwd: process.cwd(),
    files: [],
    configPath: '',
  };
}

/**
 * Normalize a host pattern: drop a scheme, a path and a trailing dot.
 * @param {unknown} value Raw host value.
 * @param {string} source Description used in error messages.
 * @returns {string} Normalized host.
 * @throws {ConfigError} When the value is not a usable host.
 */
function normalizeHost(value, source) {
  if (typeof value !== 'string') throw new ConfigError(source + ': host must be a string');
  let host = value.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const slash = host.indexOf('/');
  if (slash !== -1) host = host.slice(0, slash);
  host = host.replace(/\.$/, '');
  if (!host) throw new ConfigError(source + ': empty host');
  if (!/^(\*\.)?[a-z0-9][a-z0-9.-]*(:\d+)?$/.test(host)) {
    throw new ConfigError(source + ': "' + value + '" is not a valid host name');
  }
  return host;
}

/**
 * Normalize a list of hosts.
 * @param {unknown} value Raw value from a config file or CLI flag.
 * @param {string} source Description used in error messages.
 * @returns {string[]} Normalized, de-duplicated hosts.
 * @throws {ConfigError} When the value is not a list.
 */
function normalizeHostList(value, source) {
  if (!Array.isArray(value)) throw new ConfigError(source + ': expected a list of hosts');
  /** @type {string[]} */
  const out = [];
  for (const item of value) {
    const host = normalizeHost(item, source);
    if (out.indexOf(host) === -1) out.push(host);
  }
  if (out.length === 0) throw new ConfigError(source + ': at least one host is required');
  return out;
}

/**
 * Normalize the `scoped` block, accepting both `"@corp": ["host"]` and
 * `"@corp": {"hosts": ["host"]}` shapes.
 * @param {unknown} value Raw value.
 * @returns {Record<string, {hosts: string[]}>} Normalized rules.
 * @throws {ConfigError} When a scope or host is invalid.
 */
function normalizeScoped(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError('scoped: expected an object keyed by "@scope"');
  }
  /** @type {Record<string, {hosts: string[]}>} */
  const out = {};
  for (const key of Object.keys(value)) {
    if (!/^@[a-z0-9][a-z0-9._-]*$/i.test(key)) {
      throw new ConfigError('scoped: "' + key + '" is not a valid scope (expected @scope)');
    }
    const rule = /** @type {Record<string, unknown>} */ (value[key]);
    const hosts = Array.isArray(rule) ? rule : rule && rule.hosts;
    out[key.toLowerCase()] = {
      hosts: normalizeHostList(hosts, 'scoped[' + key + ']'),
    };
  }
  return out;
}

/**
 * Validate and merge a configuration file into a config object.
 * @param {Config} config Target configuration, modified in place.
 * @param {unknown} data Parsed JSON document.
 * @param {string} file Path used in error messages.
 * @returns {Config} The same configuration object.
 * @throws {ConfigError} On unknown keys or invalid values.
 */
function applyConfigData(config, data, file) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ConfigError(file + ': configuration root must be a JSON object');
  }
  const record = /** @type {Record<string, unknown>} */ (data);
  for (const key of Object.keys(record)) {
    if (CONFIG_KEYS.indexOf(key) === -1) {
      throw new ConfigError(file + ': unknown configuration key "' + key + '"');
    }
  }
  if (record.allowedHosts !== undefined) {
    config.allowedHosts = normalizeHostList(record.allowedHosts, file + ': allowedHosts');
  }
  if (record.allowedGitHosts !== undefined) {
    config.allowedGitHosts = normalizeHostList(record.allowedGitHosts, file + ': allowedGitHosts');
  }
  if (record.scoped !== undefined) config.scoped = normalizeScoped(record.scoped);
  for (const key of ['enforceHttps', 'allowFileRefs', 'requireGitCommitPin', 'quiet', 'failOnWarnings']) {
    if (record[key] === undefined) continue;
    if (typeof record[key] !== 'boolean') {
      throw new ConfigError(file + ': ' + key + ' must be true or false');
    }
    config[key] = record[key];
  }
  if (record.format !== undefined) {
    if (record.format !== 'human' && record.format !== 'json' && record.format !== 'sarif') {
      throw new ConfigError(file + ': format must be human, json or sarif');
    }
    config.format = record.format;
  }
  if (record.sarifFile !== undefined) {
    if (typeof record.sarifFile !== 'string') throw new ConfigError(file + ': sarifFile must be a string');
    config.sarifFile = record.sarifFile;
  }
  return config;
}

/**
 * Read and apply a configuration file.
 * @param {Config} config Target configuration.
 * @param {string} file Absolute or relative path.
 * @returns {Config} The same configuration object.
 * @throws {ConfigError} When the file is missing or invalid.
 */
function loadConfigFile(config, file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new ConfigError('cannot read config file ' + file);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError('invalid JSON in ' + file + ': ' + message);
  }
  config.configPath = file;
  return applyConfigData(config, data, file);
}

/**
 * Find the first configuration file in a directory.
 * @param {string} cwd Directory to inspect.
 * @returns {string} Path of the config file, empty when none exists.
 */
function findConfigFile(cwd) {
  for (const name of CONFIG_FILES) {
    const candidate = path.join(cwd, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return '';
}

/**
 * @typedef {Object} CliArgs
 * @property {Set<string>} explicit Names of options set on the command line.
 * @property {boolean} help Whether `--help` was requested.
 * @property {boolean} version Whether `--version` was requested.
 * @property {string[]} files Positional arguments.
 * @property {Record<string, unknown>} values Raw option values.
 */

/**
 * Split a comma separated list value.
 * @param {string} value Raw value.
 * @returns {string[]} Trimmed, non-empty items.
 */
function splitCommaList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/**
 * Parse command line arguments. Unknown flags are rejected instead of ignored,
 * because a typo in `--allowed-hosts` must not silently disable the policy.
 * @param {string[]} argv Arguments without the node and script entries.
 * @returns {CliArgs} Parsed arguments.
 * @throws {ConfigError} On an unknown flag or a missing value.
 */
function parseArgs(argv) {
  /** @type {CliArgs} */
  const result = { explicit: new Set(), help: false, version: false, files: [], values: {} };
  let i = 0;

  /**
   * Collect the remaining values of a list flag.
   * @param {string|null} inline Value supplied with `=`.
   * @returns {string[]} Collected values.
   * @throws {ConfigError} When no value is present.
   */
  const takeList = (inline) => {
    if (inline !== null) return splitCommaList(inline);
    // Consume exactly one token. Swallowing every following non-dash argument
    // made `--allowed-hosts X ./project` treat the target path as a host and
    // silently scan the current directory instead.
    if (i >= argv.length || argv[i].startsWith('-')) {
      throw new ConfigError('missing value for ' + argv[i - 1]);
    }
    const value = argv[i];
    i += 1;
    return splitCommaList(value);
  };

  /**
   * Read the value of a single-value flag.
   * @param {string|null} inline Value supplied with `=`.
   * @param {string} flag Flag name for the error message.
   * @returns {string} Value.
   * @throws {ConfigError} When no value is present.
   */
  const takeValue = (inline, flag) => {
    if (inline !== null) return inline;
    if (i >= argv.length) throw new ConfigError('missing value for ' + flag);
    const value = argv[i];
    i += 1;
    return value;
  };

  while (i < argv.length) {
    const rawArg = argv[i];
    i += 1;
    let arg = rawArg;
    let inline = null;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        inline = arg.slice(eq + 1);
        arg = arg.slice(0, eq);
      }
    }
    if (arg === '-h' || arg === '--help') {
      result.help = true;
      continue;
    }
    if (arg === '-v' || arg === '--version') {
      result.version = true;
      continue;
    }
    if (arg === '--allowed-hosts') {
      // Repeatable: every occurrence contributes to the replacement list.
      const list = takeList(inline);
      result.values.allowedHosts = (result.values.allowedHosts || []).concat(list);
      result.explicit.add('allowedHosts');
      continue;
    }
    if (arg === '--add-host') {
      // Repeatable: every occurrence contributes to the extra hosts.
      const list = takeList(inline);
      result.values.addHosts = (result.values.addHosts || []).concat(list);
      result.explicit.add('addHosts');
      continue;
    }
    if (arg === '--allow-git-hosts') {
      const list = takeList(inline);
      result.values.allowedGitHosts = (result.values.allowedGitHosts || []).concat(list);
      result.explicit.add('allowedGitHosts');
      continue;
    }
    if (arg === '--enforce-https') {
      result.values.enforceHttps = true;
      result.explicit.add('enforceHttps');
      continue;
    }
    if (arg === '--no-enforce-https') {
      result.values.enforceHttps = false;
      result.explicit.add('enforceHttps');
      continue;
    }
    if (arg === '--allow-file-refs') {
      result.values.allowFileRefs = true;
      result.explicit.add('allowFileRefs');
      continue;
    }
    if (arg === '--no-allow-file-refs') {
      result.values.allowFileRefs = false;
      result.explicit.add('allowFileRefs');
      continue;
    }
    if (arg === '--require-git-commit-pin') {
      result.values.requireGitCommitPin = true;
      result.explicit.add('requireGitCommitPin');
      continue;
    }
    if (arg === '--no-require-git-commit-pin') {
      result.values.requireGitCommitPin = false;
      result.explicit.add('requireGitCommitPin');
      continue;
    }
    if (arg === '--fail-on-warnings') {
      result.values.failOnWarnings = true;
      result.explicit.add('failOnWarnings');
      continue;
    }
    if (arg === '--quiet') {
      result.values.quiet = true;
      result.explicit.add('quiet');
      continue;
    }
    if (arg === '--no-color') {
      result.values.color = false;
      result.explicit.add('color');
      continue;
    }
    if (arg === '--json') {
      result.values.format = 'json';
      result.explicit.add('format');
      continue;
    }
    if (arg === '--scope') {
      const value = takeValue(inline, '--scope');
      const eq = value.indexOf('=');
      if (eq === -1) throw new ConfigError('--scope expects @scope=host1,host2');
      const scope = value.slice(0, eq).trim();
      const hosts = splitCommaList(value.slice(eq + 1));
      if (!result.values.scopes) result.values.scopes = {};
      /** @type {Record<string, string[]>} */ (result.values.scopes)[scope] = hosts;
      result.explicit.add('scopes');
      continue;
    }
    if (arg === '--config') {
      result.values.configPath = takeValue(inline, '--config');
      continue;
    }
    if (arg === '--format') {
      result.values.format = takeValue(inline, '--format');
      result.explicit.add('format');
      continue;
    }
    if (arg === '--sarif-file') {
      result.values.sarifFile = takeValue(inline, '--sarif-file');
      result.explicit.add('sarifFile');
      continue;
    }
    if (arg === '--max-violations') {
      const value = takeValue(inline, '--max-violations');
      const parsed = parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new ConfigError('--max-violations expects a non-negative integer');
      }
      result.values.maxViolations = parsed;
      result.explicit.add('maxViolations');
      continue;
    }
    if (arg === '--cwd') {
      result.values.cwd = takeValue(inline, '--cwd');
      result.explicit.add('cwd');
      continue;
    }
    if (arg === '--file' || arg === '--lockfile') {
      const value = takeValue(inline, arg);
      result.files.push(value);
      continue;
    }
    if (arg.startsWith('-')) throw new ConfigError('unknown option "' + rawArg + '" (try --help)');
    result.files.push(rawArg);
  }

  if (typeof result.values.format === 'string') {
    const format = result.values.format;
    if (format !== 'human' && format !== 'json' && format !== 'sarif') {
      throw new ConfigError('--format must be human, json or sarif');
    }
  }
  return result;
}

/**
 * Build the effective configuration from defaults, a config file, environment
 * variables and command line flags (later sources win).
 * @param {CliArgs} args Parsed command line arguments.
 * @param {NodeJS.ProcessEnv} env Environment variables.
 * @returns {Config} Resolved configuration.
 * @throws {ConfigError} When any source is invalid.
 */
function resolveConfig(args, env) {
  const config = defaultConfig();
  const environment = env || process.env;
  const cwd = typeof args.values.cwd === 'string' ? path.resolve(args.values.cwd) : process.cwd();
  config.cwd = cwd;

  const explicitPath = typeof args.values.configPath === 'string' ? args.values.configPath : '';
  const envPath = typeof environment.LOCKFILE_GUARD_CONFIG === 'string' ? environment.LOCKFILE_GUARD_CONFIG : '';
  const configPath = explicitPath || envPath || findConfigFile(cwd);
  if (configPath) {
    if (!fs.existsSync(configPath)) throw new ConfigError('config file not found: ' + configPath);
    loadConfigFile(config, path.resolve(configPath));
  }

  if (typeof environment.LOCKFILE_GUARD_ALLOWED_HOSTS === 'string' && environment.LOCKFILE_GUARD_ALLOWED_HOSTS) {
    config.allowedHosts = normalizeHostList(
      splitCommaList(environment.LOCKFILE_GUARD_ALLOWED_HOSTS),
      'LOCKFILE_GUARD_ALLOWED_HOSTS',
    );
  }

  if (args.explicit.has('allowedHosts')) {
    config.allowedHosts = normalizeHostList(args.values.allowedHosts, '--allowed-hosts');
  }
  if (args.explicit.has('addHosts')) {
    const extra = normalizeHostList(args.values.addHosts, '--add-host');
    for (const host of extra) {
      if (config.allowedHosts.indexOf(host) === -1) config.allowedHosts.push(host);
    }
  }
  if (args.explicit.has('allowedGitHosts')) {
    config.allowedGitHosts = normalizeHostList(args.values.allowedGitHosts, '--allow-git-hosts');
  }
  for (const key of ['enforceHttps', 'allowFileRefs', 'requireGitCommitPin', 'quiet', 'failOnWarnings', 'color']) {
    if (args.explicit.has(key)) config[key] = Boolean(args.values[key]);
  }
  if (args.explicit.has('format')) config.format = String(args.values.format);
  if (args.explicit.has('sarifFile')) config.sarifFile = String(args.values.sarifFile);
  if (args.explicit.has('maxViolations')) config.maxViolations = Number(args.values.maxViolations);
  if (args.explicit.has('scopes')) {
    config.scoped = normalizeScoped(args.values.scopes);
  }
  config.files = args.files.slice();
  if (typeof environment.NO_COLOR === 'string' && environment.NO_COLOR !== '') config.color = false;
  return config;
}

module.exports = {
  CONFIG_FILES,
  CONFIG_KEYS,
  defaultConfig,
  normalizeHost,
  normalizeHostList,
  normalizeScoped,
  applyConfigData,
  loadConfigFile,
  findConfigFile,
  parseArgs,
  resolveConfig,
  splitCommaList,
};
