// Copyright (c) 2026 Ariob Studio. Apache-2.0.
import { dom, all, one, attr, text, request, headers, page, url, optionalURL } from './common.mjs';
const base = 'https://www.webtoons.com';
function site(value) {
  const target = url(value, base);
  if (new URL(target).origin !== base) throw new Error('Invalid WEBTOON chapter link.');
  return target;
}
function next(tree, current) {
  return all(tree, 'a[href]').some(a => { try { return Number(new URL(attr(a, 'href'), base).searchParams.get('page')) > current; } catch { return false; } });
}
export async function search(source, query, index, host) {
  const target = `${base}/en/search?keyword=${encodeURIComponent(query)}&page=${Math.max(1, index)}`;
  const tree = dom((await request(host, target, { headers: headers(base + '/en/') })).body);
  const seen = new Set();
  return page(all(tree, 'a[href*="/list?title_no="]').flatMap(a => {
    const title = text(one(a, '.title')); if (!title) return [];
    const link = site(attr(a, 'href')); if (seen.has(link)) return []; seen.add(link);
    return [{ id: link, title, author: text(one(a, '.author')), format: 'cbz', delivery: 'chapters', direction: 'ltr', language: 'en',
      coverUrl: optionalURL(attr(one(a, 'img'), 'src'), base), coverReferer: base + '/en/' }];
  }), next(tree, index));
}
export async function chapters(source, item, index, host) {
  const target = new URL(site(item.id)); target.searchParams.set('page', String(Math.max(1, index)));
  const tree = dom((await request(host, target.href, { headers: headers(base + '/en/') })).body);
  const seen = new Set();
  const items = all(tree, 'li._episodeItem[data-episode-no]').flatMap(row => {
    const href = attr(one(row, 'a[href*="/viewer?"]'), 'href'); if (!href) return [];
    const link = site(href); if (seen.has(link)) return []; seen.add(link);
    return [{ id: link, title: text(one(row, '.subj')) || `Episode ${attr(row, 'data-episode-no')}`,
      number: attr(row, 'data-episode-no'), language: 'en' }];
  });
  // Keep the site's newest-first chapter-list order across pagination. Page
  // images themselves remain in document order, from top to bottom.
  return { items, hasMore: next(tree, index) };
}
export async function pages(source, item, host) {
  const target = site(item.id);
  const tree = dom((await request(host, target, { headers: headers(target) })).body);
  const images = all(tree, 'img._images[data-url]').map(img => ({ url: url(attr(img, 'data-url'), target), headers: { Referer: target, Accept: 'image/jpeg,image/png' } }));
  if (!images.length) throw new Error('This episode is locked or has no publicly downloadable images.');
  return images;
}
export function resolve() { throw new Error('Choose an episode to download as CBZ.'); }
