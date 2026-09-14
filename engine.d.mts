import type { SourceDefinition, SourceHost, SourceItem, Download } from './types.mjs';
export type * from './types.mjs';
export function interpolate(template: string, vars: Record<string, unknown>): string;
export function runSearch(source: SourceDefinition, query: string, page: number | undefined, host: SourceHost): Promise<{ items: SourceItem[]; hasMore: boolean }>;
export function runResolve(source: SourceDefinition, item: SourceItem, host: SourceHost): Promise<Download>;
export function runCover(source: SourceDefinition, item: SourceItem, host: SourceHost): Promise<Download | null>;
