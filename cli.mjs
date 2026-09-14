#!/usr/bin/env node
/** Node entry point. Source interpretation stays in the portable engine. */
import { writeFile } from 'node:fs/promises';
import { createNodeHost } from './host.mjs';
import { runSearch, runResolve } from './engine.mjs';
import { listSources, loadSourceDefinition } from './catalog.mjs';
import { createRepository } from './repository.mjs';

const USAGE = `Usage:
  book-sources list [--json]
  book-sources validate [source]
  book-sources search <source> <query> [page] [--json]
  book-sources download <source> <query> <result#|id> [-o path]
  book-sources cover <source> <query> <result#|id> [-o path]

Options:
  --repo <url>               Load a hosted repo.json (or set BOOK_SOURCES_REPOSITORY).
  --sources-dir <directory>  Read local source packs from this directory.
  --json                     Print list or search results as JSON.
  -o, --output <path>         Save a book or cover to this path.
  -h, --help                 Show this help.

Quote queries that contain spaces. Download and cover select from page 1.
Run without installation with: node cli.mjs <command>`;

function parseArguments(args) {
  const options = { positional: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      options.positional.push(...args.slice(index + 1));
      break;
    }
    if (['-h', '--help'].includes(argument)) options.help = true;
    else if (argument === '--json') options.json = true;
    else if (['--repo', '--sources-dir', '-o', '--output'].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value`);
      const key = argument === '--repo' ? 'repository' : argument === '--sources-dir' ? 'directory' : 'destination';
      options[key] = value;
    } else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else options.positional.push(argument);
  }
  return options;
}

function validateArguments(command, args, options) {
  const ranges = { list: [0, 0], validate: [0, 1], search: [2, 3], download: [3, 3], cover: [3, 3] };
  if (!Object.hasOwn(ranges, command)) throw new Error(`Unknown command: ${command}`);
  const [minimum, maximum] = ranges[command];
  if (args.length < minimum || args.length > maximum || args.some((argument) => !argument)) {
    throw new Error(`Invalid arguments for ${command}. Run node cli.mjs help for usage.`);
  }
  if (options.json && !['list', 'search'].includes(command)) throw new Error('--json is supported by list and search');
  if (options.destination && !['download', 'cover'].includes(command)) throw new Error('--output is supported by download and cover');
  if (command === 'search' && args[2] !== undefined && (!Number.isSafeInteger(Number(args[2])) || Number(args[2]) < 1)) {
    throw new Error('Page must be a positive integer');
  }
}

function printResult(item, index) {
  const metadata = [item.author, item.year, item.language, item.format, item.size].filter(Boolean).join(' | ');
  console.log(`${index + 1}. ${item.title}`);
  if (metadata) console.log(`   ${metadata}`);
  console.log(`   id: ${item.id}`);
  if (item.coverUrl) console.log(`   cover: ${item.coverUrl}`);
  console.log();
}

function printResults(results) {
  results.forEach(printResult);
  console.log(`${results.length} result(s)`);
}

function printSource(source) {
  console.log(`${source.id} v${source.version} — ${source.name}`);
}

function printJSON(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function searchSource(source, query, page, host) {
  if (!source.search) throw new Error(`${source.id}: source has no search pipeline`);
  return (await runSearch(source, query, page, host)).items;
}

function selectResult(results, pick) {
  // Preserve exact-ID precedence, including numeric IDs, before result position.
  const item = results.find((result) => result.id === pick) ?? results[Number(pick) - 1];
  if (!item) throw new Error(`Result "${pick}" not found`);
  return item;
}

async function fetchDownload(url, headers) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', ...headers },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response;
}

function destinationPath(destination, extension, fallback) {
  if (!destination) return fallback.replace(/[/\\]/g, '_');
  return /\.\w+$/.test(destination) ? destination : `${destination}.${extension}`;
}

function bookPath(response, source, item, destination) {
  const disposition = response.headers.get('content-disposition') ?? '';
  const remoteName = decodeURIComponent(disposition.match(/filename="?([^";]+)"?/)?.[1] ?? '');
  const remoteExtension = (remoteName.match(/\.(\w{2,5})$/)?.[1] ?? '').toLowerCase();
  const extension = remoteExtension || item.format || 'bin';
  // A server filename takes precedence over the source-id fallback.
  return destinationPath(destination, extension, remoteName || `${source.id}-${item.id}`);
}

function coverPath(response, source, item, destination) {
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) throw new Error(`Cover response is not an image (${type || 'missing Content-Type'})`);
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
  const extension = extensions[type] ?? 'img';
  return destinationPath(destination, extension, `${source.id}-${item.id}-cover.${extension}`);
}

async function saveResponse(response, path) {
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(path, buffer);
  console.log(`Saved: ${path} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
}

async function downloadBook(source, item, destination, host) {
  const resolved = await runResolve(source, item, host);
  const response = await fetchDownload(resolved.url, resolved.headers);
  await saveResponse(response, bookPath(response, source, item, destination));
}

async function downloadCover(source, item, destination) {
  if (!item.coverUrl) throw new Error(`${source.id}: result "${item.id}" has no cover URL`);
  const response = await fetchDownload(item.coverUrl);
  await saveResponse(response, coverPath(response, source, item, destination));
}

function sourceProvider(options, host) {
  if (options.directory && options.repository) throw new Error('Choose --repo or --sources-dir');
  if (options.directory) {
    return {
      list: () => listSources(options.directory),
      load: (id) => loadSourceDefinition(id, options.directory),
    };
  }
  const url = options.repository || process.env.BOOK_SOURCES_REPOSITORY;
  if (!url) throw new Error('Specify --repo <url>, set BOOK_SOURCES_REPOSITORY, or use --sources-dir <directory>');
  return createRepository(url, host);
}

async function runCommand(command, args, options) {
  const host = createNodeHost();
  const provider = sourceProvider(options, host);
  if (command === 'list') {
    const sources = await provider.list();
    return options.json ? printJSON(sources) : sources.forEach(printSource);
  }
  if (command === 'validate') {
    const entries = args[0] ? [{ id: args[0] }] : await provider.list();
    // Validate one pack at a time to avoid a burst of requests to a repository.
    for (const entry of entries) {
      const source = await provider.load(entry.id);
      console.log(`Valid: ${source.id} v${source.version}`);
    }
    console.log(`${entries.length} source(s) validated`);
    return;
  }
  const [id, query, selection] = args;
  const source = await provider.load(id);
  const results = await searchSource(source, query, command === 'search' ? selection : 1, host);
  if (command === 'search') return options.json ? printJSON(results) : printResults(results);
  const item = selectResult(results, selection);
  if (command === 'cover') return downloadCover(source, item, options.destination);
  return downloadBook(source, item, options.destination, host);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [command, ...args] = options.positional;
  if (!command || command === 'help' || options.help) {
    console.log(USAGE);
    if (!command && !options.help) process.exitCode = 1;
    return;
  }
  validateArguments(command, args, options);
  await runCommand(command, args, options);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
