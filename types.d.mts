/** Shared types for the portable source engine and adapters. */
export type JSONPath = string | Array<string | number>;
export type Operation =
  | { regex: string; flags?: string; group?: number }
  | { cell: number }
  | { anchors: { hrefIncludes?: string; pick?: 'first' | 'last' | 'longest' | 'clean'; part?: 'text' | 'href' } }
  | { json: JSONPath }
  | { stripTags: boolean }
  | { trim: boolean }
  | { lowercase: boolean }
  | { default: unknown }
  | { prepend: string }
  | { append: string }
  | { template: string }
  | null;
export type Operations = Operation | Operation[];
export type Step =
  | { step: 'request'; url: string; method?: string; headers?: Record<string, string>; retries?: number; retryDelayMs?: number; untilRegex?: string }
  | { step: 'set'; name: string; from?: string; ops?: Operations };
export interface SourceDefinition {
  id: string;
  name: string;
  version: string;
  contentType: string;
  description?: string;
  capabilities: { search: boolean; resolve: boolean };
  search?: {
    steps?: Step[];
    nextPagePath?: JSONPath;
    items: {
      jsonPath?: JSONPath;
      regex?: string;
      flags?: string;
      group?: number;
      over?: string;
      fields: Record<string, Operations>;
      required?: string[];
      limit?: number;
    };
  };
  cover?: { steps?: Step[]; output: { url: string; headers?: Record<string, string> } };
  resolve?: {
    steps?: Step[];
    output: { url: string; fileName?: string; headers?: Record<string, string>; [field: string]: unknown };
  };
}
/** Only id is normalized by the engine; other fields retain extracted values. */
export interface SourceItem {
  id?: string | null;
  [field: string]: unknown;
}
export interface Download {
  url: string;
  fileName?: string;
  headers?: Record<string, string>;
  [field: string]: unknown;
}
export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface TextResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export interface SourceHost {
  request(url: string, options?: RequestOptions): Promise<TextResponse>;
}
export interface FetchResponse {
  status: number;
  headers: Record<string, string> | { forEach(callback: (value: string, name: string) => void): void };
  text(): Promise<string>;
}
export type FetchRequest = (url: string, options?: RequestOptions) => Promise<FetchResponse>;
export interface RepositoryEntry {
  id: string;
  name: string;
  version: string;
  sourceUrl: string;
  [field: string]: unknown;
}
export interface Repository {
  list(): Promise<RepositoryEntry[]>;
  load(id: string): Promise<SourceDefinition>;
  refresh(): Promise<RepositoryEntry[]>;
}
