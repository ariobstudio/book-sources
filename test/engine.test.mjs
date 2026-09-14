import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { interpolate, runSearch as searchPage, runResolve } from '../engine.mjs';

const runSearch = async (...args) => (await searchPage(...args)).items;
const readSource = async (id) => JSON.parse(await readFile(new URL(`../sources/${id}.source.json`, import.meta.url)));

function fixtureHost(responses) {
  const calls = [];
  return {
    calls,
    async request(url, options) {
      calls.push({ url, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response, 'Unexpected request');
      return { status: 200, headers: {}, ...response };
    },
  };
}

function jsonSource(fields, options = {}) {
  return {
    id: 'fixture',
    search: {
      steps: [{ step: 'request', url: 'https://example.com/{query|urlencode}' }],
      items: { jsonPath: 'results', fields, ...options },
    },
  };
}

test('interpolation preserves filter order, missing values, and leading slash behavior', () => {
  assert.equal(interpolate('{query|urlencode}/{missing|default:a b|urlencode}/{path|trimSlash}', {
    query: 'a & b', path: '//book/',
  }), 'a%20%26%20b/a%20b/book/');
  assert.equal(interpolate('{item.id}:{zero|default:9}:{missing}:{query|unknown}', {
    item: { id: 12 }, zero: 0, query: 'kept',
  }), '12:0::kept');
});

test('Gutenberg search and resolve preserve result fields, pagination, and missing EPUB behavior', async () => {
  const source = await readSource('gutenberg');
  const host = fixtureHost([{ body: JSON.stringify({ results: [
    { id: 12, title: 'A book', authors: [{ name: 'A writer' }], languages: ['en'], formats: { 'application/epub+zip': 'https://example.com/12.epub', 'image/jpeg': 'https://example.com/12.jpg' } },
    { id: 13, title: 'No EPUB', formats: {} },
    { id: 14, title: '' },
  ] }) }]);
  const results = await runSearch(source, 'a & b', 2, host);
  assert.deepEqual(results, [
    { id: '12', title: 'A book', author: 'A writer', language: 'en', coverUrl: 'https://example.com/12.jpg', downloadUrl: 'https://example.com/12.epub', format: 'epub' },
    { id: '13', title: 'No EPUB', author: '', language: '', coverUrl: '', downloadUrl: '', format: 'txt' },
  ]);
  assert.equal(host.calls[0].url, 'https://gutendex.com/books/?search=a%20%26%20b&page=2');
  assert.deepEqual(await runResolve(source, results[0], host), { url: 'https://example.com/12.epub', fileName: 'A book.epub' });
  await assert.rejects(runResolve(source, results[1], host), /resolve produced no url/);
});

test('LibGen keeps quote-aware title selection, required fields, and resolve steps', async () => {
  const source = await readSource('libgen');
  const md5 = 'a'.repeat(32);
  const row = `<tr><td><a href="edition.php?id=1" title="<br>">The &amp; Book</a><a href="edition.php?id=2">#36</a><a href="edition.php?id=3">123; X</a></td><td> Author </td><td>Publisher</td><td>2024</td><td>English</td><td>unused</td><td>2 MB</td><td>EPUB</td><td><a href="ads.php?md5=${md5}">get</a></td></tr>`;
  const host = fixtureHost([
    { body: `<table class="table table-striped" id="tablelibgen"><tr><td>Heading</td></tr>${row}</table>` },
    { body: `<a href="/get.php?md5=${md5}&key=ABC123">Get</a>` },
  ]);
  const results = await runSearch(source, 'query', 1, host);
  assert.deepEqual(results, [{ md5, id: md5, title: 'The & Book', author: 'Author', publisher: 'Publisher', year: '2024', language: 'English', size: '2 MB', format: 'epub', pages: '', editionID: '1' }]);
  assert.ok(host.calls[0].url.endsWith('&page=1'));
  assert.equal(source.resolve.steps[0].headers.Referer, 'https://libgen.li/');
  assert.equal(source.resolve.output.headers.Referer, 'https://libgen.li/');
  assert.deepEqual(await runResolve(source, results[0], host), { url: `https://libgen.li/get.php?md5=${md5}&key=ABC123`, fileName: 'The & Book.epub', headers: source.resolve.output.headers });
});

test('operations run left to right and fields can reference earlier fields', async () => {
  const source = jsonSource({
    id: [{ json: 'id' }],
    title: [{ json: 'title' }, { stripTags: true }, { trim: true }, { lowercase: true }, { prepend: '[' }, { append: ']' }],
    label: [{ template: '{item.id}:{item.title}' }],
    fallback: [{ json: 'missing' }, { default: 'fallback' }],
    match: [{ json: 'title' }, { regex: 'BOOK', flags: 'i', group: 0 }],
    literal: [{ json: ['formats', 'a.b'] }],
  }, { required: ['id', 'title'], limit: 1 });
  const host = fixtureHost([{ body: JSON.stringify({ results: [{ id: 9, title: ' <b>Book &amp; title</b> ', formats: { 'a.b': 'literal' } }, { id: 10, title: 'ignored' }] }) }]);
  assert.deepEqual(await runSearch(source, '', 1, host), [{ id: '9', title: '[book & title]', label: '9:[book & title]', fallback: 'fallback', match: 'Book', literal: 'literal' }]);
});

test('anchor selection supports first, last, longest, clean, and href output', async () => {
  const fields = Object.fromEntries(['first', 'last', 'longest', 'clean'].map((pick) => [pick, [{ anchors: { pick } }, { stripTags: true }]]));
  fields.href = [{ anchors: { hrefIncludes: 'long', part: 'href' } }];
  const source = { id: 'anchors', search: { steps: [{ step: 'request', url: 'https://example.com' }], items: { regex: '<row>([\\s\\S]*?)</row>', fields } } };
  const host = fixtureHost([{ body: '<row><a href="first">Short</a><a href="long" title=">">The longest title</a><a href="number">#36</a><a href="empty"> </a></row>' }]);
  assert.deepEqual(await runSearch(source, '', 1, host), [{ first: 'Short', last: '#36', longest: 'The longest title', clean: 'The longest title', href: 'long' }]);
});

test('retry attempts stay sequential and set steps see the final response', async () => {
  const source = jsonSource({ id: [{ json: 'id' }] });
  source.search.steps[0].retries = 3;
  source.search.steps[0].untilRegex = 'results';
  const host = fixtureHost([{ status: 503, body: '' }, { body: 'challenge' }, { body: '{"results":[{"id":1}]}' }]);
  assert.deepEqual(await runSearch(source, '', 1, host), [{ id: '1' }]);
  assert.equal(host.calls.length, 3);
});

test('HTTP and pattern failures remain errors; transport errors are not retried', async () => {
  const source = jsonSource({});
  source.search.steps[0].retries = 8;
  const host = fixtureHost(Array.from({ length: 5 }, () => ({ status: 503, body: '' })));
  await assert.rejects(runSearch(source, '', 1, host), /fixture: HTTP 503/);
  assert.equal(host.calls.length, 5);
  source.search.steps[0].retries = 1;
  source.search.steps[0].untilRegex = 'expected';
  await assert.rejects(runSearch(source, '', 1, fixtureHost([{ body: 'other' }])), /expected pattern not found/);
  await assert.rejects(runSearch(source, '', 1, fixtureHost([new Error('offline')])), /offline/);
});

test('invalid JSON and non-array paths return no results', async () => {
  const source = jsonSource({});
  for (const body of ['not JSON', '{"results":{}}', '{}']) {
    assert.deepEqual(await runSearch(source, '', 1, fixtureHost([{ body }])), []);
  }
});

test('resolve interpolates only top-level strings and keeps header objects literal', async () => {
  const source = { id: 'resolve', resolve: { output: { url: '{item.url}', fileName: '{item.id}', headers: { Authorization: '{item.token}' } } } };
  assert.deepEqual(await runResolve(source, { url: 'https://example.com', id: '1', token: 'secret' }, {}), {
    url: 'https://example.com', fileName: '1', headers: { Authorization: '{item.token}' },
  });
  await assert.rejects(runResolve({ id: 'missing' }, {}, {}), /source has no resolve pipeline/);
});

test('LibGen accepts reordered table attributes and single-quoted links without confusing ISBNs for titles', async () => {
  const source = await readSource('libgen');
  const md5 = 'b'.repeat(32);
  const row = `<tr><td><a title='<br>scan' href='edition.php?id=2'>Alice &amp; Friends</a><a href='edition.php?id=2'>9781234567890; X</a></td><td>Carroll, Lewis</td><td>Publisher</td><td>1865</td><td>English</td><td>200</td><td>4 MB</td><td>EPUB</td><td><a href='ads.php?md5=${md5.toUpperCase()}'>Get</a></td></tr>`;
  const host = fixtureHost([{ body: `<table data-layout='books' id='tablelibgen' class='table responsive table-striped'><tr><th>Title</th></tr>${row}</table>` }]);
  const [book] = await runSearch(source, 'Alice', 2, host);
  assert.deepEqual(book, { md5, id: md5, title: 'Alice & Friends', author: 'Carroll, Lewis', publisher: 'Publisher', year: '1865', language: 'English', size: '4 MB', format: 'epub', pages: '200', editionID: '2' });
  assert.match(host.calls[0].options.headers['User-Agent'], /Mozilla/);
});

test('LibGen resolves absolute and escaped download links without duplicating the host', async () => {
  const source = await readSource('libgen');
  const md5 = 'c'.repeat(32);
  for (const href of [`/get.php?md5=${md5}&key=abc123`, `https://libgen.li/get.php?md5=${md5}&amp;key=ABC123`]) {
    const result = await runResolve(source, { md5, title: 'Alice', format: 'epub' }, fixtureHost([{ body: `<a href="${href}">GET</a>` }]));
    assert.equal(new URL(result.url).hostname, 'libgen.li');
    assert.equal(new URL(result.url).pathname, '/get.php');
    assert.equal(new URL(result.url).searchParams.get('md5'), md5);
    assert.equal(new URL(result.url).searchParams.get('key')?.toLowerCase(), 'abc123');
  }
});

test('LibGen distinguishes an empty results table from a successful HTTP response containing no catalog', async () => {
  const source = await readSource('libgen');
  source.search.steps[0].retries = 1;
  assert.deepEqual(await runSearch(source, 'absent', 1, fixtureHost([{ body: '<table id="tablelibgen"><tr><th>No results</th></tr></table>' }])), []);
  for (const body of ['<h1>Welcome to nginx!</h1>', '<style>#tablelibgen td {color:black}</style><h1>Unavailable</h1>']) {
    await assert.rejects(runSearch(source, 'Alice', 1, fixtureHost([{ body }])), /expected pattern not found/);
  }
});

test('captured live LibGen table returns 25 distinct files with exact column metadata', async () => {
  const source = await readSource('libgen');
  const body = await readFile(new URL('./fixtures/libgen-search.html', import.meta.url), 'utf8');
  const items = await runSearch(source, 'alice wonderland', 1, fixtureHost([{ body }]));
  assert.equal(items.length, 25);
  assert.equal(new Set(items.map(item => item.md5)).size, 25);
  assert.deepEqual(items[0], {
    md5: 'f84db86464adfe0bbb8741ac73d924a0', id: 'f84db86464adfe0bbb8741ac73d924a0',
    title: 'Trapped in Wonderland First edition paperback', author: '(Fictitious character from Carroll) Alice;Hoots, Dani',
    publisher: '', year: '2017', language: 'English', size: '328 kB', format: 'epub',
    pages: '282', editionID: '140746421',
  });
  assert.equal(items[1].md5, 'd31089be7013f56ca62581589efbeb32');
  assert.equal(items[1].size, '454 kB');
});

test('LibGen zero-file response ends pagination without treating the missing table as an outage', async () => {
  const source = await readSource('libgen');
  const body = await readFile(new URL('./fixtures/libgen-empty.html', import.meta.url), 'utf8');
  assert.deepEqual(await runSearch(source, 'zzpillcrowabsent729813', 1, fixtureHost([{ body }])), []);
});

test('Gutenberg next-page metadata ends scrolling while the last page still contains books', async () => {
  const source = await readSource('gutenberg');
  const results = [{ id: 11, title: 'Alice', formats: { 'application/epub+zip': 'https://www.gutenberg.org/ebooks/11.epub3.images' } }];
  const last = await searchPage(source, 'Alice', 1, fixtureHost([{ body: JSON.stringify({ next: null, results }) }]));
  assert.equal(last.items.length, 1);
  assert.equal(last.hasMore, false);
  const next = await searchPage(source, 'Alice', 1, fixtureHost([{ body: JSON.stringify({ next: 'https://gutendex.com/books/?page=2', results }) }]));
  assert.equal(next.hasMore, true);
});

 test('LibGen resolves actual edition or file covers, and treats missing covers as optional', async () => {
  const { runCover } = await import('../engine.mjs');
  const source = await readSource('libgen');
  for (const path of ['/editioncovers/137868000/137868366.jpg', '/covers/4544000/abc.jpg']) {
    const host = fixtureHost([{ body: `<img src="/img/logo.png"><img class="img-fluid" src="${path}">` }]);
    const cover = await runCover(source, { editionID: '137868366' }, host);
    assert.equal(cover.url, `https://libgen.li${path}`);
    assert.equal(cover.headers.Referer, 'https://libgen.li/');
    assert.equal(host.calls[0].url, 'https://libgen.li/edition.php?id=137868366');
  }
  assert.equal(await runCover(source, { editionID: '1' }, fixtureHost([{ body: '<img src="/img/logo.png">' }])), null);
});
