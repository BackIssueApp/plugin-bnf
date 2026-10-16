# French editions (BnF)

A metadata source for **French-language comics**: albums, their numbering,
ISBNs, publishers, release dates and credits, looked up in the catalogue of the
Bibliothèque nationale de France. The catalogue lists nearly every book
published in France through legal deposit, so a French series or a translated
run that is missing or thin elsewhere is usually complete here. No account or
key is needed.

## Install

One click from **Sidebar → Plugins** in BackIssue, or drop this folder into the
app's `plugins/` directory and restart.

## Use

Open **Settings → Metadata** and turn on the French editions source. Press
**Test source** to confirm the catalogue answers, then save. Searches now ask
the catalogue as well as every other source you have on, and show the answers
together, best first; move the French editions source up the list to prefer
its editions when two sources know the same series. A series you add from the
catalogue keeps coming from it: refreshing it, matching files on a scan,
writing tags and importing reading lists all go to the catalogue. Turn it off
at any time; series added through it keep their data and refresh again once it
is back on.

- **Series** are the catalogue's set records: one per series, carrying the
  title, publisher and the year it began.
- **Issues** are the albums linked to that set, numbered by tome. Each album
  carries its ISBN and EAN, price, page count, writer and artist credits, the
  legal deposit date as its release date, and a summary when the catalogue has
  one. Reprints of a tome are folded into the first printing.
- A one-shot album with no set is a series of one.
- Searching an **ISBN or EAN** finds the album's series directly.

## What the catalogue does not have

- Character lists, teams and story arcs.
- Summaries for most albums, and covers for older ones.
- Anything for Discover, which keeps needing the built-in service or ComicVine.

## Data and licence

Catalogue data is published by the Bibliothèque nationale de France under the
French government's open licence (Licence Ouverte). Lookups go to
`catalogue.bnf.fr` from your server, carrying only the search text or the
record being fetched. See the privacy policy for what leaves your server.

## Development

```
npm test
```

The tests run against real catalogue responses saved under `tests/fixtures/`.
