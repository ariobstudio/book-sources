/**
 * Adapt an injected Fetch-compatible function to the engine's text host.
 * No Node, browser, or Lynx globals are accessed when importing this module.
 */

function normalizeHeaders(headers) {
  if (typeof headers?.forEach !== 'function') return { ...headers };
  const entries = [];
  headers.forEach((value, name) => entries.push([name, value]));
  return Object.fromEntries(entries);
}

/**
 * @param {Function} fetchRequest A function accepting (url, options) and returning
 *   a response with status, headers, and an async text() method.
 * @param {Object} [defaults] Request defaults, including optional headers.
 * @returns {import('./engine.mjs').SourceHost}
 */
export function createFetchHost(fetchRequest, defaults = {}) {
  if (typeof fetchRequest !== 'function') throw new TypeError('A fetch function is required');
  return {
    async request(url, options = {}) {
      const response = await fetchRequest(url, {
        ...defaults,
        ...options,
        method: options.method || defaults.method || 'GET',
        headers: { ...defaults.headers, ...options.headers },
      });
      return {
        status: response.status,
        headers: normalizeHeaders(response.headers),
        body: await response.text(),
      };
    },
  };
}
