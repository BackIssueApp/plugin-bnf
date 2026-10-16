// The BnF catalogue (catalogue.bnf.fr) as a comic metadata provider.
//
// The Bibliothèque nationale de France catalogues nearly every book published
// in France through legal deposit, which makes it the fullest source for
// French-language albums and translations. It speaks SRU (a query URL that
// answers with UNIMARC records in XML); it is free, needs no account, and its
// data is released under the French government's open licence.
//
// How the catalogue maps onto a comic library:
//   - a SERIES is a "set" record (ensemble): one record per series, with the
//     title, publisher and the year it began, and no ISBN of its own;
//   - an ISSUE is an album record linked to its set (UNIMARC field 461, which
//     also carries the tome number); the catalogue lists a set's albums
//     directly through the `bib.ens2bib` index;
//   - a one-shot album with no set is both at once: a series with one issue.
//
// Identity: every record has an ARK (ark:/12148/cb<8 digits><check>). The
// digits are the record number; the check character is the NOID checksum,
// recomputed here so a bare number is enough to fetch a record again. Ids are
// minted into their own range above every other provider's so they can never
// be mistaken for a ComicVine or Metron id.
import { readFileSync } from 'node:fs';

// Above the Metron range (1 000 000 000 + its ids), below Int32 (the mobile
// apps read ids as 32-bit integers). A record number has 8 digits.
export const MINTED_BASE = 1_100_000_000;
export const mintId = (n) => MINTED_BASE + Number(n);
export const unmintId = (id) => Number(id) - MINTED_BASE;
export const isBnfId = (id) => Number.isInteger(Number(id)) && Number(id) > MINTED_BASE && Number(id) < MINTED_BASE + 100_000_000;

export const BASE = 'https://catalogue.bnf.fr/api/SRU';
const NAAN = 'ark:/12148/';
const POLITE_MS = 400;
const TIMEOUT_MS = 20000;
const PAGE = 100;

const UA = (() => {
  let version = '0.0.0';
  try { version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version || version; } catch { /* keep the fallback */ }
  return `BackIssue-bnf/${version} (${process.platform})`;
})();

// ---- ARK identifiers --------------------------------------------------------

// The NOID check character: each character's ordinal in this alphabet, times
// its 1-based position, summed, modulo the alphabet length.
const NOID = '0123456789bcdfghjkmnpqrstvwxz';
export function noidCheck(s) {
  let total = 0;
  for (let i = 0; i < s.length; i++) total += Math.max(0, NOID.indexOf(s[i])) * (i + 1);
  return NOID[total % NOID.length];
}
/** The ARK name (cb12345678x) for a record number. */
export function arkFor(n) {
  const body = 'cb' + String(Number(n)).padStart(8, '0');
  return body + noidCheck(body);
}
/** The record number inside an ARK, identifier or field link, or null. */
export function recordNumber(s) {
  const m = /cb(\d{8})/.exec(String(s || ''));
  if (m) return Number(m[1]);
  const d = /^\s*(\d{8})\s*$/.exec(String(s || ''));
  return d ? Number(d[1]) : null;
}
export const arkUrl = (n) => `https://catalogue.bnf.fr/${NAAN}${arkFor(n)}`;
export const coverUrl = (n) => `https://catalogue.bnf.fr/couverture?&appName=NE&idArk=${NAAN}${arkFor(n)}&couverture=1`;

// ---- UNIMARC XML ------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') { const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(code) ? String.fromCodePoint(code) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Parse an SRU searchRetrieve response into { count, next, records, error }. */
export function parseResponse(xml) {
  const text = String(xml || '');
  const diag = /<(?:\w+:)?message>([^<]*)<\/(?:\w+:)?message>/.exec(text);
  const count = Number((/<(?:\w+:)?numberOfRecords>(\d+)</.exec(text) || [])[1] || 0);
  const next = Number((/<(?:\w+:)?nextRecordPosition>(\d+)</.exec(text) || [])[1] || 0) || null;
  const records = [];
  // The SRU envelope (<srw:record>, no attributes) wraps the UNIMARC record
  // (<mxc:record xmlns=...>), and the identifier follows the data, so the
  // envelope must close on the prefix it opened with.
  const re = /<(\w*:?)record>([\s\S]*?)<\/\1record>/g;
  let m;
  while ((m = re.exec(text))) {
    const r = parseRecord(m[2]);
    if (r) records.push(r);
  }
  return { count, next, records, error: diag ? decodeXml(diag[1]).trim() : null };
}

