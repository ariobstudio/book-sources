import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../repository.mjs';

const pack = {
  id: 'fixture', name: 'Fixture', version: '1', contentType: 'books',
  capabilities: { search: true, resolve: false },
  search: { steps: [], items: { regex: '(row)', fields: {} } },
};

function fixture() {
  const calls = [];
  const state = {
    manifest: { sources: [{ id: 'fixture', name: 'Fixture', version: '1', sourceUrl: './packs/fixture.json' }] },
    pack: structuredClone(pack), status: 200,
  };
  const host = {
    async request(url) {
      calls.push(url);
      return {
        status: state.status,
        headers: {},
        body: state.body ?? JSON.stringify(url.endsWith('repo.json') ? state.manifest : state.pack),
      };
    },
  };
  return { calls, state, repository: createRepository('https://example.com/catalog/repo.json', host) };
}

test('repository lazily loads packs, resolves relative URLs, and deduplicates concurrent loads', async () => {
  const { calls, repository } = fixture();
  assert.equal(calls.length, 0);
  assert.equal((await repository.list())[0].id, 'fixture');
  assert.equal(calls.length, 1);
  const results = await Promise.all([repository.load('fixture'), repository.load('fixture')]);
  assert.equal(results[0], results[1]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], 'https://example.com/catalog/packs/fixture.json');
  await assert.rejects(repository.load('missing'), /not found/);
});

test('refresh invalidates cached definitions after a new manifest is fetched', async () => {
  const { calls, state, repository } = fixture();
  await repository.load('fixture');
  state.pack.version = '2';
  state.manifest.sources[0].version = '2';
  await repository.refresh();
  assert.equal((await repository.load('fixture')).version, '2');
  assert.equal(calls.length, 4);
});

test('source version mismatches fail and failed source loads can retry', async () => {
  const { state, repository } = fixture();
  state.pack.version = '2';
  await assert.rejects(repository.load('fixture'), /id and version must match/);
  state.pack.version = '1';
  assert.equal((await repository.load('fixture')).version, '1');
});

test('repository handles HTTP and JSON errors without caching failures', async () => {
  const { state, repository } = fixture();
  state.status = 503;
  await assert.rejects(repository.list(), /HTTP 503/);
  state.status = 200;
  state.body = '<html>error</html>';
  await assert.rejects(repository.list(), /Invalid JSON/);
  delete state.body;
  assert.equal((await repository.list()).length, 1);
});

test('manifest validation rejects duplicate IDs, missing source URLs, and non-HTTP URLs', async () => {
  const duplicate = fixture();
  duplicate.state.manifest.sources.push(duplicate.state.manifest.sources[0]);
  await assert.rejects(duplicate.repository.list(), /duplicate source id/);
  const missing = fixture();
  delete missing.state.manifest.sources[0].sourceUrl;
  await assert.rejects(missing.repository.list(), /sourceUrl/);
  const invalidURL = fixture();
  invalidURL.state.manifest.sources[0].sourceUrl = 'file:///tmp/pack.json';
  await assert.rejects(invalidURL.repository.list(), /HTTP or HTTPS/);
  assert.throws(() => createRepository('file:///tmp/repo.json', {}), /HTTP or HTTPS/);
});
