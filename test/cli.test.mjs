import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
let server, directory, sources, baseURL, fixturePack;
const requests = [];

function serve(request, response) {
  requests.push({ url: request.url, headers: request.headers });
  if (request.url === '/repo.json') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ sources: [{ id: 'fixture', name: 'Fixture catalog', version: '1.0.0', sourceUrl: './packs/fixture.source.json' }] }));
  } else if (request.url === '/packs/fixture.source.json') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(fixturePack));
  } else if (request.url.startsWith('/search')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ results: [
      { id: 9, title: 'First book', url: `${baseURL}/book/9`, cover: `${baseURL}/cover`, format: 'epub' },
      { id: 1, title: 'Exact ID wins', url: `${baseURL}/book/1`, cover: `${baseURL}/cover`, format: 'epub' },
      { id: 3, title: 'No cover', url: `${baseURL}/book/3`, format: 'epub' },
      { id: 4, title: 'Bad cover', url: `${baseURL}/book/4`, cover: `${baseURL}/bad-cover`, format: 'epub' },
    ] }));
  } else if (request.url.startsWith('/book/')) {
    response.setHeader('Content-Disposition', 'attachment; filename="fixture.epub"');
    response.end(`BOOK:${request.url.split('/').pop()}`);
  } else if (request.url === '/cover') {
    response.setHeader('Content-Type', 'image/jpeg');
    response.end(jpeg);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<html>not an image</html>');
  }
}

function run(...args) {
  return execute(process.execPath, [cli, ...args], { cwd: directory, timeout: 10000 });
}

function custom(...args) {
  return run(...args, '--sources-dir', sources);
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'book-sources-test-'));
  sources = join(directory, 'sources');
  await mkdir(sources);
  server = createServer(serve);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  const source = {
    id: 'fixture', name: 'Fixture catalog', version: '1.0.0', contentType: 'books',
    capabilities: { search: true, resolve: true },
    search: {
      steps: [{ step: 'request', url: `${baseURL}/search?q={query|urlencode}&page={page}` }],
      items: { jsonPath: 'results', fields: {
        id: [{ json: 'id' }], title: [{ json: 'title' }], downloadUrl: [{ json: 'url' }],
        coverUrl: [{ json: 'cover' }, { default: '' }], coverReferer: [{ template: 'https://catalog.example/' }], format: [{ json: 'format' }],
      }, required: ['id', 'title'] },
    },
    resolve: { output: { url: '{item.downloadUrl}', fileName: '{item.title}.epub', headers: { 'X-Fixture': 'resolve-header' } } },
  };
  fixturePack = source;
  await writeFile(join(sources, 'fixture.source.json'), JSON.stringify(source));
  await writeFile(join(sources, 'ignored.json'), '{}');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

test('help and explicit source discovery work from a different working directory', async () => {
  assert.match((await run('--help')).stdout, /book-sources cover/);
  assert.match((await custom('list')).stdout, /fixture/);
  assert.match((await custom('validate')).stdout, /1 source\(s\) validated/);
});

test('new source files work without CLI or manifest edits', async () => {
  const result = await custom('list', '--json');
  assert.deepEqual(JSON.parse(result.stdout).map((source) => source.id), ['fixture']);
  assert.match((await custom('validate', 'fixture')).stdout, /Valid: fixture/);
});

test('search returns JSON, preserves query encoding and forwards page numbers', async () => {
  const result = await custom('search', 'fixture', 'a & b', '2', '--json');
  assert.equal(JSON.parse(result.stdout)[0].coverUrl, `${baseURL}/cover`);
  assert.ok(requests.some((request) => request.url === '/search?q=a%20%26%20b&page=2'));
  const text = await custom('search', 'fixture', 'query');
  assert.match(text.stdout, /1\. First book/);
  assert.match(text.stdout, /cover: http:/);
});

test('book downloads preserve exact ID precedence, headers, and output extension rules', async () => {
  const destination = join(directory, 'chosen');
  await custom('download', 'fixture', 'query', '1', '-o', destination);
  assert.equal(await readFile(`${destination}.epub`, 'utf8'), 'BOOK:1');
  assert.ok(requests.some((request) => request.url === '/book/1' && request.headers['x-fixture'] === 'resolve-header'));
  await custom('download', 'fixture', 'query', '2', '-o', join(directory, 'explicit.data'));
  assert.equal(await readFile(join(directory, 'explicit.data'), 'utf8'), 'BOOK:1');
  await custom('download', 'fixture', 'query', '9');
  assert.equal(await readFile(join(directory, 'fixture.epub'), 'utf8'), 'BOOK:9');
});

