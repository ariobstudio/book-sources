/** Load independently hosted JSON source packs through the application's host. */
import { validateSource } from './validation.mjs';

function httpURL(value, base) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Repository URLs must use HTTP or HTTPS: ${url}`);
  return url.href;
}

async function requestJSON(url, host) {
  const response = await host.request(url, { method: 'GET' });
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status} for ${url}`);
  try {
    return JSON.parse(response.body);
  } catch {
    throw new Error(`Invalid JSON from ${url}`);
  }
}

function validateManifest(manifest, url) {
  if (!manifest || !Array.isArray(manifest.sources)) throw new Error(`${url}: expected a sources array`);
  const ids = new Set();
  manifest.sources.forEach((entry, index) => {
    const path = `${url}: sources[${index}]`;
    if (!entry || !/^[a-z0-9][a-z0-9_-]*$/.test(entry.id) || typeof entry.id !== 'string') throw new Error(`${path}: invalid source id`);
    ['name', 'version', 'sourceUrl'].forEach((name) => {
      if (typeof entry[name] !== 'string' || !entry[name]) throw new Error(`${path}: ${name} must be a nonempty string`);
    });
    if (ids.has(entry.id)) throw new Error(`${path}: duplicate source id ${entry.id}`);
    ids.add(entry.id);
    httpURL(entry.sourceUrl, url);
  });
  return manifest;
}

/**
 * Create a repository client with an in-memory manifest and source cache.
 * @param {string} manifestURL Absolute HTTP(S) URL of repo.json.
 * @param {import('./engine.mjs').SourceHost} host Injected text transport.
 * @returns {{list: Function, load: Function, refresh: Function}}
 *   list() returns manifest entries; load(id) validates and returns a pack;
 *   refresh() reloads the manifest and clears cached packs. Failed loads can retry.
 */
export function createRepository(manifestURL, host) {
  const url = httpURL(manifestURL);
  const sources = new Map();
  let manifestPromise;

  async function fetchManifest() {
    return validateManifest(await requestJSON(url, host), url);
  }

  async function getManifest() {
    if (!manifestPromise) manifestPromise = fetchManifest();
    const pending = manifestPromise;
    try {
      return await pending;
    } catch (error) {
      if (manifestPromise === pending) manifestPromise = undefined;
      throw error;
    }
  }

  async function list() {
    const manifest = await getManifest();
    return manifest.sources.map((entry) => ({ ...entry }));
  }

  async function fetchSource(entry) {
    const sourceURL = httpURL(entry.sourceUrl, url);
    const source = validateSource(await requestJSON(sourceURL, host));
    if (source.id !== entry.id || source.version !== entry.version) {
      throw new Error(`${sourceURL}: source id and version must match the repository entry`);
    }
    return source;
  }

  async function load(id) {
    const entries = await list();
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Source "${id}" not found in ${url}`);
    const key = JSON.stringify([entry.id, entry.version, entry.sourceUrl]);
    if (!sources.has(key)) sources.set(key, fetchSource(entry));
    const pending = sources.get(key);
    try {
      return await pending;
    } catch (error) {
      if (sources.get(key) === pending) sources.delete(key);
      throw error;
    }
  }

  async function refresh() {
    const manifest = await fetchManifest();
    manifestPromise = Promise.resolve(manifest);
    sources.clear();
    return list();
  }

  return { list, load, refresh };
}
