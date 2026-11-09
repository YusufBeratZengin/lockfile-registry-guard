'use strict';

const { parseRef, scopeOf, maskCredentials } = require('./refs');

/**
 * @typedef {import('./parsers/common').Entry} Entry
 */

/**
 * @typedef {Object} Violation
 * @property {string} code Stable rule id.
 * @property {'error'|'warning'} severity Severity used for exit codes and SARIF.
 * @property {string} file Lockfile name.
 * @property {number} line 1-based line, 0 when unknown.
 * @property {string} name Package name.
 * @property {string} version Package version.
 * @property {string} url Offending reference.
 * @property {string} message Human readable explanation.
 * @property {string} expected What the policy expected instead.
 */

/**
 * Rule catalogue. Keeping it in one place makes the SARIF driver rules and the
 * documentation stay in sync.
 * @type {Record<string, {title: string, description: string}>}
 */
const RULES = {
  HOST_NOT_ALLOWED: {
    title: 'Download host is not allowlisted',
    description: 'The package resolves from a host that is not in allowedHosts.',
  },
  INSECURE_PROTOCOL: {
    title: 'Insecure download protocol',
    description: 'The package is downloaded over plain HTTP or an unencrypted git transport.',
  },
  INVALID_URL: {
    title: 'Unparseable download reference',
    description: 'The resolved/resolution field is not a URL, git reference or local reference.',
  },
  CREDENTIALS_IN_URL: {
    title: 'Credentials embedded in URL',
    description: 'The download URL carries a username or password, which leaks into logs and caches.',
  },
  SCOPE_REGISTRY_MISMATCH: {
    title: 'Scoped package resolved from the wrong registry',
    description: 'A package whose scope has a dedicated registry rule resolved from another host.',
  },
  PRIVATE_REGISTRY_FOR_PUBLIC_PACKAGE: {
    title: 'Public package resolved from a private registry',
    description: 'An unscoped package resolved from a host reserved for an internal scope.',
  },
  GIT_HOST_NOT_ALLOWED: {
    title: 'Git host is not allowlisted',
    description: 'The dependency is fetched from a git host outside allowedGitHosts.',
  },
  GIT_COMMIT_NOT_PINNED: {
    title: 'Git dependency is not pinned to a commit',
    description: 'requireGitCommitPin is enabled but the git reference is not a 40 character commit SHA.',
  },
  FILE_REF_NOT_ALLOWED: {
    title: 'Local file reference is not allowed',
    description: 'allowFileRefs is disabled but the lockfile contains a file:, link: or patch: reference.',
  },
  PARSE_ERROR: {
    title: 'Lockfile could not be parsed',
    description: 'The lockfile is malformed, so its download references cannot be verified.',
  },
  NO_LOCKFILE: {
    title: 'No lockfile found',
    description: 'No supported lockfile exists in the scanned directory.',
  },
};

/**
 * Match a reference host against an allowlist pattern.
 *
 * Patterns are lowercased host names, optionally with `*` as the leftmost label
 * (`*.corp.example`) or with an explicit port (`nexus.corp.example:8081`).
 * @param {import('./refs').Ref} ref Classified reference.
 * @param {string} pattern Allowlist pattern.
 * @returns {boolean} True when the reference host matches.
 */
function hostMatches(ref, pattern) {
  const value = String(pattern || '').trim().toLowerCase();
  if (!value || !ref.hostname) return false;
  if (/:\d+$/.test(value)) return ref.host === value;
  if (value.startsWith('*.')) {
    const suffix = value.slice(1);
    return ref.hostname === value.slice(2) || ref.hostname.endsWith(suffix);
  }
  return ref.hostname === value;
}

/**
 * Match against a list of patterns.
 * @param {import('./refs').Ref} ref Classified reference.
 * @param {string[]} patterns Allowlist patterns.
 * @returns {boolean} True when any pattern matches.
 */
