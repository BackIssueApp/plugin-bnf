import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MINTED_BASE, mintId, unmintId, isBnfId, arkFor, recordNumber, noidCheck, decodeXml, parseResponse,
  titleOf, publisherOf, yearOf, isOpenEnded, isbnOf, eanOf, priceOf, pageCountOf, isComic, setLink, tomeNumber,
  looksLikeSet, creditsOf, sortAlbums, dedupeAlbums, albumName, shapeSeries, shapeIssue, candidatesFrom, makeBnfClient,
} from '../bnf.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const SEARCH = fixture('southern-bastards-search.xml');
const ALBUMS = fixture('southern-bastards-albums.xml');
const SET = fixture('southern-bastards-set.xml');
const ASTERIX = fixture('asterix-search.xml');
const recs = (xml) => parseResponse(xml).records;
const byN = (xml, n) => recs(xml).find((r) => r.n === n);

// A fetch stub answering by a substring of the decoded query, recording calls.
function stubFetch(routes) {
  const calls = [];
  const impl = async (url, opts) => {
    const q = decodeURIComponent(url);
    calls.push({ url: q, ua: opts?.headers?.['User-Agent'] || '' });
    for (const [needle, body] of routes) {
      if (!q.includes(needle)) continue;
      const r = typeof body === 'function' ? body(q) : body;
      return { ok: (r.status || 200) < 400, status: r.status || 200, text: async () => r.xml ?? '' };
    }
    return { ok: true, status: 200, text: async () => '<srw:searchRetrieveResponse><srw:numberOfRecords>0</srw:numberOfRecords></srw:searchRetrieveResponse>' };
  };
  impl.calls = calls;
  return impl;
}
const client = (routes) => makeBnfClient({ fetchImpl: stubFetch(routes), politeMs: 0 });

test('ids are minted above the Metron range and below Int32', () => {
  assert.equal(MINTED_BASE, 1_100_000_000);
  assert.equal(mintId(44329882), 1_144_329_882);
  assert.equal(unmintId(1_144_329_882), 44329882);
  assert.ok(mintId(99_999_999) < 2 ** 31);
  assert.equal(isBnfId(1_144_329_882), true);
  assert.equal(isBnfId(1_000_002_086), false); // a Metron id
  assert.equal(isBnfId(46568), false);         // a ComicVine id
});

test('the ARK check character is recomputed from the record number', () => {
  for (const ark of ['cb44316542h', 'cb44329882h', 'cb47625315z', 'cb475851264', 'cb45635270r', 'cb443843945', 'cb45155794p']) {
    assert.equal(arkFor(recordNumber(ark)), ark);
  }
  assert.equal(noidCheck('cb44316542'), 'h');
  assert.equal(recordNumber('ark:/12148/cb44329882h'), 44329882);
  assert.equal(recordNumber('44329882'), 44329882);
  assert.equal(recordNumber('nope'), null);
});

test('parseResponse reads the count, the cursor, every record and a diagnostic', () => {
  const p = parseResponse(SEARCH);
  assert.equal(p.count, 7);
  assert.equal(p.records.length, 7);
  assert.equal(p.next, null);
  assert.equal(p.error, null);
  const bad = parseResponse('<srw:searchRetrieveResponse><diag:diagnostic><diag:message>Unsupported index</diag:message></diag:diagnostic></srw:searchRetrieveResponse>');
  assert.equal(bad.error, 'Unsupported index');
  assert.equal(decodeXml('dessin &amp; couleur &#233;t&#xE9;'), 'dessin & couleur été');
});

