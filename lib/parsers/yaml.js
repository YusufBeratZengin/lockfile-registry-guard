'use strict';

/**
 * A deliberately small YAML reader for pnpm lockfiles.
 *
 * pnpm only emits a narrow YAML subset: block mappings, plain/quoted scalars,
 * single line flow mappings (`{integrity: ..., tarball: ...}`) and the odd
 * scalar sequence. Supporting that subset keeps the project at zero
 * dependencies while still tracking line numbers, which is what a SARIF report
 * needs. Anything outside the subset raises a `YamlError` instead of silently
 * producing wrong data.
 *
 * @typedef {Object} YMap
 * @property {'map'} type
 * @property {{key: string, node: YNode, line: number}[]} entries
 * @property {number} line
 *
 * @typedef {Object} YSeq
 * @property {'seq'} type
 * @property {YNode[]} items
 * @property {number} line
 *
 * @typedef {Object} YScalar
 * @property {'scalar'} type
 * @property {string|null} value
 * @property {boolean} quoted
 * @property {number} line
 *
 * @typedef {YMap|YSeq|YScalar} YNode
 */

class YamlError extends Error {
  /**
   * @param {string} message Human readable message.
   * @param {number} line 1-based line number.
   */
  constructor(message, line) {
    super(message + ' (line ' + line + ')');
    this.name = 'YamlError';
    this.line = line;
  }
}

/**
 * @typedef {Object} Token
 * @property {number} indent Leading space count.
 * @property {string} text Line content without indentation or trailing spaces.
 * @property {number} line 1-based line number.
 */

/**
 * Split the document into significant tokens, dropping blanks and comments.
 * @param {string} text Raw YAML text.
 * @returns {Token[]} Tokens in document order.
 * @throws {YamlError} On tab indentation.
 */
function tokenize(text) {
  const lines = text.split(/\r?\n/);
  /** @type {Token[]} */
  const tokens = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (/^[ \t]*$/.test(raw)) continue;
    const leading = /^[ \t]*/.exec(raw)[0];
    if (leading.includes('\t')) throw new YamlError('tab in indentation', i + 1);
    const body = raw.slice(leading.length).replace(/[ \t]+$/, '');
    if (body === '---' || body === '...' || body.startsWith('#') || body.startsWith('%')) {
      continue;
    }
    tokens.push({ indent: leading.length, text: body, line: i + 1 });
  }
  return tokens;
}

/**
 * Detect a sequence item line (`-` alone or `- value`).
 * @param {string} text Token text.
 * @returns {boolean} True for sequence items.
 */
function isSeqItem(text) {
  return text === '-' || text.startsWith('- ');
}

/**
 * Locate the mapping separator: the first colon outside quotes that is
 * followed by a space or by the end of the line.
 * @param {string} text Token text.
 * @returns {number} Index of the colon, or -1.
 */
function keyColon(text) {
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (quote === '"' && ch === '\\') i += 1;
      else if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") i += 1;
        else quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ':' && (i + 1 === text.length || text[i + 1] === ' ')) return i;
  }
  return -1;
}

/**
 * Build a scalar node.
 * @param {string|null} value Decoded value.
 * @param {boolean} quoted Whether the source was quoted.
 * @param {number} line 1-based line number.
 * @returns {YScalar} Scalar node.
 */
function scalarNode(value, quoted, line) {
  return { type: 'scalar', value: value, quoted: quoted, line: line };
}

/**
 * Decode a plain (unquoted) scalar.
 * @param {string} text Raw text.
 * @param {number} line 1-based line number.
 * @returns {YScalar} Scalar node.
 */
function plainNode(text, line) {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '~' || trimmed === 'null' || trimmed === 'Null') {
    return scalarNode(null, false, line);
  }
  return scalarNode(trimmed, false, line);
}

/**
 * Read a quoted scalar starting at the current position.
 * @param {{s: string, i: number, line: number}} p Parser cursor.
 * @returns {string} Decoded value.
 * @throws {YamlError} On an unterminated or badly escaped string.
 */
function readQuoted(p) {
  const quote = p.s[p.i];
  p.i += 1;
  let out = '';
  while (p.i < p.s.length) {
    const ch = p.s[p.i];
    if (quote === "'" && ch === "'" && p.s[p.i + 1] === "'") {
      out += "'";
      p.i += 2;
      continue;
    }
    if (ch === quote) {
      p.i += 1;
      return out;
    }
    if (quote === '"' && ch === '\\') {
      const next = p.s[p.i + 1];
      if (next === 'u') {
        out += String.fromCharCode(parseInt(p.s.slice(p.i + 2, p.i + 6), 16));
        p.i += 6;
        continue;
      }
      const table = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/' };
      out += table[next] !== undefined ? table[next] : next;
      p.i += 2;
      continue;
    }
    out += ch;
    p.i += 1;
  }
  throw new YamlError('unterminated quoted string', p.line);
}

/**
 * Skip spaces and tabs inside a flow collection.
 * @param {{s: string, i: number, line: number}} p Parser cursor.
 * @returns {void}
 */