function parseRecord(body) {
  const ident = /<(?:\w+:)?recordIdentifier>([^<]*)</.exec(body);
  const n = recordNumber(ident ? ident[1] : '');
  if (!n) return null;
  const fields = [];
  const fre = /<(?:\w+:)?datafield\s+tag="(\d{3})"(?:\s+ind1="([^"]*)")?(?:\s+ind2="([^"]*)")?[^>]*>([\s\S]*?)<\/(?:\w+:)?datafield>/g;
  let m;
  while ((m = fre.exec(body))) {
    const subs = [];
    const sre = /<(?:\w+:)?subfield\s+code="(\w)">([\s\S]*?)<\/(?:\w+:)?subfield>/g;
    let s;
    while ((s = sre.exec(m[4]))) subs.push([s[1], decodeXml(s[2]).trim()]);
    fields.push({ tag: m[1], ind1: m[2] ?? ' ', ind2: m[3] ?? ' ', subs });
  }
  return { n, ark: arkFor(n), fields };
}

const all = (rec, tag) => rec.fields.filter((f) => f.tag === tag);
const sub = (field, code) => field?.subs.find((s) => s[0] === code)?.[1] ?? null;
const subs = (field, code) => (field ? field.subs.filter((s) => s[0] === code).map((s) => s[1]) : []);
const first = (rec, tag, code) => { for (const f of all(rec, tag)) { const v = sub(f, code); if (v) return v; } return null; };

// ---- Field readers ----------------------------------------------------------

const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\s*[:;,/]\s*$/, '').trim();
const unbracket = (s) => tidy(s).replace(/^\[(.*)\]$/, '$1');

/** The record's own title (200 $a), with a part title (200 $i) when the main
 *  title is just the series name carrying a volume number. */
export function titleOf(rec) {
  const f = all(rec, '200')[0];
  if (!f) return null;
  const a = tidy(sub(f, 'a'));
  const i = tidy(sub(f, 'i'));
  return a || i || null;
}
export function partTitleOf(rec) {
  const f = all(rec, '200')[0];
  return f ? tidy(sub(f, 'i')) || null : null;
}
/** What an album is called inside its series: the part title (200 $i) when
 *  the main title is the series name, else its own title unless that is the
 *  series name too. */
export function albumName(rec, seriesTitle = null) {
  const part = partTitleOf(rec);
  if (part) return part;
  const own = titleOf(rec);
  const series = seriesTitle ?? setLink(rec)?.title ?? null;
  if (!own) return null;
  if (series && own.toLowerCase() === series.toLowerCase()) return null;
  return own;
}

export function publisherOf(rec) {
  return unbracket(first(rec, '214', 'c') || first(rec, '210', 'c') || '') || null;
}

/** 100 $a: positions 0-7 are the date the record was created (within weeks of
 *  legal deposit, so the closest thing to a release date), position 8 the date
 *  type ('g' = an open range, a set still running), 9-12 the publication year. */
function coded(rec) {
  const a = first(rec, '100', 'a') || '';
  const created = /^(\d{4})(\d{2})(\d{2})/.exec(a);
  const year = /^\d{8}.(\d{4})/.exec(a);
  return {
    created: created && Number(created[2]) >= 1 && Number(created[2]) <= 12 && Number(created[3]) >= 1 && Number(created[3]) <= 31 ? `${created[1]}-${created[2]}-${created[3]}` : null,
    year: year && year[1] !== '    ' ? Number(year[1]) || null : null,
    open: a[8] === 'g',
  };
}
export function yearOf(rec) {
  const c = coded(rec);
  if (c.year) return c.year;
  const d = first(rec, '214', 'd') || first(rec, '210', 'd') || '';
  const m = /(\d{4})/.exec(d);
  return m ? Number(m[1]) : null;
}
export function isOpenEnded(rec) {
  if (coded(rec).open) return true;
  const d = first(rec, '214', 'd') || first(rec, '210', 'd') || '';
  return /\d{4}\s*-\s*$/.test(d);
}
export function isbnOf(rec) { return first(rec, '010', 'a'); }
export function eanOf(rec) { return first(rec, '073', 'a'); }
/** "15,50 EUR" → "15.50 €"; a pre-euro "79 F" keeps its currency so it is never
 *  read as euros or dollars. */