function hostIn(ref, patterns) {
  if (!Array.isArray(patterns)) return false;
  for (const pattern of patterns) {
    if (hostMatches(ref, pattern)) return true;
  }
  return false;
}

/**
 * Flatten the hosts guarded by scoped rules.
 * @param {Record<string, {hosts: string[]}>} scoped Scope rules.
 * @returns {string[]} Hosts that only scoped packages may use.
 */
function privateHostsOf(scoped) {
  /** @type {string[]} */
  const hosts = [];
  if (!scoped) return hosts;
  for (const scope of Object.keys(scoped)) {
    const rule = scoped[scope];
    if (!rule || !Array.isArray(rule.hosts)) continue;
    for (const host of rule.hosts) {
      if (hosts.indexOf(host) === -1) hosts.push(host);
    }
  }
  return hosts;
}

/**
 * Whether a git reference embeds real credentials.
 *
 * `git@host` (and the equivalent `ssh://git@host`) is the standard SSH login
 * for every forge, so it is not a leaked credential. Anything with a password,
 * or any other username (the common `https://token@host` shape), is.
 * @param {import('./refs').Ref} ref Classified reference.
 * @returns {boolean} True when the URL carries credentials worth reporting.
 */
function hasGitCredentials(ref) {
  if (!ref.userinfo) return false;
  if (ref.hasPassword) return true;
  const sshLogin = ref.protocol === 'ssh:' || ref.protocol === 'git+ssh:' || ref.protocol === 'git:';
  return !(sshLogin && ref.username.toLowerCase() === 'git');
}

/**
 * @param {Entry} entry Entry under inspection.
 * @param {string} file Lockfile name.
 * @param {string} code Rule id.
 * @param {string} message Human readable message.
 * @param {string} expected Expected value.
 * @returns {Violation} Violation object.
 */
function violation(entry, file, code, message, expected) {
  const rule = RULES[code];
  return {
    code: code,
    severity: code === 'GIT_COMMIT_NOT_PINNED' ? 'warning' : 'error',
    file: file,
    line: entry.line || 0,
    name: entry.name,
    version: maskCredentials(entry.version || ''),
    url: typeof entry.ref === 'string' ? maskCredentials(entry.ref) : '',
    message: message,
    expected: expected,
    title: rule ? rule.title : code,
  };
}

/**
 * Validate a single lockfile entry against the policy.
 * @param {Entry} entry Parsed entry.
 * @param {import('./config').Config} config Resolved configuration.
 * @param {string} file Lockfile name used in reports.
 * @returns {Violation[]} Violations for this entry.
 */
