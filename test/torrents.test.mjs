import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runSearch, runTorrent, runResolve } from '../engine.mjs';
import { validateSource } from '../validation.mjs';
const source = async id => validateSource(JSON.parse(await readFile(new URL(`../sources/${id}.source.json`, import.meta.url))));
const hash = '1234567890abcdef1234567890abcdef12345678';
function row(id, category) { return `<tr><td><a href="/?c=${category}">Category</a></td><td><a href="/view/${id}#comments">4</a><a href="/view/${id}">Little Nemo &amp; friends</a></td><td><a href="/download/${id}.torrent">Torrent</a><a href="magnet:?xt=urn:btih:${hash}&amp;dn=Little%20Nemo">Magnet</a></td><td>12 MiB</td><td>2026-09-14</td><td>5</td></tr>`; }
test('Nyaa searches only literature, preserves swarm metadata and follows real next links', async () => {
  const calls = [], s = await source('nyaa');
  const h = { request: async url => { calls.push(url); return { status: 200, body: `<table class="torrent-list"><tbody>${row(1,'3_1')}${row(2,'1_2')}${row(3,'3_3')}</tbody></table><ul class="pagination"><li><a rel="next" href="/?p=3">Next</a></li></ul>` }; } };
  const result = await runSearch(s, 'Nemo & friends', 2, h, { language: 'en' });
  const url = new URL(calls[0]); assert.equal(url.searchParams.get('c'), '3_1'); assert.equal(url.searchParams.get('p'), '2'); assert.equal(url.searchParams.get('q'), 'Nemo & friends');
  assert.equal(result.hasMore, true); assert.equal(result.items.length, 2);
  assert.equal(result.items[0].format, 'torrent'); assert.equal(result.items[0].language, 'en'); assert.equal(result.items[1].language, '');
  assert.equal((await runTorrent(s, result.items[0], h)).url, `magnet:?xt=urn:btih:${hash}&dn=Little%20Nemo`);
  await assert.rejects(runResolve(s, result.items[0], h), /Choose an EPUB or CBZ/);
});
test('Nyaa final/empty pages stop infinite loading', async () => {
  const result = await runSearch(await source('nyaa'), 'Nemo', 1, { request: async () => ({ status: 200, body: '<ul class="pagination"><li class="disabled"><a rel="next">Next</a></li></ul>' }) });
  assert.deepEqual(result, { items: [], hasMore: false });
});
test('LibGen uses advertised torrent links and never treats an edition MD5 as a swarm hash', async () => {
  const s = await source('libgen');
  for (const [href, expected] of [[`magnet:?xt=urn:btih:${hash}&amp;dn=books`, `magnet:?xt=urn:btih:${hash}&dn=books`], ['/torrents/collection.torrent', 'https://libgen.li/torrents/collection.torrent']]) {
    const found = await runTorrent(s, { md5: 'a'.repeat(32) }, { request: async () => ({ status: 200, body: `<a href="${href}">Torrent</a>` }) });
    assert.equal(found.url, expected);
  }
  await assert.rejects(runTorrent(s, { md5: 'a'.repeat(32) }, { request: async () => ({ status: 200, body: '<a href="get.php?key=direct">Get</a>' }) }), /no url/);
});
