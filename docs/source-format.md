# Add a source

Create a JSON pack to describe a provider's search and download behavior. You
need a provider endpoint and representative JSON or HTML responses. Use
`sources/gutenberg.source.json` as a JSON example and `sources/libgen.source.json`
as an HTML example in this checkout.

A source can use any provider supported by the request and extraction vocabulary
below. There is no provider registration table in the engine or CLI.

## Create and verify a pack

1. Copy a pack from the checkout. Choose a lowercase source ID; the example uses
   `my-catalog`.

   ```bash
   cp sources/gutenberg.source.json sources/my-catalog.source.json
   ```

2. Set `id` to `my-catalog`, replace the metadata and provider URL, and map the
   provider's fields. The following complete template expects a JSON response
   with a `results` array. Replace the example endpoint with your provider's URL.

   ```json
   {
     "id": "my-catalog",
     "name": "My catalog",
     "version": "1.0.0",
     "contentType": "books",
     "capabilities": { "search": true, "resolve": true },
     "search": {
       "steps": [
         {
           "step": "request",
           "url": "https://catalog.example.com/books?search={query|urlencode}&page={page}"
         }
       ],
       "items": {
         "jsonPath": "results",
         "fields": {
           "id": [{ "json": "id" }],
           "title": [{ "json": "title" }],
           "coverUrl": [{ "json": "cover" }, { "default": "" }],
           "downloadUrl": [{ "json": "download" }],
           "format": [{ "json": "format" }, { "default": "epub" }]
         },
         "required": ["id", "title"],
         "limit": 50
       }
     },
     "resolve": {
       "steps": [],
       "output": {
         "url": "{item.downloadUrl}",
         "fileName": "{item.title}.{item.format}"
       }
     }
   }
   ```

3. Validate the pack's structure.

   ```bash
   node cli.mjs validate my-catalog --sources-dir ./sources
   ```

4. Check real results from your provider. Replace `test title` with a title that
   the provider contains.

   ```bash
   node cli.mjs search my-catalog "test title" --json --sources-dir ./sources
   ```

5. Add representative fixture tests for parsing, missing fields, and resolution
   to `test/`. Run the suite before publishing.

   ```bash
   npm test
   ```

Add a matching manifest entry before running the manifest consistency test for a
new pack. Follow [Host a source repository](hosting.md) to publish it. Local CLI
discovery works before publication.

## Source metadata

A pack requires `id`, `name`, `version`, `contentType`, and `capabilities`.
The ID uses lowercase letters, digits, hyphens, or underscores and starts with a
letter or digit. The version is a nonempty string; clients compare exact values.

Both `capabilities.search` and `capabilities.resolve` are booleans. A `true` value
requires the matching pipeline; a `false` value requires it to be absent. At least
one pipeline must exist. A search-only source can provide covers without a
resolve pipeline. The CLI requires search for book or cover selection.

## Pipeline steps

The engine runs `steps` in order and awaits each request. A request step has the
following properties.

| Property | Behavior |
| --- | --- |
| `step` | Must be `request`. |
| `url` | Interpolated URL string. |
| `method` | Optional HTTP method; the supplied hosts default to `GET`. |
| `headers` | Optional literal string values; no template expansion. |
| `retries` | Total attempts, including the first. Defaults to 1 and is capped at 5. Validation requires a positive integer. |
| `retryDelayMs` | Delay between failed attempts; defaults to no delay. |
| `untilRegex` | Optional case-sensitive pattern that must match the response body. |

Status codes from 200 through 399 count as success for engine steps, provided
`untilRegex` matches when set. The host determines redirect handling. An exhausted
HTTP or pattern failure throws an error. A transport exception fails immediately.
The engine does not pass request bodies from JSON packs.

A `set` step transforms a response value and assigns it to a pipeline variable.
The following step extracts a table for later item parsing.

```json
{
  "step": "set",
  "name": "table",
  "from": "response.body",
  "ops": [{ "regex": "<table[^>]*>([\\s\\S]*?)</table>", "group": 1 }]
}
```

`from` is a dotted path under `response`, such as `response.body`,
`response.status`, or `response.headers.content-type`. It defaults to the most
recent response body. `ops` defaults to an empty array. Set variable names must
be identifiers and cannot replace `query`, `page`, `item`, or internal variables.
To derive a value from another variable, use a `template` operation.

## Interpolation

Search templates can access `query`, `page`, and variables created by `set` steps.
Resolve templates can also access `item.*`; resolve starts with `query` set to
an empty string and `page` set to 1. Search variables do not carry into resolve.

Template expressions use dotted paths, for example `{item.title}`. Apply filters
in order with `|`, as in `{query|urlencode}`.

| Filter | Behavior |
| --- | --- |
| `urlencode` | Apply `encodeURIComponent` to the value. |
| `default:value` | Substitute when the value is null, undefined, or an empty string. |
| `trimSlash` | Remove leading slashes; trailing slashes stay unchanged. |

