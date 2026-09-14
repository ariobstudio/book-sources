/** Local source discovery for Node tools. Applications can load JSON themselves. */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateSource } from './validation.mjs';

/** Load and validate <id>.source.json from a local directory. */
export async function loadSourceDefinition(id, directory) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error(`Invalid source ID: ${id}`);
  const path = resolve(directory, `${id}.source.json`);
  let source;
  try {
    source = validateSource(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    throw new Error(`Cannot load ${path}: ${error.message}`);
  }
  if (source.id !== id) throw new Error(`${path}: source.id must match filename (${id})`);
  return source;
}

/** Discover and validate packs in filename order; unrelated files are ignored. */
export async function listSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const ids = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.source.json'))
    .map((entry) => entry.name.slice(0, -'.source.json'.length))
    .sort();
  return Promise.all(ids.map((id) => loadSourceDefinition(id, directory)));
}
