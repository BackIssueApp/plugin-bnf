// French editions from the BnF catalogue, as a metadata source.
//
// Registers one metadata provider. Once turned on in Settings → Metadata, series
// and issue lookups go to catalogue.bnf.fr: alone, for everything; alongside
// other sources, searches merge its answers in and the series it found keep
// coming from it. Search, add, refresh, scans, tagging and reading-list imports
// all work unchanged. No account or key is needed.
import { makeBnfClient, MINTED_BASE } from './bnf.js';

export default function register(api) {
  if (typeof api.registerMetadataProvider !== 'function') {
    console.warn('bnf: this version of BackIssue has no metadata provider hook; update the app to use this plugin');
    return;
  }
  api.registerMetadataProvider({
    id: 'bnf',
    label: 'Bibliothèque nationale de France (French editions)',
    note: 'Looks series and albums up in the national catalogue, which lists nearly every book published in France. Best for French-language albums and translations: numbering, ISBNs, publishers, release dates and credits are complete, but there are no character lists or story arcs, summaries are rare, and a cover is only shown for albums the catalogue holds one for. No account is needed; Discover needs the built-in service or ComicVine.',
    fields: [],
    isConfigured: () => true,
    // The ids this plugin mints; with several sources enabled, the app sends
    // lookups for these here and for other ids elsewhere.
    idRange: [MINTED_BASE, MINTED_BASE + 100_000_000],
    makeClient: (_cfg, opts) => makeBnfClient(opts),
    test: () => makeBnfClient({ politeMs: 0 }).test(),
  });
}
