// Copyright (c) 2026 Ariob Studio. Apache-2.0.
import { all, attr, clean, dom, download, format, json, optionalURL, page, text, one } from './common.mjs';
export async function search(source, query, index, host) {
  const endpoint = `https://public-api.wordpress.com/rest/v1.1/sites/${new URL(source.baseUrl).hostname}/posts/?type=page&number=20&page=${index}&search=${encodeURIComponent(query)}`;
  const data = await json(host, endpoint); const items = [];
  for (const post of data.posts ?? []) {
    const tree = dom(post.content); const title = clean(post.title);
    for (const anchor of all(tree, 'a[href]')) {
      const href = optionalURL(attr(anchor, 'href'), source.baseUrl); if (!href) continue;
      const label = text(anchor); const ext = format(href) || format(label); if (!ext) continue;
      let target = href; const parsed = new URL(href);
      if (parsed.hostname === 'drive.google.com') { const id = parsed.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] || parsed.searchParams.get('id'); if (!id) continue; target = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`; }
      items.push({ id: target, title: `${title}${label && !/^(epub|cbz|download)$/i.test(label) ? ' — ' + label : ''}`, author: '', format: ext, downloadUrl: target,
        coverUrl: optionalURL(post.featured_image || attr(one(tree, 'img'), 'src'), source.baseUrl), description: clean(post.excerpt) });
    }
  }
  return page([...new Map(items.map(item => [item.id, item])).values()], Number(data.found) > index * 20);
}
export async function resolve(source, item) { return download(item); }
