# Host a source repository

Publish source JSON independently so applications can update their catalogs
without bundling source definitions or releasing new application code. This
checkout contains the source data and the package code, but the installable
archive includes only package code and documentation.

You need an HTTP(S) static host that you control. Browser clients also need CORS
headers that allow them to read the manifest and source files. Your host must
serve the files as JSON content, not as an HTML file-viewing page.

## Prepare the catalog

The repository manifest uses `sourceUrl` to point to each source pack. Relative
URLs resolve against the manifest URL. An entry has this shape.

```json
{
  "id": "gutenberg",
  "name": "Project Gutenberg",
  "version": "0.3.0",
  "sourceUrl": "sources/gutenberg.source.json"
}
```

`repo.json` contains these entries in a `sources` array. Each entry requires a
unique `id`, a `name`, a `version`, and a `sourceUrl`. A loaded pack's `id` and
`version` must match its entry. Other metadata, such as `description` and
`contentType`, can help your application display the catalog.

The manifest's top-level `id`, `name`, and `version` describe the repository.
The client uses each source entry's version to check pack consistency; it does
not enforce an application version or interpret semantic version ranges.

## Publish the files

1. Validate your local packs from the checkout root.

   ```bash
   npm run validate
   ```

2. Run the tests, including the manifest consistency check.

   ```bash
   npm test
   ```

3. Upload `repo.json` and the `sources/` directory to your static host, preserving
   their relative paths. Publish only this source data; the host does not need
   the engine or an application bundle.

4. Check the published repository. Replace the URL with your manifest URL.

   ```bash
   node cli.mjs validate --repo https://sources.example.com/repo.json
   ```

A successful check prints the source IDs and versions. This procedure does not
create a hosting account or deploy files automatically. No production host is
configured in this checkout.

## Update a source

Edit the pack, increase its `version`, and set the same version in its manifest
entry. Re-run validation and tests. Publish the pack before publishing the new
manifest. For updates that must avoid a mismatch during rollout, use a new
versioned filename in `sourceUrl` and publish the manifest last.

`createRepository` caches the manifest and loaded packs in memory for that client
instance. Call `repository.refresh()` to fetch a new manifest and clear the pack
cache. There is no automatic polling, disk cache, or offline fallback. Your
application chooses the refresh schedule and persistence policy. Configure HTTP
cache headers on your host to match that schedule.

Only sources expressible by the installed engine's vocabulary can update without
a package release. A new extraction operation requires an engine update and tests
before a pack can use it.