export function priceOf(rec) {
  const d = first(rec, '010', 'd');
  const m = d && /(\d+(?:[.,]\d+)?)\s*([A-Za-z€$£]+)?/.exec(d);
  if (!m) return null;
  const amount = m[1].replace(',', '.');
  const cur = (m[2] || '').toUpperCase();
  if (!cur || cur === 'EUR' || cur === '€') return `${amount} €`;
  if (cur === 'F' || cur === 'FRF' || cur === 'FF') return `${amount} F`;
  return `${amount} ${m[2]}`;
}
export function pageCountOf(rec) {
  const a = first(rec, '215', 'a');
  const m = a && /(\d+)\s*p\b/.exec(a);
  return m ? Number(m[1]) : null;
}
export function summaryOf(rec) {
  const parts = all(rec, '330').map((f) => tidy(sub(f, 'a'))).filter(Boolean);
  return parts.length ? parts.join('\n\n') : null;
}
/** The French national bibliography files comics under class 805. */
export function isComic(rec) { return all(rec, '686').some((f) => sub(f, 'a') === '805'); }

/** The set this album belongs to (461): { n, title, number }. */
export function setLink(rec) {
  const f = all(rec, '461')[0];
  if (!f) return null;
  const n = recordNumber(sub(f, '0'));
  if (!n) return null;
  return { n, title: tidy(sub(f, 't')) || null, number: numberIn(sub(f, 'v')) };
}
const numberIn = (s) => { const m = /(\d+(?:[.,]\d+)?)/.exec(String(s || '')); return m ? m[1].replace(',', '.') : null; };
/** The album's number in its series: the set link, the collection statement
 *  (225 $v "tome 4") or the title's part number (200 $h "Volume 1"). */
export function tomeNumber(rec) {
  const link = setLink(rec);
  if (link?.number) return link.number;
  for (const f of all(rec, '225')) { const v = numberIn(sub(f, 'v')); if (v) return v; }
  const h = numberIn(sub(all(rec, '200')[0], 'h'));
  return h || null;
}
/** A set record: no ISBN of its own, and either an open date range or a date
 *  the catalogue coded as a range. */
export function looksLikeSet(rec) { return !isbnOf(rec) && isOpenEnded(rec); }

// UNIMARC relator codes seen on French albums.
const ROLES = {
  '070': 'Writer', '690': 'Writer', '440': 'Artist', '100': 'Creator', '730': 'Translator',
  '080': 'Preface', '075': 'Afterword', '340': 'Editor', '651': 'Editorial director',
  '205': 'Contributor', '600': 'Photographer', '010': 'Adapter', '090': 'Dialogue', '020': 'Annotator',
};
export function creditsOf(rec) {
  const out = [];
  const seen = new Set();
  for (const tag of ['700', '701', '702', '710', '711', '712']) {
    for (const f of all(rec, tag)) {
      const name = tidy([sub(f, 'b'), sub(f, 'a')].filter(Boolean).join(' '));
      if (!name) continue;
      const role = subs(f, '4').map((c) => ROLES[c] || '').filter(Boolean);
      const key = name.toLowerCase();
      if (seen.has(key)) { const prior = out.find((c) => c.name.toLowerCase() === key); if (prior && role.length && !prior.role) prior.role = role.join(', '); continue; }
      seen.add(key);
      out.push({ name, role: role.join(', ') });
    }
  }
  return out;
}

// ---- Shapes the app expects -------------------------------------------------
// The same series and issue shapes the ComicVine client produces, plus the
// enrichment sidecar under the key the app stores extras from.

