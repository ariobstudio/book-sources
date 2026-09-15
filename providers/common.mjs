// Copyright (c) 2026 Ariob Studio. Apache-2.0.
// DOM-free maintained parsers are needed for HTML forms and OPDS namespaces;
// a regular expression cannot reliably preserve nested metadata or attributes.
import { parseDocument } from 'htmlparser2';
import { selectAll, selectOne } from 'css-select';
import { textContent } from 'domutils';
export function dom(html, xml = false) {
  const tree = parseDocument(String(html), { xmlMode: xml });
  if (xml) {
    // Atom feeds may use a default namespace or an explicit atom: prefix.
    const visit = node => { if (node.name) node.name = node.name.split(':').pop(); for (const child of node.children ?? []) visit(child); };
    visit(tree);
  }
  return tree;
}
export const all = (node, selector) => selectAll(selector, node);
export const one = (node, selector) => selectOne(selector, node);
export const attr = (node, key) => node?.attribs?.[key] ?? '';
export const text = node => node ? textContent(node).replace(/\s+/g, ' ').trim() : '';
export const clean = value => text(dom(value ?? ''));
export function url(value, base) {
  const parsed = new URL(value, base);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('This source requires an HTTPS URL without embedded credentials.');
  return parsed.href;
}
export const optionalURL = (value, base) => { try { return value ? url(value, base) : ''; } catch { return ''; } };
export const format = value => String(value ?? '').toLowerCase().match(/(?:^|[.\s/])(epub|cbz)(?:$|[?\s+#])/i)?.[1] ?? '';
export const form = values => Object.entries(values).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
export const headers = base => ({ 'User-Agent': 'Mozilla/5.0', Referer: base, Accept: 'text/html,application/json,application/atom+xml' });
export function header(response, name) { return Object.entries(response.headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? ''; }
export async function request(host, target, options = {}) {
  const response = await host.request(url(target), options);
  if (response.status < 200 || response.status >= 300) throw new Error(`Source unavailable (HTTP ${response.status}). Try again later.`);
  if (/cf-chl-|cf-challenge|challenge-platform|<title>\s*Just a moment/i.test(response.body)) throw new Error('This source requires a browser verification and cannot provide a direct download right now.');
  return response;
}
export async function json(host, target, options) {
  const response = await request(host, target, options);
  try { return JSON.parse(response.body); } catch { throw new Error('The source returned a webpage instead of catalog data.'); }
}
export const page = (items, hasMore = false) => ({ items: items.filter(item => item.title && ['epub', 'cbz'].includes(item.format)), hasMore });
export function download(item, target = item.downloadUrl, extra = {}) {
  if (!['epub', 'cbz'].includes(item.format)) throw new Error('Only EPUB and CBZ downloads are supported.');
  return { url: url(target), fileName: `${item.title}.${item.format}`, ...extra };
}
export async function settings(source, host) { return await host.settings?.(source) ?? {}; }
export function sameOrigin(target, base) { return new URL(url(target, base)).origin === new URL(base).origin; }