test('field readers: title, publisher, year, ISBN, EAN, price, pages, set link, tome number', () => {
  const t4 = byN(SEARCH, 45635270); // Du fond des tripes, tome 4
  assert.equal(titleOf(t4), 'Du fond des tripes');
  assert.equal(publisherOf(t4), 'Urban comics');
  assert.equal(yearOf(t4), 2018);
  assert.equal(isbnOf(t4), '978-2-36577-911-1');
  assert.equal(eanOf(t4), '9782365779111');
  assert.equal(priceOf(t4), '15.50 €');
  assert.equal(pageCountOf(t4), 145);
  assert.equal(isComic(t4), true);
  assert.deepEqual(setLink(t4), { n: 44329882, title: 'Southern bastards', number: '4' });
  assert.equal(tomeNumber(t4), '4');
  assert.equal(isOpenEnded(t4), false);
  const v1 = byN(SEARCH, 47585126); // the 2024 "Volume 1" collected edition
  assert.equal(tomeNumber(v1), '1');
  assert.equal(publisherOf(v1), 'Urban');
});

test('a set record is told from an album: no ISBN and an open date', () => {
  const set = byN(SEARCH, 44329882);
  assert.equal(looksLikeSet(set), true);
  assert.equal(isOpenEnded(set), true);
  assert.equal(isbnOf(set), null);
  assert.equal(looksLikeSet(byN(SEARCH, 44316542)), false);
});

test('credits read the relator codes and merge a person credited twice', () => {
  const c = creditsOf(byN(SEARCH, 45635270));
  assert.deepEqual(c, [
    { name: 'Jason Aaron', role: 'Writer' },
    { name: 'Jason Latour', role: 'Artist' },
    { name: 'Chris Brunner', role: 'Artist' },
  ]);
  const legacy = recs(ASTERIX).find((r) => creditsOf(r).some((x) => x.role === 'Creator'));
  assert.ok(legacy, 'an album crediting the original creators');
  assert.ok(creditsOf(legacy).some((x) => x.name === 'René Goscinny' && x.role === 'Creator'));
});

test('albums sort by tome number, then year, then title', () => {
  const sorted = sortAlbums(recs(ALBUMS));
  assert.deepEqual(sorted.map(tomeNumber), ['1', '2', '3', '4']);
  assert.deepEqual(sorted.map(titleOf), ['Ici repose un homme', 'Sang et sueur', 'Retour au bercail', 'Du fond des tripes']);
});

test('candidatesFrom folds albums into their set and puts comics first', () => {
  const c = candidatesFrom(recs(SEARCH));
  assert.equal(c.length, 2);
  const [a, b] = c;
  assert.equal(a.name, 'Southern bastards');
  assert.equal(b.name, 'Southern bastards');
  const main = c.find((x) => x.id === mintId(44329882));
  assert.equal(main.publisher, 'Urban comics');
  assert.equal(main.start_year, '2015');
  assert.equal(main.count_of_issues, 4);
  assert.ok(main.image_url.includes('cb44316542h')); // tome 1's cover stands in
  assert.equal(main.site_detail_url, 'https://catalogue.bnf.fr/ark:/12148/cb44329882h');
  const reissue = c.find((x) => x.id === mintId(47625315));
  assert.equal(reissue.start_year, '2024');
  assert.equal(reissue.count_of_issues, 1);
  for (const x of c) assert.equal('_comic' in x, false);
});

test('a one-shot album with no set is a series of one', () => {
  const stickers = recs(ASTERIX).find((r) => titleOf(r) === '600 autocollants Astérix');
  const c = candidatesFrom([stickers]);
  assert.equal(c.length, 1);
  assert.equal(c[0].count_of_issues, 1);
  assert.equal(c[0].id, mintId(stickers.n));
  const asterix = candidatesFrom(recs(ASTERIX));
  assert.ok(asterix.length < 30, 'albums folded into sets');
  assert.equal(asterix[0].publisher !== undefined, true);
});

