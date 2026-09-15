import type { SourceDefinition, SourceHost, SourceItem, Download } from './types.mjs';
export type * from './types.mjs';
export function interpolate(template: string, vars: Record<string, unknown>): string;
export function runSearch(source: SourceDefinition, query: string, page: number | undefined, host: SourceHost, filters?: import('./types.mjs').SourceSearchFilters): Promise<{ items: SourceItem[]; hasMore: boolean }>;
export function runResolve(source: SourceDefinition, item: SourceItem, host: SourceHost): Promise<Download>;
export function runCover(source: SourceDefinition, item: SourceItem, host: SourceHost): Promise<Download | null>;

export function runChapters(source: SourceDefinition, item: SourceItem, page: number, host: SourceHost): Promise<{items: import('./types.mjs').SourceChapter[]; hasMore: boolean}>;
export function runPages(source: SourceDefinition, item: SourceItem, host: SourceHost): Promise<import('./types.mjs').ChapterImage[]>;

export function runTorrent(source: SourceDefinition, item: SourceItem, host: SourceHost): Promise<Download>;

export function runDetails(source: SourceDefinition, item: SourceItem, host: SourceHost): Promise<import("./types.mjs").SourceDetails | null>;