function skipSpace(p) {
  while (p.i < p.s.length && (p.s[p.i] === ' ' || p.s[p.i] === '\t')) p.i += 1;
}

/**
 * Parse one flow node (`{...}`, `[...]`, quoted or plain scalar).
 * @param {{s: string, i: number, line: number}} p Parser cursor.
 * @returns {YNode} Parsed node.
 */
function parseFlowNode(p) {
  skipSpace(p);
  const ch = p.s[p.i];
  if (ch === '{') return parseFlowMap(p);
  if (ch === '[') return parseFlowSeq(p);
  if (ch === '"' || ch === "'") return scalarNode(readQuoted(p), true, p.line);
  const start = p.i;
  while (p.i < p.s.length && ',}]'.indexOf(p.s[p.i]) === -1) p.i += 1;
  return plainNode(p.s.slice(start, p.i), p.line);
}

/**
 * Parse a flow mapping such as `{integrity: sha512-..., tarball: https://x}`.
 * @param {{s: string, i: number, line: number}} p Parser cursor.
 * @returns {YMap} Parsed mapping.
 * @throws {YamlError} On malformed input.
 */
function parseFlowMap(p) {
  p.i += 1;
  /** @type {YMap} */
  const node = { type: 'map', entries: [], line: p.line };
  skipSpace(p);
  if (p.s[p.i] === '}') {
    p.i += 1;
    return node;
  }
  while (p.i < p.s.length) {
    skipSpace(p);
    let key;
    if (p.s[p.i] === '"' || p.s[p.i] === "'") {
      key = readQuoted(p);
    } else {
      const start = p.i;
      while (p.i < p.s.length && p.s[p.i] !== ':' && p.s[p.i] !== ',') p.i += 1;
      key = p.s.slice(start, p.i).trim();
    }
    skipSpace(p);
    if (p.s[p.i] !== ':') throw new YamlError('expected ":" in flow mapping', p.line);
    p.i += 1;
    const value = parseFlowNode(p);
    node.entries.push({ key: key, node: value, line: p.line });
    skipSpace(p);
    const ch = p.s[p.i];
    if (ch === ',') {
      p.i += 1;
      continue;
    }
    if (ch === '}') {
      p.i += 1;
      return node;
    }
    if (p.i >= p.s.length) return node;
    throw new YamlError('unexpected character in flow mapping', p.line);
  }
  return node;
}

/**
 * Parse a flow sequence such as `[a, b]`.
 * @param {{s: string, i: number, line: number}} p Parser cursor.
 * @returns {YSeq} Parsed sequence.
 */
function parseFlowSeq(p) {
  p.i += 1;
  /** @type {YSeq} */
  const node = { type: 'seq', items: [], line: p.line };
  skipSpace(p);
  if (p.s[p.i] === ']') {
    p.i += 1;
    return node;
  }
  while (p.i < p.s.length) {
    node.items.push(parseFlowNode(p));
    skipSpace(p);
    if (p.s[p.i] === ',') {
      p.i += 1;
      continue;
    }
    if (p.s[p.i] === ']') {
      p.i += 1;
      return node;
    }
    break;
  }
  return node;
}

/**
 * Net count of `{`/`[` brackets outside quotes, used to join wrapped flow
 * collections across lines.
 * @param {string} text Flow text.
 * @returns {number} Positive when the collection is still open.
 */
function bracketDepth(text) {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (quote === '"' && ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
  }
  return depth;
}

/**
 * Mutable parser state over the token list.
 * @typedef {Object} State
 * @property {Token[]} tokens Tokens, mutated when a sequence item opens a block.
 * @property {number} pos Current token index.
 */

/**
 * Peek at the current token.
 * @param {State} state Parser state.
 * @returns {Token|undefined} Current token.
 */
function peek(state) {
  return state.tokens[state.pos];
}

/**
 * Parse a block node (mapping or sequence) at a fixed indentation.
 * @param {State} state Parser state.
 * @param {number} indent Indentation of the block.
 * @returns {YNode} Parsed node.
 */
function parseBlock(state, indent) {
  const token = peek(state);
  if (!token) return scalarNode(null, false, 0);
  if (isSeqItem(token.text)) return parseSeq(state, indent);
  return parseMap(state, indent);
}

/**
 * Parse a block mapping.
 * @param {State} state Parser state.
 * @param {number} indent Indentation of the mapping.
 * @returns {YMap} Parsed mapping.
 * @throws {YamlError} On inconsistent indentation or unsupported syntax.
 */