const byNumber = (a, b) => {
  const na = Number(tomeNumber(a)), nb = Number(tomeNumber(b));
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  if (Number.isFinite(na) !== Number.isFinite(nb)) return Number.isFinite(na) ? -1 : 1;
  return (yearOf(a) || 0) - (yearOf(b) || 0) || String(titleOf(a) || '').localeCompare(String(titleOf(b) || ''));
};
export function sortAlbums(records) { return [...records].sort(byNumber); }
/** One album per tome number, the earliest printing of each; albums with no
 *  number are all kept. Input must already be sorted. */
export function dedupeAlbums(sorted) {
  const seen = new Set();
  return sorted.filter((a) => {
    const n = tomeNumber(a);
    if (n == null) return true;
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

function seriesSidecar(rec, albums, single) {
  const publisher = publisherOf(rec) || albums.map(publisherOf).find(Boolean) || null;
  return {
    id: rec.n, cv_id: null, rating: null,
    series_type: single ? 'One-shot' : 'Series',
    status: single ? null : (isOpenEnded(rec) ? 'Ongoing' : null),
    year_end: null, imprint: null,
    genres: (isComic(rec) || albums.some(isComic)) ? ['Bandes dessinées'] : null,
    sort_name: null, gcd_id: null,
    description: summaryOf(rec),
    issue_count: albums.length,
    publisher: publisher ? { name: publisher } : null,
    year_began: yearOf(rec) || albums.map(yearOf).filter(Boolean).sort()[0] || null,
    volume: null, associated: null,
    resource_url: arkUrl(rec.n),
  };
}

/** The series for a set record and its albums (already sorted). */
export function shapeSeries(rec, albums, { single = false } = {}) {
  const side = seriesSidecar(rec, albums, single);
  const title = titleOf(rec);
  const stubs = albums.map((a, i) => ({ id: mintId(a.n), number: tomeNumber(a) ?? String(i + 1), name: single ? null : albumName(a, title) }));
  return {
    id: mintId(rec.n),
    name: titleOf(rec),
    publisher: side.publisher?.name ?? null,
    start_year: side.year_began != null ? String(side.year_began) : null,
    count_of_issues: albums.length,
    deck: null,
    description: side.description,
    image_url: albums.length ? coverUrl(albums[0].n) : null,
    site_detail_url: arkUrl(rec.n),
    aliases: null,
    metron: side,
    issues: stubs,
  };
}

function issueDates(rec) {
  const c = coded(rec);
  const year = yearOf(rec);
  // The creation date is the deposit date when it falls in the publication
  // year; a record created later (a retrospective entry) says nothing about release.
  const created = c.created && year && Number(c.created.slice(0, 4)) === year ? c.created : null;
  return { cover_date: created || (year ? `${year}-01-01` : null), store_date: created };
}

function issueSidecar(rec) {
  const publisher = publisherOf(rec);
  const credits = creditsOf(rec);
  return {
    id: rec.n, cv_id: null, rating: null,
    price: priceOf(rec), isbn: isbnOf(rec), upc: eanOf(rec), sku: null, foc_date: null,
    story_titles: null, reprints: null, variants: null, cover_hash: null,
    characters: null, teams: null, arcs: null, universes: null,
    credits: credits.length ? credits.map((c) => ({ id: null, creator: c.name, role: c.role ? c.role.split(', ').map((name) => ({ id: null, name })) : [] })) : null,
    description: summaryOf(rec),
    title: tidy(first(rec, '225', 'a')) || null,
    alt_number: null,
    page_count: pageCountOf(rec),
    imprint: null,
    publisher: publisher ? { name: publisher } : null,
    resource_url: arkUrl(rec.n),
    image: coverUrl(rec.n),
    gcd_id: null, modified: null,
  };
}

/** An album as the app's issue shape. `series` is the owning set when known. */
export function shapeIssue(rec, series = null) {
  const link = setLink(rec);
  const volume = series ? { id: mintId(series.n), name: titleOf(series) }
    : link ? { id: mintId(link.n), name: link.title }
      : { id: mintId(rec.n), name: titleOf(rec) };
  const dates = issueDates(rec);
  return {
    id: mintId(rec.n),
    number: tomeNumber(rec) ?? '1',
    name: albumName(rec, volume.name),
    volume,
    cover_date: dates.cover_date,
    store_date: dates.store_date,
    description: summaryOf(rec),
    site_detail_url: arkUrl(rec.n),
    image_url: coverUrl(rec.n),
    credits: creditsOf(rec),
    character_credits: null, team_credits: null, location_credits: null, story_arc_credits: null,
    associated_images: null,
    metron: issueSidecar(rec),
  };
}
export function shapeIssueRow(rec, series = null) {
  const i = shapeIssue(rec, series);
  return { id: i.id, name: i.name, number: i.number, volume: i.volume, cover_date: i.cover_date, store_date: i.store_date, image_url: i.image_url, site_detail_url: i.site_detail_url };
}

/** Group search hits into series candidates: albums fold into their set (seen
 *  or not), set records stand alone, and an album with no set is a one-shot. */
export function candidatesFrom(records) {
  const sets = new Map();
  const get = (n, title) => { if (!sets.has(n)) sets.set(n, { n, title, rec: null, albums: [], single: false }); return sets.get(n); };
  const loose = [];
  for (const rec of records) {
    if (!titleOf(rec)) continue;
    const link = setLink(rec);
    if (link) get(link.n, link.title).albums.push(rec);
    else loose.push(rec);
  }
  for (const rec of loose) {
    if (sets.has(rec.n)) { sets.get(rec.n).rec = rec; continue; }
    const s = get(rec.n, titleOf(rec));
    s.rec = rec;
    if (!looksLikeSet(rec)) { s.albums.push(rec); s.single = true; }
  }
  const out = [];
  for (const s of sets.values()) {
    const albums = dedupeAlbums(sortAlbums(s.albums));
    const anchor = s.rec || albums[0];
    const comic = (s.rec && isComic(s.rec)) || albums.some(isComic);
    const publisher = (s.rec && publisherOf(s.rec)) || albums.map(publisherOf).find(Boolean) || null;
    const year = (s.rec && yearOf(s.rec)) || albums.map(yearOf).filter(Boolean).sort()[0] || null;
    out.push({
      id: mintId(s.n),
      name: (s.rec && titleOf(s.rec)) || s.title || titleOf(anchor),
      publisher,
      start_year: year != null ? String(year) : null,
      count_of_issues: s.single ? 1 : (albums.length || null),
      deck: null,
      description: s.rec ? summaryOf(s.rec) : null,
      image_url: albums.length ? coverUrl(albums[0].n) : null,
      site_detail_url: arkUrl(s.n),
      aliases: null,
      _comic: comic,
    });
  }
  // Comics before other printed matter; the app ranks by title and year after.
  return out.sort((a, b) => Number(b._comic) - Number(a._comic)).map(({ _comic, ...c }) => c);
}

// ---- The client -------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cql = (s) => `"${String(s || '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`;
const isbnLike = (q) => /^(?:97[89][\d\s-]{10,14}|\d{9}[\dXx])$/.test(String(q || '').trim());

/**
 * A client with the method surface the app expects of a metadata provider:
 * search, volume, issue, issuesByIds, findIssue, searchArcs, storyArcIssues,
 * test. No `list`: the catalogue has no feeds for Discover to read.
 */
export function makeBnfClient({ fetchImpl, politeMs, base, timeoutMs } = {}) {
  const doFetch = fetchImpl || fetch;
  const root = String(base || process.env.BNF_BASE_OVERRIDE || BASE).replace(/\/+$/, '');
  const pace = politeMs !== undefined ? politeMs : POLITE_MS;
  const timeout = timeoutMs !== undefined ? timeoutMs : TIMEOUT_MS;
  let nextAt = 0;

  async function call(query, { start = 1, max = PAGE } = {}, attempt = 0) {
    const wait = nextAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextAt = Date.now() + pace;
    const url = `${root}?version=1.2&operation=searchRetrieve&recordSchema=unimarcxchange&maximumRecords=${max}&startRecord=${start}&query=${encodeURIComponent(query)}`;
    let resp;
    try {
      resp = await doFetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml' }, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      if (attempt < 1) { await sleep(500); return call(query, { start, max }, attempt + 1); }
      const code = e?.cause?.code || e?.name;
      const why = code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'TimeoutError' || code === 'AbortError' ? 'timed out' : (e?.cause?.code || e?.cause?.message || e?.message || e);
      throw new Error(`Could not reach the BnF catalogue (${why})`);
    }
    if (resp.status === 429 || resp.status === 503) {
      if (attempt < 2) { await sleep(2000); return call(query, { start, max }, attempt + 1); }
      const err = new Error(`The BnF catalogue is busy (HTTP ${resp.status})`); err.rateLimited = true; throw err;
    }
    if (!resp.ok) throw new Error(`BnF catalogue HTTP ${resp.status}`);
    const parsed = parseResponse(await resp.text());
    if (parsed.error) throw new Error(`The BnF catalogue rejected the query: ${parsed.error}`);
    return parsed;
  }

  // Every record for a query, paging through the catalogue's cursor.
  async function pages(query, cap = 500) {
    const out = [];
    let start = 1;
    for (;;) {
      const p = await call(query, { start, max: Math.min(PAGE, cap - out.length) });
      out.push(...p.records);
      if (!p.next || out.length >= cap || !p.records.length) break;
      start = p.next;
    }
    return out;
  }

  async function record(n) {
    const p = await call(`bib.persistentid all ${cql(NAAN + arkFor(n))}`, { max: 1 });
    return p.records.find((r) => r.n === Number(n)) || null;
  }
  /** The albums linked to a set, in series order. */
  async function albumsOf(n) { return dedupeAlbums(sortAlbums(await pages(`bib.ens2bib all ${cql(String(n))}`))); }

  async function search(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const p = isbnLike(q)
      ? await call(`bib.isbn adj ${cql(q.replace(/[\s-]/g, ''))} or bib.ean adj ${cql(q.replace(/[\s-]/g, ''))}`, { max: 20 })
      : await call(`bib.title all ${cql(q)} and bib.doctype any "a"`, { max: PAGE });
    return candidatesFrom(p.records);
  }

  async function volume(id) {
    if (!isBnfId(id)) throw new Error('This series is not from the BnF catalogue, so it cannot be refreshed from there');
    const n = unmintId(id);
    const rec = await record(n);
    if (!rec) throw new Error('The BnF catalogue has no record with that id');
    const albums = await albumsOf(n);
    if (albums.length) return shapeSeries(rec, albums);
    return shapeSeries(rec, [rec], { single: true });
  }

  async function issue(id) {
    if (!isBnfId(id)) throw new Error('This issue is not from the BnF catalogue');
    const rec = await record(unmintId(id));
    if (!rec) throw new Error('The BnF catalogue has no record with that id');
    return shapeIssue(rec);
  }

  async function issuesByIds(ids) {
    const out = [];
    for (const id of ids) {
      if (!isBnfId(id)) continue;
      const rec = await record(unmintId(id));
      if (rec) out.push(shapeIssueRow(rec));
    }
    return out;
  }

  async function findIssue(volumeId, number) {
    if (!isBnfId(volumeId)) return null;
    const n = unmintId(volumeId);
    const want = String(number ?? '').trim().replace(',', '.');
    let albums = await albumsOf(n);
    let series = null;
    if (!albums.length) { const rec = await record(n); if (!rec) return null; albums = [rec]; series = rec; }
    const hit = albums.find((a) => String(tomeNumber(a) ?? '1') === want) || (want === '1' && albums.length === 1 ? albums[0] : null);
    return hit ? shapeIssueRow(hit, series) : null;
  }

  // The catalogue has no story arcs.
  async function searchArcs() { return []; }
  async function storyArcIssues(arcId) { return { arc: { id: arcId, name: null }, issues: [] }; }

  async function test() {
    const p = await call('bib.title all "astérix" and bib.doctype any "a"', { max: 1 });
    return { ok: true, message: `The catalogue answered. A test search found ${p.count} records.` };
  }

  return { provider: 'bnf', search, volume, issue, issuesByIds, findIssue, searchArcs, storyArcIssues, test };
}
