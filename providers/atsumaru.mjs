// Copyright (c) 2026 Ariob Studio. Apache-2.0.
import { json, headers, page, url } from './common.mjs';
const base = 'https://atsu.moe';
const options = { headers: headers(base + '/') };
const identifier = value => { if (!/^[a-z0-9_-]+$/i.test(String(value))) throw new Error('Invalid Atsumaru identifier.'); return value; };
const imageURL = value => url(String(value).startsWith('https:') || String(value).startsWith('//') ? value : `/static/${String(value).replace(/^\/?static\//, '').replace(/^\//, '')}`, base);
export async function search(source, query, index, host, filters = {}) {
  if (filters.language && filters.language !== 'en') return page([]);
  const params = new URLSearchParams({ q: query, query_by: 'title,englishTitle,otherNames,authors', page: String(index), per_page: '20', filter_by: 'hidden:!=true && isAdult:=false' });
  const data = await json(host, `${base}/collections/manga/documents/search?${params}`, options);
  if (!Array.isArray(data.hits)) throw new Error('Atsumaru returned an invalid catalog.');
  return page(data.hits.map(hit => hit.document).filter(m => m?.id && !m.hidden && !m.isAdult).map(m => ({
    id: m.id, title: m.title || m.englishTitle, author: (m.authors ?? []).map(a => typeof a === 'string' ? a : a.name).filter(Boolean).join(', '),
    format: 'cbz', delivery: 'chapters', language: 'en', availableLanguages: ['en'],
    direction: String(m.type).toLowerCase() === 'manga' ? 'rtl' : 'ltr',
    coverUrl: m.poster ? imageURL(typeof m.poster === 'string' ? m.poster : m.poster.image) : '', coverReferer: base + '/',
    description: m.synopsis, year: m.releaseYear,
  })), index * 20 < data.found);
}
export async function chapters(source, item, index, host) {
  if (index > 1 || (item.chapterLanguage && item.chapterLanguage !== 'en')) return { items: [], hasMore: false };
  const data = await json(host, `${base}/api/manga/allChapters?mangaId=${identifier(item.id)}`, options);
  if (!Array.isArray(data.chapters)) throw new Error('Atsumaru returned an invalid chapter list.');
  const known = new Set();
  return { items: data.chapters.filter(ch => ch.id && ch.pageCount > 0 && !known.has(ch.id) && !!known.add(ch.id))
    .sort((a, b) => Number(a.number) - Number(b.number)).map(ch => ({ id: `${item.id}/${ch.id}`, title: ch.title || `Chapter ${ch.number}`, number: String(ch.number), language: 'en', pages: ch.pageCount })), hasMore: false };
}
export async function pages(source, item, host) {
  const ids = String(item.id).split('/');
  if (ids.length !== 2) throw new Error('Invalid Atsumaru chapter.');
  const data = await json(host, `${base}/api/read/chapter?mangaId=${identifier(ids[0])}&chapterId=${identifier(ids[1])}`, options);
  const rows = data.readChapter?.pages;
  if (!Array.isArray(rows) || !rows.length || rows.some(p => !p.image)) throw new Error('This chapter has no complete downloadable page list.');
  return rows.map(p => ({ url: imageURL(p.image), headers: options.headers }));
}
export function resolve() { throw new Error('Choose a chapter to download as CBZ.'); }
