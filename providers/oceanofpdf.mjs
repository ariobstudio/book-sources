// Copyright (c) 2026 Ariob Studio. Apache-2.0.
import { all, attr, dom, download, form, header, headers, one, page, request, text, url, optionalURL } from './common.mjs';
export async function search(source, query, index, host) {
  const target = `${source.baseUrl}${index > 1 ? `/page/${index}/` : '/'}?s=${encodeURIComponent(query)}`;
  const tree = dom((await request(host, target, { headers: headers(source.baseUrl) })).body);
  const items = all(tree, 'article').map(article => {
    const anchor = one(article, 'h2 a, h3 a, .entry-title a'); const image = one(article, 'img'); const target = optionalURL(attr(anchor, 'href'), source.baseUrl);
    return { id: target, title: text(anchor), author: text(article).match(/Author:\s*(.*?)(?:Language:|Genre:|$)/)?.[1]?.trim() || '', format: /\bepub\b/i.test(`${target} ${text(one(article, '.entry-content p'))} ${attr(article, 'aria-label')}`) ? 'epub' : '', detailUrl: target,
      coverUrl: optionalURL(attr(image, 'data-src') || attr(image, 'src'), source.baseUrl), description: text(one(article, '.entry-content p')) };
  }).filter(item => item.detailUrl);
  return page(items, !!one(tree, 'a.next, a[rel="next"]'));
}
export async function resolve(source, item, host) {
  if (new URL(item.detailUrl).origin !== new URL(source.baseUrl).origin) throw new Error('The book detail URL belongs to another source.');
  const tree = dom((await request(host, item.detailUrl, { headers: headers(source.baseUrl) })).body);
  const forms = all(tree, 'form').map(node => ({ endpoint: optionalURL(attr(node, 'action'), item.detailUrl), id: attr(one(node, 'input[name="id"]'), 'value'), fileName: attr(one(node, 'input[name="filename"]'), 'value') }));
  const selected = forms.find(node => node.id && node.fileName.toLowerCase().endsWith('.epub') && /fetching-ebook-php/.test(node.endpoint));
  if (!selected || new URL(selected.endpoint).origin !== new URL(source.baseUrl).origin) throw new Error('This edition does not expose a direct EPUB download.');
  const response = await request(host, selected.endpoint, { method: 'POST', headers: { ...headers(item.detailUrl), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ id: selected.id, filename: selected.fileName }) });
  const refresh = header(response, 'refresh').match(/(?:^|;)\s*url\s*=\s*["']?([^\r\n]+?)["']?\s*$/i)?.[1];
  if (!refresh) throw new Error('This source requires a browser download instead of a direct EPUB link.');
  const target = url(refresh.replaceAll('&amp;', '&'), selected.endpoint); const parsed = new URL(target);
  if (parsed.origin !== new URL(selected.endpoint).origin || parsed.pathname !== '/download.php' || parsed.searchParams.get('filename') !== selected.fileName || !parsed.searchParams.get('token') || parsed.searchParams.getAll('filename').length !== 1) throw new Error('The source returned an unexpected download redirect.');
  const cookie = header(response, 'set-cookie').split(/,(?=\s*[^\s;,=]+=)/).map(value => value.split(';')[0].trim()).filter(value => /^[^\s;,=]+=[^\r\n;]*$/.test(value)).join('; ');
  return download(item, target, { fileName: selected.fileName, headers: { Referer: selected.endpoint, ...(cookie ? { Cookie: cookie } : {}) } });
}
