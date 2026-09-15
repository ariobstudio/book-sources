// Copyright (c) 2026 Ariob Studio. Apache-2.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runSearch, runResolve, runCover } from '../engine.mjs';
import { validateSource } from '../validation.mjs';
const source = async id => JSON.parse(await readFile(new URL(`../sources/${id}.source.json`, import.meta.url), 'utf8'));
const reply = (body, headers = {}) => ({ status: 200, body: typeof body === 'string' ? body : JSON.stringify(body), headers });
function host(responses, config = {}) { const calls = []; return { calls, settings: async () => config, request: async (url, options) => { calls.push({ url, options }); const next = responses.shift(); assert.ok(next, `Unexpected request to ${url}`); return next; } }; }

test('Bookracy keeps EPUB/CBZ metadata and stops repeating an API without pagination', async () => {
  const s = await source('bookracy'); const h = host([reply({ results: [
    { md5: 'a', title: 'Alice &amp; Friends', author: 'Lewis Carroll', book_filetype: 'epub', link: 'https://files.test/alice.epub', publisher: 'Public Editions', year: 1865, book_lang: 'English' },
    { md5: 'b', title: 'Alice comic', book_filetype: 'cbz', link: 'https://files.test/alice.cbz' },
    { md5: 'c', title: 'Unsupported PDF', book_filetype: 'pdf', link: 'https://files.test/alice.pdf' },
  ] })]);
  const found = await runSearch(s, 'alice', 1, h); assert.equal(found.items.length, 2); assert.equal(found.hasMore, false); assert.equal(found.items[0].title, 'Alice & Friends'); assert.equal(found.items[0].publisher, 'Public Editions');
  assert.deepEqual((await runSearch(s, 'alice', 2, h)).items, []); assert.equal(h.calls.length, 1);
  assert.equal((await runResolve(s, found.items[1], h)).fileName, 'Alice comic.cbz');
  assert.equal((await runCover(s, found.items[0], h)).headers.Referer, 'https://bookracy.com/');
});

test('unavailable APIs fail visibly instead of masquerading as no matches', async () => {
  for (const id of ['bookracy', 'zlibrary', 'oceanofpdf', 'annas-archive', 'swaytranslations']) {
    await assert.rejects(runSearch(await source(id), 'alice', 1, host([{ status: 403, body: '', headers: {} }])), /403/);
  }
});

test('OPDS uses OpenSearch templates, next links, edition formats and scoped credentials', async () => {
  const s = await source('opds-catalog');
  const root = '<feed><link rel="search" href="search.xml" type="application/opensearchdescription+xml"/></feed>';
  const search = '<OpenSearchDescription><Url template="https://opds.test/search?q={searchTerms}&amp;page={startPage?}"/></OpenSearchDescription>';
  const first = '<feed><link rel="next" href="/search?q=alice&amp;cursor=two"/></feed>';
  const second = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>alice</id><title>Alice</title><author><name>Lewis Carroll</name></author><link rel="http://opds-spec.org/image" href="/cover.jpg"/><link rel="http://opds-spec.org/acquisition/open-access" type="application/epub+zip" href="/alice.epub"/><link rel="http://opds-spec.org/acquisition" type="application/vnd.comicbook+zip" href="https://cdn.test/alice.cbz"/><link rel="http://opds-spec.org/acquisition" type="application/pdf" href="/alice.pdf"/></entry></feed>';
  const h = host([reply(root), reply(search), reply(first), reply(second)], { serverUrl: 'https://opds.test/', username: 'reader', password: 'secret' });
  const found = await runSearch(s, 'alice', 2, h); assert.equal(found.items.length, 2); assert.equal(found.hasMore, false); assert.match(h.calls[2].url, /q=alice&page=1/); assert.match(h.calls[3].url, /cursor=two/);
  const local = await runResolve(s, found.items[0], h); assert.match(local.headers.Authorization, /^Basic /);
  const cdn = await runResolve(s, found.items[1], h); assert.deepEqual(cdn.headers, {});
  assert.match((await runCover(s, found.items[0], h)).headers.Authorization, /^Basic /);
});

test('OPDS requires configuration and never sends credentials to a foreign catalog', async () => {
  const s = await source('opds-catalog'); await assert.rejects(runSearch(s, 'alice', 1, host([])), /server address/);
  const h = host([reply('<feed><link rel="search" href="https://foreign.test/steal"/></feed>')], { serverUrl: 'https://opds.test/', password: 'secret' });
  await assert.rejects(runSearch(s, 'alice', 1, h), /another server/); assert.equal(h.calls.length, 1);
});