function validateEntry(entry, config, file) {
  /** @type {Violation[]} */
  const out = [];
  const ref = parseRef(entry.ref, entry.name);
  const label = entry.version ? entry.name + '@' + maskCredentials(entry.version) : entry.name;

  if (ref.kind === 'none' || ref.kind === 'alias') return out;

  if (ref.kind === 'invalid') {
    out.push(
      violation(
        entry,
        file,
        'INVALID_URL',
        'package ' + label + ' has a download reference that is not a URL, git remote or local path',
        'an https URL on an allowed registry host',
      ),
    );
    return out;
  }

  if (ref.kind === 'file' || ref.kind === 'patch') {
    if (!config.allowFileRefs) {
      out.push(
        violation(
          entry,
          file,
          'FILE_REF_NOT_ALLOWED',
          'package ' + label + ' uses a local reference (' + ref.spec + ')',
          'a registry URL (file references are disabled)',
        ),
      );
    }
    return out;
  }

  if (ref.kind === 'git') {
    // Checked before the host gate because the early return below used to hide
    // credentials embedded in a git URL.
    if (hasGitCredentials(ref)) {
      out.push(
        violation(
          entry,
          file,
          'CREDENTIALS_IN_URL',
          'package ' + label + ' embeds credentials in its git URL',
          'a git URL without a token or password',
        ),
      );
    }
    if (
      (ref.protocol === 'git:' || ref.protocol === 'git+http:' || ref.protocol === 'file:') &&
      config.enforceHttps
    ) {
      out.push(
        violation(
          entry,
          file,
          'INSECURE_PROTOCOL',
          'package ' + label + ' is fetched over the unencrypted ' + ref.protocol + ' transport',
          'git+https:// or git+ssh://',
        ),
      );
    }
    if (!hostIn(ref, config.allowedGitHosts)) {
      out.push(
        violation(
          entry,
          file,
          'GIT_HOST_NOT_ALLOWED',
          'package ' + label + ' is fetched from the git host ' + (ref.host || 'unknown'),
          'one of: ' + config.allowedGitHosts.join(', '),
        ),
      );
      return out;
    }
    if (config.requireGitCommitPin && !/^[0-9a-f]{40}$/i.test(ref.gitRef)) {
      out.push(
        violation(
          entry,
          file,
          'GIT_COMMIT_NOT_PINNED',
          'package ' + label + ' is not pinned to a full commit SHA',
          'a 40 character commit SHA after #',
        ),
      );
    }
    return out;
  }

  if (ref.userinfo) {
    out.push(
      violation(
        entry,
        file,
        'CREDENTIALS_IN_URL',
        'package ' + label + ' embeds credentials in its download URL',
        'a URL without username or password',
      ),
    );
  }

  if (ref.protocol !== 'https:' && config.enforceHttps) {
    out.push(
      violation(
        entry,
        file,
        'INSECURE_PROTOCOL',
        'package ' + label + ' is downloaded over ' + ref.protocol + ', which is not encrypted',
        'https://',
      ),
    );
  }

  const scope = scopeOf(entry.name);
  const rule = scope && config.scoped ? config.scoped[scope] : null;
  if (rule && Array.isArray(rule.hosts)) {
    if (!hostIn(ref, rule.hosts)) {
      out.push(
        violation(
          entry,
          file,
          'SCOPE_REGISTRY_MISMATCH',
          'package ' + label + ' belongs to ' + scope + ' but resolves from ' + (ref.host || 'unknown'),
          'one of: ' + rule.hosts.join(', '),
        ),
      );
    }
    return out;
  }

  if (!hostIn(ref, config.allowedHosts)) {
    out.push(
      violation(
        entry,
        file,
        'HOST_NOT_ALLOWED',
        'package ' + label + ' resolves from an untrusted host ' + (ref.host || 'unknown'),
        'one of: ' + config.allowedHosts.join(', '),
      ),
    );
    return out;
  }

  const privateHosts = privateHostsOf(config.scoped);
  if (hostIn(ref, privateHosts)) {
    out.push(
      violation(
        entry,
        file,
        'PRIVATE_REGISTRY_FOR_PUBLIC_PACKAGE',
        'public package ' + label + ' resolves from the scope-only host ' + ref.host,
        'one of: ' + config.allowedHosts.join(', '),
      ),
    );
  }

  return out;
}

/**
 * Validate every entry of one lockfile.
 * @param {Entry[]} entries Parsed entries.
 * @param {import('./config').Config} config Resolved configuration.
 * @param {string} file Lockfile name used in reports.
 * @returns {Violation[]} All violations, in entry order.
 */
function validateEntries(entries, config, file) {
  /** @type {Violation[]} */
  const out = [];
  for (const entry of entries) {
    const found = validateEntry(entry, config, file);
    for (const item of found) out.push(item);
  }
  return out;
}

/**
 * Build the two line summary printed at the end of a run.
 * @param {Violation[]} violations Violations from every file.
 * @returns {{errors: number, warnings: number}} Counts by severity.
 */
function countViolations(violations) {
  let errors = 0;
  let warnings = 0;
  for (const item of violations) {
    if (item.severity === 'warning') warnings += 1;
    else errors += 1;
  }
  return { errors: errors, warnings: warnings };
}

module.exports = {
  RULES,
  hostMatches,
  hostIn,
  privateHostsOf,
  hasGitCredentials,
  validateEntry,
  validateEntries,
  countViolations,
};
