// Copyright (c) 2026 Ariob Studio. Apache-2.0.
import { all, attr, dom, download, headers, one, page, request, settings, text, url, optionalURL } from './common.mjs';
export async function search(source, query, index, host) {
  const target = `${source.baseUrl}/search?q=${encodeURIComponent(query)}&ext=epub&page=${index}`;
  const tree = dom((await request(host, target, { headers: headers(source.baseUrl) })).body);
  const seen = new Set(); const items = [];
  for (const anchor of all(tree, 'a[href*="/md5/"]')) {
    const md5 = attr(anchor, 'href').match(/\/md5\/([a-f0-9]{32})(?:$|[/?#])/i)?.[1]; if (!md5 || seen.has(md5)) continue;
    const block = anchor.parent; const title = text(one(anchor, 'h3') || one(block, 'h3') || anchor); if (!title || /^\[|^\d+$/.test(title)) continue;
    const meta = text(block); const actualFormat = meta.match(/\b(epub|cbz|pdf|mobi|azw3|cbr|djvu)\b/i)?.[1]?.toLowerCase();
    if (actualFormat && actualFormat !== 'epub' && actualFormat !== 'cbz') continue;
    const image = one(block, 'img'); seen.add(md5);
    items.push({ id: md5, title, author: text(one(block, '.italic, [class*="author"]')), format: actualFormat || 'epub', detailUrl: `${source.baseUrl}/md5/${md5}`, coverUrl: optionalURL(attr(image, 'src') || attr(image, 'data-src'), target), size: meta.match(/\d+(?:\.\d+)?\s*[KMG]i?B/i)?.[0] || '' });
  }
  return page(items, !!one(tree, 'a[rel="next"], a[href*="page=' + (index + 1) + '"]'));
}
function linkFrom(html, base) {
  const tree = dom(html);
  return all(tree, 'a[href]').map(node => ({ target: optionalURL(attr(node, 'href'), base), label: text(node) })).find(link => link.target && (/\.(epub|cbz)(?:$|\?)/i.test(link.target) || /[?&](?:download|filename)=/i.test(link.target) || /download now/i.test(link.label)))?.target;
}
export async function resolve(source, item, host) {
  if (!/^[a-f0-9]{32}$/i.test(item.id)) throw new Error('This result has no valid book identifier.');
  const detail = `${source.baseUrl}/md5/${item.id}`; const config = await settings(source, host);
  if (config.supporterKey) {
    const response = await request(host, `${source.baseUrl}/fast_download/${item.id}/0/2?secret=${encodeURIComponent(config.supporterKey)}`, { headers: headers(source.baseUrl) });
    const target = linkFrom(response.body, detail);
    // Do not put the supporter key into a download Referer or persisted metadata.
    if (target) return download(item, target, { headers: headers(detail) });
    throw new Error('Anna’s Archive did not accept the supporter download. Check your source key.');
  }
  const response = await request(host, detail, { headers: headers(source.baseUrl) });
  const direct = linkFrom(response.body, detail); if (direct) return download(item, direct, { headers: headers(detail) });
  const links = all(dom(response.body), 'a[href*="/slow_download/"]').map(node => optionalURL(attr(node, 'href'), detail)).filter(target => target && new URL(target).origin === new URL(source.baseUrl).origin);
  for (const target of [...new Set(links)].slice(0, 3)) {
    const next = await request(host, target, { headers: headers(detail) });
    const file = linkFrom(next.body, target); if (file) return download(item, file, { headers: headers(detail) });
  }
  throw new Error('This edition requires browser verification or a supporter key. A direct EPUB/CBZ link is not available.');
}
