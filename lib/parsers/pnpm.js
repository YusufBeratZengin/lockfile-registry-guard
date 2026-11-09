'use strict';

const { ParseError } = require('../errors');
const { pnpmDialect } = require('./common');
const { stripNamePrefix } = require('../refs');
const { parseYaml, mapGet, mapEntries, scalarOf, YamlError } = require('./yaml');

/**
 * @typedef {import('./common').Entry} Entry
 */

/**
 * Split a pnpm package key into name and version. Handles all shapes pnpm has
 * shipped: `/name/1.0.0` (v5), `/name@1.0.0` (v6/v7), `@scope/name@1.0.0`
 * (v9) and peer suffixes such as `name@1.0.0(peer@2.0.0)`.
 * @param {string} key Raw key from the `packages` mapping.
 * @returns {{name: string, version: string}} Split key.
 */
function splitPackageKey(key) {
  const cleaned = key.replace(/\(.*$/, '').replace(/^\//, '');
  // The version delimiter is the first `@` after the package name. Using the
  // last `@` would split git references such as `pkg@git+ssh://git@host/repo`.
  let at = cleaned.indexOf('@');
  if (cleaned[0] === '@') {
    const slash = cleaned.indexOf('/');
    at = slash === -1 ? -1 : cleaned.indexOf('@', slash + 1);
  }
  if (at > 0) return { name: cleaned.slice(0, at), version: cleaned.slice(at + 1) };
  const slash = cleaned.lastIndexOf('/');
  if (slash > 0) return { name: cleaned.slice(0, slash), version: cleaned.slice(slash + 1) };
  return { name: cleaned, version: '' };
}

/**
 * Whether an importer version spec is a download reference we must inspect
 * rather than a plain version number.
 * @param {string} spec Version specifier.
 * @returns {boolean} True for URLs, git refs and local refs.
 */
function isReferenceSpec(spec) {
  return /^(https?:\/\/|git\+|git:|ssh:\/\/|github:|gitlab:|bitbucket:|file:|link:|portal:)/.test(spec);
}

/**
 * Parse a `pnpm-lock.yaml` file (lockfile format v5, v6, v7 and v9).
 *
 * pnpm normally stores only an integrity hash for registry packages, so an
 * entry without a URL is not a problem: it means "default registry". Explicit
 * `tarball`, git and directory resolutions are extracted with their line
 * numbers so violations can be reported and annotated precisely.
 * @param {string} text Raw lockfile content.
 * @param {string} file File name used in error messages.
 * @returns {{format: string, entries: Entry[]}} Parsed lockfile.
 * @throws {ParseError} When the YAML cannot be parsed.
 */
function parsePnpm(text, file) {
  /** @type {import('./yaml').YMap} */
  let root;
  try {
    root = parseYaml(text);
  } catch (err) {
    if (err instanceof YamlError) throw new ParseError('invalid YAML: ' + err.message, file, err.line);
    throw err;
  }
  const version = scalarOf(mapGet(root, 'lockfileVersion')) || '';
  const format = pnpmDialect(version);
  /** @type {Entry[]} */
  const entries = [];
  /** @type {{entry: Entry, commit: string, line: number}[]} */
  const unresolvedGit = [];

  for (const item of mapEntries(mapGet(root, 'packages'))) {
    const split = splitPackageKey(item.key);
    if (!split.name) continue;
    /** @type {Entry} */
    const entry = {
      name: split.name,
      version: split.version,
      ref: null,
      line: item.line,
      parser: 'pnpm',
    };
    const resolution = mapGet(item.node, 'resolution');
    if (resolution && resolution.type === 'map') {
      const tarballNode = mapGet(resolution, 'tarball');
      const tarball = scalarOf(tarballNode);
      const type = scalarOf(mapGet(resolution, 'type'));
      const repoNode = mapGet(resolution, 'repo');
      const repo = scalarOf(repoNode) || '';
      const commitNode = mapGet(resolution, 'commit');
      const commit = scalarOf(commitNode) || '';
      if (tarball) {
        entry.ref = tarball;
        entry.line = tarballNode ? tarballNode.line : item.line;
      } else if (type === 'git' || repo || commit) {
        // pnpm has shipped git resolutions with only `commit` (and the remote
        // encoded in the package key), with `repo` but no `type`, and with the
        // full `type: git` triplet. All of them must be inspected, otherwise a
        // git dependency silently becomes `kind: none` and bypasses the gate.
        let ref = repo;
        if (!ref && split.version && isReferenceSpec(split.version)) ref = split.version;
        if (ref) {
          const hasScheme = /^[a-z][a-z+.-]*:\/\//.test(ref);
          const isScp = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:/.test(ref);
          // A `resolution.repo` is always a git remote, but pnpm also writes
          // plain `https://host/o/r.git` there. Without the `git+` marker the
          // reference classifies as a tarball URL and skips allowedGitHosts.
          let remote = ref;
          if (hasScheme) {
            if (/^https?:\/\//i.test(ref)) remote = 'git+' + ref;
          } else if (!isScp && !/^[a-z][a-z+.-]*:/.test(ref)) {
            remote = 'git+' + ref;
          }
          const pinned = commit && remote.indexOf('#') === -1 ? '#' + commit : '';
          entry.ref = remote + pinned;
          entry.line = repoNode ? repoNode.line : commitNode ? commitNode.line : item.line;
        } else if (commit) {
          // A commit without a remote cannot be validated yet. Leave the
          // reference empty so the importer fallback below can supply the
          // remote; unresolved entries are reported as invalid afterwards.
          unresolvedGit.push({
            entry: entry,
            commit: commit,
            line: commitNode ? commitNode.line : item.line,
          });
        }
      } else if (type === 'directory' || type === 'file') {
        const dir = scalarOf(mapGet(resolution, 'directory')) || scalarOf(mapGet(resolution, 'file')) || '';
        entry.ref = 'file:' + dir;
        const dirNode = mapGet(resolution, 'directory') || mapGet(resolution, 'file');
        entry.line = dirNode ? dirNode.line : item.line;
      }
    } else if (resolution && resolution.type === 'scalar' && resolution.value) {
      entry.ref = resolution.value;
      entry.line = resolution.line;
    }
    entries.push(entry);
  }

  const importers = mapGet(root, 'importers');
  /** @type {Map<string, Entry[]>} */
  const knownEntries = new Map();
  for (const entry of entries) {
    const list = knownEntries.get(entry.name);
    if (list) list.push(entry);
    else knownEntries.set(entry.name, [entry]);
  }
  for (const importer of mapEntries(importers)) {
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const dep of mapEntries(mapGet(importer.node, section))) {
        const versionNode = mapGet(dep.node, 'version');
        const spec = scalarOf(versionNode);
        // Importer versions are often prefixed with the package name
        // (`evildep@github:acme/evildep#sha`); classify the spec without it.
        if (!spec || !isReferenceSpec(stripNamePrefix(spec, dep.key))) continue;
        // Skip only when the `packages` entry already yielded a reference. A
        // same-named entry with `ref: null` means the packages section was not
        // inspectable, so the importer is the only place the host appears.
        const known = knownEntries.get(dep.key);
        if (known) {
          const empty = known.find((entry) => !entry.ref);
          if (empty) {
            empty.ref = spec;
            empty.line = versionNode ? versionNode.line : dep.line;
            continue;
          }
          if (known.some((entry) => Boolean(entry.ref))) continue;
        }
        entries.push({
          name: dep.key,
          version: '',
          ref: spec,
          line: versionNode ? versionNode.line : dep.line,
          parser: 'pnpm',
        });
      }
    }
  }

  // Git entries whose commit arrived without a remote and without importer
  // information must not be treated as unvalidated registry packages.
  for (const item of unresolvedGit) {
    if (item.entry.ref) continue;
    item.entry.ref = 'git+' + item.commit;
    item.entry.line = item.line;
  }

  const seen = new Set();
  const unique = entries.filter((entry) => {
    const key = entry.name + '|' + entry.ref + '|' + entry.line;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { format: format, entries: unique };
}

module.exports = { parsePnpm, splitPackageKey, isReferenceSpec };
