'use strict';

/**
 * Reference classification for lockfile download locations.
 *
 * A lockfile reference is one of:
 * - `url`    an http(s) tarball URL (the thing an attacker rewrites),
 * - `git`    a git remote, possibly written as a shorthand,
 * - `file`   a local path reference (`file:`, `link:`, `portal:`, `workspace:`),
 * - `patch`  a Yarn Berry patch reference,
 * - `alias`  an npm alias / bare registry spec (`npm:1.2.3`) with no host,
 * - `none`   no reference at all (registry packages in pnpm/Berry),
 * - `invalid` something that cannot be understood as a download location.
 */

/** Shorthand hosts understood by npm, Yarn and pnpm. */
const GIT_SHORTHANDS = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
  gist: 'gist.github.com',
};

/**
 * @typedef {Object} Ref
 * @property {'url'|'git'|'file'|'patch'|'alias'|'none'|'invalid'} kind Reference kind.
 * @property {string} spec Normalized reference used in reports.
 * @property {string} protocol Lowercase scheme including the colon, empty for shorthands.
 * @property {string} host Host with a non-default port, empty when unknown.
 * @property {string} hostname Host without port, empty when unknown.
 * @property {string} port Explicit port, empty when default or absent.
 * @property {string} path Path portion, empty when unknown.
 * @property {string} gitRef Commit, tag or branch after `#`, empty when absent.
 * @property {boolean} userinfo Whether the URL embeds credentials.
 * @property {string} username Username from the URL userinfo, empty when absent.
 * @property {boolean} hasPassword Whether the URL userinfo contains a password.
 */

/**
 * @param {Partial<Ref>} [extra] Fields to override.
 * @returns {Ref} A reference with safe defaults.
 */
function baseRef(extra) {
  return Object.assign(
    {
      kind: 'invalid',
      spec: '',
      protocol: '',
      host: '',
      hostname: '',
      port: '',
      path: '',
      gitRef: '',
      userinfo: false,
      username: '',
      hasPassword: false,
    },
    extra || {},
  );
}

/**
 * Remove a leading `name@` from a Berry/pnpm style spec such as
 * `lodash@npm:1.2.3` or `@scope/pkg@https://example.test/pkg.tgz`.
 * @param {string} spec Raw spec.
 * @param {string} name Expected package name.
 * @returns {string} Spec without the package prefix.
 */
function stripNamePrefix(spec, name) {
  if (name && spec.startsWith(name + '@')) {
    const rest = spec.slice(name.length + 1);
    if (/^[a-z][a-z+.-]*:/.test(rest)) return rest;
  }
  const match = /^(@[^/@]+\/[^@]+|[^@/]+)@((?:npm|https?|git\+[a-z]+|git|ssh|file|link|portal|workspace|patch|github|gitlab|bitbucket|gist):)/.exec(
    spec,
  );
  if (match) return spec.slice(match[1].length + 1);
  return spec;
}

/**
 * Build a git reference from a shorthand or a plain URL.
 * @param {string} spec Full spec including the scheme.
 * @param {string} host Host to record.
 * @param {string} protocol Scheme to record.
 * @param {string} fallbackPath Path used for shorthands.
 * @returns {Ref} Git reference.
 */
function gitRef(spec, host, protocol, fallbackPath) {
  const hash = spec.indexOf('#');
  const reference = hash === -1 ? '' : decodeURIComponent(spec.slice(hash + 1));
  return baseRef({
    kind: 'git',
    spec: spec,
    protocol: protocol,
    host: host,
    hostname: host,
    path: fallbackPath,
    gitRef: reference,
  });
}

/**
 * Classify a lockfile reference.
 * @param {string|null|undefined} raw Raw value from the lockfile.
 * @param {string} name Package name, used to strip `name@` prefixes.
 * @returns {Ref} Classified reference.
 */
function parseRef(raw, name) {
  const original = typeof raw === 'string' ? raw.trim() : '';
  if (!original) return baseRef({ kind: 'none' });
  if (!/^[a-z][a-z+.-]*:\/\//i.test(original)) {
    const spec = stripNamePrefix(original, name || '');
    return classify(spec, original);
  }
  return classify(original, original);
}

/**
 * Classify an already prefix-free spec.
 * @param {string} spec Spec without `name@`.
 * @param {string} original Original value for reporting.
 * @returns {Ref} Classified reference.
 */
