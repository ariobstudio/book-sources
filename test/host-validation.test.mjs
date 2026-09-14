import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createFetchHost } from '../fetch-host.mjs';
import { createNodeHost } from '../host.mjs';
import { validateSource } from '../validation.mjs';
import { listSources } from '../catalog.mjs';

const source = {
  id: 'fixture', name: 'Fixture', version: '1', contentType: 'books',
  capabilities: { search: true, resolve: false },
  search: {
    steps: [{ step: 'request', url: 'https://example.com/{query}' }],
    items: { jsonPath: 'results', fields: { id: [{ json: 'id' }] }, required: ['id'] },
  },
};

test('portable fetch host supports a custom transport and merges request defaults', async () => {
  let received;
  const host = createFetchHost(async (url, options) => {
    received = { url, options };
    return { status: 201, headers: { custom: 'header' }, text: async () => 'body' };
  }, { method: 'POST', headers: { default: 'kept', override: 'old' } });
  assert.deepEqual(await host.request('custom:resource', { method: undefined, headers: { override: 'new' } }), {
    status: 201, headers: { custom: 'header' }, body: 'body',
  });
  assert.deepEqual(received, { url: 'custom:resource', options: { method: 'POST', headers: { default: 'kept', override: 'new' } } });
});

test('Node host preserves text responses and request defaults', async () => {
  const calls = [];
  const host = createNodeHost(async (url, options) => {
    calls.push(options);
    return new Response('hello', { status: 200, headers: { 'X-Test': 'value' } });
  });
  const response = await host.request('https://example.com', { headers: { 'User-Agent': 'custom' } });
  assert.equal(response.body, 'hello');
  assert.equal(response.headers['x-test'], 'value');
  assert.equal(calls[0].headers['User-Agent'], 'custom');
  assert.equal(calls[0].redirect, 'follow');
});

test('fetch host rejects missing transports and propagates network failures', async () => {
  assert.throws(() => createFetchHost(), /fetch function/);
  const host = createFetchHost(async () => { throw new Error('offline'); });
  await assert.rejects(host.request('https://example.com'), /offline/);
});

test('validation returns its input and does not require platform globals', () => {
  assert.equal(validateSource(source), source);
});

test('validation reports malformed packs before a request can run', () => {
  const changes = [
    [(s) => { s.search.steps[0].retries = 0; }, /retries/],
    [(s) => { s.search.steps[0].step = 'execute'; }, /expected request or set/],
    [(s) => { s.search.steps[0].body = '{}'; }, /unsupported property/],
    [(s) => { s.search.items.fields.id = [{ typo: true }]; }, /exactly one operation/],
    [(s) => { s.search.items.fields.id = [{ regex: '[' }]; }, /regex/],
    [(s) => { s.search.items.fields.id = [{ anchors: { pick: 'random' } }]; }, /pick/],
    [(s) => { delete s.search.items.jsonPath; s.search.items.regex = '(row)'; s.search.items.flags = 'i'; }, /include g/],
    [(s) => { s.search.items.required = ['missing']; }, /unknown field/],
    [(s) => { s.search.steps.push({ step: 'set', name: '__proto__' }); }, /nonreserved/],
    [(s) => { s.search.items.fields = JSON.parse('{"__proto__":[]}'); }, /reserved field/],
    [(s) => { s.capabilities.search = false; }, /capability flag/],
  ];
  changes.forEach(([change, pattern]) => {
    const invalid = structuredClone(source);
    change(invalid);
    assert.throws(() => validateSource(invalid), pattern);
  });
});

test('repository manifest IDs and versions match the hosted source packs', async () => {
  const manifest = JSON.parse(await readFile(new URL('../repo.json', import.meta.url)));
  const packs = await listSources(fileURLToPath(new URL('../sources/', import.meta.url)));
  const versions = (entries) => entries.map(({ id, version }) => [id, version]).sort();
  assert.deepEqual(versions(manifest.sources), versions(packs));
});
