/** Validate source packs at load time without importing platform APIs. */

const OPERATIONS = ['regex', 'cell', 'anchors', 'json', 'stripTags', 'trim', 'lowercase', 'default', 'prepend', 'append', 'template'];
const RESERVED_KEYS = ['__proto__', 'prototype', 'constructor'];
const RESERVED_VARIABLES = [...RESERVED_KEYS, 'query', 'page', 'item', '__sourceId', '__res'];

function check(condition, path, message) {
  if (!condition) throw new Error(`${path}: ${message}`);
}

function object(value, path) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
}

function string(value, path, nonempty = false) {
  check(typeof value === 'string' && (!nonempty || value.length > 0), path, 'expected a string' + (nonempty ? ' that is not empty' : ''));
}

function integer(value, path, minimum = 0) {
  check(Number.isSafeInteger(value) && value >= minimum, path, `expected an integer >= ${minimum}`);
}

function keys(value, allowed, path) {
  Object.keys(value).forEach((key) => check(allowed.includes(key), `${path}.${key}`, 'unsupported property'));
}

function regex(pattern, flags, path, global = false) {
  string(pattern, path);
  string(flags, `${path} flags`);
  try {
    const compiled = new RegExp(pattern, flags);
    check(!global || compiled.global, path, 'item regex flags must include g');
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

function jsonPath(value, path) {
  if (typeof value === 'string') return;
  check(Array.isArray(value), path, 'expected a dotted path or token array');
  value.forEach((token, index) => check(typeof token === 'string' || Number.isSafeInteger(token), `${path}[${index}]`, 'expected a string or integer'));
}

function headers(value, path) {
  if (value === undefined) return;
  object(value, path);
  Object.entries(value).forEach(([name, entry]) => string(entry, `${path}.${name}`));
}

function anchors(value, path) {
  object(value, path);
  keys(value, ['hrefIncludes', 'pick', 'part'], path);
  if (value.hrefIncludes !== undefined) string(value.hrefIncludes, `${path}.hrefIncludes`);
  if (value.pick !== undefined) check(['first', 'last', 'longest', 'clean'].includes(value.pick), `${path}.pick`, 'expected first, last, longest, or clean');
  if (value.part !== undefined) check(['text', 'href'].includes(value.part), `${path}.part`, 'expected text or href');
}

function operation(value, path) {
  if (value === null) return; // The engine treats null operations as no-ops.
  object(value, path);
  const names = OPERATIONS.filter((name) => Object.prototype.hasOwnProperty.call(value, name));
  check(names.length === 1, path, 'expected exactly one operation');
  const name = names[0];
  keys(value, name === 'regex' ? ['regex', 'flags', 'group'] : [name], path);
  if (name === 'regex') {
    regex(value.regex, value.flags ?? '', `${path}.regex`);
    if (value.group !== undefined) integer(value.group, `${path}.group`);
  } else if (name === 'cell') integer(value.cell, `${path}.cell`);
  else if (name === 'json') jsonPath(value.json, `${path}.json`);
  else if (name === 'anchors') anchors(value.anchors, `${path}.anchors`);
  else if (['stripTags', 'trim', 'lowercase'].includes(name)) check(typeof value[name] === 'boolean', `${path}.${name}`, 'expected a boolean');
  else if (name !== 'default') string(value[name], `${path}.${name}`);
}

function operations(value, path) {
  const entries = Array.isArray(value) ? value : [value];
  entries.forEach((entry, index) => operation(entry, `${path}[${index}]`));
}

function step(value, path) {
  object(value, path);
  if (value.step === 'request') {
    keys(value, ['step', 'url', 'method', 'headers', 'retries', 'retryDelayMs', 'untilRegex'], path);
    string(value.url, `${path}.url`, true);
    if (value.method !== undefined) string(value.method, `${path}.method`, true);
    headers(value.headers, `${path}.headers`);
    if (value.retries !== undefined) integer(value.retries, `${path}.retries`, 1);
    if (value.retryDelayMs !== undefined) check(Number.isFinite(value.retryDelayMs) && value.retryDelayMs >= 0, `${path}.retryDelayMs`, 'expected a nonnegative finite number');
    if (value.untilRegex !== undefined) regex(value.untilRegex, '', `${path}.untilRegex`);
    return;
  }
  check(value.step === 'set', `${path}.step`, 'expected request or set');
  keys(value, ['step', 'name', 'from', 'ops'], path);
  string(value.name, `${path}.name`, true);
  check(!RESERVED_VARIABLES.includes(value.name) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.name), `${path}.name`, 'expected a nonreserved variable name');
  if (value.from !== undefined) string(value.from, `${path}.from`);
  if (value.ops !== undefined) operations(value.ops, `${path}.ops`);
}

function steps(value, path) {
  if (value === undefined) return;
  check(Array.isArray(value), path, 'expected an array');
  value.forEach((entry, index) => step(entry, `${path}[${index}]`));
}

function search(value, path) {
  object(value, path);
  steps(value.steps, `${path}.steps`);
  if (value.nextPagePath !== undefined) jsonPath(value.nextPagePath, `${path}.nextPagePath`);
  const items = value.items;
  object(items, `${path}.items`);
  check((items.jsonPath != null) !== (items.regex !== undefined), `${path}.items`, 'choose exactly one of jsonPath or regex');
  if (items.jsonPath != null) jsonPath(items.jsonPath, `${path}.items.jsonPath`);
  else regex(items.regex, items.flags ?? 'g', `${path}.items.regex`, true);
  if (items.group !== undefined) integer(items.group, `${path}.items.group`);
  if (items.over !== undefined) string(items.over, `${path}.items.over`);
  if (items.limit !== undefined) integer(items.limit, `${path}.items.limit`);
  object(items.fields, `${path}.items.fields`);
  Object.entries(items.fields).forEach(([name, ops]) => {
    check(!RESERVED_KEYS.includes(name), `${path}.items.fields.${name}`, 'reserved field name');
    operations(ops, `${path}.items.fields.${name}`);
  });
  if (items.required === undefined) return;
  check(Array.isArray(items.required), `${path}.items.required`, 'expected an array');
  items.required.forEach((name) => {
    string(name, `${path}.items.required`);
    check(Object.prototype.hasOwnProperty.call(items.fields, name), `${path}.items.required`, `unknown field ${name}`);
  });
}

function resolve(value, path) {
  object(value, path);
  steps(value.steps, `${path}.steps`);
  object(value.output, `${path}.output`);
  string(value.output.url, `${path}.output.url`, true);
  if (value.output.fileName !== undefined) string(value.output.fileName, `${path}.output.fileName`);
  headers(value.output.headers, `${path}.output.headers`);
}

/**
 * Validate metadata and the supported pipeline vocabulary, then return source.
 * Throws an Error identifying the first invalid property. This does not make
 * requests, prove regex runtime bounds, or enforce a network policy.
 * @param {Object} source Parsed JSON, not JavaScript source text.
 * @returns {Object} The input object, unchanged.
 */
export function validateSource(source) {
  object(source, 'source');
  string(source.id, 'source.id', true);
  check(/^[a-z0-9][a-z0-9_-]*$/.test(source.id), 'source.id', 'use lowercase letters, digits, underscores, or hyphens');
  const path = source.id;
  string(source.name, `${path}.name`, true);
  string(source.version, `${path}.version`, true);
  string(source.contentType, `${path}.contentType`, true);
  object(source.capabilities, `${path}.capabilities`);
  ['search', 'resolve'].forEach((name) => {
    check(typeof source.capabilities[name] === 'boolean', `${path}.capabilities.${name}`, 'expected a boolean');
    check(source.capabilities[name] === (source[name] != null), `${path}.${name}`, 'pipeline must match its capability flag');
  });
  check(source.search != null || source.resolve != null, path, 'expected a search or resolve pipeline');
  if (source.search != null) search(source.search, `${path}.search`);
  if (source.resolve != null) resolve(source.resolve, `${path}.resolve`);
  return source;
}