function classify(spec, original) {
  if (/^patch:/.test(spec)) {
    return baseRef({ kind: 'patch', spec: original });
  }
  if (/^npm:/.test(spec)) {
    return baseRef({ kind: 'alias', spec: original });
  }
  if (/^(file|link|portal|workspace):/.test(spec)) {
    return baseRef({ kind: 'file', spec: original, path: spec.slice(spec.indexOf(':') + 1) });
  }
  const shorthand = /^(github|gitlab|bitbucket|gist):(.*)$/.exec(spec);
  if (shorthand) {
    const host = GIT_SHORTHANDS[shorthand[1]] || '';
    return gitRef(spec, host, shorthand[1] + ':', shorthand[2].split('#')[0]);
  }
  if (/^git\+(?:https?|ssh):\/\//.test(spec)) {
    const protocol = spec.slice(0, spec.indexOf('://') + 1);
    return fromUrl(spec, protocol, true);
  }
  if (/^git:\/\//.test(spec)) return fromUrl(spec, 'git:', true);
  if (/^ssh:\/\//.test(spec)) return fromUrl(spec, 'ssh:', true);
  if (/^https?:\/\//.test(spec)) return fromUrl(spec, '', false);
  const scp = /^[A-Za-z0-9._-]+@([A-Za-z0-9.-]+):(.+)$/.exec(spec);
  if (scp) return gitRef(spec, scp[1].toLowerCase(), 'ssh:', scp[2]);
  if (/^(\.{0,2}\/|~\/)/.test(spec)) return baseRef({ kind: 'file', spec: original, path: spec });
  return baseRef({ kind: 'invalid', spec: original });
}

/**
 * Parse an absolute URL reference.
 * @param {string} spec Full spec including the scheme.
 * @param {string} protocolOverride Scheme to record, empty to use the URL scheme.
 * @param {boolean} isGit Whether the reference is a git remote.
 * @returns {Ref} Parsed reference, `invalid` when the URL is malformed.
 */
function fromUrl(spec, protocolOverride, isGit) {
  const urlText = /^git\+/.test(spec) ? spec.slice(4) : spec;
  let url;
  try {
    url = new URL(urlText);
  } catch (err) {
    return baseRef({ kind: 'invalid', spec: spec });
  }
  const protocol = (protocolOverride || url.protocol).toLowerCase();
  let host = url.host.toLowerCase();
  const port = url.port;
  if ((url.protocol === 'https:' && port === '443') || (url.protocol === 'http:' && port === '80')) {
    host = url.hostname.toLowerCase();
  }
  const ref = baseRef({
    kind: isGit ? 'git' : 'url',
    spec: spec,
    protocol: protocol,
    host: host,
    hostname: url.hostname.toLowerCase(),
    port: port,
    path: url.pathname,
    userinfo: url.username !== '' || url.password !== '',
    username: url.username,
    hasPassword: url.password !== '',
  });
  if (isGit) ref.gitRef = decodeURIComponent(url.hash.replace(/^#/, ''));
  return ref;
}

/**
 * Mask credentials embedded in a reference so reports never echo secrets.
 *
 * The standard `git@host` SSH login is kept, because it is not a secret; any
 * password or non-standard username is replaced with `***`.
 * @param {string} raw Raw reference.
 * @returns {string} Reference safe to print.
 */
function maskCredentials(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const spec = stripNamePrefix(text, '');
  const prefix = text.slice(0, text.length - spec.length);
  const match = /^([a-z][a-z+.-]*:\/\/)([^/?#]*)@/i.exec(spec);
  if (!match) return text;
  const scheme = match[1];
  const userinfo = match[2];
  const colon = userinfo.indexOf(':');
  const username = colon === -1 ? userinfo : userinfo.slice(0, colon);
  const hasPassword = colon !== -1;
  const sshLogin = /^(ssh|git\+ssh|git):\/\/$/i.test(scheme);
  if (!hasPassword && sshLogin && username.toLowerCase() === 'git') return text;
  return prefix + scheme + '***' + spec.slice(match[0].length - 1);
}

/**
 * Extract the npm scope of a package name.
 * @param {string} name Package name.
 * @returns {string} Scope such as `@corp`, empty string when unscoped.
 */
function scopeOf(name) {
  if (typeof name !== 'string' || name[0] !== '@') return '';
  const slash = name.indexOf('/');
  return slash === -1 ? name : name.slice(0, slash);
}

module.exports = { parseRef, scopeOf, maskCredentials, GIT_SHORTHANDS, stripNamePrefix };