test('Z-Library searches anonymously, preserves editions, and refuses exhausted quotas', async () => {
  const s = await source('zlibrary'); const h = host([reply({ books: [{ id: 4, hash: 'hash', title: 'Alice', author: 'Carroll', extension: 'epub', cover: '/cover.jpg' }, { id: 8, title: 'Unresolvable', extension: 'epub' }] })], { email: 'reader@example.test', password: 'secret' });
  const found = await runSearch(s, 'alice', 2, h); assert.equal(found.items.length, 1); assert.match(h.calls[0].options.body, /page=2/); assert.ok(!h.calls[0].options.headers.Cookie);
  const q = host([reply({ success: 1, user: { id: 7, remix_userkey: 'token' } }), reply({ success: 1, file: { allowDownload: false } })], { email: 'reader@example.test', password: 'secret' });
  await assert.rejects(runResolve(s, found.items[0], q), /limit/); assert.match(q.calls[1].options.headers.Cookie, /remix_userkey=token/);
  const ok = host([reply({ success: 1, user: { id: 7, remix_userkey: 'token' } }), reply({ success: 1, file: { downloadLink: 'https://z-library.ec/alice.epub', extension: 'epub' } })], { email: 'reader@example.test', password: 'secret' });
  assert.equal((await runResolve(s, found.items[0], ok)).url, 'https://z-library.ec/alice.epub');
});

test('OceanofPDF keeps EPUB forms and validates session-bound Refresh redirects', async () => {
  const s = await source('oceanofpdf'); const h = host([reply('<article aria-label="EPUB"><h2><a href="/alice/">Alice</a></h2><img data-src="/alice.jpg"/></article><a rel="next" href="/page/2/">Next</a>')]);
  const found = await runSearch(s, 'alice', 1, h); assert.equal(found.items[0].coverUrl, 'https://readrobe.com/alice.jpg'); assert.equal(found.hasMore, true);
  const html = '<form action="/fetching-ebook-php/"><input value="7" name="id"><input name="filename" value="Alice.epub"></form><form action="/fetching-ebook-php/"><input name="id" value="8"><input name="filename" value="Alice.pdf"></form>';
  const ok = host([reply(html), reply('', { Refresh: '0; url=/download.php?filename=Alice.epub&token=public-test-token', 'Set-Cookie': 'session=test; Path=/; HttpOnly' })]);
  const file = await runResolve(s, found.items[0], ok); assert.equal(file.headers.Cookie, 'session=test'); assert.match(ok.calls[1].options.body, /filename=Alice.epub/);
  const bad = host([reply(html), reply('', { Refresh: '0; url=https://foreign.test/download.php?filename=Alice.epub&token=test' })]);
  await assert.rejects(runResolve(s, found.items[0], bad), /unexpected/);
});

test('Anna’s Archive resolves only exposed download links and never persists supporter keys', async () => {
  const s = await source('annas-archive'); const id = 'a'.repeat(32); const h = host([reply(`<div><a href="/md5/${id}"><h3>Alice</h3></a><span class="italic">Carroll</span><span>EPUB 1 MB</span><img src="/cover.jpg"/></div>`)]);
  const found = await runSearch(s, 'alice', 1, h); assert.equal(found.items[0].author, 'Carroll');
  const file = await runResolve(s, found.items[0], host([reply('<a href="https://files.test/alice.epub">Download now</a>')], { supporterKey: 'private-key' }));
  assert.ok(!JSON.stringify(file).includes('private-key'));
  await assert.rejects(runResolve(s, found.items[0], host([reply('<title>Just a moment</title>')])), /browser verification/);
});

test('ElScione traverses only matching folders and keeps original file paths', async () => {
  const s = await source('elscione'); const h = host([
    reply({ items: [{ href: '/Officially%20Translated%20Light%20Novels/Alice/', type: 'folder' }, { href: '/Officially%20Translated%20Light%20Novels/Unrelated/', type: 'folder' }] }),
    reply({ items: [] }), reply({ items: [] }), reply({ items: [] }), reply({ items: [] }),
    reply({ items: [{ href: '/Officially%20Translated%20Light%20Novels/Alice/Volume%201.epub', size: 42 }, { href: '/Officially%20Translated%20Light%20Novels/Alice/Volume%201.pdf' }] }),
  ]);
  const found = await runSearch(s, 'alice', 1, h); assert.equal(found.items.length, 1); assert.equal(found.items[0].title, 'Volume 1'); assert.ok(!JSON.stringify(h.calls).includes('Unrelated/'));
  assert.match((await runResolve(s, found.items[0], h)).url, /Volume%201.epub/);
});

test('Sway returns only downloadable editions and preserves drive file identifiers', async () => {
  const s = await source('swaytranslations'); const h = host([reply({ found: 22, posts: [{ title: 'Alice', featured_image: 'https://images.test/cover.jpg', content: '<p><a href="https://drive.google.com/file/d/test-id/view">EPUB</a><a href="https://files.test/alice.pdf">PDF</a><a href="/chapter-1">Read chapter</a></p>' }] })]);
  const found = await runSearch(s, 'alice', 1, h); assert.equal(found.items.length, 1); assert.equal(found.hasMore, true); assert.match((await runResolve(s, found.items[0], h)).url, /id=test-id/);
});

test('repositories cannot select unknown executable adapters or inject configuration keys', async () => {
  const s = await source('bookracy'); assert.throws(() => validateSource({ ...s, provider: 'remote-javascript' }), /unknown/);
  assert.throws(() => validateSource({ ...s, configuration: [{ id: '__proto__', type: 'password', label: 'Password' }] }), /invalid/);
});
