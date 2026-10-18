# Changelog

Notable, user-facing changes per release. Format follows [Keep a Changelog](https://keepachangelog.com);
versions follow the tags in this repository (`vX.Y.Z` → the release bundle BackIssue's plugin catalog installs).

Contributors: please **don't** edit this file in pull requests — entries are added
by the maintainers when changes merge, so concurrent PRs don't conflict here.

## [Unreleased]

## [0.1.0] — 2026-10-17

### Added

- First release. A metadata source for French-language comics from the
  catalogue of the Bibliothèque nationale de France: series as the catalogue's
  set records, albums as their numbered tomes, with ISBN and EAN, price, page
  count, writer and artist credits, the legal deposit date as the release
  date, and summaries and covers where the catalogue holds them. Searching an
  ISBN finds the album's series directly. Reprints of a tome fold into the
  first printing, and a one-shot album is a series of one. No account is
  needed. Requires BackIssue 0.9.1 or newer.
- Declares the id range it mints, so it can be turned on alongside other
  metadata sources: searches merge its answers in, and the series it found
  keep coming from the catalogue.
- **Records keep their ARK.** The plugin names its catalog and gives each
  series' and album's ARK identifier, which BackIssue 0.9.1 keeps with the
  cached record. Older versions ignore it.
- **Translated provider card.** The source’s name and note under Settings →
  Metadata, and the plugin description on the Plugins page, follow the
  language picked under Profile → Language on BackIssue 0.9.1 and newer;
  English on older ones. French, German, Spanish, Italian, Portuguese
  (Portugal and Brazil), Dutch, Polish, Japanese and Simplified Chinese ship
  in `locales/`.
