'use strict';

const assert = require('node:assert');
const { describe } = require('../harness');
const h = require('../helpers');
const { parseLockfile } = require('../../lib/parsers');
const { ParseError } = require('../../lib/errors');

describe('npm v3 parser', (it) => {
  it('reads every resolved entry with name, version, url and line', () => {
    const text = h.fixture('npm-v3.json');
    const parsed = parseLockfile(text, 'package-lock.json');
    assert.equal(parsed.format, 'npm-v3');
    assert.equal(parsed.entries.length, 8);

    const express = parsed.entries.find((entry) => entry.name === 'express');
    assert.ok(express, 'express entry is present');
    assert.equal(express.version, '4.18.2');
    assert.equal(express.ref, 'https://registry.npmjs.org/express/-/express-4.18.2.tgz');
    assert.equal(express.line, h.lineOf(text, 'express-4.18.2.tgz'));
    assert.equal(express.parser, 'npm');
  });

  it('skips the root entry and workspace links', () => {
    const parsed = parseLockfile(h.fixture('npm-v3.json'), 'package-lock.json');
    const names = parsed.entries.map((entry) => entry.name);
    assert.equal(names.indexOf(''), -1);
    assert.equal(names.indexOf('linkdep'), -1);
  });

  it('derives scoped and nested names from the packages map keys', () => {
    const text = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/a/node_modules/@scope/b': {
          version: '1.0.0',
          resolved: 'https://registry.npmjs.org/@scope/b/-/b-1.0.0.tgz',
        },
        'node_modules/a/node_modules/plain': {
          version: '2.0.0',
          resolved: 'https://registry.npmjs.org/plain/-/plain-2.0.0.tgz',
        },
      },
    });
    const parsed = parseLockfile(text, 'package-lock.json');
    assert.deepEqual(
      parsed.entries.map((entry) => entry.name),
      ['@scope/b', 'plain'],
    );
  });

  it('reports the line of a malformed JSON document', () => {
    const text = '{\n  "lockfileVersion": 3,\n  "packages": {\n';
    assert.throws(
      () => parseLockfile(text, 'package-lock.json'),
      (err) => {
        assert.ok(err instanceof ParseError, 'ParseError expected');
        assert.equal(err.code, 'PARSE_ERROR');
        assert.ok(err.line >= 1, 'a line number is reported');
        assert.match(err.message, /invalid JSON/);
        return true;
      },
    );
  });

  it('rejects documents without a dependency section and non-object roots', () => {
    assert.throws(() => parseLockfile('{"lockfileVersion":3}', 'package-lock.json'), /no "packages"/);
    assert.throws(() => parseLockfile('[]', 'package-lock.json'), /must be a JSON object/);
  });

  it('accepts a UTF-8 BOM left by Windows tooling', () => {
    const text = '\uFEFF{"lockfileVersion":2,"packages":{"node_modules/x":{"version":"1.0.0","resolved":"https://registry.npmjs.org/x/-/x-1.0.0.tgz"}}}';
    const parsed = parseLockfile(text, 'package-lock.json');
    assert.equal(parsed.entries.length, 1);
  });
});