A missing value becomes an empty string. Unknown filters leave the value
unchanged. Interpolation is available in request URLs, `items.over`, template
operations, and top-level resolve output strings. It does not recursively expand
objects such as headers. Encode query parameters explicitly and ensure resolved
URLs are usable absolute URLs for the host.

## Extract items

Choose one item extraction mode in `search.items`.

- `jsonPath`: Parse the last response body as JSON and select an array. Use a
  dotted path such as `results`, or a token array. An empty token array selects
  a root array. Invalid JSON, missing paths, and non-array values yield no results.
- `regex`: Scan `over`, or the last response body if `over` is absent. The default
  flags are `g`; explicit flags must include `g`. `group` selects the captured
  item segment and defaults to 1.

`fields` maps result field names to operations. Each field starts from the same
item segment. Fields run in declaration order, so a template can reference an
earlier field through `{item.fieldName}`. Non-null IDs are converted to strings
before required-field checks.

`required` lists fields that must be truthy for the item to remain in results.
`limit` counts accepted items; omitted or `0` means no limit. HTML matches are
iterated as needed, but the full response body is still held in memory. JSON
extraction parses the full document.

Common field names are `id`, `title`, `author`, `publisher`, `year`, `language`,
`size`, `format`, `downloadUrl`, and `coverUrl`. You can add provider-specific
fields. `__proto__`, `prototype`, and `constructor` are reserved field names.

## Apply value operations

Operations run from left to right. Use one operation per object; an operation
array or a single operation object is accepted. A `null` operation does nothing.

| Operation | Behavior |
| --- | --- |
| `{"json":"authors.0.name"}` | Read a dotted JSON path; missing values become null. Token arrays handle keys containing periods or MIME types. |
| `{"regex":"pattern","flags":"i","group":1}` | Match the current value as a string. Flags default to empty and group to 0; a missing match becomes null. |
| `{"cell":3}` | Select zero-based `<td>` content from a row. Tag matching is case-sensitive. |
| `{"anchors":{"pick":"clean","part":"text"}}` | Extract an anchor from HTML using the rules below. |
| `{"stripTags":true}` | Remove tags, decode `amp`, `quot`, `#39`, `lt`, `gt`, and `nbsp` entities, collapse whitespace, and trim. |
| `{"trim":true}` | Trim whitespace from the string value. |
| `{"lowercase":true}` | Convert the string value to lowercase. |
| `{"default":"fallback"}` | Replace null, undefined, or an empty string. Zero and false are preserved. |
| `{"prepend":"prefix"}` | Add text before the value. |
| `{"append":"suffix"}` | Add text after the value. |
| `{"template":"{item.id}"}` | Replace the current value with an interpolated template. |

Anchor extraction recognizes lowercase `<a>` and `</a>` tags and preserves `>`
characters inside quoted attributes. It reads double-quoted `href` attributes
and ignores anchors with whitespace-only contents. It is not a full HTML parser.

Use `hrefIncludes` to filter by a substring of the URL. `pick` accepts `first`,
`last` (the default), `longest`, or `clean`. `longest` compares stripped text and
keeps the first on ties. `clean` selects the last plausible title, excluding
short text, `#` prefixes, and numeric/ISBN-like text, then falls back to the last
anchor. `part` is `text` (inner HTML, the default) or `href`.

## Add covers

Extract an optional `coverUrl` when the provider includes an image URL. For the
Gutenberg pack, the URL comes from Gutendex's MIME-keyed `formats` object.
The [Gutendex API documentation](https://gutendex.com/) describes that mapping.

```json
{
  "coverUrl": [
    { "json": ["formats", "image/jpeg"] },
    { "default": "" }
  ]
}
```

Do not add `coverUrl` to `required`; a book can remain searchable without a cover.
The Gutenberg pack returns an empty string when JPEG metadata is absent. The
supplied LibGen search pack has no verified cover mapping and does not invent one.
Your application can load the URL when displaying the item; the CLI's `cover`
command can download it explicitly.

## Resolve a book

`resolve.steps` uses the same step vocabulary. `resolve.output` contains a
nonempty `url` template and optional `fileName` and literal `headers`. The engine
expands top-level string values and throws if the resulting URL is empty. It
does not fetch or save the book. Other output fields are passed through.

The supplied Gutenberg pack resolves EPUB URLs only. An item without an EPUB
can still appear in search with `format: "txt"`; resolution then fails because
there is no download URL. This pack does not implement a text-download fallback.

## Format limits

The engine executes no source code. It supports text HTTP responses, JSON paths,
and the HTML extraction rules above. It does not render JavaScript, run CSS
selectors, send source-defined request bodies, or implement authentication flows.

Validation checks syntax and supported operations. It does not prove extraction
correctness, restrict provider destinations, limit response size, or bound regex
execution time. Review patterns against representative responses and let the
embedding host enforce network and resource policies. Extend the documented
vocabulary when a provider cannot be represented by the existing operations.
