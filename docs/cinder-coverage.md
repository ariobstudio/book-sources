# Cinder coverage and verification

Protocol reference: [TrexxyMon/Cinder-Extensions](https://github.com/TrexxyMon/Cinder-Extensions).
Audited September 14, 2026. Its manifest contains 32 entries; an additional OPDS
script is present outside the manifest. No upstream JavaScript was bundled or
executed. Adapters are independently implemented against the public protocols.

## Included adapters

| Source | Path | Verification on September 14, 2026 |
| --- | --- | --- |
| LibGen | Existing EPUB/CBZ JSON pipeline | Absolute download hosts and query ordering fixture-tested; live search and ads returned nginx placeholder pages |
| Project Gutenberg | Existing EPUB JSON pipeline | Existing fixture suite retained |
| Bookracy | Direct EPUB/CBZ | Fixtures pass; live API returned HTTP 403 |
| Anna’s Archive | Exposed EPUB links; optional supporter key | Fixtures pass; live search returned HTTP 403 |
| ElScione | Matching h5ai directories, EPUB/CBZ | Fixtures pass; live endpoint returned HTTP 403 |
| OceanofPDF / Readrobe | EPUB form and session-bound download URL | Live search and public-domain Alice download resolution passed; file body not downloaded |
| Sway Translations | Public WordPress pages with EPUB/CBZ links | Live search found an EPUB link; file body not downloaded |
| Z-Library | Anonymous search; account-backed EPUB/CBZ resolution | Live search passed; login/quota/download flows fixture-tested without an account |
| OPDS catalog | Configured Atom/OpenSearch acquisitions | Authentication, namespaces and pagination fixture-tested; requires a user server |
| MangaDex | Chapter images → local CBZ | Live search, chapter feed and original-resolution image lists passed; package/import tested with public-domain comics |
| Atsumaru | English chapter images → local CBZ | Live search, cover URL, 22 chapters and 424 page URLs verified for Astro Boy; no commercial page bodies downloaded; WebP import tested with public-domain Little Nemo |
| WEBTOON | Public episode images → local CBZ | Live search, episode pagination and image lists passed; package/import tested with public-domain comics |

A successful adapter test is not a promise of provider uptime. Browser challenges,
account quotas, unavailable files and locked episodes produce visible errors.
No Cloudflare, paywall, DRM or login bypass is implemented.

## Not included

Asura Scans exposes scrambled image tiles in addition to ordinary images. A
correct tile renderer is needed before enabling it; treating those URLs as normal
pages would corrupt the artwork. MangaK, MangaKakalot, ReadComicOnline,
WeebCentral, ComicKFan, GoComics, ComicHubFree, BatCave, BBato and ReadAllComics
have not yet been ported and verified. They are not advertised in this catalog.

RoyalRoad, ReadNovel, NovelBin, NovelFire, WebNovel, WitchCultTranslation,
LuminareTranslations, Bronstl and Literotica provide chapter text and remain
outside the selected comic/ebook download scope. DownMagaz and FreeMagazines
focus on magazine formats outside Pillcrow's EPUB/CBZ import contract.

## Image and direction guarantees

The host must retain the image array's order; never sort image URLs. MangaDex's
`data` array is used rather than the recompressed `dataSaver` array. WEBTOON's
reader images stay in document order. Original image bytes are stored in CBZ
without recompression or redrawing speech bubbles. The first image remains the
imported cover. No search thumbnail is inserted into the comic.

WEBTOON defaults to LTR. MangaDex has no explicit direction field; Japanese
originals default to RTL and other original languages to LTR, with an explicit
chapter-picker override. The selected direction is persisted in ComicInfo and
honored by the importer. Locked, external-only and future MangaDex chapters are
excluded. Language and scanlation-group editions remain distinct.

MangaDex community image servers require transport-health reports containing
image URL, byte count, cache hit, elapsed time and success. No account identifier,
device identifier or reading history is sent. Failed image fetches refresh the
server assignment once; changed chapter image lists abort rather than mix versions.

Chapter packaging is cancellable and continues when leaving Sources for Library,
but it does not yet survive application termination or resume partial chapters.
This limitation is stated before downloading. Existing native background EPUB/CBZ
file transfers are unchanged.

Nyaa Literature is available as a torrent source. Pillcrow uses a TorBox API key
configured in Settings to prepare a release and select individual EPUB/CBZ files.
The source adapter exposes public magnet/.torrent locators, not fabricated book
downloads; the host owns the cloud connection and keeps its key out of source packs. WeebCentral
returned a Cloudflare block in this environment and was not added.

Language search uses chapter translation availability on MangaDex, with the same
filter sent to chapter feeds. Original-language metadata stays intact.