function parseMap(state, indent) {
  const first = peek(state);
  /** @type {YMap} */
  const node = { type: 'map', entries: [], line: first ? first.line : 0 };
  while (state.pos < state.tokens.length) {
    const token = state.tokens[state.pos];
    if (token.indent < indent) break;
    if (token.indent > indent) {
      throw new YamlError('unexpected indentation (expected ' + indent + ')', token.line);
    }
    if (isSeqItem(token.text)) throw new YamlError('sequence item inside a mapping', token.line);
    const colon = keyColon(token.text);
    if (colon === -1) throw new YamlError('expected "key: value"', token.line);
    let key = token.text.slice(0, colon).trim();
    if (key.length > 1 && (key[0] === '"' || key[0] === "'") && key[key.length - 1] === key[0]) {
      key = key.slice(1, -1);
    }
    if (!key) throw new YamlError('empty mapping key', token.line);
    const rest = token.text.slice(colon + 1).trim();
    state.pos += 1;
    let child;
    if (rest === '') {
      const next = peek(state);
      if (next && next.indent > indent) child = parseBlock(state, next.indent);
      else child = scalarNode(null, false, token.line);
    } else if (rest[0] === '|' || rest[0] === '>') {
      const parts = [];
      while (state.pos < state.tokens.length && state.tokens[state.pos].indent > indent) {
        parts.push(state.tokens[state.pos].text);
        state.pos += 1;
      }
      child = scalarNode(parts.join('\n'), true, token.line);
    } else if (rest[0] === '{' || rest[0] === '[') {
      let flow = rest;
      while (bracketDepth(flow) > 0 && state.pos < state.tokens.length) {
        flow += ' ' + state.tokens[state.pos].text.trim();
        state.pos += 1;
      }
      child = parseFlowNode({ s: flow, i: 0, line: token.line });
    } else {
      const hash = rest.indexOf(' #');
      const plain = hash === -1 ? rest : rest.slice(0, hash);
      child =
        plain[0] === '"' || plain[0] === "'"
          ? parseFlowNode({ s: plain, i: 0, line: token.line })
          : plainNode(plain, token.line);
    }
    node.entries.push({ key: key, node: child, line: token.line });
  }
  return node;
}

/**
 * Parse a block sequence.
 * @param {State} state Parser state.
 * @param {number} indent Indentation of the sequence.
 * @returns {YSeq} Parsed sequence.
 */
function parseSeq(state, indent) {
  const first = peek(state);
  /** @type {YSeq} */
  const node = { type: 'seq', items: [], line: first ? first.line : 0 };
  while (state.pos < state.tokens.length) {
    const token = state.tokens[state.pos];
    if (token.indent < indent) break;
    if (token.indent > indent) {
      throw new YamlError('unexpected indentation (expected ' + indent + ')', token.line);
    }
    if (!isSeqItem(token.text)) break;
    const body = token.text === '-' ? '' : token.text.slice(2).trim();
    if (body === '') {
      state.pos += 1;
      const next = peek(state);
      if (next && next.indent > indent) node.items.push(parseBlock(state, next.indent));
      else node.items.push(scalarNode(null, false, token.line));
      continue;
    }
    if (body[0] === '{' || body[0] === '[') {
      state.pos += 1;
      node.items.push(parseFlowNode({ s: body, i: 0, line: token.line }));
      continue;
    }
    if (keyColon(body) === -1) {
      state.pos += 1;
      node.items.push(plainNode(body, token.line));
      continue;
    }
    state.tokens[state.pos] = { indent: indent + 2, text: body, line: token.line };
    node.items.push(parseMap(state, indent + 2));
  }
  return node;
}

/**
 * Parse a YAML document into a tree that remembers line numbers.
 * @param {string} text Raw YAML text.
 * @returns {YMap} Root mapping (an empty mapping for a blank document).
 * @throws {YamlError} When the document leaves the supported subset.
 */
function parseYaml(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return { type: 'map', entries: [], line: 0 };
  const state = { tokens: tokens, pos: 0 };
  const root = parseBlock(state, tokens[0].indent);
  if (state.pos < state.tokens.length) {
    throw new YamlError('trailing content after document root', state.tokens[state.pos].line);
  }
  if (root.type !== 'map') return { type: 'map', entries: [], line: root.line };
  return root;
}

/**
 * Look up a key in a mapping node.
 * @param {YNode|null|undefined} node Candidate mapping.
 * @param {string} key Key to look up.
 * @returns {YNode|null} Child node or null.
 */
function mapGet(node, key) {
  if (!node || node.type !== 'map') return null;
  for (let i = node.entries.length - 1; i >= 0; i -= 1) {
    if (node.entries[i].key === key) return node.entries[i].node;
  }
  return null;
}

/**
 * Read a scalar node as a string.
 * @param {YNode|null|undefined} node Candidate node.
 * @returns {string|null} Value or null.
 */
function scalarOf(node) {
  if (!node || node.type !== 'scalar') return null;
  return node.value;
}

/**
 * Entry list of a mapping node.
 * @param {YNode|null|undefined} node Candidate node.
 * @returns {{key: string, node: YNode, line: number}[]} Entries, empty when not a mapping.
 */
function mapEntries(node) {
  if (!node || node.type !== 'map') return [];
  return node.entries;
}

module.exports = {
  YamlError,
  parseYaml,
  tokenize,
  mapGet,
  mapEntries,
  scalarOf,
  keyColon,
};