test('cover command fetches bytes and uses the image content type for the filename', async () => {
  await custom('cover', 'fixture', 'query', '9');
  assert.deepEqual(await readFile(join(directory, 'fixture-9-cover.jpg')), jpeg);
  assert.ok(requests.some(request => request.url === '/cover' && request.headers.referer === 'https://catalog.example/'));
  await custom('cover', 'fixture', 'query', '9', '--output', join(directory, 'cover'));
  assert.deepEqual(await readFile(join(directory, 'cover.jpg')), jpeg);
});

test('missing and non-image covers produce useful errors', async () => {
  await assert.rejects(custom('cover', 'fixture', 'query', '3'), (error) => error.code === 1 && /has no cover URL/.test(error.stderr));
  await assert.rejects(custom('cover', 'fixture', 'query', '4'), (error) => error.code === 1 && /not an image/.test(error.stderr));
});

test('invalid arguments and missing sources exit nonzero with an error on stderr', async () => {
  const cases = [
    [['unknown'], /Unknown command/],
    [['search'], /Invalid arguments/],
    [['search', 'fixture', 'query', '0'], /positive integer/],
    [['download', 'fixture', 'query', '1', '-o'], /requires a value/],
    [['list', '--wat'], /Unknown option/],
    [['download', 'fixture', 'query', '1', '--json'], /supported by list and search/],
    [['search', '../fixture', 'query'], /Invalid source ID/],
    [['search', 'absent', 'query'], /Cannot load/],
    [['download', 'fixture', 'query', '100'], /not found/],
  ];
  for (const [args, pattern] of cases) {
    await assert.rejects(custom(...args), (error) => error.code === 1 && pattern.test(error.stderr));
  }
});


test('hosted CLI loads a manifest, validates packs, and searches without local sources', async () => {
  const repositoryURL = `${baseURL}/repo.json`;
  assert.equal(JSON.parse((await run('list', '--repo', repositoryURL, '--json')).stdout)[0].sourceUrl, './packs/fixture.source.json');
  assert.match((await run('validate', '--repo', repositoryURL)).stdout, /Valid: fixture/);
  const results = JSON.parse((await run('search', 'fixture', 'query', '--repo', repositoryURL, '--json')).stdout);
  assert.equal(results[0].title, 'First book');
  await assert.rejects(custom('list', '--repo', repositoryURL), (error) => /Choose --repo or --sources-dir/.test(error.stderr));
});

test('installed archive exposes package imports and a working CLI without source data', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const packed = await execute('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', directory], { cwd: root, timeout: 30000 });
  const archive = JSON.parse(packed.stdout)[0];
  assert.ok(!archive.files.some(({ path }) => path === 'repo.json' || path.startsWith('sources/') || path.startsWith('test/')));
  const application = join(directory, 'application');
  await mkdir(application);
  await execute('npm', ['install', '--prefix', application, join(directory, archive.filename), '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], { timeout: 30000 });
  const installed = join(application, 'node_modules', '.bin', 'book-sources');
  const environment = { ...process.env, BOOK_SOURCES_REPOSITORY: `${baseURL}/repo.json` };
  const help = await execute(installed, ['--help'], { cwd: application, env: environment, timeout: 10000 });
  assert.match(help.stdout, /book-sources cover/);
  const result = await execute(installed, ['search', 'fixture', 'query', '--json'], { cwd: application, env: environment, timeout: 10000 });
  assert.equal(JSON.parse(result.stdout)[0].id, '9');
  await execute(installed, ['cover', 'fixture', 'query', '9', '-o', 'installed-cover'], { cwd: application, env: environment, timeout: 10000 });
  assert.deepEqual(await readFile(join(application, 'installed-cover.jpg')), jpeg);
  const imports = await execute(process.execPath, ['--input-type=module', '-e', `
    import { runSearch, runResolve } from 'book-sources';
    import { createRepository } from 'book-sources/repository';
    import { createFetchHost } from 'book-sources/fetch-host';
    import { validateSource } from 'book-sources/validation';
    import { createNodeHost } from 'book-sources/node-host';
    const host = createFetchHost(fetch);
    const repo = createRepository(process.env.BOOK_SOURCES_REPOSITORY, host);
    const source = validateSource(await repo.load('fixture'));
    const { items } = await runSearch(source, 'query', 1, host);
    const download = await runResolve(source, items[0], host);
    console.log(JSON.stringify({ id: items[0].id, url: download.url, host: typeof createNodeHost().request }));
  `], { cwd: application, env: environment, timeout: 10000 });
  assert.deepEqual(JSON.parse(imports.stdout), { id: '9', url: `${baseURL}/book/9`, host: 'function' });
});
