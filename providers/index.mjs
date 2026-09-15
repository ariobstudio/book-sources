// Copyright (c) 2026 Ariob Studio. Apache-2.0.
// Reviewed adapters for protocols beyond the declarative JSON pipeline. Remote
// repositories choose a known adapter; they cannot supply executable code.
import * as atsumaru from './atsumaru.mjs';
import * as bookracy from './bookracy.mjs';
import * as zlibrary from './zlibrary.mjs';
import * as opds from './opds.mjs';
import * as oceanofpdf from './oceanofpdf.mjs';
import * as annas from './annas-archive.mjs';
import * as elscione from './elscione.mjs';
import * as sway from './swaytranslations.mjs';
import * as mangadex from './mangadex.mjs';
import * as webtoons from './webtoons.mjs';
const providers = { atsumaru, mangadex, webtoons, bookracy, zlibrary, opds, oceanofpdf, 'annas-archive': annas, elscione, swaytranslations: sway };
export const providerIDs = Object.keys(providers);
export function provider(source) {
  if (!Object.prototype.hasOwnProperty.call(providers, source.provider)) throw new Error(`Unknown source adapter: ${source.provider}`);
  return providers[source.provider];
}