test('shapeSeries carries the sidecar and ordered issue stubs', () => {
  const v = shapeSeries(byN(SET, 44329882), sortAlbums(recs(ALBUMS)));
  assert.equal(v.id, mintId(44329882));
  assert.equal(v.name, 'Southern bastards');
  assert.equal(v.publisher, 'Urban comics');
  assert.equal(v.start_year, '2015');
  assert.equal(v.count_of_issues, 4);
  assert.deepEqual(v.issues.map((i) => i.number), ['1', '2', '3', '4']);
  assert.equal(v.issues[1].name, 'Sang et sueur');
  assert.equal(v.metron.series_type, 'Series');
  assert.equal(v.metron.status, 'Ongoing');
  assert.deepEqual(v.metron.genres, ['Bandes dessinées']);
  assert.deepEqual(v.metron.publisher, { name: 'Urban comics' });
  assert.equal(v.metron.year_began, 2015);
  const one = shapeSeries(byN(SEARCH, 44316542), [byN(SEARCH, 44316542)], { single: true });
  assert.equal(one.count_of_issues, 1);
  assert.equal(one.metron.series_type, 'One-shot');
  assert.equal(one.issues[0].name, null);
});

test('shapeIssue maps dates, credits, ISBN, price and the owning series', () => {
  const i = shapeIssue(byN(SEARCH, 45635270));
  assert.equal(i.id, mintId(45635270));
  assert.equal(i.number, '4');
  assert.equal(i.name, 'Du fond des tripes');
  assert.deepEqual(i.volume, { id: mintId(44329882), name: 'Southern bastards' });
  assert.equal(i.store_date, '2018-12-11'); // the legal deposit entry
  assert.equal(i.cover_date, '2018-12-11');
  assert.equal(i.credits[0].name, 'Jason Aaron');
  assert.equal(i.image_url, 'https://catalogue.bnf.fr/couverture?&appName=NE&idArk=ark:/12148/cb45635270r&couverture=1');
  assert.equal(i.site_detail_url, 'https://catalogue.bnf.fr/ark:/12148/cb45635270r');
  assert.equal(i.metron.isbn, '978-2-36577-911-1');
  assert.equal(i.metron.upc, '9782365779111');
  assert.equal(i.metron.price, '15.50 €');
  assert.equal(i.metron.page_count, 145);
  assert.deepEqual(i.metron.credits[0], { id: null, creator: 'Jason Aaron', role: [{ id: null, name: 'Writer' }] });
  assert.equal(i.metron.title, 'Southern bastards');
  // A retrospective entry says nothing about release: year only.
  const old = shapeIssue(recs(ASTERIX).find((r) => titleOf(r) === 'Astérix le Gaulois'));
  assert.equal(old.cover_date, '2019-01-01');
  assert.equal(old.store_date, null);
});

test('search quotes the title and groups the hits; an ISBN searches by number', async () => {
  const c = client([['bib.title all "Southern Bastards"', { xml: SEARCH }]]);
  const r = await c.search('Southern Bastards');
  assert.equal(r.length, 2);
  const c2 = client([['bib.isbn adj "9782365779111"', { xml: SEARCH }]]);
  await c2.search('978-2-36577-911-1');
  assert.ok(c2.fetchCalls === undefined);
  const stub = stubFetch([]);
  const c3 = makeBnfClient({ fetchImpl: stub, politeMs: 0 });
  await c3.search('a "quoted" title');
  assert.ok(stub.calls[0].url.includes('bib.title all "a quoted title"'));
  assert.ok(stub.calls[0].ua.startsWith('BackIssue-bnf/'));
});

test('volume fetches the set record and its albums; a lone album is its own series', async () => {
  const c = client([
    ['bib.persistentid all "ark:/12148/cb44329882h"', { xml: SET }],
    ['bib.ens2bib all "44329882"', { xml: ALBUMS }],
  ]);
  const v = await c.volume(mintId(44329882));
  assert.equal(v.name, 'Southern bastards');
  assert.equal(v.issues.length, 4);
  assert.equal(v.issues[3].id, mintId(45635270));
  const lone = client([['bib.persistentid all "ark:/12148/cb44316542h"', { xml: SEARCH.replace(/<srw:record>[\s\S]*?cb44329882h[\s\S]*?<\/srw:record>/, '') }]]);
  const one = await lone.volume(mintId(44316542));
  assert.equal(one.count_of_issues, 1);
  await assert.rejects(c.volume(46568), /not from the BnF catalogue/);
  await assert.rejects(c.volume(mintId(12345678)), /no record with that id/);
});

