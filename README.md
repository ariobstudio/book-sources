# Book sources

Search book catalogs, resolve download URLs, and retrieve available covers through
an installable JavaScript package and CLI. Source definitions are JSON files
hosted independently from your application. The package contains the interpreter
and adapters; it does not bundle a source catalog.

Use the package in a JavaScript runtime with an injected network host, including
Node, browsers, and Lynx. Applications written in other languages can call the CLI
or expose the engine through a JavaScript service.

## Install the package

You need Node.js 22 or later and npm to run the CLI or work on this repository.
HTML and OPDS adapters use the DOM-free htmlparser2, css-select, and domutils packages. The package has not been published to npm;
build an installable archive from this checkout.

1. Create the archive from the repository root.

   ```bash
   npm pack
   ```

2. Install the archive in your application's directory. Replace
   `/path/to/book-sources` with the absolute path to this checkout.

   ```bash
   npm install /path/to/book-sources/book-sources-0.4.0.tgz
   ```

3. Verify that the installed CLI runs.

   ```bash
   npx --no-install book-sources --help
   ```

The help output lists `list`, `validate`, `search`, `download`, and `cover`.
The archive excludes `repo.json`, `sources/`, and tests. See
[npm's package file reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#files)
for how the package allowlist works.

## Connect to a source repository

A source repository is a hosted `repo.json` manifest plus the JSON packs it
references. You need the URL of a published manifest. Replace the example URL
with your repository URL.

1. Configure the repository for your shell session.

   ```bash
   export BOOK_SOURCES_REPOSITORY='https://raw.githubusercontent.com/ariobstudio/book-sources/main/repo.json'
   ```

2. List the available sources.

   ```bash
   npx --no-install book-sources list
   ```

3. Validate the referenced source packs.

   ```bash
   npx --no-install book-sources validate
   ```

A successful validation prints each source ID and version. It checks source
structure and manifest consistency; it does not contact book providers. You can
also pass `--repo <url>` to one command. See [Host a source repository](docs/hosting.md)
to publish the catalog in this checkout. No hosting is configured automatically.

## Search and download

For a repository containing the supplied Gutenberg pack, search for a book.

```bash
npx --no-install book-sources search gutenberg "sherlock holmes"
```

The output includes result numbers, IDs, and cover URLs when available. Add
`--json` to receive a JSON array, or add a page number after the query.

Download the first result and its cover with these commands.

```bash
npx --no-install book-sources download gutenberg "sherlock holmes" 1 -o book.epub
npx --no-install book-sources cover gutenberg "sherlock holmes" 1 -o cover.jpg
```

Selection matches an exact ID first, then a one-based result number, on page 1.
Covers are optional: `cover` fails with a message when the selected item has no
cover URL. Search fetches metadata; the `cover` command fetches image bytes.
See the [CLI reference](docs/cli.md) for filename rules and error handling.

## Work on source packs

From this checkout, use an explicit local source directory. Local authoring does
not require a hosted manifest.

```bash
node cli.mjs list --sources-dir ./sources
node cli.mjs search gutenberg "sherlock holmes" --sources-dir ./sources
npm run validate
npm test
```

Tests use local HTTP fixtures and require no internet access. They cover parsing,
retry behavior, repository loading, CLI downloads, and cover handling. They do
not prove that an external provider or device is currently compatible.

## Integrate and extend

- [Integrate the package](docs/integration.md): runtime boundaries, hosted source
  loading, the network host, and Lynx integration.
- [Add a source](docs/source-format.md): JSON and HTML extraction, pipeline
  operations, optional covers, and format limits.
- [Host a source repository](docs/hosting.md): publish and update source data
  separately from application releases.
- [Use the CLI](docs/cli.md): commands, options, and troubleshooting.

Source files support the documented request and extraction operations. Providers
that require other protocols, request bodies, or JavaScript execution need an
engine extension or an application service. JSON packs cannot execute code, but
URLs and regular expressions still need review; the host controls network policy
and resource limits.

## Pillcrow

In **Settings → Book sources**, connect:

```text
https://raw.githubusercontent.com/ariobstudio/book-sources/main/repo.json
```

Then choose **Add Book → Add from source**. Search at the bottom; the header
filters select providers and formats. Each provider has its own continuation
cursor, so scrolling appends results and a failed provider does not hide others.

## Verification

Run `npm test` and `npm run validate`. The regression suite includes a captured
LibGen search table (metadata only), reordered attributes, single-quoted links,
ISBN/title disambiguation, empty versus unavailable results, and absolute or
HTML-escaped download links. Sources are declarative data, never executable code.

Live checks on 2026-09-14 parsed two distinct LibGen pages of 25 records and a
Gutenberg/Gutendex response of 32 records. LibGen needs the User-Agent and Referer
headers included in its source pack. Without Referer, image and download landing
requests can return empty HTTP 200 responses. With it, an edition cover returned
55,158 JPEG bytes and a Lewis Carroll EPUB download returned a valid 1,024-byte
ZIP range (64,490,986 bytes total). This verifies resolution and initial bytes,
not a complete LibGen import. Gutenberg's Alice EPUB was downloaded completely.

LibGen's optional `cover` pipeline reads the actual image URL from the selected
edition page, including file covers when an edition cover is absent. Consumers
call `runCover(source, item, host)` independently of search and pass returned
headers with the image request (the CLI does this). Apps whose image element
cannot set headers can fetch bounded image bytes in the background and pass a
local/data URI. Missing covers retain title/author placeholders.
Search also returns page count, publisher, year, language, and file size when
available. Provider availability can change independently of these tests.

## Nyaa content formats

`runDetails(source, item, host)` returns public filename metadata when an adapter
supports it, otherwise `null`. For Nyaa it reads `/view/{id}` and returns
`formats`, `formatEvidence: "file-list"`, and `fileCount`. It does not create a
cloud transfer or download the torrent payload. Search results may initially
contain `formats` with `formatEvidence: "title"`; these are hints, not confirmed
filenames. Merge the details result over those hints when available.

Keep `item.format: "torrent"` for delivery routing. EPUB/CBZ filtering should use
`formats` for torrents. Missing file lists raise an error; an empty formats array
with file-list evidence means filenames were present but no recognized types
were found. ZIP/RAR collections and loose images are never labeled CBZ. Apps
should bound and cache details lookups, cancel abandoned searches, and retain
unknown-format results in the unfiltered view.

## Cinder source coverage

Version 0.4.0 adds reviewed adapters for six ebook providers, OPDS, MangaDex,
and WEBTOON. The catalog has 11 sources including the existing LibGen and
Project Gutenberg packs. This is a selective protocol port, not a Cinder script
runtime. Remote JSON cannot execute JavaScript. See the
[coverage and verification record](docs/cinder-coverage.md) before enabling a provider.

Chapter sources return `delivery: "chapters"` search items. Call
`runChapters(source, item, page, host)` to select a chapter, then
`runPages(source, chapter, host)` for its ordered image URLs and request headers.
They do not return a ready-made CBZ from `runResolve`. Hosts download original
images and package them locally; Pillcrow supports JPEG/PNG chapters up to 500
images and its 128 MiB import limit. Chapter assembly currently requires the app
to remain open; regular file downloads retain native background transfers.

Optional `host.settings(source)` returns the source's configuration values.
Pillcrow exposes these fields under Settings → Book sources → Configure and
stores them in the device Keychain. Never embed account credentials in JSON packs.
