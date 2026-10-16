// French editions from the BnF catalogue, as a metadata source.
//
// Registers one metadata provider. Once selected in Settings → Metadata, every
// series and issue lookup the app makes goes to catalogue.bnf.fr instead of
// the built-in service: search, add, refresh, scans, tagging and reading-list
// imports all work unchanged. No account or key is needed.
import { makeBnfClient } from './bnf.js';

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
    makeClient: (_cfg, opts) => makeBnfClient(opts),
    test: () => makeBnfClient({ politeMs: 0 }).test(),
  });
}
