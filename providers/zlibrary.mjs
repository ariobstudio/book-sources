// Copyright (c) 2026 Ariob Studio. Apache-2.0.
import { clean, download, form, headers, json, page, settings, url, optionalURL } from './common.mjs';
const postHeaders = base => ({ ...headers(base), 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' });
export async function search(source, query, index, host) {
  const config = await settings(source, host); const base = url(config.baseUrl || source.baseUrl).replace(/\/$/, '');
  const data = await json(host, `${base}/eapi/book/search`, { method: 'POST', headers: postHeaders(base), body: form({ message: query, page: index, limit: 30 }) });
  if (data.error) throw new Error('Z-Library rejected the search. Check the source address in Settings.');
  const books = data.books?.length ? data.books : data.exactMatch?.books ?? [];
  return page(books.filter(book => book.id && book.hash).map(book => ({ id: `${book.id}:${book.hash}`, remoteId: String(book.id), hash: book.hash,
    title: clean(book.title), author: clean(book.author), format: String(book.extension ?? '').toLowerCase(), coverUrl: optionalURL(book.cover, base),
    publisher: clean(book.publisher), year: book.year, language: clean(book.language), size: clean(book.filesizeString), pages: book.pages,
    // Retain the search origin: changing settings must not send credentials for
    // one server to a result obtained from another server.
    origin: base,
  })), books.length === 30);
}
export async function resolve(source, item, host) {
  const config = await settings(source, host); const base = url(config.baseUrl || source.baseUrl).replace(/\/$/, '');
  if (item.origin !== base) throw new Error('The source address changed. Search for this book again.');
  if (!config.email || !config.password) throw new Error('Add your Z-Library email and password in Settings → Book sources.');
  const login = await json(host, `${base}/eapi/user/login`, { method: 'POST', headers: postHeaders(base), body: form({ email: config.email, password: config.password }) });
  const user = login.user || login.response || {};
  if (Number(login.success) !== 1 || !user.id || !user.remix_userkey) throw new Error('Z-Library sign-in failed. Check your source credentials.');
  const auth = { ...headers(base), Cookie: `remix_userid=${encodeURIComponent(user.id)}; remix_userkey=${encodeURIComponent(user.remix_userkey)}` };
  const data = await json(host, `${base}/eapi/book/${encodeURIComponent(item.remoteId)}/${encodeURIComponent(item.hash)}/file`, { headers: auth });
  if (!data.file?.downloadLink) throw new Error(data.file?.allowDownload === false ? 'Your Z-Library download limit has been reached.' : 'Z-Library did not provide a download link.');
  if (String(data.file.extension || item.format).toLowerCase() !== item.format) throw new Error('The source returned a different file format.');
  const target = url(data.file.downloadLink, base);
  // Z-Library download links may use another domain; never disclose login
  // cookies to an origin supplied by a download response.
  if (new URL(target).origin !== new URL(base).origin) throw new Error('Z-Library returned a download on another host. Use that source directly.');
  return download(item, target, { headers: auth });
}
