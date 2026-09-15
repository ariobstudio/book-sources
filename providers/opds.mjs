// Copyright (c) 2026 Ariob Studio. Apache-2.0.
import { all, attr, dom, download, headers, one, page, request, sameOrigin, settings, text, url, optionalURL } from './common.mjs';
function basic(value) {
  // PrimJS does not guarantee browser TextEncoder; percent encoding yields UTF-8.
  const encoded = encodeURIComponent(value), bytes = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === '%') { bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(encoded.charCodeAt(i));
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let output = '';
  for (let i = 0; i < bytes.length; i += 3) { const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0); output += alphabet[n >>> 18] + alphabet[n >>> 12 & 63] + (i + 1 < bytes.length ? alphabet[n >>> 6 & 63] : '=') + (i + 2 < bytes.length ? alphabet[n & 63] : '='); }
  return output;
}
async function connection(source, host) {
  const config = await settings(source, host);
  if (!config.serverUrl) throw new Error('Set your OPDS server address in Settings → Book sources.');
  const base = url(config.serverUrl); const auth = headers(base);
  if (config.username || config.password) auth.Authorization = `Basic ${basic(`${config.username || ''}:${config.password || ''}`)}`;
  const fetch = async target => {
    if (!sameOrigin(target, base)) throw new Error('OPDS redirected the catalog to another server. Update its address in Settings.');
    return dom((await request(host, target, { headers: auth })).body, true);
  };
  return { base, auth, fetch };
}
export async function search(source, query, index, host) {
  if (index > 20) return page([]);
  const conn = await connection(source, host); let target = conn.base; let tree = await conn.fetch(target);
  const searchLink = all(tree, 'link').find(node => attr(node, 'rel') === 'search');
  let filtered = true;
  if (searchLink) {
    let template = attr(searchLink, 'href');
    if (!template.includes('{searchTerms}')) {
      const description = await conn.fetch(url(template, target));
      template = attr(all(description, '*').find(node => node.name.split(':').pop() === 'Url' && attr(node, 'template')), 'template');
    }
    if (template.includes('{searchTerms}')) { target = url(template.replace(/\{searchTerms\}/g, encodeURIComponent(query)).replace(/\{(?:startPage|page)\??\}/g, '1').replace(/\{[^}]+\?\}/g, ''), target); tree = await conn.fetch(target); filtered = false; }
  }
  // Follow the catalog's continuation links, rather than guessing its paging API.
  for (let p = 1; p < index; p++) { const next = all(tree, 'link').find(node => attr(node, 'rel') === 'next'); if (!next) return page([]); target = url(attr(next, 'href'), target); tree = await conn.fetch(target); }
  const items = [];
  for (const entry of all(tree, 'entry')) {
    const title = text(one(entry, 'title')); const author = text(one(entry, 'author > name'));
    if (filtered && !`${title} ${author}`.toLowerCase().includes(query.toLowerCase())) continue;
    const links = all(entry, 'link'); const cover = links.find(link => /image|thumbnail/.test(attr(link, 'rel')));
    for (const link of links.filter(link => /opds-spec.org\/acquisition(?:\/open-access)?$/.test(attr(link, 'rel')))) {
      const type = attr(link, 'type'); const format = /epub\+zip/.test(type) ? 'epub' : /(?:comicbook\+zip|x-cbz)/.test(type) ? 'cbz' : '';
      if (!format) continue;
      items.push({ id: `${text(one(entry, 'id')) || target + title}:${format}`, title, author, format, downloadUrl: url(attr(link, 'href'), target), coverUrl: optionalURL(attr(cover, 'href'), target), origin: conn.base, description: text(one(entry, 'summary') || one(entry, 'content')) });
    }
  }
  return page(items, all(tree, 'link').some(node => attr(node, 'rel') === 'next'));
}
export async function resolve(source, item, host) {
  const conn = await connection(source, host);
  if (conn.base !== item.origin) throw new Error('Your OPDS server changed. Search again before downloading.');
  return download(item, item.downloadUrl, { headers: sameOrigin(item.downloadUrl, conn.base) ? conn.auth : {} });
}
export async function cover(source, item, host) { const conn = await connection(source, host); return item.coverUrl ? { url: item.coverUrl, headers: sameOrigin(item.coverUrl, conn.base) ? conn.auth : {} } : null; }
