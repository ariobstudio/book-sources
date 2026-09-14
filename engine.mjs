/**
 * Interpret declarative JSON source pipelines without executing source code.
 * This module has no Node or UI dependencies. See docs/source-format.md.
 *
 * @typedef {Object} SourceHost
 * @property {function(string, Object=): Promise<{status: number, headers: Object, body: string}>} request
 *   Fetch text through the embedding application's network stack.
 */

function stripTags(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lookup(path, vars) {
  return path.split('.').reduce((value, key) => value == null ? undefined : value[key], vars);
}

function applyFilter(value, filter) {
  const separator = filter.indexOf(':');
  const name = separator === -1 ? filter : filter.slice(0, separator);
  const argument = separator === -1 ? undefined : filter.slice(separator + 1);
  if (name === 'urlencode') return encodeURIComponent(String(value ?? ''));
  if (name === 'trimSlash') return String(value ?? '').replace(/^\/+/, '');
  if (name === 'default') return value == null || value === '' ? argument : value;
  return value;
}

/**
 * Expand dotted variable paths and apply filters from left to right.
 * Missing values become empty strings; unknown filters leave values unchanged.
 * @param {string} template
 * @param {Object} vars
 * @returns {string}
 */
export function interpolate(template, vars) {
  return String(template ?? '').replace(/\{([^{}]+)\}/g, (_, expression) => {
    const [path, ...filters] = expression.split('|').map((part) => part.trim());
    const value = filters.reduce(applyFilter, lookup(path, vars));
    return value == null ? '' : String(value);
  });
}

function jsonGet(object, path) {
  const tokens = Array.isArray(path) ? path : String(path).split('.');
  const value = tokens.reduce((current, key) => current == null ? null : current[key], object);
  return value === undefined ? null : value;
}

function extractCells(value) {
  const cells = String(value ?? '').match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? [];
  return cells.map((cell) => cell.replace(/^<td[^>]*>/, '').replace(/<\/td>$/, ''));
}

function extractAnchors(value) {
  const text = String(value ?? '');
  // Attribute values can contain ">"; a tag-only regex would truncate them.
  const openingTag = /<a\s(?:"[^"]*"|'[^']*'|[^"'>])*>/g;
  const anchors = [];
  let match;
  while ((match = openingTag.exec(text))) {
    const start = match.index + match[0].length;
    const end = text.indexOf('</a>', start);
    if (end === -1) break;
    const inner = text.slice(start, end);
    if (inner.trim()) {
      anchors.push({ href: match[0].match(/\bhref\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] ?? '', text: inner });
    }
    openingTag.lastIndex = end + 4;
  }
  return anchors;
}

function looksLikeTitle(anchor) {
  const text = stripTags(anchor.text);
  return text.length >= 2 && !text.startsWith('#') && !/^[\d;\sXx]*$/.test(text);
}

function longerAnchor(first, second) {
  return stripTags(second.text).length > stripTags(first.text).length ? second : first;
}

function pickAnchor(anchors, pick) {
  if (!anchors.length) return null;
  if (pick === 'first') return anchors[0];
  if (pick === 'longest') return anchors.reduce(longerAnchor);
  const last = anchors[anchors.length - 1];
  // Keep the last plausible title, falling back to the last anchor.
  if (pick === 'clean') return [...anchors].reverse().find(looksLikeTitle) ?? last;
  return last;
}

function anchorValue(value, options) {
  const anchors = extractAnchors(value).filter((anchor) =>
    !options.hrefIncludes || anchor.href.includes(options.hrefIncludes));
  const picked = pickAnchor(anchors, options.pick);
  return picked ? picked[options.part ?? 'text'] : null;
}

function applyOperation(value, operation, vars) {
  if (operation == null) return value;
  if ('regex' in operation) {
    const match = String(value ?? '').match(new RegExp(operation.regex, operation.flags ?? ''));
    return match ? match[operation.group ?? 0] : null;
  }
  if ('cell' in operation) return extractCells(value)[operation.cell] ?? null;
  if ('anchors' in operation) return anchorValue(value, operation.anchors);
  if ('json' in operation) return jsonGet(value, operation.json);
  if (operation.stripTags) return stripTags(value);
  if (operation.trim) return String(value ?? '').trim();
  if (operation.lowercase) return String(value ?? '').toLowerCase();
  if ('default' in operation) return value == null || value === '' ? operation.default : value;
  if ('prepend' in operation) return operation.prepend + (value ?? '');
  if ('append' in operation) return (value ?? '') + operation.append;
  if ('template' in operation) return interpolate(operation.template, vars);
  return value;
}

function applyOps(value, operations, vars) {
  return [].concat(operations).reduce((current, operation) => applyOperation(current, operation, vars), value);
}

function isSuccessful(response) {
  return response.status >= 200 && response.status < 400;
}

function hasExpectedBody(response, step) {
  return !step.untilRegex || new RegExp(step.untilRegex).test(response.body);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestStep(step, vars, host) {
  const url = interpolate(step.url, vars);
  const attempts = Math.min(step.retries ?? 1, 5);
  let response = null;
  // Requests and retries are sequential: later steps consume this response.
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    response = await host.request(url, { method: step.method, headers: step.headers });
    if (isSuccessful(response) && hasExpectedBody(response, step)) break;
    if (attempt < attempts - 1 && step.retryDelayMs) await delay(step.retryDelayMs);
  }
  if (!isSuccessful(response)) {
    throw new Error(`${vars.__sourceId ?? 'source'}: HTTP ${response.status} for ${url}`);
  }
  if (!hasExpectedBody(response, step)) {
    throw new Error(`${vars.__sourceId ?? 'source'}: expected pattern not found on ${url}`);
  }
  vars.__res = response;
}

function setStep(step, vars) {
  const base = step.from != null
    ? lookup(String(step.from), { response: vars.__res })
    : vars.__res?.body;
  vars[step.name] = applyOps(base, step.ops ?? [], vars);
}

async function runStep(step, vars, host) {
  if (step.step === 'request') return requestStep(step, vars, host);
  if (step.step === 'set') return setStep(step, vars);
  throw new Error(`Unknown step type: ${step.step}`);
}

async function runSteps(steps, vars, host) {
  for (const step of steps ?? []) await runStep(step, vars, host);
}

function* extractSegments(definition, vars) {
  if (definition.jsonPath != null) {
    let parsed;
    try {
      parsed = JSON.parse(vars.__res.body);
    } catch {
      return;
    }
    const items = jsonGet(parsed, definition.jsonPath);
    if (Array.isArray(items)) yield* items;
    return;
  }
  const body = definition.over ? interpolate(definition.over, vars) : vars.__res?.body ?? '';
  const regex = new RegExp(definition.regex, definition.flags ?? 'g');
  // Iterate matches as needed so a result limit also stops row extraction.
  for (const match of body.matchAll(regex)) yield match[definition.group ?? 1];
}

function extractItem(segment, fields, vars) {
  const item = {};
  Object.entries(fields ?? {}).forEach(([name, operations]) => {
    // Field order matters: templates can use previously extracted fields.
    item[name] = applyOps(segment, operations, { ...vars, item });
  });
  if (item.id != null) item.id = String(item.id);
  return item;
}

function collectResults(definition, vars) {
  const results = [];
  for (const segment of extractSegments(definition, vars)) {
    const item = extractItem(segment, definition.fields, vars);
    if (!(definition.required ?? []).every((key) => item[key])) continue;
    results.push(item);
    if (definition.limit && results.length >= definition.limit) break;
  }
  return results;
}

/**
 * Search one page. Each call owns its pipeline variables.
 * @param {Object} source Parsed source JSON with a search pipeline.
 * @param {string} query Search text; templates decide how to encode it.
 * @param {number} page Page number; zero or nonnumeric input defaults to 1.
 * @param {SourceHost} host
 * @returns {Promise<{items: Object[], hasMore: boolean}>} Items and provider continuation state.
 */
export async function runSearch(source, query, page, host) {
  const pageNumber = Number(page) || 1;
  const vars = {
    __sourceId: source.id,
    query: String(query),
    page: pageNumber,
  };
  await runSteps(source.search.steps, vars, host);
  const items = collectResults(source.search.items, vars);
  // A provider's explicit continuation wins over visible/filtered result counts.
  // HTML catalogs without a continuation field terminate at an empty page.
  const path = source.search.nextPagePath;
  const hasMore = path === undefined ? items.length > 0
    : Boolean(jsonGet(JSON.parse(vars.__res.body), path));
  return { items, hasMore };
}

/**
 * Resolve an item to download metadata. This does not download or save a file.
 * Only top-level output strings are interpolated; nested objects stay literal.
 * @param {Object} source Parsed source JSON with a resolve pipeline.
 * @param {Object} item A search result from this source.
 * @param {SourceHost} host
 * @returns {Promise<Object>} Output containing a nonempty url and optional fileName/headers.
 */
export async function runResolve(source, item, host) {
  if (!source.resolve) throw new Error(`${source.id}: source has no resolve pipeline`);
  const vars = { __sourceId: source.id, query: '', page: 1, item };
  await runSteps(source.resolve.steps, vars, host);
  const output = Object.fromEntries(Object.entries(source.resolve.output ?? {}).map(([key, template]) => [
    key, typeof template === 'string' ? interpolate(template, vars) : template,
  ]));
  if (!output.url) throw new Error(`${source.id}: resolve produced no url`);
  return output;
}
