// Copyright (c) 2026 Ariob Studio. Apache-2.0.
import { clean, download, headers, json, page, optionalURL } from './common.mjs';
export async function search(source, query, index, host) {
  // This API has no search cursor. Do not repeat page one indefinitely.
  if (index > 1) return page([]);
  const base = source.baseUrl;
  const data = await json(host, `${base}/api/books?query=${encodeURIComponent(query)}&lang=all&limit=8`, { headers: headers('https://bookracy.com/') });
  return page((data.results ?? []).map(item => ({
    id: `${item.md5 || item.link}:${item.book_filetype}`, title: clean(item.title), author: clean(item.author),
    format: String(item.book_filetype || '').toLowerCase(), downloadUrl: optionalURL(item.link, base),
    coverUrl: optionalURL(item.book_image || (item.md5 ? `${base}/cover/${item.md5}/thumbnail.jpg` : ''), base),
    coverReferer: 'https://bookracy.com/', publisher: clean(item.publisher), year: item.year,
    language: clean(item.book_lang), size: clean(item.book_size), isbn: clean(item.isbn), description: clean(item.description),
  })).filter(item => item.downloadUrl));
}
export async function resolve(source, item) { return download(item, item.downloadUrl, { headers: headers('https://bookracy.com/') }); }
