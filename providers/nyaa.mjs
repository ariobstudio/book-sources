// Copyright (c) 2026 Ariob Studio. Apache-2.0.
import { all, one, attr, text, dom, request, url } from './common.mjs';

export async function search(source, query, page, host, filters = {}) {
  const target = new URL(source.baseUrl);
  target.searchParams.set('q', query);
  target.searchParams.set('p', String(page));
  // Literature only. Raw/non-English categories do not identify a language.
  const categories = { all: '3_0', english: '3_1', nonEnglish: '3_2', raw: '3_3' };
  target.searchParams.set('c', categories[filters.nyaaCategory] || (filters.language === 'en' ? '3_1' : '3_0'));
  target.searchParams.set('f', filters.nyaaQuality === 'trusted' ? '2' : filters.nyaaQuality === 'noRemakes' ? '1' : '0');
  const tree = dom((await request(host, target.href)).body);
  const items = all(tree, '.torrent-list tbody tr').flatMap(row => {
    const cells = all(row, 'td');
    const titleLink = all(cells[1], 'a').find(link => /^\/view\/\d+$/.test(attr(link, 'href')));
    const id = attr(titleLink, 'href').match(/^\/view\/(\d+)$/)?.[1];
    const category = attr(one(cells[0], 'a'), 'href');
    if (!id || !/[?&]c=3_[123](?:&|$)/.test(category)) return [];
    const links = all(cells[2], 'a');
    const magnet = attr(links.find(link => attr(link, 'href').startsWith('magnet:?')), 'href');
    const torrent = attr(links.find(link => /^\/download\/\d+\.torrent$/.test(attr(link, 'href'))), 'href');
    if (!magnet && !torrent) return [];
    const title = text(titleLink);
    // Nyaa groups manga and novels together. Only hide explicit novel labels;
    // ambiguous titles stay visible, and this is never claimed as manga detection.
    if (filters.nyaaHideNovels && /\b(?:light[ -]*novels?|novels?)\b|\[(?:LN|WN)\]/i.test(title)) return [];
    return [{ id, title, author: '', format: 'torrent', delivery: 'torrent',
      magnet, torrentUrl: torrent ? url(torrent, source.baseUrl) : '',
      language: category.includes('3_1') ? 'en' : '', size: text(cells[3]),
      seeds: text(cells[5]), detailUrl: url(`/view/${id}`, source.baseUrl) }];
  });
  return { items, hasMore: !!one(tree, '.pagination li:not(.disabled) a[rel=next]') };
}
export async function torrent(source, item) {
  if (typeof item.magnet === 'string' && item.magnet.startsWith('magnet:?')) return { url: item.magnet };
  return { url: url(item.torrentUrl, source.baseUrl) };
}
export async function resolve() { throw new Error('Choose an EPUB or CBZ from this release using your connected download service.'); }