test('issue, issuesByIds and findIssue resolve albums by record and by number', async () => {
  const c = client([
    ['bib.persistentid all "ark:/12148/cb45635270r"', { xml: SEARCH }],
    ['bib.ens2bib all "44329882"', { xml: ALBUMS }],
  ]);
  const i = await c.issue(mintId(45635270));
  assert.equal(i.number, '4');
  const rows = await c.issuesByIds([mintId(45635270), 46568]);
  assert.equal(rows.length, 1);
  const f = await c.findIssue(mintId(44329882), '3');
  assert.equal(f.id, mintId(45155794));
  assert.equal(await c.findIssue(mintId(44329882), '9'), null);
  assert.equal(await c.findIssue(46568, '1'), null);
});

test('a diagnostic, a busy catalogue and an unreachable host read clearly', async () => {
  const diag = client([['bib.title', { xml: '<r><diag:message>Query syntax error</diag:message></r>' }]]);
  await assert.rejects(diag.search('x'), /rejected the query: Query syntax error/);
  const busy = client([['bib.title', { status: 503 }]]);
  await assert.rejects(busy.search('x'), (e) => e.rateLimited === true);
  const down = makeBnfClient({ fetchImpl: () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })), politeMs: 0 });
  await assert.rejects(down.test(), /Could not reach the BnF catalogue \(ENOTFOUND\)/);
});

test('the Test round trip reports the catalogue count', async () => {
  const c = client([['bib.title all "astérix"', { xml: ASTERIX }]]);
  const r = await c.test();
  assert.equal(r.ok, true);
  assert.match(r.message, /588 records/);
});

test('a price keeps a non-euro currency; euros get the sign', () => {
  const mk = (d) => ({ n: 1, ark: 'x', fields: [{ tag: '010', ind1: ' ', ind2: ' ', subs: [['a', '2-205-04965-8'], ['d', d]] }] });
  assert.equal(priceOf(mk('79 F')), '79 F');
  assert.equal(priceOf(mk('15,50 EUR')), '15.50 €');
  assert.equal(priceOf(mk('25 EUR')), '25 €');
  assert.equal(priceOf(mk('12.99 GBP')), '12.99 GBP');
  assert.equal(priceOf({ n: 1, ark: 'x', fields: [] }), null);
});

test('reprints of a tome collapse to the earliest printing; part titles name the album', () => {
  const t1 = byN(SEARCH, 44316542);
  const reprint = { ...t1, n: 99999999, fields: t1.fields.map((f) => (f.tag === '100' ? { ...f, subs: [['a', '20200101d2020    m  y0frey50      ba']] } : f)) };
  const kept = dedupeAlbums(sortAlbums([reprint, t1, byN(SEARCH, 44384394)]));
  assert.deepEqual(kept.map((r) => r.n), [44316542, 44384394]);
  const parted = { n: 5, ark: 'x', fields: [
    { tag: '200', ind1: '1', ind2: ' ', subs: [['a', 'Blacksad'], ['h', '3'], ['i', 'Âme rouge']] },
    { tag: '461', ind1: ' ', ind2: ' ', subs: [['0', '37127367'], ['t', 'Blacksad'], ['v', '3']] },
  ] };
  assert.equal(albumName(parted), 'Âme rouge');
  const bare = { ...parted, fields: [{ tag: '200', ind1: '1', ind2: ' ', subs: [['a', 'Blacksad']] }, parted.fields[1]] };
  assert.equal(albumName(bare), null);
  assert.equal(albumName(t1, 'Southern bastards'), 'Ici repose un homme');
  const v = shapeSeries({ n: 37127367, ark: 'y', fields: [{ tag: '200', ind1: '1', ind2: ' ', subs: [['a', 'Blacksad']] }] }, [parted, bare]);
  assert.deepEqual(v.issues.map((i) => i.name), ['Âme rouge', null]);
});
