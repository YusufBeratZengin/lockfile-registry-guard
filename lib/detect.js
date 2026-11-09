'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** File names the guard recognizes, mapped to their parser id. */
const LOCKFILE_NAMES = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'pnpm-lock.yml': 'pnpm',
};

/**
 * Choose a parser for a file, falling back to content sniffing so fixtures and
 * renamed lockfiles still work.
 * @param {string} file File path or name.
 * @param {string} [text] File content, used when the name is unknown.
 * @returns {'npm'|'yarn'|'pnpm'|null} Parser id or null when nothing matches.
 */
function detectParser(file, text) {
  const base = path.basename(String(file || '')).toLowerCase();
  if (LOCKFILE_NAMES[base]) return LOCKFILE_NAMES[base];
  if (typeof text !== 'string') return null;
  const head = text.slice(0, 4096);
  if (/^\s*[[{]/.test(head)) return 'npm';
  if (/^lockfileVersion:/m.test(head) || /^packages:/m.test(head)) return 'pnpm';
  if (/^__metadata:/m.test(head) || /^# yarn lockfile v1/m.test(head)) return 'yarn';
  if (/^[^\s#][^\n]*:\s*$/m.test(head)) return 'yarn';
  return null;
}

/**
 * List the lockfiles present in a directory.
 * @param {string} dir Directory to scan (not recursive).
 * @returns {string[]} Absolute paths, sorted by name.
 */
function detectLockfiles(dir) {
  /** @type {string[]} */
  const found = [];
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return found;
  }
  for (const name of names.sort()) {
    if (!LOCKFILE_NAMES[name.toLowerCase()]) continue;
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).isFile()) found.push(full);
    } catch (err) {
      continue;
    }
  }
  return found;
}

module.exports = { LOCKFILE_NAMES, detectParser, detectLockfiles };
