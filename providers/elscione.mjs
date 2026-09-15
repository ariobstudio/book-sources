// Copyright (c) 2026 Ariob Studio. Apache-2.0.
import { download, format, headers, json, page, url } from './common.mjs';
function listing(value, depth = 0) {
  if (!value || depth > 5) return [];
  if (Array.isArray(value)) return value.filter(item => item && typeof item.href === 'string');
  if (typeof value !== 'object') return [];
  for (const child of Object.values(value)) { const found = listing(child, depth + 1); if (found.length) return found; }
  return [];
}
const decoded = value => { try { return decodeURIComponent(value); } catch { return value; } };
export async function search(source, query, index, host) {
  if (index > 1) return page([]);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean); if (!tokens.length) return page([]);
  const queue = ['/Officially%20Translated%20Light%20Novels/', '/LNWNCentral%20Dump/', '/Manga/', '/Books/', '/TMW%20eBook%20Collection/'].map(href => ({ href, depth: 0, matched: false }));
  const seen = new Set(); const items = []; let requests = 0; let successful = 0; let failure;
  while (queue.length && requests++ < 22 && items.length < 100) {
    const folder = queue.shift(); const target = url(folder.href, source.baseUrl);
    if (seen.has(target)) continue; seen.add(target);
    let entries;
    try { entries = listing(await json(host, `${source.baseUrl}/`, { method: 'POST', headers: { ...headers(target), 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get', items: { href: folder.href, what: 1 } }) })); successful++; }
    catch (error) { if (error?.name === 'AbortError') throw error; failure = error; continue; }
    for (const entry of entries) {
      const target = url(entry.href, source.baseUrl); if (new URL(target).origin !== new URL(source.baseUrl).origin) continue;
      const relative = decoded(new URL(target).pathname); const prefix = decoded(folder.href); const rest = relative.startsWith(prefix) ? relative.slice(prefix.length).replace(/\/$/, '') : '';
      if (!rest || rest.includes('/')) continue;
      const matches = folder.matched || tokens.every(token => rest.toLowerCase().includes(token));
      if (!matches) continue;
      const ext = format(rest);
      if (ext) items.push({ id: target, title: rest.replace(/\.(epub|cbz)$/i, ''), author: '', format: ext, downloadUrl: target, size: entry.size ? String(entry.size) + ' bytes' : '' });
      else if ((entry.type === 'folder' || entry.type === 'dir' || entry.href.endsWith('/')) && folder.depth < 3) queue.push({ href: new URL(target).pathname, depth: folder.depth + 1, matched: true });
    }
  }
  if (!successful && failure) throw failure;
  return page([...new Map(items.map(item => [item.id, item])).values()]);
}
export async function resolve(source, item) { return download(item, item.downloadUrl, { headers: headers(source.baseUrl + '/') }); }
