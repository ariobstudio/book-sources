import type { FetchRequest, RequestOptions, SourceHost } from './types.mjs';
export function createFetchHost(fetchRequest: FetchRequest, defaults?: RequestOptions & Record<string, unknown>): SourceHost;
