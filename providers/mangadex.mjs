// Copyright (c) 2026 Ariob Studio. Apache-2.0.
import { json, page, url } from './common.mjs';
const base = 'https://api.mangadex.org';
const options = { headers: { Accept: 'application/json', 'User-Agent': 'Pillcrow/0.7 (https://pillcrow.app)' } };
const id = value => { if (!/^[a-f0-9-]{36}$/i.test(String(value))) throw new Error('Invalid MangaDex identifier.'); return value; };
export async function search(source, query, index, host) {
  const offset = (Math.max(1, index) - 1) * 20;
  const data = await json(host, `${base}/manga?title=${encodeURIComponent(query)}&limit=20&offset=${offset}&includes[]=cover_art&includes[]=author&order[relevance]=desc`, options);
  if (!Array.isArray(data.data)) throw new Error('MangaDex returned an invalid catalog.');
  return page(data.data.map(manga => {
    const a = manga.attributes ?? {}, relationships = manga.relationships ?? [];
    const cover = relationships.find(r => r.type === 'cover_art')?.attributes?.fileName;
    const title = a.title?.en || a.title?.['ja-ro'] || Object.values(a.title ?? {})[0];
    return { id: manga.id, title, format: 'cbz', delivery: 'chapters',
      author: relationships.filter(r => r.type === 'author').map(r => r.attributes?.name).filter(Boolean).join(', '),
      description: a.description?.en, language: a.originalLanguage,
      // MangaDex supplies no reading-direction field. Japanese defaults to RTL;
      // other languages use LTR. The chapter picker exposes an explicit override.
      direction: a.originalLanguage === 'ja' ? 'rtl' : 'ltr',
      coverUrl: cover ? `https://uploads.mangadex.org/covers/${id(manga.id)}/${encodeURIComponent(cover)}.256.jpg` : '' };
  }), offset + 20 < data.total);
}
export async function chapters(source, item, index, host) {
  const offset = (Math.max(1, index) - 1) * 50;
  const data = await json(host, `${base}/manga/${id(item.id)}/feed?limit=50&offset=${offset}&order[volume]=asc&order[chapter]=asc&includes[]=scanlation_group&includeEmptyPages=0&includeFuturePublishAt=0&includeExternalUrl=0`, options);
  if (!Array.isArray(data.data)) throw new Error('MangaDex returned an invalid chapter list.');
  return { items: data.data.filter(c => c.attributes?.pages > 0 && !c.attributes.externalUrl && (!c.attributes.publishAt || Date.parse(c.attributes.publishAt) <= Date.now())).map(c => {
    const a = c.attributes;
    return { id: c.id, title: [a.volume ? `Vol. ${a.volume}` : '', a.chapter ? `Chapter ${a.chapter}` : 'Oneshot', a.title].filter(Boolean).join(' · '),
      number: a.chapter ?? '', language: a.translatedLanguage, pages: a.pages,
      group: (c.relationships ?? []).filter(r => r.type === 'scanlation_group').map(r => r.attributes?.name).filter(Boolean).join(', ') };
  }), hasMore: offset + 50 < data.total };
}
export async function pages(source, item, host) {
  const data = await json(host, `${base}/at-home/server/${id(item.id)}?forcePort443=true`, options);
  if (!data.chapter?.hash || !Array.isArray(data.chapter.data) || !data.chapter.data.length) throw new Error('This chapter has no downloadable pages.');
  const root = url(data.baseUrl).replace(/\/$/, '');
  const hostname = new URL(root).hostname;
  return data.chapter.data.map(name => ({ url: `${root}/data/${encodeURIComponent(data.chapter.hash)}/${encodeURIComponent(name)}`,
    report: hostname !== 'mangadex.org' && !hostname.endsWith('.mangadex.org') }));
}
export function resolve() { throw new Error('Choose a chapter to download as CBZ.'); }
