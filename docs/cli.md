# Use the CLI

Use the CLI to inspect a hosted source repository, search a provider, and save a
book or cover. Install the package as described in the [README](../README.md).
For checkout development, replace `npx --no-install book-sources` with
`node cli.mjs`.

## Select a source repository

Use `--repo <url>` or set `BOOK_SOURCES_REPOSITORY` to an HTTP(S) manifest URL.
The option takes precedence over the environment variable. For local authoring,
use `--sources-dir <directory>`; it takes precedence over the environment variable.
Passing both `--repo` and `--sources-dir` is an error.

The CLI discovers local files named `<id>.source.json` in filename order. Each
file's `id` must match its filename. The directory is relative to your current
working directory. Discovery ignores subdirectories and other file extensions.

## Run commands

Command arguments have the following meanings. Quote queries that contain spaces.
Replace angle-bracket placeholders with your values.

| Command | Result |
| --- | --- |
| `list [--json]` | Print manifest entries for a hosted repository, or validated definitions for a local directory. |
| `validate [source]` | Load and validate one pack, or all packs. Remote validation also checks ID and version against the manifest. |
| `search <source> <query> [page] [--json]` | Search one page; page defaults to 1 and must be a positive integer. |
| `download <source> <query> <result#\|id> [-o path]` | Search page 1, resolve the selected item, and save its response bytes. |
| `cover <source> <query> <result#\|id> [-o path]` | Search page 1 and save the selected item's `coverUrl` as an image. |
| `help` | Show command usage. `-h` and `--help` also work. |

`--output` is an alias for `-o`. `--json` is available on `list` and `search`.
Use `--` to end option parsing when positional arguments start with a hyphen.

Both download commands prefer an exact string ID over a result number. If an
item has ID `1`, selecting `1` chooses that item even if it is not the first row.
To select a known item without ambiguity, use its ID from the search output.

## Choose a destination

The parent directory must exist. Saving to an existing filename overwrites it.
The CLI buffers each download in memory before writing it.

For books, an explicit destination with an extension is used as supplied. If it
has no extension, the CLI appends the server filename's extension, the item's
`format`, or `bin`, in that order. Without `-o`, the CLI uses the server's
`Content-Disposition` filename, or `<source>-<id>` when no filename is provided.
It replaces slashes in server filenames with underscores. The CLI does not use
`resolve.output.fileName`; that field is available to embedding applications.

For covers, the response must have an `image/*` content type. Without `-o`, the
filename is `<source>-<id>-cover.<extension>`. JPEG, PNG, WebP, GIF, AVIF, and SVG
have recognized extensions; other image types use `img`. An explicit destination
with an extension is kept as supplied; this does not convert the image format.
A destination without an extension gets the detected image extension.

## Handle errors

Successful commands exit with code `0`. Errors go to standard error and exit
with code `1`. Calling the CLI without a command prints usage and exits with `1`.
`search --json` writes only the result array to standard output.

| Symptom | Action |
| --- | --- |
| `Specify --repo ...` | Configure a hosted manifest URL or pass a local directory. |
| `Cannot load ...` | Check the local filename, JSON syntax, and property path in the error. |
| `source id and version must match` | Publish the matching pack and manifest versions. |
| `expected pattern not found` | Inspect the provider response; it might be a challenge page or changed HTML. |
| `HTTP ...` or a fetch error | Check connectivity, repository URLs, and provider availability. |
| `Result ... not found` | Search again and select an ID or position from page 1. |
| `resolve produced no url` | The item has no usable download URL. The Gutenberg pack requires an EPUB URL. |
| `has no cover URL` | This provider or item has no extracted cover; choose another item or supply cover extraction in the pack. |
| `Cover response is not an image` | Check whether the URL returns an error page or requires authentication. |

The engine retries HTTP or expected-pattern failures up to the configured
attempt count. Transport exceptions are reported immediately. Hosts currently
have no explicit timeout or response-size limit. Apply these in a custom host
when embedding the engine.
