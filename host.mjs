/** Node network defaults for the CLI. Applications can use their own host. */
import { createFetchHost } from './fetch-host.mjs';

/**
 * Create a text host with Node fetch and request headers used by the sources.
 * Pass a fetch function to use a custom transport. There is no explicit timeout
 * or byte limit; applications that need these must enforce them in the transport.
 */
export function createNodeHost(fetchRequest = globalThis.fetch) {
  return createFetchHost(fetchRequest, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.8',
    },
  });
}
